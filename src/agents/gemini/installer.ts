import { join } from "node:path";

import type { InstallHost } from "../install-host.ts";

import { formatArgv } from "../../util/argv.ts";
import { log } from "../../util/log.ts";
import { type HostConsent, readHostConsent, writeHostConsent } from "../consent-store.ts";
import { localInstallHost } from "../install-host.ts";
// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const HOOK_SCRIPT_NAME = "honeymux.py";
const HOOK_EVENTS = ["SessionStart", "BeforeAgent", "Notification", "SessionEnd"];

type GeminiSettings = {
  hooks?: Record<string, HookMatcherGroup[]>;
};

type HookHandler = {
  command: string;
  type: "command";
};

type HookMatcherGroup = {
  hooks: HookHandler[];
};

type ResolveExecutable = (name: string) => null | string | undefined;

// Consent lives on the local filesystem regardless of install target.
const CONSENT_FILE = `${process.env.HOME}/.local/state/honeymux/gemini-hooks-consent.json`;

export async function areGeminiHooksInstalled(host: InstallHost = localInstallHost): Promise<boolean> {
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  const script = await host.readFile(scriptPath);
  if (script === null) return false;
  const resolver = await buildHostResolver(host);
  return buildGeminiHookCommand(scriptPath, resolver) !== null;
}

export async function installGeminiHooks(host: InstallHost = localInstallHost): Promise<boolean> {
  try {
    const hooksDir = await getHooksDir(host);
    await host.mkdir(hooksDir, { recursive: true });

    const destPath = join(hooksDir, HOOK_SCRIPT_NAME);
    if (!(await syncGeminiHookInstall(host, destPath))) return false;

    await saveGeminiConsent(true, host.hostId);
    return true;
  } catch {
    return false;
  }
}

export function isGeminiConsented(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).consented === true;
}

export function isGeminiIgnored(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).ignored === true;
}

/**
 * If the user has granted consent for this host and the hook script is already
 * present on disk, re-run the sync so script + settings stay current with the
 * bundled version. No-op when consent is missing or the script is absent.
 */
export async function refreshGeminiHooksIfConsented(host: InstallHost = localInstallHost): Promise<void> {
  if (readHostConsent(CONSENT_FILE, host.hostId).consented !== true) return;
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  if ((await host.readFile(scriptPath)) === null) return;
  try {
    await syncGeminiHookInstall(host, scriptPath);
  } catch {
    // best-effort — silent failure, normal flows will re-surface on next detection
  }
}

export async function saveGeminiConsent(consented: boolean, hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export async function saveGeminiIgnored(hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented: false, ignored: true, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

function buildGeminiHookCommand(
  scriptPath: string,
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  const interpreter = resolveGeminiHookPython(resolveExecutable);
  if (!interpreter) return null;
  return formatArgv([interpreter, scriptPath]);
}

async function buildHostResolver(host: InstallHost): Promise<ResolveExecutable> {
  const python3 = await host.resolveExecutable("python3");
  const python = await host.resolveExecutable("python");
  return (name) => (name === "python3" ? python3 : name === "python" ? python : null);
}

function containsOurHook(obj: unknown): boolean {
  if (typeof obj === "string") return obj.includes(HOOK_SCRIPT_NAME);
  if (Array.isArray(obj)) return obj.some(containsOurHook);
  if (obj && typeof obj === "object") return Object.values(obj).some(containsOurHook);
  return false;
}

async function getHooksDir(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.gemini/hooks`;
}

async function getSettingsFile(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.gemini/settings.json`;
}

function resolveGeminiHookPython(resolveExecutable: ResolveExecutable = (name) => Bun.which(name)): null | string {
  return resolveExecutable("python3") ?? resolveExecutable("python") ?? null;
}

function safeParseJson(text: string): GeminiSettings {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function syncGeminiHookInstall(host: InstallHost, scriptPath: string): Promise<boolean> {
  const resolver = await buildHostResolver(host);
  const command = buildGeminiHookCommand(scriptPath, resolver);
  if (!command) return false;

  await host.mkdir(await getHooksDir(host), { recursive: true });

  const currentScript = await host.readFile(scriptPath);
  if (currentScript !== HOOK_CONTENT) {
    await host.writeFile(scriptPath, HOOK_CONTENT, { mode: 0o755 });
    log(
      "hooks",
      `gemini: ${currentScript === null ? "installed" : "updated"} hook script on ${host.hostId} at ${scriptPath}`,
    );
  }

  const settingsFile = await getSettingsFile(host);
  const currentSettingsText = await host.readFile(settingsFile);
  const currentSettings: GeminiSettings = currentSettingsText ? safeParseJson(currentSettingsText) : {};
  const nextSettings = upsertGeminiHookSettings(currentSettings, command);
  const nextSettingsText = JSON.stringify(nextSettings, null, 2);
  if (currentSettingsText !== nextSettingsText) {
    await host.writeFile(settingsFile, nextSettingsText);
    log(
      "hooks",
      `gemini: ${currentSettingsText === null ? "installed" : "updated"} settings on ${host.hostId} at ${settingsFile}`,
    );
  }

  return true;
}

function upsertGeminiHookSettings(settings: GeminiSettings, command: string): GeminiSettings {
  const next: GeminiSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}) },
  };

  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(next.hooks?.[event]) ? next.hooks[event] : [];
    const filtered = existing.filter((group: unknown) => !containsOurHook(group));
    next.hooks![event] = [
      ...filtered,
      {
        hooks: [
          {
            command,
            type: "command",
          },
        ],
      },
    ];
  }

  return next;
}

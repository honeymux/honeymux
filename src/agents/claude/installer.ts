import { join } from "node:path";

import type { InstallHost } from "../install-host.ts";

import { formatArgv } from "../../util/argv.ts";
import { type HostConsent, readHostConsent, writeHostConsent } from "../consent-store.ts";
import { localInstallHost } from "../install-host.ts";
// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const HOOK_SCRIPT_NAME = "honeymux.py";
const HOOK_EVENTS = ["SessionStart", "PermissionRequest", "SessionEnd"];
// PermissionRequest is synchronous (script blocks for approval); all others async
const SYNC_EVENTS = new Set(["PermissionRequest"]);

type ClaudeSettings = {
  hooks?: Record<string, HookMatcherGroup[]>;
};

type HookHandler = {
  async?: boolean;
  command: string;
  type: "command";
};

type HookMatcherGroup = {
  hooks: HookHandler[];
};

type ResolveExecutable = (name: string) => null | string | undefined;

// Consent lives on the local filesystem regardless of install target.
const CONSENT_FILE = `${process.env.HOME}/.local/state/honeymux/claude-hooks-consent.json`;

export async function areClaudeHooksInstalled(host: InstallHost = localInstallHost): Promise<boolean> {
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  const script = await host.readFile(scriptPath);
  if (script === null) return false;

  try {
    return await syncClaudeHookInstall(host, scriptPath);
  } catch {
    return false;
  }
}

export function buildClaudeHookCommand(
  scriptPath: string,
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  const interpreter = resolveClaudeHookPython(resolveExecutable);
  if (!interpreter) return null;
  return formatArgv([interpreter, scriptPath]);
}

export async function installClaudeHooks(host: InstallHost = localInstallHost): Promise<boolean> {
  try {
    const hooksDir = await getHooksDir(host);
    await host.mkdir(hooksDir, { recursive: true });

    const destPath = join(hooksDir, HOOK_SCRIPT_NAME);
    if (!(await syncClaudeHookInstall(host, destPath))) return false;

    await saveClaudeConsent(true, host.hostId);
    return true;
  } catch {
    return false;
  }
}

export function isClaudeIgnored(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).ignored === true;
}

export function resolveClaudeHookPython(
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  return resolveExecutable("python3") ?? resolveExecutable("python") ?? null;
}

export async function saveClaudeConsent(consented: boolean, hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export async function saveClaudeIgnored(hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented: false, ignored: true, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export function upsertClaudeHookSettings(settings: ClaudeSettings, command: string): ClaudeSettings {
  const next: ClaudeSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}) },
  };

  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(next.hooks?.[event]) ? next.hooks[event] : [];
    const filtered = existing.filter((group: unknown) => !containsOurHook(group));
    const hookHandler: HookHandler = {
      command,
      type: "command",
    };

    if (!SYNC_EVENTS.has(event)) {
      hookHandler.async = true;
    }

    next.hooks![event] = [
      ...filtered,
      {
        hooks: [hookHandler],
      },
    ];
  }

  return next;
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
  return `${await host.homeDir()}/.claude/hooks`;
}

async function getSettingsFile(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.claude/settings.json`;
}

function safeParseJson(text: string): ClaudeSettings {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function syncClaudeHookInstall(host: InstallHost, scriptPath: string): Promise<boolean> {
  const resolver = await buildHostResolver(host);
  const command = buildClaudeHookCommand(scriptPath, resolver);
  if (!command) return false;

  await host.mkdir(await getHooksDir(host), { recursive: true });

  const currentScript = await host.readFile(scriptPath);
  if (currentScript !== HOOK_CONTENT) {
    await host.writeFile(scriptPath, HOOK_CONTENT, { mode: 0o755 });
  }

  const settingsFile = await getSettingsFile(host);
  const currentSettingsText = await host.readFile(settingsFile);
  const currentSettings: ClaudeSettings = currentSettingsText ? safeParseJson(currentSettingsText) : {};
  const nextSettings = upsertClaudeHookSettings(currentSettings, command);
  const nextSettingsText = JSON.stringify(nextSettings, null, 2);
  if (currentSettingsText !== nextSettingsText) {
    await host.writeFile(settingsFile, nextSettingsText);
  }

  return true;
}

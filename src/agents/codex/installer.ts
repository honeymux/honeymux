import { join } from "node:path";

import type { InstallHost } from "../install-host.ts";

import { formatArgv } from "../../util/argv.ts";
import { log } from "../../util/log.ts";
import { type HostConsent, readHostConsent, writeHostConsent } from "../consent-store.ts";
import { localInstallHost } from "../install-host.ts";
// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const HOOK_SCRIPT_NAME = "honeymux.py";

type CodexSettings = {
  hooks?: {
    SessionStart?: HookMatcherGroup[];
  };
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
const CONSENT_FILE = `${process.env.HOME}/.local/state/honeymux/codex-hooks-consent.json`;

export async function areCodexHooksInstalled(host: InstallHost = localInstallHost): Promise<boolean> {
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  const script = await host.readFile(scriptPath);
  if (script === null) return false;
  const resolver = await buildHostResolver(host);
  return buildCodexHookCommand(scriptPath, resolver) !== null;
}

export function buildCodexHookCommand(
  scriptPath: string,
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  const interpreter = resolveCodexHookPython(resolveExecutable);
  if (!interpreter) return null;
  return formatArgv([interpreter, scriptPath]);
}

export async function installCodexHooks(host: InstallHost = localInstallHost): Promise<boolean> {
  try {
    const hooksDir = await getHooksDir(host);
    await host.mkdir(hooksDir, { recursive: true });

    const destPath = join(hooksDir, HOOK_SCRIPT_NAME);
    if (!(await syncCodexHookInstall(host, destPath))) return false;

    await saveCodexConsent(true, host.hostId);
    return true;
  } catch {
    return false;
  }
}

export function isCodexConsented(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).consented === true;
}

export function isCodexIgnored(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).ignored === true;
}

/**
 * If the user has granted consent for this host and the hook script is already
 * present on disk, re-run the sync so script + hooks.json + config.toml stay
 * current with the bundled version. No-op when consent is missing or the
 * script is absent.
 */
export async function refreshCodexHooksIfConsented(host: InstallHost = localInstallHost): Promise<void> {
  if (readHostConsent(CONSENT_FILE, host.hostId).consented !== true) return;
  const scriptPath = join(await getHooksDir(host), HOOK_SCRIPT_NAME);
  if ((await host.readFile(scriptPath)) === null) return;
  try {
    await syncCodexHookInstall(host, scriptPath);
  } catch {
    // best-effort — silent failure, normal flows will re-surface on next detection
  }
}

export function resolveCodexHookPython(
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  return resolveExecutable("python3") ?? resolveExecutable("python") ?? null;
}

export async function saveCodexConsent(consented: boolean, hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export async function saveCodexIgnored(hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented: false, ignored: true, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export function upsertCodexHookSettings(settings: CodexSettings, command: string): CodexSettings {
  const next: CodexSettings = {
    ...settings,
    hooks: { ...(settings.hooks ?? {}) },
  };
  const hooks = next.hooks!;

  hooks["SessionStart"] = Array.isArray(hooks["SessionStart"])
    ? hooks["SessionStart"].filter((group: unknown) => !containsOurHook(group))
    : [];

  hooks["SessionStart"].push({
    hooks: [
      {
        command,
        type: "command",
      },
    ],
  });

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

function ensureCodexHooksFeature(configText: string): string {
  const lines = configText.split(/\r?\n/);
  let inFeatures = false;
  let inserted = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inFeatures && !inserted) {
        lines.splice(i, 0, "codex_hooks = true");
        inserted = true;
        break;
      }
      inFeatures = trimmed === "[features]";
      continue;
    }
    if (inFeatures && /^codex_hooks\s*=/.test(trimmed)) {
      lines[i] = "codex_hooks = true";
      inserted = true;
      break;
    }
  }

  if (!inserted) {
    if (inFeatures) {
      lines.push("codex_hooks = true");
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push("[features]");
      lines.push("codex_hooks = true");
    }
  }

  return `${lines.join("\n")}\n`;
}

async function getConfigFile(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.codex/config.toml`;
}

async function getHooksDir(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.codex/hooks`;
}

async function getHooksFile(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.codex/hooks.json`;
}

function safeParseJson(text: string): CodexSettings {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function syncCodexHookInstall(host: InstallHost, scriptPath: string): Promise<boolean> {
  const resolver = await buildHostResolver(host);
  const command = buildCodexHookCommand(scriptPath, resolver);
  if (!command) return false;

  await host.mkdir(await getHooksDir(host), { recursive: true });

  const currentScript = await host.readFile(scriptPath);
  if (currentScript !== HOOK_CONTENT) {
    await host.writeFile(scriptPath, HOOK_CONTENT, { mode: 0o755 });
    log(
      "hooks",
      `codex: ${currentScript === null ? "installed" : "updated"} hook script on ${host.hostId} at ${scriptPath}`,
    );
  }

  const hooksFile = await getHooksFile(host);
  const currentHooksText = await host.readFile(hooksFile);
  const currentSettings: CodexSettings = currentHooksText ? safeParseJson(currentHooksText) : {};
  const nextSettings = upsertCodexHookSettings(currentSettings, command);
  const nextHooksText = JSON.stringify(nextSettings, null, 2);
  if (currentHooksText !== nextHooksText) {
    await host.writeFile(hooksFile, nextHooksText);
    log(
      "hooks",
      `codex: ${currentHooksText === null ? "installed" : "updated"} hooks.json on ${host.hostId} at ${hooksFile}`,
    );
  }

  const configFile = await getConfigFile(host);
  const currentConfigText = (await host.readFile(configFile)) ?? "";
  const nextConfigText = ensureCodexHooksFeature(currentConfigText);
  if (currentConfigText !== nextConfigText) {
    await host.writeFile(configFile, nextConfigText);
    log("hooks", `codex: updated config.toml on ${host.hostId} at ${configFile}`);
  }

  return true;
}

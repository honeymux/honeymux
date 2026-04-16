import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatArgv } from "../../util/argv.ts";
// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const CODEX_DIR = `${process.env.HOME}/.codex`;
const HOOKS_DIR = `${CODEX_DIR}/hooks`;
const HOOKS_FILE = `${CODEX_DIR}/hooks.json`;
const CONFIG_FILE = `${CODEX_DIR}/config.toml`;
const HOOK_SCRIPT_NAME = "honeymux.py";
const CONSENT_DIR = `${process.env.HOME}/.local/state/honeymux`;
const CONSENT_FILE = `${CONSENT_DIR}/codex-hooks-consent.json`;

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

export function areCodexHooksInstalled(): boolean {
  const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
  if (!existsSync(scriptPath)) return false;

  try {
    return syncCodexHookInstall(scriptPath);
  } catch {
    return false;
  }
}

export function buildCodexHookCommand(
  scriptPath: string,
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  const interpreter = resolveCodexHookPython(resolveExecutable);
  if (!interpreter) return null;
  return formatArgv([interpreter, scriptPath]);
}

export async function installCodexHooks(): Promise<boolean> {
  try {
    mkdirSync(HOOKS_DIR, { recursive: true });

    const destPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
    if (!syncCodexHookInstall(destPath)) return false;

    await saveCodexConsent(true);
    return true;
  } catch {
    return false;
  }
}

export function isCodexIgnored(): boolean {
  try {
    const content = readFileSync(CONSENT_FILE, "utf-8");
    const data = JSON.parse(content);
    return data.ignored === true;
  } catch {
    return false;
  }
}

export function resolveCodexHookPython(
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  return resolveExecutable("python3") ?? resolveExecutable("python") ?? null;
}

export async function saveCodexConsent(consented: boolean): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
}

export async function saveCodexIgnored(): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented: false, ignored: true, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
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

function loadCodexSettings(): CodexSettings {
  try {
    const content = readFileSync(HOOKS_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function syncCodexHookInstall(scriptPath: string): boolean {
  const command = buildCodexHookCommand(scriptPath);
  if (!command) return false;

  mkdirSync(HOOKS_DIR, { recursive: true });

  const currentScript = existsSync(scriptPath) ? readFileSync(scriptPath, "utf-8") : null;
  if (currentScript !== HOOK_CONTENT) {
    writeFileSync(scriptPath, HOOK_CONTENT);
    chmodSync(scriptPath, 0o755);
  }

  const currentHooksText = existsSync(HOOKS_FILE) ? readFileSync(HOOKS_FILE, "utf-8") : null;
  const settings = upsertCodexHookSettings(loadCodexSettings(), command);
  const nextHooksText = JSON.stringify(settings, null, 2);
  if (currentHooksText !== nextHooksText) {
    writeFileSync(HOOKS_FILE, nextHooksText);
  }

  const currentConfigText = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, "utf-8") : "";
  const nextConfigText = ensureCodexHooksFeature(currentConfigText);
  if (currentConfigText !== nextConfigText) {
    writeFileSync(CONFIG_FILE, nextConfigText);
  }

  return true;
}

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { formatArgv } from "../../util/argv.ts";
// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const CLAUDE_DIR = `${process.env.HOME}/.claude`;
const HOOKS_DIR = `${CLAUDE_DIR}/hooks`;
const SETTINGS_FILE = `${CLAUDE_DIR}/settings.json`;
const HOOK_SCRIPT_NAME = "honeymux.py";
const CONSENT_DIR = `${process.env.HOME}/.local/state/honeymux`;
const CONSENT_FILE = `${CONSENT_DIR}/claude-hooks-consent.json`;

const HOOK_EVENTS = ["SessionStart", "PermissionRequest", "SessionEnd"];

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

// PermissionRequest is synchronous (script blocks for approval); all others async
const SYNC_EVENTS = new Set(["PermissionRequest"]);

export function areClaudeHooksInstalled(): boolean {
  const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
  if (!existsSync(scriptPath)) return false;

  try {
    return syncClaudeHookInstall(scriptPath);
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

export async function installClaudeHooks(): Promise<boolean> {
  try {
    mkdirSync(HOOKS_DIR, { recursive: true });

    const destPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
    if (!syncClaudeHookInstall(destPath)) return false;

    await saveClaudeConsent(true);
    return true;
  } catch {
    return false;
  }
}

export function isClaudeIgnored(): boolean {
  try {
    const content = readFileSync(CONSENT_FILE, "utf-8");
    const data = JSON.parse(content);
    return data.ignored === true;
  } catch {
    return false;
  }
}

export function resolveClaudeHookPython(
  resolveExecutable: ResolveExecutable = (name) => Bun.which(name),
): null | string {
  return resolveExecutable("python3") ?? resolveExecutable("python") ?? null;
}

export async function saveClaudeConsent(consented: boolean): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
}

export async function saveClaudeIgnored(): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented: false, ignored: true, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
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

function containsOurHook(obj: any): boolean {
  if (typeof obj === "string") return obj.includes(HOOK_SCRIPT_NAME);
  if (Array.isArray(obj)) return obj.some(containsOurHook);
  if (obj && typeof obj === "object") return Object.values(obj).some(containsOurHook);
  return false;
}

function loadClaudeSettings(): ClaudeSettings {
  try {
    const content = readFileSync(SETTINGS_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function syncClaudeHookInstall(scriptPath: string): boolean {
  const command = buildClaudeHookCommand(scriptPath);
  if (!command) return false;

  mkdirSync(HOOKS_DIR, { recursive: true });

  const currentScript = existsSync(scriptPath) ? readFileSync(scriptPath, "utf-8") : null;
  if (currentScript !== HOOK_CONTENT) {
    writeFileSync(scriptPath, HOOK_CONTENT);
    chmodSync(scriptPath, 0o755);
  }

  const currentSettingsText = existsSync(SETTINGS_FILE) ? readFileSync(SETTINGS_FILE, "utf-8") : null;
  const settings = upsertClaudeHookSettings(loadClaudeSettings(), command);
  const nextSettingsText = JSON.stringify(settings, null, 2);
  if (currentSettingsText !== nextSettingsText) {
    writeFileSync(SETTINGS_FILE, nextSettingsText);
  }

  return true;
}

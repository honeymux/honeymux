import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// PermissionRequest is synchronous (script blocks for approval); all others async
const SYNC_EVENTS = new Set(["PermissionRequest"]);

export function areClaudeHooksInstalled(): boolean {
  // The script must actually exist on disk, not just be referenced in settings
  const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
  return existsSync(scriptPath);
}

export async function installClaudeHooks(): Promise<boolean> {
  try {
    // Ensure hooks directory exists
    mkdirSync(HOOKS_DIR, { recursive: true });

    // Copy hook script
    const destPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
    await Bun.write(destPath, HOOK_CONTENT);
    chmodSync(destPath, 0o755);

    // Read existing settings
    let settings: ClaudeSettings = {};
    try {
      const content = await Bun.file(SETTINGS_FILE).text();
      settings = JSON.parse(content);
    } catch {
      // no existing settings — start fresh
    }

    if (!settings.hooks) settings.hooks = {};

    // New format: each event has an array of matcher groups.
    // Each matcher group has { matcher?: string, hooks: HookHandler[] }
    // We add one matcher group per event with no matcher (matches everything).
    for (const event of HOOK_EVENTS) {
      if (!Array.isArray(settings.hooks[event])) {
        settings.hooks[event] = [];
      }

      // Remove any existing honeymux matcher groups
      settings.hooks[event] = settings.hooks[event].filter((group: any) => !containsOurHook(group));

      const hookHandler: HookHandler = {
        command: `python3 ${destPath}`,
        type: "command",
      };

      if (!SYNC_EVENTS.has(event)) {
        hookHandler.async = true;
      }

      // Wrap in the matcher group format: { hooks: [handler] }
      settings.hooks[event].push({
        hooks: [hookHandler],
      });
    }

    await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));

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

function containsOurHook(obj: any): boolean {
  if (typeof obj === "string") return obj.includes(HOOK_SCRIPT_NAME);
  if (Array.isArray(obj)) return obj.some(containsOurHook);
  if (obj && typeof obj === "object") return Object.values(obj).some(containsOurHook);
  return false;
}

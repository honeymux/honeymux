import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Embed hook script at build time so it survives `bun build --compile`.
import HOOK_CONTENT from "./hooks.py" with { type: "text" };

const GEMINI_DIR = `${process.env.HOME}/.gemini`;
const HOOKS_DIR = `${GEMINI_DIR}/hooks`;
const SETTINGS_FILE = `${GEMINI_DIR}/settings.json`;
const HOOK_SCRIPT_NAME = "honeymux.py";
const CONSENT_DIR = `${process.env.HOME}/.local/state/honeymux`;
const CONSENT_FILE = `${CONSENT_DIR}/gemini-hooks-consent.json`;

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

export function areGeminiHooksInstalled(): boolean {
  // The script must actually exist on disk, not just be referenced in settings
  const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
  if (!existsSync(scriptPath)) return false;
  // Auto-update: sync hook script if bundled content differs from installed
  try {
    const dstContent = readFileSync(scriptPath, "utf-8");
    if (dstContent !== HOOK_CONTENT) {
      Bun.write(scriptPath, HOOK_CONTENT);
      // Also ensure all hook events are registered (new events may have been added)
      try {
        const settingsContent = readFileSync(SETTINGS_FILE, "utf-8");
        const settings = JSON.parse(settingsContent);
        if (settings.hooks) {
          let changed = false;
          for (const event of HOOK_EVENTS) {
            if (!Array.isArray(settings.hooks[event]) || !containsOurHook(settings.hooks[event])) {
              if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
              settings.hooks[event].push({ hooks: [{ command: `python3 ${scriptPath}`, type: "command" }] });
              changed = true;
            }
          }
          if (changed) Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        }
      } catch {
        // best-effort settings sync
      }
    }
  } catch {
    // best-effort sync
  }
  return true;
}

export async function installGeminiHooks(): Promise<boolean> {
  try {
    // Ensure hooks directory exists
    mkdirSync(HOOKS_DIR, { recursive: true });

    // Copy hook script
    const destPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
    await Bun.write(destPath, HOOK_CONTENT);
    chmodSync(destPath, 0o755);

    // Read existing settings
    let settings: GeminiSettings = {};
    try {
      const content = await Bun.file(SETTINGS_FILE).text();
      settings = JSON.parse(content);
    } catch {
      // no existing settings — start fresh
    }

    if (!settings.hooks) settings.hooks = {};

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

      // Gemini hooks are all synchronous by default; no async field needed.
      // But for non-blocking events we don't need the response, so they
      // just exit quickly.

      settings.hooks[event].push({
        hooks: [hookHandler],
      });
    }

    await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));

    await saveGeminiConsent(true);
    return true;
  } catch {
    return false;
  }
}

export function isGeminiIgnored(): boolean {
  try {
    const content = readFileSync(CONSENT_FILE, "utf-8");
    const data = JSON.parse(content);
    return data.ignored === true;
  } catch {
    return false;
  }
}

export async function saveGeminiConsent(consented: boolean): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
}

export async function saveGeminiIgnored(): Promise<void> {
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

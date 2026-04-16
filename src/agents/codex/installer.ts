import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function areCodexHooksInstalled(): boolean {
  const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
  if (!existsSync(scriptPath) || !existsSync(HOOKS_FILE) || !isCodexHooksFeatureEnabled()) {
    return false;
  }

  try {
    const content = readFileSync(HOOKS_FILE, "utf-8");
    const settings = JSON.parse(content);
    return containsOurHook(settings?.hooks);
  } catch {
    return false;
  }
}

export async function installCodexHooks(): Promise<boolean> {
  try {
    mkdirSync(HOOKS_DIR, { recursive: true });

    const destPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
    await Bun.write(destPath, HOOK_CONTENT);
    chmodSync(destPath, 0o755);

    let settings: CodexSettings = {};
    try {
      const content = await Bun.file(HOOKS_FILE).text();
      settings = JSON.parse(content);
    } catch {
      // no existing hook config
    }

    if (!settings.hooks || typeof settings.hooks !== "object") {
      settings.hooks = {};
    }

    settings.hooks["SessionStart"] = Array.isArray(settings.hooks["SessionStart"])
      ? settings.hooks["SessionStart"].filter((group: unknown) => !containsOurHook(group))
      : [];

    settings.hooks["SessionStart"].push({
      hooks: [
        {
          command: `python3 ${destPath}`,
          type: "command",
        },
      ],
    });

    await Bun.write(HOOKS_FILE, JSON.stringify(settings, null, 2));

    let configText = "";
    try {
      configText = await Bun.file(CONFIG_FILE).text();
    } catch {
      // create a new config file
    }
    await Bun.write(CONFIG_FILE, ensureCodexHooksFeature(configText));

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

function isCodexHooksFeatureEnabled(): boolean {
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const lines = content.split(/\r?\n/);
    let inFeatures = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        inFeatures = trimmed === "[features]";
        continue;
      }
      if (inFeatures && /^codex_hooks\s*=\s*true\b/.test(trimmed)) {
        return true;
      }
    }
  } catch {}
  return false;
}

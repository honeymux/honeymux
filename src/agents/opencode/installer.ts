import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Embed plugin script at build time so it survives `bun build --compile`.
import PLUGIN_CONTENT from "./plugin.source" with { type: "text" };

const OPENCODE_CONFIG_DIR = `${process.env.HOME}/.config/opencode`;
const OPENCODE_PLUGINS_DIR = `${OPENCODE_CONFIG_DIR}/plugins`;
const PLUGIN_SCRIPT_NAME = "honeymux.ts";
const CONSENT_DIR = `${process.env.HOME}/.local/state/honeymux`;
const CONSENT_FILE = `${CONSENT_DIR}/opencode-plugin-consent.json`;

export async function installOpenCodePlugin(): Promise<boolean> {
  try {
    // Ensure plugins directory exists
    mkdirSync(OPENCODE_PLUGINS_DIR, { recursive: true });

    // Copy plugin script
    const destPath = join(OPENCODE_PLUGINS_DIR, PLUGIN_SCRIPT_NAME);
    await Bun.write(destPath, PLUGIN_CONTENT);

    await saveOpenCodeConsent(true);
    return true;
  } catch {
    return false;
  }
}

export function isOpenCodeIgnored(): boolean {
  try {
    const content = readFileSync(CONSENT_FILE, "utf-8");
    const data = JSON.parse(content);
    return data.ignored === true;
  } catch {
    return false;
  }
}

export function isOpenCodePluginInstalled(): boolean {
  const destPath = join(OPENCODE_PLUGINS_DIR, PLUGIN_SCRIPT_NAME);
  if (!existsSync(destPath)) return false;
  // Auto-update: sync plugin content if bundled version differs from installed
  try {
    const dstContent = readFileSync(destPath, "utf-8");
    if (dstContent !== PLUGIN_CONTENT) {
      Bun.write(destPath, PLUGIN_CONTENT);
    }
  } catch {
    // best-effort sync
  }
  return true;
}

export async function saveOpenCodeConsent(consented: boolean): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
}

export async function saveOpenCodeIgnored(): Promise<void> {
  try {
    mkdirSync(CONSENT_DIR, { recursive: true });
    await Bun.write(CONSENT_FILE, JSON.stringify({ consented: false, ignored: true, savedAt: Date.now() }));
  } catch {
    // best-effort
  }
}

import { join } from "node:path";

import type { InstallHost } from "../install-host.ts";

import { log } from "../../util/log.ts";
import { type HostConsent, readHostConsent, writeHostConsent } from "../consent-store.ts";
import { localInstallHost } from "../install-host.ts";
// Embed plugin script at build time so it survives `bun build --compile`.
import PLUGIN_CONTENT from "./plugin.source" with { type: "text" };

const PLUGIN_SCRIPT_NAME = "honeymux.ts";

// Consent lives on the local filesystem regardless of install target.
const CONSENT_FILE = `${process.env.HOME}/.local/state/honeymux/opencode-plugin-consent.json`;

export async function installOpenCodePlugin(host: InstallHost = localInstallHost): Promise<boolean> {
  try {
    const pluginsDir = await getPluginsDir(host);
    await host.mkdir(pluginsDir, { recursive: true });

    const destPath = join(pluginsDir, PLUGIN_SCRIPT_NAME);
    await syncOpenCodePlugin(host, destPath);

    await saveOpenCodeConsent(true, host.hostId);
    return true;
  } catch {
    return false;
  }
}

export function isOpenCodeIgnored(hostId: string = "local"): boolean {
  return readHostConsent(CONSENT_FILE, hostId).ignored === true;
}

export async function isOpenCodePluginInstalled(host: InstallHost = localInstallHost): Promise<boolean> {
  const destPath = join(await getPluginsDir(host), PLUGIN_SCRIPT_NAME);
  return (await host.readFile(destPath)) !== null;
}

/**
 * If the user has granted consent for this host and the plugin is already
 * present on disk, overwrite it with the bundled version when it differs.
 * No-op when consent is missing or the plugin file is absent.
 */
export async function refreshOpenCodePluginIfConsented(host: InstallHost = localInstallHost): Promise<void> {
  if (readHostConsent(CONSENT_FILE, host.hostId).consented !== true) return;
  const destPath = join(await getPluginsDir(host), PLUGIN_SCRIPT_NAME);
  if ((await host.readFile(destPath)) === null) return;
  try {
    await syncOpenCodePlugin(host, destPath);
  } catch {
    // best-effort — silent failure, normal flows will re-surface on next detection
  }
}

export async function saveOpenCodeConsent(consented: boolean, hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

export async function saveOpenCodeIgnored(hostId: string = "local"): Promise<void> {
  const consent: HostConsent = { consented: false, ignored: true, savedAt: Date.now() };
  writeHostConsent(CONSENT_FILE, hostId, consent);
}

async function getPluginsDir(host: InstallHost): Promise<string> {
  return `${await host.homeDir()}/.config/opencode/plugins`;
}

async function syncOpenCodePlugin(host: InstallHost, destPath: string): Promise<void> {
  const current = await host.readFile(destPath);
  if (current !== PLUGIN_CONTENT) {
    await host.writeFile(destPath, PLUGIN_CONTENT);
    log("hooks", `opencode: ${current === null ? "installed" : "updated"} plugin on ${host.hostId} at ${destPath}`);
  }
}

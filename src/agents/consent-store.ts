import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface HostConsent {
  consented?: boolean;
  ignored?: boolean;
  savedAt?: number;
}

interface ConsentFile {
  // legacy flat shape (pre per-host) — treated as the "local" entry on read.
  consented?: boolean;
  hosts?: Record<string, HostConsent>;
  ignored?: boolean;
  savedAt?: number;
  version?: number;
}

const CURRENT_VERSION = 2;
const LOCAL_HOST_ID = "local";

export function readHostConsent(consentFile: string, hostId: string): HostConsent {
  const parsed = readConsentFile(consentFile);
  if (parsed.hosts && Object.keys(parsed.hosts).length > 0) {
    return parsed.hosts[hostId] ?? {};
  }
  if (hostId === LOCAL_HOST_ID) {
    const { consented, ignored, savedAt } = parsed;
    if (consented !== undefined || ignored !== undefined || savedAt !== undefined) {
      return { consented, ignored, savedAt };
    }
  }
  return {};
}

export function writeHostConsent(consentFile: string, hostId: string, consent: HostConsent): void {
  try {
    mkdirSync(dirname(consentFile), { recursive: true });
    const current = readConsentFile(consentFile);
    const hosts: Record<string, HostConsent> = current.hosts ? { ...current.hosts } : {};
    if (!current.hosts) {
      const legacy: HostConsent = {};
      if (current.consented !== undefined) legacy.consented = current.consented;
      if (current.ignored !== undefined) legacy.ignored = current.ignored;
      if (current.savedAt !== undefined) legacy.savedAt = current.savedAt;
      if (Object.keys(legacy).length > 0) hosts[LOCAL_HOST_ID] = legacy;
    }
    hosts[hostId] = consent;
    const next: ConsentFile = { hosts, version: CURRENT_VERSION };
    writeFileSync(consentFile, JSON.stringify(next, null, 2));
  } catch {
    // best-effort — consent loss is non-fatal
  }
}

function readConsentFile(consentFile: string): ConsentFile {
  if (!existsSync(consentFile)) return {};
  try {
    return JSON.parse(readFileSync(consentFile, "utf-8"));
  } catch {
    return {};
  }
}

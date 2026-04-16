import { mkdirSync, readFileSync } from "node:fs";

const STATE_DIR = `${process.env.HOME}/.local/state/honeymux`;
const NOTICES_FILE = `${STATE_DIR}/dismissed-notices.json`;

/**
 * Persist that the user dismissed a one-time notice.
 */
export async function dismissNotice(id: string): Promise<void> {
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(NOTICES_FILE, "utf-8"));
    } catch {}
    const dismissed = new Set<string>(Array.isArray(existing["dismissed"]) ? (existing["dismissed"] as string[]) : []);
    dismissed.add(id);
    existing["dismissed"] = [...dismissed].sort();
    mkdirSync(STATE_DIR, { recursive: true });
    await Bun.write(NOTICES_FILE, JSON.stringify(existing));
  } catch {}
}

/**
 * Check whether a one-time notice has already been dismissed by the user.
 */
export function isNoticeDismissed(id: string): boolean {
  try {
    const content = readFileSync(NOTICES_FILE, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.dismissed)) {
      return (parsed.dismissed as string[]).includes(id);
    }
  } catch {}
  return false;
}

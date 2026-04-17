/**
 * Detect whether the foreground process in a pane is running as root.
 *
 * Resolves the pane's controlling-tty foreground process group and checks the
 * effective UID of the group leader (the process whose pid == pgid == tpgid).
 * Setuid-root helpers (sudo, login, security, ...) forked by the active
 * command share the fg pgrp but are not its leader, so they do not trip this
 * check. Platform-aware: uses /proc on Linux, `ps` on macOS. Returns false on
 * any error (graceful degradation).
 */
export async function isActivePaneRoot(panePid: number): Promise<boolean> {
  try {
    if (process.platform === "darwin") return await isRootDarwin(panePid);
    if (process.platform === "linux") return await isRootLinux(panePid);
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse the foreground process-group id (tpgid) from a /proc/<pid>/stat line.
 * Uses `lastIndexOf(")")` to skip past the comm field, which may contain
 * spaces. Returns null for missing, -1, 0, or non-numeric values.
 */
export function parseProcStatTpgid(statLine: string): null | number {
  const closeIdx = statLine.lastIndexOf(")");
  if (closeIdx === -1) return null;
  const fields = statLine
    .slice(closeIdx + 2)
    .trim()
    .split(/\s+/);
  // Post-comm layout: state, ppid, pgrp, session, tty_nr, tpgid, ...
  const tpgid = parseInt(fields[5] ?? "", 10);
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
}

/** Returns true iff the /proc/<pid>/status body reports effective UID 0. */
export function parseProcStatusIsRootUid(status: string): boolean {
  for (const line of status.split("\n")) {
    if (line.startsWith("Uid:")) {
      const parts = line.split(/\s+/);
      return parts[2] === "0";
    }
  }
  return false;
}

/** Parse `ps -o tpgid=` output. Rejects -1, 0, empty, and non-numeric. */
export function parsePsTpgidOutput(output: string): null | number {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const tpgid = parseInt(trimmed, 10);
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null;
}

/** Parse `ps -o uid=` output. Returns null for empty/invalid input. */
export function parsePsUidOutput(output: string): null | number {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const uid = parseInt(trimmed, 10);
  return Number.isInteger(uid) && uid >= 0 ? uid : null;
}

async function isRootDarwin(panePid: number): Promise<boolean> {
  const tpgidOut = await runPs(["-o", "tpgid=", "-p", String(panePid)]);
  const tpgid = parsePsTpgidOutput(tpgidOut);
  if (tpgid === null) return false;

  const uidOut = await runPs(["-o", "uid=", "-p", String(tpgid)]);
  return parsePsUidOutput(uidOut) === 0;
}

async function isRootLinux(panePid: number): Promise<boolean> {
  const stat = await Bun.file(`/proc/${panePid}/stat`).text();
  const tpgid = parseProcStatTpgid(stat);
  if (tpgid === null) return false;

  const status = await Bun.file(`/proc/${tpgid}/status`).text();
  return parseProcStatusIsRootUid(status);
}

async function runPs(args: string[]): Promise<string> {
  const proc = Bun.spawn(["ps", ...args], { stderr: "ignore", stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

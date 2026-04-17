interface PsPidTpgidUidRow {
  pid: number;
  tpgid: number;
  uid: number;
}

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
export async function isActivePaneRoot(panePid: number, paneTty?: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") return await isRootDarwin(panePid, paneTty);
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

/** Parse `ps -o pid= -o tpgid= -o uid=` output into numeric rows. */
export function parsePsPidTpgidUidOutput(output: string): PsPidTpgidUidRow[] {
  const rows: PsPidTpgidUidRow[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(-?\d+)\s+(\d+)$/);
    if (!match) continue;

    const pid = parseInt(match[1] ?? "", 10);
    const tpgid = parseInt(match[2] ?? "", 10);
    const uid = parseInt(match[3] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isInteger(tpgid) || tpgid <= 0) continue;
    if (!Number.isInteger(uid) || uid < 0) continue;

    rows.push({ pid, tpgid, uid });
  }
  return rows;
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

async function isRootDarwin(panePid: number, paneTty?: string): Promise<boolean> {
  const tty = paneTty?.replace(/^\/dev\//, "").trim();
  if (!tty) return false;

  const output = await runPs(["-ww", "-o", "pid=", "-o", "tpgid=", "-o", "uid=", "-t", tty]);
  const rows = parsePsPidTpgidUidOutput(output);
  const paneRow = rows.find((row) => row.pid === panePid);
  if (!paneRow) return false;

  const leaderRow = rows.find((row) => row.pid === paneRow.tpgid);
  return leaderRow?.uid === 0;
}

async function isRootLinux(panePid: number): Promise<boolean> {
  const stat = await Bun.file(`/proc/${panePid}/stat`).text();
  const tpgid = parseProcStatTpgid(stat);
  if (tpgid === null) return false;

  const status = await Bun.file(`/proc/${tpgid}/status`).text();
  return parseProcStatusIsRootUid(status);
}

async function runPs(args: string[]): Promise<string> {
  const proc = Bun.spawn(["ps", ...args], {
    stderr: "ignore",
    stdin: "ignore",
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

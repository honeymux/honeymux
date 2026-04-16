/**
 * Detect whether the foreground process in a pane is running as root.
 * Platform-aware: uses /proc on Linux, `ps` on macOS.
 * Returns false on any error (graceful degradation).
 */
export async function isActivePaneRoot(panePid: number, paneTty: string): Promise<boolean> {
  try {
    if (process.platform === "linux") {
      return await isRootLinux(panePid);
    }
    if (process.platform === "darwin") {
      return await isRootDarwin(paneTty);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * macOS: use `ps` to find the foreground process on the pane's tty and check its UID.
 * Spawns one small process — negligible at 2-second polling interval.
 */
async function isRootDarwin(paneTty: string): Promise<boolean> {
  // Strip /dev/ prefix if present for ps -t
  const tty = paneTty.replace(/^\/dev\//, "");
  const proc = Bun.spawn(["ps", "-o", "stat,uid", "-t", tty], {
    stderr: "ignore",
    stdout: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    // Foreground processes have '+' in the STAT column
    if (trimmed.includes("+")) {
      const parts = trimmed.split(/\s+/);
      const uid = parts[parts.length - 1];
      if (uid === "0") return true;
    }
  }
  return false;
}

/**
 * Linux: read /proc to find the foreground process group, then check its effective UID.
 * No subprocess spawned — all via Bun.file().
 */
async function isRootLinux(panePid: number): Promise<boolean> {
  // Field 8 (0-indexed 7) of /proc/<pid>/stat is tpgid (foreground process group ID)
  const stat = await Bun.file(`/proc/${panePid}/stat`).text();
  const fields = stat.split(" ");
  const tpgid = fields[7];
  if (!tpgid || tpgid === "-1") return false;

  // Read effective UID from /proc/<tpgid>/status
  const status = await Bun.file(`/proc/${tpgid}/status`).text();
  for (const line of status.split("\n")) {
    if (line.startsWith("Uid:")) {
      // Uid: real effective saved filesystem
      const parts = line.split(/\s+/);
      const effectiveUid = parts[2];
      return effectiveUid === "0";
    }
  }
  return false;
}

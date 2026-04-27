/**
 * Lightweight registry of child process PIDs so cleanup() can kill
 * them without querying tmux or threading refs through the React tree.
 *
 * Callers untrack PIDs when children exit so shutdown never signals an
 * unrelated process after PID reuse.
 */

const pids = new Set<number>();

export function killTrackedChildren(): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  pids.clear();
}

export function trackChildPid(pid: number): void {
  pids.add(pid);
}

export function untrackChildPid(pid: number): void {
  pids.delete(pid);
}

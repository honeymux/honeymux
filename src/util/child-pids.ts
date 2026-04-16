/**
 * Lightweight registry of child process PIDs so cleanup() can kill
 * them without querying tmux or threading refs through the React tree.
 *
 * PIDs are never removed — at exit we just SIGTERM everything.  Dead
 * PIDs get ESRCH which the catch swallows.
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

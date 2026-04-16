import { readFileSync, readlinkSync } from "node:fs";

export interface ProcessSnapshotEntry extends ProcessTreeEntry {
  tty: null | string;
}

export interface ProcessTreeEntry {
  command: string;
  parentPid: number;
  pid: number;
}

export function collectProcessSubtreeCommandLines(rootPid: number, entries: ProcessTreeEntry[]): string[] {
  if (!Number.isInteger(rootPid) || rootPid <= 1) return [];

  const byParent = new Map<number, ProcessTreeEntry[]>();
  const byPid = new Map<number, ProcessTreeEntry>();
  for (const entry of entries) {
    byPid.set(entry.pid, entry);
    const siblings = byParent.get(entry.parentPid);
    if (siblings) {
      siblings.push(entry);
    } else {
      byParent.set(entry.parentPid, [entry]);
    }
  }

  const commands: string[] = [];
  const seen = new Set<number>();
  const queue = [rootPid];
  while (queue.length > 0) {
    const currentPid = queue.shift();
    if (currentPid === undefined || seen.has(currentPid)) continue;
    seen.add(currentPid);

    const entry = byPid.get(currentPid);
    if (entry?.command) {
      commands.push(entry.command);
    }

    for (const child of byParent.get(currentPid) ?? []) {
      queue.push(child.pid);
    }
  }

  return commands;
}

export function getProcessCommandLineSync(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 1) return "";

  if (process.platform === "linux") {
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
      const parts = raw
        .split("\u0000")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length > 0) {
        return parts.join(" ");
      }
    } catch {}
  }

  return parsePsCommandOutput(runPsSync(["-ww", "-o", "command=", "-p", String(pid)]).stdout);
}

export function getProcessParentPidSync(pid: number): null | number {
  if (!Number.isInteger(pid) || pid <= 1) return null;

  if (process.platform === "linux") {
    try {
      const parsed = parseProcStatParentPid(readFileSync(`/proc/${pid}/stat`, "utf-8"));
      if (parsed !== null) return parsed;
    } catch {}
  }

  return parsePsParentPidOutput(runPsSync(["-ww", "-o", "ppid=", "-p", String(pid)]).stdout);
}

export function getProcessSnapshotEntriesSync(): ProcessSnapshotEntry[] {
  const psOutput = runPsSync(["-axww", "-o", "pid=", "-o", "ppid=", "-o", "tty=", "-o", "command="]).stdout;
  return parsePsProcessSnapshotOutput(psOutput);
}

export function getProcessStdinTtySync(pid: number): null | string {
  if (!Number.isInteger(pid) || pid <= 1) return null;

  if (process.platform === "linux") {
    try {
      return normalizeTtyPath(readlinkSync(`/proc/${pid}/fd/0`));
    } catch {}
  }

  return parsePsTtyOutput(runPsSync(["-ww", "-o", "tty=", "-p", String(pid)]).stdout);
}

export function getProcessSubtreeCommandLinesSync(rootPid: number): string[] {
  if (!Number.isInteger(rootPid) || rootPid <= 1) return [];

  const rootCommand = getProcessCommandLineSync(rootPid);
  const commands = new Set<string>();
  if (rootCommand) commands.add(rootCommand);

  const psOutput = runPsSync(["-axww", "-o", "pid=", "-o", "ppid=", "-o", "command="]).stdout;
  for (const command of collectProcessSubtreeCommandLines(rootPid, parsePsProcessTableOutput(psOutput))) {
    if (command) commands.add(command);
  }

  return [...commands];
}

export function normalizeTtyPath(raw: null | string | undefined): null | string {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "-" || trimmed === "?" || trimmed === "??") return null;
  if (trimmed.startsWith("/dev/")) return trimmed;
  return `/dev/${trimmed}`;
}

export function parseProcStatParentPid(statLine: string): null | number {
  const closeIdx = statLine.lastIndexOf(")");
  if (closeIdx === -1) return null;
  const fields = statLine
    .slice(closeIdx + 2)
    .trim()
    .split(/\s+/);
  const parentPid = parseInt(fields[1] ?? "", 10);
  return Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null;
}

export function parsePsCommandOutput(output: string): string {
  return output.trim();
}

export function parsePsParentPidOutput(output: string): null | number {
  const trimmed = output.trim();
  const parentPid = parseInt(trimmed, 10);
  return Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null;
}

export function parsePsProcessSnapshotOutput(output: string): ProcessSnapshotEntry[] {
  const entries: ProcessSnapshotEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;

    const pid = parseInt(match[1] ?? "", 10);
    const parentPid = parseInt(match[2] ?? "", 10);
    const tty = normalizeTtyPath(match[3]);
    const command = (match[4] ?? "").trim();
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isInteger(parentPid) || parentPid < 0) continue;
    if (!command) continue;

    entries.push({ command, parentPid, pid, tty });
  }
  return entries;
}

export function parsePsProcessTableOutput(output: string): ProcessTreeEntry[] {
  const entries: ProcessTreeEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;

    const pid = parseInt(match[1] ?? "", 10);
    const parentPid = parseInt(match[2] ?? "", 10);
    const command = (match[3] ?? "").trim();
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isInteger(parentPid) || parentPid < 0) continue;
    if (!command) continue;

    entries.push({ command, parentPid, pid });
  }
  return entries;
}

export function parsePsTtyOutput(output: string): null | string {
  return normalizeTtyPath(output);
}

function runPsSync(args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["ps", ...args], {
    stderr: "ignore",
    stdout: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
  };
}

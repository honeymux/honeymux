import { appendFileSync, renameSync, statSync, unlinkSync } from "fs";
import { join } from "path";

import { ensurePrivateDir, getHoneymuxStateDir } from "./runtime-paths.ts";

const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MiB
const MAX_ARCHIVES = 5; // honeymux.log.0 through honeymux.log.4

let ensuredDir: null | string = null;

export function getHoneymuxLogPath(): string {
  return join(getHoneymuxLogDir(), "honeymux.log");
}

export function log(tag: string, message: string): void {
  ensureDir();
  const ts = new Date().toISOString();
  const logPath = getHoneymuxLogPath();
  try {
    appendFileSync(logPath, `${ts} [${tag}] ${message}\n`);
  } catch {}
  rotate();
}

function ensureDir() {
  const logDir = getHoneymuxLogDir();
  if (ensuredDir === logDir) return;
  ensurePrivateDir(logDir);
  ensuredDir = logDir;
}

function getHoneymuxLogDir(): string {
  return join(getHoneymuxStateDir(), "logs");
}

function rotate() {
  const logPath = getHoneymuxLogPath();
  try {
    const { size } = statSync(logPath);
    if (size < MAX_LOG_SIZE) return;
  } catch {
    return; // file doesn't exist yet
  }

  // Shift existing archives: .4 is deleted, .3→.4, .2→.3, .1→.2, .0→.1
  try {
    unlinkSync(`${logPath}.${MAX_ARCHIVES - 1}`);
  } catch {}
  for (let i = MAX_ARCHIVES - 2; i >= 0; i--) {
    try {
      renameSync(`${logPath}.${i}`, `${logPath}.${i + 1}`);
    } catch {}
  }
  // Current log becomes .0
  try {
    renameSync(logPath, `${logPath}.0`);
  } catch {}
}

import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SAFE_SOCKET_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function ensurePrivateDir(path: string): string {
  mkdirSync(path, { mode: 0o700, recursive: true });
  try {
    chmodSync(path, 0o700);
  } catch {}
  return path;
}

export function getHoneymuxRuntimeDir(): string {
  const runtimeRoot = process.env.XDG_RUNTIME_DIR
    ? join(process.env.XDG_RUNTIME_DIR, "honeymux")
    : join(getHoneymuxStateDir(), "runtime");
  return ensurePrivateDir(runtimeRoot);
}

export function getHoneymuxStateDir(): string {
  const stateHome = process.env.XDG_STATE_HOME || `${process.env.HOME}/.local/state`;
  return ensurePrivateDir(join(stateHome, "honeymux"));
}

export function getHoneymuxTempRoot(): string {
  return ensurePrivateDir(getPrivateRuntimePath("tmp"));
}

export function getPrivateRuntimePath(...segments: string[]): string {
  return join(getHoneymuxRuntimeDir(), ...segments);
}

export function getPrivateSocketPath(name: string): string {
  assertSafeSocketName(name);
  return getPrivateRuntimePath(`${name}.sock`);
}

function assertSafeSocketName(name: string): void {
  if (!SAFE_SOCKET_NAME_RE.test(name)) {
    throw new Error(`Invalid socket name: ${name}`);
  }
}

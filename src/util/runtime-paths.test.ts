import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getHoneymuxRuntimeDir, getHoneymuxTempRoot, getPrivateSocketPath } from "./runtime-paths.ts";

const originalHome = process.env.HOME;
const originalXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
const originalXdgStateHome = process.env.XDG_STATE_HOME;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  if (originalXdgRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = originalXdgRuntimeDir;

  if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgStateHome;

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("runtime-paths", () => {
  test("uses a private honeymux runtime subdirectory under XDG_RUNTIME_DIR", () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "hmx-runtime-"));
    const stateHome = mkdtempSync(join(tmpdir(), "hmx-state-"));
    tempDirs.push(runtimeDir, stateHome);
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    process.env.XDG_STATE_HOME = stateHome;
    process.env.HOME = stateHome;

    const honeymuxRuntimeDir = getHoneymuxRuntimeDir();

    expect(honeymuxRuntimeDir).toBe(join(runtimeDir, "honeymux"));
    expect(statSync(honeymuxRuntimeDir).mode & 0o777).toBe(0o700);
    expect(getPrivateSocketPath("hmx-claude")).toBe(join(runtimeDir, "honeymux", "hmx-claude.sock"));
    expect(getHoneymuxTempRoot()).toBe(join(runtimeDir, "honeymux", "tmp"));
  });

  test("falls back to a private runtime directory under the honeymux state dir", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const stateHome = mkdtempSync(join(tmpdir(), "hmx-state-"));
    tempDirs.push(stateHome);
    process.env.XDG_STATE_HOME = stateHome;
    process.env.HOME = stateHome;

    const honeymuxRuntimeDir = getHoneymuxRuntimeDir();

    expect(honeymuxRuntimeDir).toBe(join(stateHome, "honeymux", "runtime"));
    expect(statSync(honeymuxRuntimeDir).mode & 0o777).toBe(0o700);
    expect(getPrivateSocketPath("hmx-gemini")).toBe(join(stateHome, "honeymux", "runtime", "hmx-gemini.sock"));
    expect(getHoneymuxTempRoot()).toBe(join(stateHome, "honeymux", "runtime", "tmp"));
  });

  test("rejects invalid socket names", () => {
    expect(() => getPrivateSocketPath("../sock")).toThrow("Invalid socket name");
  });
});

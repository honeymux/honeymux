import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getRemoteProxySocketPath } from "./proxy-server.ts";

const originalXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
const originalXdgStateHome = process.env.XDG_STATE_HOME;
const originalHome = process.env.HOME;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalXdgRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = originalXdgRuntimeDir;

  if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgStateHome;

  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {}
  }
});

describe("getRemoteProxySocketPath", () => {
  test("uses a fixed socket path in the private XDG runtime directory", () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), "hmx-runtime-"));
    const stateHome = mkdtempSync(join(tmpdir(), "hmx-state-"));
    tempDirs.push(runtimeDir, stateHome);
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    process.env.XDG_STATE_HOME = stateHome;
    process.env.HOME = stateHome;

    expect(getRemoteProxySocketPath()).toBe(join(runtimeDir, "honeymux", "hmx-remote-proxy.sock"));
  });

  test("uses a fixed socket path in the fallback private state runtime directory", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const stateHome = mkdtempSync(join(tmpdir(), "hmx-proxy-state-"));
    tempDirs.push(stateHome);
    process.env.XDG_STATE_HOME = stateHome;
    process.env.HOME = stateHome;

    expect(getRemoteProxySocketPath()).toBe(join(stateHome, "honeymux", "runtime", "hmx-remote-proxy.sock"));
  });
});

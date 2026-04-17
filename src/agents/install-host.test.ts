import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalInstallHost } from "./install-host.ts";

describe("LocalInstallHost", () => {
  let host: LocalInstallHost;
  let tmp: string;

  beforeEach(() => {
    host = new LocalInstallHost();
    tmp = mkdtempSync(join(tmpdir(), "hmx-install-host-"));
  });

  afterEach(() => {
    try {
      chmodSync(tmp, 0o700);
    } catch {}
    rmSync(tmp, { force: true, recursive: true });
  });

  it("reports hostId as 'local'", () => {
    expect(host.hostId).toBe("local");
  });

  it("creates directories recursively and is idempotent", async () => {
    const nested = join(tmp, "a", "b", "c");
    await host.mkdir(nested, { recursive: true });
    await host.mkdir(nested, { recursive: true });
    expect(existsSync(nested)).toBe(true);
  });

  it("readFile returns null for missing files", async () => {
    expect(await host.readFile(join(tmp, "nope"))).toBe(null);
  });

  it("writes and reads UTF-8 content", async () => {
    const path = join(tmp, "greeting.txt");
    await host.writeFile(path, "hello ʕ·ᴥ·ʔ\n");
    expect(await host.readFile(path)).toBe("hello ʕ·ᴥ·ʔ\n");
  });

  it("applies mode when provided", async () => {
    const path = join(tmp, "exec.sh");
    await host.writeFile(path, "#!/bin/sh\necho hi\n", { mode: 0o755 });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o755);
    expect(readFileSync(path, "utf-8")).toContain("echo hi");
  });

  it("resolves executables that exist on PATH", async () => {
    const sh = await host.resolveExecutable("sh");
    expect(sh).not.toBe(null);
    expect(sh?.startsWith("/")).toBe(true);
  });

  it("returns null for unknown executables", async () => {
    expect(await host.resolveExecutable("this-binary-does-not-exist-hmx")).toBe(null);
  });

  it("homeDir returns an absolute path", async () => {
    const home = await host.homeDir();
    expect(home.startsWith("/")).toBe(true);
  });
});

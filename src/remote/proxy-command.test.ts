import { describe, expect, test } from "bun:test";

import { buildRemoteProxyProcessArgv, isBundledEntryPath } from "./proxy-command.ts";

describe("buildRemoteProxyProcessArgv", () => {
  test("source mode: spawns the JSX-free proxy.ts, wrapped to tee crash stderr into honeymux.log", () => {
    const argv = buildRemoteProxyProcessArgv("%10", "token-123", "/run/user/1000/honeymux/hmx-remote-proxy.sock", {
      execPath: "/home/aaron/.bun/bin/bun",
      logPath: "/tmp/honeymux.log",
      mainPath: "/home/aaron/src/honeymux/src/index.tsx",
      proxyScriptPath: "/home/aaron/src/honeymux/src/remote/proxy.ts",
    });

    // /bin/sh -c <supervisor> hmx-proxy <logPath> <real argv…>
    expect(argv.slice(0, 2)).toEqual(["/bin/sh", "-c"]);
    expect(argv[2]).toContain('>>"$log"'); // tees the proxy's stderr into the log on crash
    expect(argv.slice(3)).toEqual([
      "hmx-proxy",
      "/tmp/honeymux.log",
      "/home/aaron/.bun/bin/bun",
      "/home/aaron/src/honeymux/src/remote/proxy.ts",
      "%10",
      "token-123",
      "/run/user/1000/honeymux/hmx-remote-proxy.sock",
    ]);
  });

  test("bundled mode: re-enters the installed executable with the flag, same crash-capture wrap", () => {
    const argv = buildRemoteProxyProcessArgv("%10", "token-123", "/run/user/1000/honeymux/hmx-remote-proxy.sock", {
      execPath: "/home/aaron/bin/hmx",
      logPath: "/tmp/honeymux.log",
      mainPath: "/$bunfs/root/hmx-linux-x64",
      proxyScriptPath: "/$bunfs/root/proxy.ts",
    });

    expect(argv.slice(0, 2)).toEqual(["/bin/sh", "-c"]);
    expect(argv.slice(3)).toEqual([
      "hmx-proxy",
      "/tmp/honeymux.log",
      "/home/aaron/bin/hmx",
      "--internal-remote-proxy",
      "%10",
      "token-123",
      "/run/user/1000/honeymux/hmx-remote-proxy.sock",
    ]);
  });
});

describe("isBundledEntryPath", () => {
  test("detects Bun bundle entry paths", () => {
    expect(isBundledEntryPath("/$bunfs/root/hmx-linux-x64")).toBe(true);
    expect(isBundledEntryPath("/home/aaron/src/honeymux/src/index.tsx")).toBe(false);
  });
});

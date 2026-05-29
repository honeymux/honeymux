import { describe, expect, test } from "bun:test";

import { buildRemoteProxyProcessArgv, isBundledEntryPath } from "./proxy-command.ts";

describe("buildRemoteProxyProcessArgv", () => {
  test("spawns the dedicated JSX-free proxy entrypoint in source mode (cwd-independent)", () => {
    expect(
      buildRemoteProxyProcessArgv("%10", "token-123", {
        execPath: "/home/aaron/.bun/bin/bun",
        mainPath: "/home/aaron/src/honeymux/src/index.tsx",
        proxyScriptPath: "/home/aaron/src/honeymux/src/remote/proxy.ts",
      }),
    ).toEqual(["/home/aaron/.bun/bin/bun", "/home/aaron/src/honeymux/src/remote/proxy.ts", "%10", "token-123"]);
  });

  test("re-enters the installed executable in bundled mode", () => {
    expect(
      buildRemoteProxyProcessArgv("%10", "token-123", {
        execPath: "/home/aaron/bin/hmx",
        mainPath: "/$bunfs/root/hmx-linux-x64",
        proxyScriptPath: "/$bunfs/root/proxy.ts",
      }),
    ).toEqual(["/home/aaron/bin/hmx", "--internal-remote-proxy", "%10", "token-123"]);
  });
});

describe("isBundledEntryPath", () => {
  test("detects Bun bundle entry paths", () => {
    expect(isBundledEntryPath("/$bunfs/root/hmx-linux-x64")).toBe(true);
    expect(isBundledEntryPath("/home/aaron/src/honeymux/src/index.tsx")).toBe(false);
  });
});

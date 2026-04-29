import { describe, expect, test } from "bun:test";

import { formatUsage, parseCliArgs } from "./args.ts";

describe("formatUsage", () => {
  test("includes supported options", () => {
    expect(formatUsage()).toContain("Usage: hmx [options] [session]");
    expect(formatUsage()).toContain("--server <name>");
  });
});

describe("parseCliArgs", () => {
  test("parses a session name", () => {
    expect(parseCliArgs(["work"])).toEqual({
      explicitServer: undefined,
      kind: "run",
      sessionName: "work",
    });
  });

  test("parses a server override and session name", () => {
    expect(parseCliArgs(["--server", "dev", "work"])).toEqual({
      explicitServer: "dev",
      kind: "run",
      sessionName: "work",
    });
  });

  test("supports -- to stop option parsing", () => {
    expect(parseCliArgs(["--", "--help"])).toEqual({
      explicitServer: undefined,
      kind: "run",
      sessionName: "--help",
    });
  });

  test("returns help for help flags", () => {
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
  });

  test("returns version for version flags", () => {
    expect(parseCliArgs(["-V"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  test("parses the internal remote proxy mode", () => {
    expect(parseCliArgs(["--internal-remote-proxy", "%10", "token-123"])).toEqual({
      kind: "internal-remote-proxy",
      localPaneId: "%10",
      proxyToken: "token-123",
    });
  });

  test("rejects a missing internal remote proxy pane id", () => {
    expect(parseCliArgs(["--internal-remote-proxy"])).toEqual({
      kind: "error",
      message: "honeymux: option '--internal-remote-proxy' requires a pane id",
    });
  });

  test("rejects a missing internal remote proxy token", () => {
    expect(parseCliArgs(["--internal-remote-proxy", "%10"])).toEqual({
      kind: "error",
      message: "honeymux: option '--internal-remote-proxy' requires a proxy token",
    });
  });

  test("rejects an unknown long option", () => {
    expect(parseCliArgs(["--bogus"])).toEqual({
      kind: "error",
      message: "honeymux: unknown option '--bogus'",
    });
  });

  test("rejects an unknown short option", () => {
    expect(parseCliArgs(["-x"])).toEqual({
      kind: "error",
      message: "honeymux: unknown option '-x'",
    });
  });

  test("rejects a missing server value", () => {
    expect(parseCliArgs(["--server"])).toEqual({
      kind: "error",
      message: "honeymux: option '--server' requires a value",
    });
  });

  test("rejects extra positional arguments", () => {
    expect(parseCliArgs(["one", "two"])).toEqual({
      kind: "error",
      message: "honeymux: unexpected argument 'two'",
    });
  });
});

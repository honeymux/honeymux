import { describe, expect, test } from "bun:test";

import { appendSshDestination, validateSshDestination } from "./ssh.ts";

describe("validateSshDestination", () => {
  test("accepts normal ssh destinations", () => {
    expect(validateSshDestination("dev-box")).toBeNull();
    expect(validateSshDestination("user@example.com")).toBeNull();
    expect(validateSshDestination("user@[2001:db8::1]")).toBeNull();
  });

  test("rejects destinations that could be parsed as ssh options", () => {
    expect(validateSshDestination("-oProxyCommand=printf")).toBe("cannot start with '-'");
  });

  test("rejects whitespace and control characters", () => {
    expect(validateSshDestination("bad host")).toBe("cannot contain whitespace");
    expect(validateSshDestination("bad\nhost")).toBe("contains invalid control characters");
  });
});

describe("appendSshDestination", () => {
  test("inserts -- before the destination", () => {
    const args = ["-o", "BatchMode=yes"];
    appendSshDestination(args, "dev-box");
    expect(args).toEqual(["-o", "BatchMode=yes", "--", "dev-box"]);
  });
});

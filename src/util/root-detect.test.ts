import { describe, expect, it } from "bun:test";

import { parseProcStatTpgid, parseProcStatusIsRootUid, parsePsTpgidOutput, parsePsUidOutput } from "./root-detect.ts";

describe("parseProcStatTpgid", () => {
  it("extracts tpgid from a simple stat line", () => {
    // pid (comm) state ppid pgrp session tty_nr tpgid ...
    const stat = "1234 (zsh) S 1000 1234 1234 34816 5678 4194304 ...";
    expect(parseProcStatTpgid(stat)).toBe(5678);
  });

  it("handles comm fields that contain spaces and parentheses", () => {
    const stat = "1234 (my (weird) cmd) S 1000 1234 1234 34816 5678 0 0";
    expect(parseProcStatTpgid(stat)).toBe(5678);
  });

  it("returns null when tpgid is -1 (no fg group)", () => {
    const stat = "1234 (zsh) S 1000 1234 1234 0 -1 0 0";
    expect(parseProcStatTpgid(stat)).toBeNull();
  });

  it("returns null when tpgid is 0", () => {
    const stat = "1234 (zsh) S 1000 1234 1234 0 0 0 0";
    expect(parseProcStatTpgid(stat)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseProcStatTpgid("garbage without parens")).toBeNull();
    expect(parseProcStatTpgid("")).toBeNull();
  });
});

describe("parseProcStatusIsRootUid", () => {
  it("returns true when effective uid is 0", () => {
    const status = "Name:\tsudo\nUid:\t0\t0\t0\t0\n";
    expect(parseProcStatusIsRootUid(status)).toBe(true);
  });

  it("returns false when effective uid is non-zero even if real uid is 0", () => {
    // Real uid 0, effective uid 1000 — e.g. setuid drop.
    const status = "Name:\tfoo\nUid:\t0\t1000\t1000\t1000\n";
    expect(parseProcStatusIsRootUid(status)).toBe(false);
  });

  it("returns false when effective uid is non-zero", () => {
    const status = "Name:\tzsh\nUid:\t1000\t1000\t1000\t1000\n";
    expect(parseProcStatusIsRootUid(status)).toBe(false);
  });

  it("returns false when no Uid line is present", () => {
    expect(parseProcStatusIsRootUid("Name:\tfoo\n")).toBe(false);
    expect(parseProcStatusIsRootUid("")).toBe(false);
  });
});

describe("parsePsTpgidOutput", () => {
  it("parses a plain numeric tpgid", () => {
    expect(parsePsTpgidOutput("  5678\n")).toBe(5678);
  });

  it("rejects -1", () => {
    expect(parsePsTpgidOutput("-1\n")).toBeNull();
  });

  it("rejects 0", () => {
    expect(parsePsTpgidOutput("0\n")).toBeNull();
  });

  it("rejects empty output (e.g. pgrp leader already exited)", () => {
    expect(parsePsTpgidOutput("")).toBeNull();
    expect(parsePsTpgidOutput("   ")).toBeNull();
  });

  it("rejects non-numeric output", () => {
    expect(parsePsTpgidOutput("TPGID\n")).toBeNull();
    expect(parsePsTpgidOutput("n/a")).toBeNull();
  });
});

describe("parsePsUidOutput", () => {
  it("parses root uid", () => {
    expect(parsePsUidOutput("0\n")).toBe(0);
  });

  it("parses a non-root uid", () => {
    expect(parsePsUidOutput("  501\n")).toBe(501);
  });

  it("rejects empty output (pid no longer exists)", () => {
    expect(parsePsUidOutput("")).toBeNull();
    expect(parsePsUidOutput("   \n")).toBeNull();
  });

  it("rejects non-numeric output", () => {
    expect(parsePsUidOutput("UID\n")).toBeNull();
    expect(parsePsUidOutput("root")).toBeNull();
  });

  it("rejects negative uids", () => {
    expect(parsePsUidOutput("-1")).toBeNull();
  });
});

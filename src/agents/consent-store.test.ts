import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readHostConsent, writeHostConsent } from "./consent-store.ts";

describe("consent-store", () => {
  let tmp: string;
  let file: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "hmx-consent-"));
    file = join(tmp, "consent.json");
  });

  afterEach(() => {
    rmSync(tmp, { force: true, recursive: true });
  });

  it("returns an empty record when no file exists", () => {
    expect(readHostConsent(file, "local")).toEqual({});
    expect(existsSync(file)).toBe(false);
  });

  it("reads legacy flat files as the local entry", () => {
    writeFileSync(file, JSON.stringify({ consented: true, savedAt: 42 }));
    expect(readHostConsent(file, "local")).toEqual({ consented: true, savedAt: 42 });
    expect(readHostConsent(file, "other")).toEqual({});
  });

  it("persists per-host entries under the hosts key", () => {
    writeHostConsent(file, "local", { consented: true, savedAt: 1 });
    writeHostConsent(file, "prod-box", { ignored: true, savedAt: 2 });
    expect(readHostConsent(file, "local")).toEqual({ consented: true, savedAt: 1 });
    expect(readHostConsent(file, "prod-box")).toEqual({ ignored: true, savedAt: 2 });
    expect(readHostConsent(file, "other")).toEqual({});
  });

  it("migrates a legacy flat file into the hosts map on first write", () => {
    writeFileSync(file, JSON.stringify({ consented: true, savedAt: 10 }));
    writeHostConsent(file, "prod-box", { ignored: true, savedAt: 20 });
    expect(readHostConsent(file, "local")).toEqual({ consented: true, savedAt: 10 });
    expect(readHostConsent(file, "prod-box")).toEqual({ ignored: true, savedAt: 20 });
  });

  it("overwrites an existing host entry", () => {
    writeHostConsent(file, "local", { consented: false, savedAt: 1 });
    writeHostConsent(file, "local", { consented: true, savedAt: 2 });
    expect(readHostConsent(file, "local")).toEqual({ consented: true, savedAt: 2 });
  });
});

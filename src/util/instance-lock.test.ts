import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hardenLockSocketPath } from "./instance-lock.ts";

describe("hardenLockSocketPath", () => {
  test("restricts the socket path to owner-only permissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "hmx-instance-lock-"));
    const path = join(dir, "honeymux.lock");
    try {
      writeFileSync(path, "test", { mode: 0o666 });
      hardenLockSocketPath(path);
      expect(statSync(path).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

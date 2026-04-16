import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatFatalConsoleMessage, writeFatalReport } from "./fatal-report.ts";

describe("fatal report", () => {
  const originalStateHome = process.env.XDG_STATE_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    process.env.XDG_STATE_HOME = originalStateHome;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("writes a crash report under the Honeymux state directory", () => {
    const stateHome = mkdtempSync(join(tmpdir(), "honeymux-fatal-"));
    tempDirs.push(stateHome);
    process.env.XDG_STATE_HOME = stateHome;

    const report = writeFatalReport({
      error: new Error("boom"),
      kind: "uncaught exception",
      sessionName: "alpha",
    });

    expect(report.path).not.toBeNull();
    expect(report.logPath).toBe(join(stateHome, "honeymux", "logs", "honeymux.log"));

    const reportText = readFileSync(report.path!, "utf8");
    expect(reportText).toContain("Honeymux fatal error report");
    expect(reportText).toContain("kind: uncaught exception");
    expect(reportText).toContain("session: alpha");
    expect(reportText).toContain("Error: boom");
  });

  it("prints the saved report path in the visible crash message", () => {
    const message = formatFatalConsoleMessage({
      errorText: "Error: boom\n    at test",
      headline: "Error: boom",
      kind: "uncaught exception",
      logPath: "/tmp/honeymux.log",
      path: "/tmp/honeymux-crash.log",
    });

    expect(message).toContain("honeymux crashed (uncaught exception)");
    expect(message).toContain("report: /tmp/honeymux-crash.log");
    expect(message).toContain("log: /tmp/honeymux.log");
    expect(message).toContain("Error: boom");
  });
});

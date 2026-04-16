import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { getHoneymuxLogPath, log } from "./log.ts";
import { ensurePrivateDir, getHoneymuxStateDir } from "./runtime-paths.ts";
import { getTmuxServer } from "./tmux-server.ts";

export interface FatalReport {
  errorText: string;
  headline: string;
  kind: string;
  logPath: string;
  path: null | string;
}

export interface WriteFatalReportOptions {
  error: unknown;
  kind: string;
  sessionName?: string;
}

export function formatFatalConsoleMessage(report: FatalReport): string {
  const lines = [
    `honeymux crashed (${report.kind})`,
    report.path ? `report: ${report.path}` : "report: unable to write crash report",
    `log: ${report.logPath}`,
    "",
    report.errorText.trimEnd(),
  ];
  return lines.join("\n");
}

export function formatFatalThrowable(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}` || String(error);
  }
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {}
  }
  return String(error);
}

export function writeFatalReport(options: WriteFatalReportOptions): FatalReport {
  const occurredAt = new Date().toISOString();
  const errorText = formatFatalThrowable(options.error);
  const headline = errorText.split("\n").find((line) => line.trim().length > 0) ?? options.kind;
  const logPath = getHoneymuxLogPath();

  let path: null | string = null;
  try {
    const crashDir = ensurePrivateDir(join(getHoneymuxStateDir(), "crashes"));
    path = join(crashDir, `${occurredAt.replace(/[:]/g, "-")}-pid${process.pid}.log`);
    writeFileSync(path, buildFatalReportText(options.kind, errorText, occurredAt, options.sessionName, logPath));
    log("fatal", `kind=${options.kind} report=${path} headline=${JSON.stringify(headline)}`);
  } catch (reportError) {
    log("fatal", `kind=${options.kind} report_write_failed=${JSON.stringify(formatFatalThrowable(reportError))}`);
  }

  return {
    errorText,
    headline,
    kind: options.kind,
    logPath,
    path,
  };
}

function buildFatalReportText(
  kind: string,
  errorText: string,
  occurredAt: string,
  sessionName: string | undefined,
  logPath: string,
): string {
  const lines = [
    "Honeymux fatal error report",
    `time: ${occurredAt}`,
    `kind: ${kind}`,
    `pid: ${process.pid}`,
    `ppid: ${process.ppid}`,
    `cwd: ${process.cwd()}`,
    `session: ${sessionName ?? "(unknown)"}`,
    `tmux_server: ${getTmuxServer()}`,
    `bun: ${typeof Bun !== "undefined" ? Bun.version : "unknown"}`,
    `platform: ${process.platform}`,
    `arch: ${process.arch}`,
    `argv: ${JSON.stringify(process.argv)}`,
    `log_path: ${logPath}`,
    "",
    errorText.trimEnd(),
    "",
  ];
  return lines.join("\n");
}

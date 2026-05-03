import type { FatalReport, WriteFatalReportOptions } from "../../util/fatal-report.ts";

import { writeFatalReport } from "../../util/fatal-report.ts";

/**
 * Process-wide singleton that lets orderly exit paths (tmux PTY death,
 * unexpected session-changed) surface a dialog through the running renderer
 * instead of silently calling `process.exit`.
 *
 * The React app registers a handler early during mount; detection sites call
 * {@link reportFatalError} to route the event through the existing crash-report
 * infrastructure (writes a report under ~/.local/state/honeymux/crashes and
 * logs a `[fatal]` entry to honeymux.log) AND present the error to the user.
 *
 * When a handler is registered, the caller MUST NOT exit afterwards — the
 * dialog's dismiss action owns the final shutdown + exit. If no handler is
 * registered (e.g. crash happened before mount or after unmount), the caller
 * should fall through to its previous immediate-shutdown behavior.
 *
 * This is distinct from `handleFatalError` in src/index.tsx: that path covers
 * *unhandled* errors (uncaught exceptions, fatal signals) and exits stderr-only
 * without a dialog. This module covers *handled* exit-conditions where the
 * renderer is still alive and we want the user to see what happened.
 */

let handler: ((report: FatalReport) => void) | null = null;
let reported = false;

export function registerFatalErrorHandler(fn: (report: FatalReport) => void): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Report a fatal error. Always writes a crash report + log entry via
 * {@link writeFatalReport}; if a UI handler is registered, the resulting
 * report is also delivered to it for display.
 *
 * Returns `true` if a UI handler was notified (caller must not exit).
 * Returns `false` if no handler was available (caller should run its
 * normal shutdown + `process.exit` path).
 *
 * Subsequent calls after the first are no-ops and always return `true` to
 * keep the first report's UI visible instead of being overwritten.
 */
export function reportFatalError(options: WriteFatalReportOptions): boolean {
  if (reported) return true;
  const report = writeFatalReport(options);
  if (!handler) return false;
  reported = true;
  handler(report);
  return true;
}

#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { readSync, writeSync } from "node:fs";

// Embed version at build time so it survives `bun build --compile`.
import pkg from "../package.json";
import { App } from "./app.tsx";
import { formatUsage, parseCliArgs } from "./cli/args.ts";
import { DEFAULT_SCHEME, initTheme, resolveThemeName } from "./themes/theme.ts";
import { tmuxSessionExists } from "./tmux/control-client.ts";
import { checkTmuxStartupRequirements } from "./tmux/startup-check.ts";
import { killTrackedChildren } from "./util/child-pids.ts";
import { loadConfig, validateConfig } from "./util/config.ts";
// Workaround: OpenTUI's Zig renderer emits OSC 12 to set the cursor color
// (default white), which makes the outer terminal draw a solid opaque block
// instead of reverse-video — hiding the character underneath the cursor.
// Reset the cursor color after each render so the terminal falls back to
// reverse-video (character visible under cursor).
// When agentAlertCursorAlert is active, re-applies the alert color instead of
// resetting, so the cursor stays visually distinct.
import { cursorAlertPostRender } from "./util/cursor-alert.ts";
import { formatFatalConsoleMessage, writeFatalReport } from "./util/fatal-report.ts";
import {
  acquireLock,
  checkExistingInstance,
  formatUptime,
  killExistingInstance,
  onLockShutdown,
  releaseLock,
} from "./util/instance-lock.ts";
import { log } from "./util/log.ts";
import { disableInputModesBeforeShutdown, shutdownRenderer } from "./util/shutdown-renderer.ts";
import { setTermCaps } from "./util/terminal-caps.ts";
import { setTerminalName, terminalBaseName } from "./util/terminal-detect.ts";
import { isLocaleUtf8, setTerminalIsUtf8, terminalIsUtf8 } from "./util/terminal-encoding.ts";
import { setTerminalOutputRenderer } from "./util/terminal-output.ts";
import { probeTerminal } from "./util/terminal-probe.ts";
import { setTmuxServer, setTmuxVersion } from "./util/tmux-server.ts";

type RendererOutputWriter = {
  writeOut: (data: Uint8Array | string) => unknown;
};

// Restrict default file permissions to owner-only (0o077 masks group & other).
// This hardens lock files, Unix sockets, temp dirs, and any other artifacts
// Honeymux creates — matching the IPC-permission rule in AGENTS.md.
process.umask(0o077);

const cliArgs = parseCliArgs(process.argv.slice(2));

if (cliArgs.kind === "version") {
  process.stdout.write(`Honeymux ${pkg.version}\n`);
  process.exit(0);
}

if (cliArgs.kind === "help") {
  process.stdout.write(`${formatUsage()}\n`);
  process.exit(0);
}

if (cliArgs.kind === "error") {
  process.stderr.write(`${cliArgs.message}\n\n${formatUsage()}\n`);
  process.exit(2);
}

// Bail early if already running inside tmux (nesting is not supported).
if (process.env.TMUX) {
  const isInsideHoneymux = process.env.TMUX.includes("/honeymux,");
  if (isInsideHoneymux) {
    console.error("honeymux is already running — nested sessions are not supported");
  } else {
    console.error(
      "honeymux is an outer TUI for tmux so it can't run inside of it; please exit all tmux sessions and try again",
    );
  }
  process.exit(1);
}

// Bail early if locale does not advertise UTF-8.
if (!isLocaleUtf8()) {
  console.error(
    "honeymux requires a UTF-8 locale but yours appears to be something else.\n" +
      `  LANG=${process.env.LANG ?? "(unset)"}  LC_CTYPE=${process.env.LC_CTYPE ?? "(unset)"}  LC_ALL=${process.env.LC_ALL ?? "(unset)"}\n` +
      "Fix: export LANG=en_US.UTF-8  (or the equivalent for your language)",
  );
  process.exit(1);
}

// Bail early if tmux is missing or too old.
// honeymux requires tmux ≥ 3.3 for:
//   - control mode (-C) with notifications: %session-window-changed,
//     %window-pane-changed, %unlinked-window-close (1.8 base, 2.5+/3.2+ notifs)
//   - remain-on-exit-format (3.3 — pane tab lifecycle)
//   - per-pane hooks: set-hook -p (3.0)
//   - send-keys -H hex mode (3.0)
//   - list-windows -f filter expressions (3.0)
//   - pane-border-lines option (3.2)
{
  const tmuxStartupCheck = await checkTmuxStartupRequirements();
  if (!tmuxStartupCheck.ok) {
    console.error(tmuxStartupCheck.message);
    process.exit(1);
  }

  setTmuxVersion(tmuxStartupCheck.version);
}

// --- Single-instance enforcement ---
// The agent event sockets live in a per-user private runtime directory.
// A second instance would steal them, causing cross-instance event bleed.
// On takeover we kill the old honeymux process but keep the tmux server —
// the new instance reattaches to the existing sessions seamlessly.
{
  const existing = await checkExistingInstance();
  if (existing) {
    const uptime = formatUptime(Date.now() - existing.startedAt);
    process.stderr.write(
      `Another honeymux instance is already running (PID ${existing.pid}, started ${uptime}).\n` +
        `If the tmux server is still alive, the new instance will take it over.\n`,
    );

    // Use a synchronous read on fd 0 so process.stdin is never touched.
    // Any manipulation of the stream (resume/pause/setRawMode/listeners)
    // leaves Bun's internal stdin in a state that prevents the later
    // terminal probe from receiving data, causing a 10 s timeout.
    process.stderr.write("Take over? [Y/n] ");
    const inputBuf = Buffer.alloc(256);
    const bytesRead = readSync(0, inputBuf, 0, 256, null);
    const answer = inputBuf.toString("utf-8", 0, bytesRead).trim();

    if (answer.toLowerCase() === "n") {
      process.exit(1);
    }

    await killExistingInstance(existing.pid);
  }
  acquireLock();
}

const STATE_FILE = `${process.env.HOME}/.local/state/honeymux/last-session`;

const explicitServer = cliArgs.explicitServer;
let sessionName = cliArgs.sessionName;

// --- Determine tmux server name ---
// Single-instance enforcement means we can use a fixed name.  The new
// instance reattaches to the surviving tmux server after a takeover.
const serverName = explicitServer ?? "honeymux";
setTmuxServer(serverName);

// --- Determine session name ---
if (!sessionName) {
  try {
    const raw = (await Bun.file(STATE_FILE).text()).trim();
    if (raw) {
      let savedServer: string | undefined;
      let savedSession: string | undefined;
      try {
        const parsed = JSON.parse(raw);
        savedServer = parsed.server;
        savedSession = parsed.session;
      } catch {}

      if (savedServer && savedSession && savedServer === serverName) {
        // Verify the saved session still exists on this server
        if (await tmuxSessionExists(savedSession)) {
          sessionName = savedSession;
        }
      }
    }
  } catch {
    // no saved session
  }
}
if (!sessionName) {
  sessionName = "honeymux";
}

// Put stdin into raw mode immediately to prevent terminal capability
// responses from being echoed as text in some terminals (e.g. Ghostty).
if (process.stdin.setRawMode) {
  process.stdin.setRawMode(true);
}

// Load config early so we can pass the theme name to initTheme.
const savedConfig = loadConfig();
if (savedConfig) {
  const configError = validateConfig(savedConfig);
  if (configError) {
    process.stderr.write(`honeymux: ${configError}\n`);
    process.exit(1);
  }
}

// Query terminal identity, capabilities, colors, and encoding in one batch.
// Uses a CPR sentinel so we wait exactly until the terminal has processed
// every query — no arbitrary timeout.  Works at any latency.
const themeName = resolveThemeName(savedConfig?.themeMode ?? "built-in", savedConfig?.themeBuiltin ?? DEFAULT_SCHEME);
const probe = await probeTerminal({
  queryCursorStyle: true,
  queryPalette: false,
});

// Distribute probe results to modules that expose them as singletons.
setTerminalName(probe.name);
if (probe.kittyKeyboard) probe.caps.set("KittyKbd", "");
setTermCaps(probe.caps);
setTerminalIsUtf8(probe.isUtf8);
initTheme(
  themeName,
  {
    bg: probe.bg,
    cursorStyle: probe.cursorStyle,
    fg: probe.fg,
    paletteColors: probe.paletteColors,
  },
  savedConfig?.themeCustom,
);

// Runtime UTF-8 probe failed — the terminal is interpreting bytes, not UTF-8.
if (terminalIsUtf8 === false) {
  if (process.stdin.setRawMode) process.stdin.setRawMode(false);
  console.error(
    "honeymux requires a UTF-8 terminal but yours appears to be in byte/Latin-1 mode.\n" +
      "Make sure your terminal emulator's encoding is set to UTF-8 and try again.",
  );
  process.exit(1);
}

const renderer = await createCliRenderer({
  enableMouseMovement: false,
  exitOnCtrlC: false, // Forward Ctrl+C to tmux
  screenMode: "alternate-screen",
  useKittyKeyboard: {
    allKeysAsEscapes: true,
    // Enable event types, alternate keys, and all keys as escapes so
    // modifier-only press/release events are reported (needed for zoom).
    alternateKeys: true,
    disambiguate: true, // Structured modifier reporting — needed for reliable keybinding detection
    events: true,
    reportText: false,
  },
  useMouse: true, // Enable mouse for tab clicking; native selection still works with modifier keys
});
setTerminalOutputRenderer(renderer as unknown as RendererOutputWriter);

// Workaround for iTerm2 bug: opaque bg on the last column bleeds into the
// scrollbar gutter.  Only applied to decorative cells (spaces, box-drawing,
// block elements) — text content in the last column is left untouched so
// characters like the tmux status-line date remain readable.
//
// Registered unconditionally; the iTerm2 check runs inside the callback so
// we don't depend on whether `terminalName` was already populated by the
// XTVERSION probe at module-init time.  We compare against the bare base
// name (no version suffix) because the probe stores the raw XTVERSION
// response which includes the version, e.g. "iTerm2 3.6.9".
renderer.addPostProcessFn((buffer) => {
  if (terminalBaseName() !== "iTerm2") return;

  const w = buffer.width;
  const h = buffer.height;
  const { bg, char: ch, fg } = buffer.buffers;
  for (let y = 0; y < h; y++) {
    const ci = y * w + (w - 1);
    const cb = ci * 4;

    const c = ch[ci]!;
    if (c !== 0x20 && c !== 0 && !(c >= 0x2500 && c <= 0x259f)) continue;

    // Opaque bg → full-block (█) with bg-as-fg and transparent bg.
    if (bg[cb + 3]! > 0) {
      ch[ci] = 0x2588; // █
      fg[cb] = bg[cb]!;
      fg[cb + 1] = bg[cb + 1]!;
      fg[cb + 2] = bg[cb + 2]!;
      fg[cb + 3] = bg[cb + 3]!;
      bg[cb] = 0;
      bg[cb + 1] = 0;
      bg[cb + 2] = 0;
      bg[cb + 3] = 0;
    }
  }
});

renderer.addPostProcessFn(() => {
  queueMicrotask(() => {
    cursorAlertPostRender();
  });
});

let cleanedUp = false;
async function cleanup(exitCode = 0) {
  if (!cleanedUp) {
    cleanedUp = true;
    // Kill child processes (PTY bridge + control client) so they don't
    // linger as orphans.  React cleanup hooks don't fire on process.exit.
    killTrackedChildren();
    await disableInputModesBeforeShutdown(renderer);
    setTerminalOutputRenderer();
    await shutdownRenderer(renderer);
  }
  process.exit(exitCode);
}

function destroyRenderer() {
  if (cleanedUp) return;
  cleanedUp = true;
  setTerminalOutputRenderer();
  try {
    renderer.destroy();
  } catch {
    // already destroyed
  }
}

let handlingFatalError = false;
async function handleFatalError(kind: string, error: unknown) {
  const report = writeFatalReport({ error, kind, sessionName });

  if (handlingFatalError) {
    writeSync(process.stderr.fd, `${formatFatalConsoleMessage(report)}\n`);
    process.exit(1);
    return;
  }
  handlingFatalError = true;

  if (!cleanedUp) {
    cleanedUp = true;
    try {
      await disableInputModesBeforeShutdown(renderer);
    } catch {
      // best-effort
    }
    setTerminalOutputRenderer();
    try {
      await shutdownRenderer(renderer);
    } catch {
      // best-effort
    }
  }

  writeSync(process.stderr.fd, `${formatFatalConsoleMessage(report)}\n`);
  killTrackedChildren();
  process.exit(1);
}

// Let the lock socket trigger the same async teardown that signals use.
// This avoids the native-renderer segfault from a synchronous exit.
onLockShutdown(() => {
  void cleanup(0);
});

process.on("exit", () => {
  // Kill any child processes that were created after the initial
  // killTrackedChildren() in cleanup() — e.g., React re-creating
  // a control client in response to PTY death during async teardown.
  killTrackedChildren();
  releaseLock();
  destroyRenderer();
});
process.on("SIGINT", () => {
  void cleanup(0);
});
process.on("SIGTERM", () => {
  void cleanup(0);
});
process.on("SIGHUP", () => {
  void cleanup(0);
});
process.on("SIGQUIT", () => {
  void cleanup(0);
});
process.on("SIGABRT", () => {
  void handleFatalError("fatal signal SIGABRT", new Error("received SIGABRT"));
});
process.on("SIGBUS", () => {
  void handleFatalError("fatal signal SIGBUS", new Error("received SIGBUS"));
});
process.on("SIGILL", () => {
  void handleFatalError("fatal signal SIGILL", new Error("received SIGILL"));
});
process.on("SIGSEGV", () => {
  void handleFatalError("fatal signal SIGSEGV", new Error("received SIGSEGV"));
});
process.on("uncaughtException", (error) => {
  void handleFatalError("uncaught exception", error);
});
process.on("unhandledRejection", (reason) => {
  void handleFatalError("unhandled rejection", reason);
});

const root = createRoot(renderer);
root.render(<App sessionName={sessionName} />);

log(
  "app",
  `started: session=${sessionName} pid=${process.pid} terminal=${renderer.terminalWidth}x${renderer.terminalHeight}`,
);
log(
  "probe",
  `name=${probe.name ?? "unknown"} utf8=${probe.isUtf8}` +
    ` fg=${probe.fg ? probe.fg.join(",") : "none"}` +
    ` bg=${probe.bg ? probe.bg.join(",") : "none"}` +
    ` cursorStyle=${probe.cursorStyle ?? "none"}` +
    ` caps=${probe.caps.size > 0 ? [...probe.caps.keys()].join(",") : "none"}`,
);

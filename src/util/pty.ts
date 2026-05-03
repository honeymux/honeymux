import type { Osc52Passthrough, OtherOscPassthrough } from "./config.ts";

import { DEFAULT_LOCAL_OSC52_PASSTHROUGH, DEFAULT_LOCAL_OTHER_OSC_PASSTHROUGH } from "./config.ts";
import { writeTerminalOutput } from "./terminal-output.ts";
import { OSC_TERMINATOR } from "./terminal-sequences.ts";

type CleanEnv = {
  HOME?: string;
  LANG?: string;
  LC_ALL?: string;
  LC_CTYPE?: string;
  SHELL?: string;
  TERM?: string;
  TMUX_TMPDIR?: string;
  XDG_CONFIG_HOME?: string;
  XDG_RUNTIME_DIR?: string;
  XDG_STATE_HOME?: string;
} & Record<string, string>;

/**
 * OSC numbers to forward from the PTY to the outer terminal.  The in-process
 * ghostty VT emulator consumes these; without passthrough they never reach
 * the user's terminal emulator.
 *
 *   0/1/2  — window/icon title (shells, vim, htop, …)
 *   9      — server notification (iTerm2 / Windows Terminal)
 *   52     — clipboard set/query (tmux copy-mode, programs using OSC 52),
 *            gated by the OSC passthrough policy
 *   99     — server notification (kitty)
 *   777    — server notification (rxvt-unicode)
 */
const PASSTHROUGH_OSC = new Set([0, 1, 2, 777, 9, 99]);
const MAX_BUFFERED_OSC_BYTES = 1024 * 1024;

export interface PtyBridge {
  exited: Promise<number>;
  kill(): void;
  pid: number;
  resize(cols: number, rows: number): void;
  write(data: Uint8Array | string): void;
}

interface OscPassthroughPolicy {
  osc52: Osc52Passthrough;
  other: OtherOscPassthrough;
}

interface OscStreamProcessorOptions {
  copyPlainBytes?: boolean;
  forwardStandaloneBell?: boolean;
  maxBufferedOscBytes: number;
  normalizeOscTerminatorToBel?: boolean;
  shouldWriteOsc: (data: ArrayLike<number>) => boolean;
  write: (data: Uint8Array | string) => void;
}

interface PassthroughForwarderOptions {
  maxBufferedOscBytes?: number;
  policyOsc52Passthrough?: Osc52Passthrough;
  policyOtherOscPassthrough?: OtherOscPassthrough;
  write?: (data: Uint8Array | string) => void;
}

/**
 * Create a stateful passthrough forwarder that correctly handles OSC
 * sequences split across data chunks. Returns a function to call with
 * each chunk of PTY output.
 *
 * Forwards:
 * - Matching OSC sequences (see PASSTHROUGH_OSC above).
 * - OSC 52 according to the policyOsc52Passthrough policy.
 * - Other host-affecting passthrough OSC sequences according to the
 *   policyOtherOscPassthrough policy.
 * - BEL (0x07) — standalone bell (not OSC terminators) for audible bell.
 */
export function createPassthroughForwarder(options: PassthroughForwarderOptions = {}): (data: Buffer) => void {
  const policy = resolveOscPassthroughPolicy(options, {
    osc52: DEFAULT_LOCAL_OSC52_PASSTHROUGH,
    other: DEFAULT_LOCAL_OTHER_OSC_PASSTHROUGH,
  });
  const write = options.write ?? defaultPassthroughWrite;
  const maxBufferedOscBytes = Math.max(4, options.maxBufferedOscBytes ?? MAX_BUFFERED_OSC_BYTES);
  return createOscStreamProcessor({
    forwardStandaloneBell: true,
    maxBufferedOscBytes,
    normalizeOscTerminatorToBel: true,
    shouldWriteOsc: (data) => shouldForwardOsc(data, policy),
    write,
  });
}

function createOscStreamProcessor(options: OscStreamProcessorOptions): (data: Buffer) => void {
  let inOsc = false;
  let oscBuf: number[] = [];
  let discardingOsc = false;
  let discardPrevWasEsc = false;
  let plainBuf: number[] = [];

  const flushPlain = () => {
    if (plainBuf.length === 0) return;
    options.write(Buffer.from(plainBuf));
    plainBuf = [];
  };

  const writeOsc = (osc: ArrayLike<number>) => {
    if (!options.shouldWriteOsc(osc)) return;
    const end = osc.length;
    const hasStTerminator = end >= 2 && osc[end - 2] === 0x1b && osc[end - 1] === 0x5c;
    if (options.normalizeOscTerminatorToBel && hasStTerminator) {
      options.write(Buffer.from(Array.from(osc).slice(0, -2)));
      options.write(OSC_TERMINATOR);
      return;
    }
    options.write(Buffer.from(Array.from(osc)));
  };

  return function processOscStream(data: Buffer): void {
    let i = 0;

    while (i < data.length) {
      if (discardingOsc) {
        while (i < data.length) {
          const byte = data[i]!;
          i++;
          if (byte === 0x07) {
            discardingOsc = false;
            discardPrevWasEsc = false;
            break;
          }
          if (discardPrevWasEsc && byte === 0x5c) {
            discardingOsc = false;
            discardPrevWasEsc = false;
            break;
          }
          discardPrevWasEsc = byte === 0x1b;
        }
        continue;
      }

      if (inOsc) {
        while (i < data.length) {
          const byte = data[i]!;
          oscBuf.push(byte);
          if (byte === 0x07) {
            i++;
            break;
          }
          if (byte === 0x1b && i + 1 < data.length && data[i + 1] === 0x5c) {
            oscBuf.push(data[i + 1]!);
            i += 2;
            break;
          }
          i++;
        }

        const last = oscBuf[oscBuf.length - 1];
        const prevLast = oscBuf.length >= 2 ? oscBuf[oscBuf.length - 2] : -1;
        if (last === 0x07 || (prevLast === 0x1b && last === 0x5c)) {
          writeOsc(oscBuf);
          inOsc = false;
          oscBuf = [];
        } else if (oscBuf.length > options.maxBufferedOscBytes) {
          inOsc = false;
          oscBuf = [];
          discardingOsc = true;
          discardPrevWasEsc = data[i - 1] === 0x1b;
        }
        continue;
      }

      if (data[i] === 0x1b && i + 1 < data.length && data[i + 1] === 0x5d) {
        flushPlain();
        const start = i;
        i += 2;
        let end = -1;
        while (i < data.length) {
          if (data[i] === 0x07) {
            end = i + 1;
            break;
          }
          if (data[i] === 0x1b && i + 1 < data.length && data[i + 1] === 0x5c) {
            end = i + 2;
            break;
          }
          i++;
        }
        if (end === -1) {
          const partial = Array.from(data.subarray(start));
          if (partial.length > options.maxBufferedOscBytes) {
            discardingOsc = true;
            discardPrevWasEsc = partial[partial.length - 1] === 0x1b;
          } else {
            inOsc = true;
            oscBuf = partial;
          }
          break;
        }
        writeOsc(data.subarray(start, end));
        i = end;
      } else if (data[i] === 0x07 && options.forwardStandaloneBell) {
        options.write("\x07");
        i++;
      } else {
        if (options.copyPlainBytes) {
          plainBuf.push(data[i]!);
        }
        i++;
      }
    }

    flushPlain();
  };
}

function defaultPassthroughWrite(data: Uint8Array | string): void {
  writeTerminalOutput(data);
}

function findByte(data: ArrayLike<number>, byte: number, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    if (data[i] === byte) return i;
  }
  return -1;
}

function getOscPayloadEnd(data: ArrayLike<number>): number {
  const end = data.length;
  if (end >= 2 && data[end - 2] === 0x1b && data[end - 1] === 0x5c) return end - 2;
  if (end >= 1 && data[end - 1] === 0x07) return end - 1;
  return end;
}

function isOsc52ReadQuery(data: ArrayLike<number>, digitsEnd: number): boolean {
  const payloadEnd = getOscPayloadEnd(data);
  if (digitsEnd >= payloadEnd || data[digitsEnd] !== 0x3b) return false;
  const targetSep = findByte(data, 0x3b, digitsEnd + 1, payloadEnd);
  if (targetSep === -1) return false;
  const valueStart = targetSep + 1;
  return valueStart + 1 === payloadEnd && data[valueStart] === 0x3f;
}

function parseOscNumber(data: ArrayLike<number>): { digitsEnd: number; number: number } | null {
  const payloadEnd = getOscPayloadEnd(data);
  let oscNum = 0;
  let i = 2; // skip ESC ]
  while (i < payloadEnd && data[i]! >= 0x30 && data[i]! <= 0x39) {
    oscNum = oscNum * 10 + (data[i]! - 0x30);
    i++;
  }
  if (i <= 2) return null;
  return { digitsEnd: i, number: oscNum };
}

function resolveOscPassthroughPolicy(
  options: Pick<PassthroughForwarderOptions, "policyOsc52Passthrough" | "policyOtherOscPassthrough">,
  defaults: OscPassthroughPolicy,
): OscPassthroughPolicy {
  return {
    osc52: options.policyOsc52Passthrough ?? defaults.osc52,
    other: options.policyOtherOscPassthrough ?? defaults.other,
  };
}

function shouldForwardOsc(data: ArrayLike<number>, policy: OscPassthroughPolicy): boolean {
  const parsed = parseOscNumber(data);
  if (!parsed) return false;
  if (parsed.number === 52) {
    if (policy.osc52 === "off") return false;
    if (policy.osc52 === "all") return true;
    return !isOsc52ReadQuery(data, parsed.digitsEnd);
  }
  return policy.other === "allow" && PASSTHROUGH_OSC.has(parsed.number);
}

/**
 * Prefixes of env vars injected by terminal emulators that trigger shell
 * integration or other terminal-specific behaviour inside the PTY bridge.
 * Honeymux *is* the terminal from tmux's perspective, so these must not leak.
 */
const STRIP_PREFIXES = [
  "COLORFGBG", // Konsole, rxvt — fg/bg color indices
  "GHOSTTY_", // Ghostty — shell integration, resources dir
  "GNOME_TERMINAL_", // GNOME Terminal — D-Bus paths
  "ITERM_", // iTerm2 — shell integration, session/profile IDs
  "KITTY_", // Kitty — shell integration, remote control socket
  "KONSOLE_", // Konsole — D-Bus session/window
  "LC_TERMINAL", // iTerm2 — terminal identity via locale (covers LC_TERMINAL_VERSION)
  "RIO_", // Rio — config path
  "TABBY_", // Tabby — config directory
  "TERM_PROGRAM", // Generic — terminal name/version (covers TERM_PROGRAM_VERSION)
  "TILIX_", // Tilix — pane ID
  "VTE_", // VTE (GNOME Terminal, etc.) — triggers /etc/profile.d/vte.sh
  "WEZTERM_", // WezTerm — IPC socket, pane IDs
  "WT_", // Windows Terminal — session/profile GUIDs
];

const STRIP_EXACT = [
  "TMUX", // Prevent nested-tmux confusion
];

/** Strip outer-terminal env vars that cause shell integration junk inside tmux. */
export function cleanEnv(): CleanEnv {
  const env: CleanEnv = {};
  outer: for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (STRIP_EXACT.includes(k)) continue;
    for (const prefix of STRIP_PREFIXES) {
      if (k.startsWith(prefix)) continue outer;
    }
    env[k] = v;
  }
  // Normalize TERM to avoid failures when terminal-specific terminfo
  // (e.g. xterm-ghostty) isn't installed on the system.
  env.TERM = "xterm-256color";
  return env;
}

export function spawnPty(cmd: string[], cols: number, rows: number, onData: (data: Buffer) => void): PtyBridge {
  const proc = Bun.spawn(cmd, {
    env: cleanEnv(),
    terminal: {
      cols,
      data(_terminal, data) {
        onData(Buffer.from(data));
      },
      rows,
    },
  });
  return {
    exited: proc.exited,
    kill: () => proc.kill(),
    pid: proc.pid,
    resize: (c, r) => proc.terminal!.resize(c, r),
    write: (data) => proc.terminal!.write(data),
  };
}

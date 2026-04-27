/**
 * Consolidated terminal probe — sends all startup queries in one batch
 * and uses CPR as a sentinel to know when the terminal has processed
 * everything.
 *
 * Replaces the separate queryTerminalName(), queryTerminalCaps(),
 * initTheme()'s palette queries, and probeTerminalUtf8().
 *
 * The key insight: terminals process their input stream sequentially.
 * By appending a CPR query (`ESC[6n`) after all other queries, the CPR
 * response is guaranteed to arrive AFTER all prior responses. When it
 * arrives, we know every query has been answered or ignored — no
 * arbitrary timeout needed.
 *
 * A generous hard timeout (default 10s) remains as a fallback for
 * terminals that don't even respond to CPR (essentially nonexistent).
 */
import type { RGB } from "../themes/theme.ts";

import { OSC_TERMINATOR } from "./terminal-sequences.ts";

export interface ProbeOptions {
  /** Query cursor style via DECRQSS (for non-"auto" themes) */
  queryCursorStyle: boolean;
  /** Query the full 16-color palette via OSC 4 (for "auto" theme) */
  queryPalette: boolean;
  /** Hard timeout in ms — fallback for truly broken terminals (default 10s) */
  timeout?: number;
}

export interface TerminalProbeResult {
  /** Background color from OSC 11 */
  bg: RGB | null;
  /** Terminal capabilities from XTGETTCAP */
  caps: Map<string, string>;
  /** Cursor style DECSCUSR parameter from DECRQSS */
  cursorStyle: null | number;
  /** Foreground color from OSC 10 */
  fg: RGB | null;
  /** Whether terminal operates in UTF-8 mode (from CPR measurement) */
  isUtf8: boolean | null;
  /** Whether terminal supports the Kitty keyboard protocol (responded to CSI ? u) */
  kittyKeyboard: boolean;
  /** Terminal emulator name from XTVERSION, e.g. "iTerm2 3.6.9" */
  name: null | string;
  /** Palette colors 0-15 from OSC 4 (null entries = not reported) */
  paletteColors: (RGB | null)[];
}

// ── Capabilities to query via XTGETTCAP ──────────────────────────────────

const QUERY_CAPS = [
  "Ms", // OSC 52 set-selection (clipboard)
  "Tc", // 24-bit true color
  "RGB", // 24-bit true color (alternative)
  "Su", // styled scrollback
  "Smulx", // styled/extended underlines
  "Setulc", // colored underlines (independent of fg)
  "Ss", // cursor style setting (DECSCUSR)
  "Sync", // synchronized output (reduces flicker)
  "Be", // bracketed paste
];

// ── Hex encoding helpers (for XTGETTCAP) ─────────────────────────────────

function hexDecode(hex: string): string {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

function hexEncode(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += s.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}

// ── OSC color parsing ────────────────────────────────────────────────────

/** Parse a 4-digit-per-channel hex value, returning the high byte (0-255). */
function parseColorChannel(hex4: string): number {
  return parseInt(hex4.slice(0, 2), 16);
}

// ── XTVERSION name prettification ────────────────────────────────────────

const KNOWN_TERMINALS: Record<string, string> = {
  alacritty: "Alacritty",
  contour: "Contour",
  foot: "Foot",
  ghostty: "Ghostty",
  iterm2: "iTerm2",
  kitty: "Kitty",
  tmux: "tmux",
  wezterm: "WezTerm",
  xterm: "xterm",
};

export async function probeTerminal(opts: ProbeOptions): Promise<TerminalProbeResult> {
  const result: TerminalProbeResult = {
    bg: null,
    caps: new Map(),
    cursorStyle: null,
    fg: null,
    isUtf8: null,
    kittyKeyboard: false,
    name: null,
    paletteColors: new Array(16).fill(null),
  };

  if (!process.stdin.isTTY || !process.stdout.isTTY) return result;

  return new Promise<TerminalProbeResult>((resolve) => {
    let buf = "";
    let cprCount = 0; // 0 = awaiting first (sentinel), 1 = awaiting second (UTF-8)
    let startCol: null | number = null;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardTimer);
      process.stdin.removeListener("data", onData);
      resolve(result);
    };

    const hardTimer = setTimeout(finish, opts.timeout ?? 10_000);

    // ── Response parsers ───────────────────────────────────────────────
    // Each parser tries one pattern against the buffer. Returns the match
    // end index (so the caller can advance), or -1 if no match.
    //
    // We try every parser on each iteration and pick the earliest match
    // to handle interleaved responses correctly.

    type ParseHit = { apply: () => void; end: number; start: number };

    function tryParsers(): ParseHit | null {
      let best: ParseHit | null = null;

      const consider = (re: RegExp, apply: (m: RegExpExecArray) => void) => {
        const m = re.exec(buf);
        if (m && (best === null || m.index < best.start)) {
          const captured = m;
          best = {
            apply: () => apply(captured),
            end: m.index + m[0].length,
            start: m.index,
          };
        }
      };

      // XTVERSION: DCS >| <text> ST
      consider(/(?:\x1bP|\x90)>\|([^\x1b\x07]+)(?:\x1b\\|\x07|\x9c)/, (m) => {
        result.name = prettifyName(m[1]!.trim());
      });

      // XTGETTCAP: DCS [01] +r <hex-payload> ST
      consider(/(?:\x1bP|\x90)([01])\+r([^\x1b\x07]*)(?:\x1b\\|\x07|\x9c)/, (m) => {
        if (m[1] === "1" && m[2]) {
          for (const pair of m[2].split(";")) {
            const eq = pair.indexOf("=");
            if (eq > 0) {
              result.caps.set(hexDecode(pair.slice(0, eq)), hexDecode(pair.slice(eq + 1)));
            } else if (pair.length > 0) {
              result.caps.set(hexDecode(pair), "");
            }
          }
        }
      });

      // DECRQSS cursor style: DCS :?[01] $r <param> SP q ST
      consider(/(?:\x1bP|\x90):?([01])\$r\s*(\d+)\s+q(?:\x1b\\|\x9c)/, (m) => {
        if (m[1] === "1") {
          result.cursorStyle = parseInt(m[2]!, 10);
        }
      });

      // OSC color response: ESC ] N ; [index;] rgb:R/G/B (BEL|ST)
      consider(/\x1b\](\d+);(?:(\d+);)?rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)(?:\x07|\x1b\\)/, (m) => {
        const osc = parseInt(m[1]!, 10);
        const rgb: RGB = [parseColorChannel(m[3]!), parseColorChannel(m[4]!), parseColorChannel(m[5]!)];
        if (osc === 10) result.fg = rgb;
        else if (osc === 11) result.bg = rgb;
        else if (osc === 4) {
          const idx = m[2] != null ? parseInt(m[2], 10) : -1;
          if (idx >= 0 && idx < 16) result.paletteColors[idx] = rgb;
        }
      });

      // Kitty keyboard protocol response: ESC [ ? <flags> u
      consider(/\x1b\[\?(\d+)u/, () => {
        result.kittyKeyboard = true;
      });

      // CPR: ESC [ row ; col R
      consider(/\x1b\[(\d+);(\d+)R/, (m) => {
        const col = parseInt(m[2]!, 10);
        if (cprCount === 0) {
          // First CPR = phase 1 sentinel. All phase 1 queries have been
          // answered (or ignored). If XTVERSION responded, the terminal
          // supports DCS — send XTGETTCAP + DECRQSS in phase 2.
          cprCount = 1;

          if (result.name !== null) {
            // Terminal supports DCS — safe to send XTGETTCAP/DECRQSS
            const phase2: string[] = [];
            const hexNames = QUERY_CAPS.map(hexEncode).join(";");
            phase2.push(`\x1bP+q${hexNames}\x1b\\`); // XTGETTCAP
            if (opts.queryCursorStyle) {
              phase2.push("\x1bP$q q\x1b\\"); // DECRQSS
            }
            phase2.push("\u20ac\x1b[6n"); // UTF-8 probe + CPR sentinel
            startCol = col;
            process.stdout.write(phase2.join(""));
          } else {
            // Terminal doesn't support DCS — skip phase 2, just do UTF-8 probe
            startCol = col;
            process.stdout.write("\u20ac\x1b[6n"); // UTF-8 probe + CPR
          }
        } else {
          // Second CPR = UTF-8 result.  In UTF-8 mode € advances 1 col;
          // in byte mode it advances 3.
          result.isUtf8 = startCol !== null ? col - startCol === 1 : null;
          // Erase the test character
          if (startCol !== null && col > startCol) {
            const advance = col - startCol;
            process.stdout.write("\b".repeat(advance) + " ".repeat(advance) + "\b".repeat(advance));
          }
          finish();
        }
      });

      return best;
    }

    // ── stdin listener ─────────────────────────────────────────────────

    const onData = (data: Buffer) => {
      buf += data.toString("latin1");

      // Drain all complete responses from the buffer.
      while (!resolved) {
        const hit = tryParsers();
        if (!hit) break;
        buf = buf.slice(hit.end);
        hit.apply();
      }
    };

    process.stdin.on("data", onData);

    // ── Phase 1: non-DCS queries ───────────────────────────────────────
    // Send XTVERSION (CSI, not DCS — safe for all terminals), Kitty keyboard
    // query, color queries, and a CPR sentinel. Terminals that don't support
    // XTVERSION simply won't respond to it; nothing gets echoed.

    const phase1: string[] = [];

    phase1.push("\x1b[>0q"); // XTVERSION
    phase1.push("\x1b[?u"); // Kitty keyboard query

    // Colors (always query fg + bg)
    phase1.push(`\x1b]10;?${OSC_TERMINATOR}`); // OSC 10 (fg)
    phase1.push(`\x1b]11;?${OSC_TERMINATOR}`); // OSC 11 (bg)
    if (opts.queryPalette) {
      for (let i = 0; i < 16; i++) {
        phase1.push(`\x1b]4;${i};?${OSC_TERMINATOR}`); // OSC 4;N
      }
    }

    // Sentinel: CPR doubles as phase 1 of the UTF-8 probe
    phase1.push("\x1b[6n"); // CPR

    process.stdout.write(phase1.join(""));
  });
}

// ── Main probe function ──────────────────────────────────────────────────

function prettifyName(raw: string): string {
  const spaceIdx = raw.indexOf(" ");
  const name = spaceIdx > 0 ? raw.slice(0, spaceIdx) : raw;
  const ver = spaceIdx > 0 ? raw.slice(spaceIdx + 1) : "";
  const prettyName = KNOWN_TERMINALS[name.toLowerCase()] ?? name;
  return ver ? `${prettyName} ${ver}` : prettyName;
}

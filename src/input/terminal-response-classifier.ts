/* eslint-disable no-control-regex */

// Terminal replies that OpenTUI itself should handle. Letting these fall
// through preserves the renderer's late capability and pixel-size updates.
const OPENTUI_PRIVATE_RESPONSE_RE = /^\x1b\[\?[\d;]+(?:\$y|u|c)$/;
const PIXEL_RESPONSE_RE = /^\x1b\[4;\d+;\d+t$/;
//
// Ambiguous CSI responses that the router still discards locally.
//
// Full CSI response: ESC [ ?  digits  suffix
//   DECRPM ($y), window ops (t), CPR (R), DSR (n), DA (c)
//   Kitty keyboard query responses (ESC [ ? digits u) are matched separately
//   because keyboard INPUT also ends in 'u' (ESC [ digits ; digits u).
//   Requires [\d;]+ (at least one digit) so single-char keys don't match.
const CSI_RESPONSE_RE = /^\x1b\[\??[\d;]+(\$y|[tRnc])$|^\x1b\[\?[\d;]+u$/;
//
// Bare response — CSI prefix was consumed by the input parser.
//   Requires at least one semicolon so keystrokes like "t" or "4t" don't match.
const BARE_RESPONSE_RE = /^\d[\d;]*;[\d;]*(\$y|[tRnc])$/;
//
// DCS response: ESC P <payload> ST  (ST = ESC \)
//   Catches late XTVERSION, XTGETTCAP, DECRQSS replies that arrive after the
//   startup query timeout on high-latency connections.
const DCS_RESPONSE_RE = /^\x1bP[\s\S]*\x1b\\$/;
//
// OSC response: ESC ] <payload> ST  (ST = BEL or ESC \)
//   Catches late color query replies (OSC 10, 11, 4) from startup detection.
const OSC_RESPONSE_RE = /^\x1b][\s\S]*(\x07|\x1b\\)$/;
//
// APC response: ESC _ <payload> ST  (ST = ESC \)
//   Catches late Kitty graphics replies such as ESC_Gi=31337;OKESC\ that can
//   otherwise leak into the attached tmux pane as literal text.
const APC_RESPONSE_RE = /^\x1b_[\s\S]*\x1b\\$/;

type TerminalResponseClassification = "consume" | "none" | "opentui";

export function classifyTerminalResponse(sequence: string): TerminalResponseClassification {
  if (
    OPENTUI_PRIVATE_RESPONSE_RE.test(sequence) ||
    PIXEL_RESPONSE_RE.test(sequence) ||
    DCS_RESPONSE_RE.test(sequence) ||
    OSC_RESPONSE_RE.test(sequence) ||
    APC_RESPONSE_RE.test(sequence)
  ) {
    return "opentui";
  }

  if (CSI_RESPONSE_RE.test(sequence) || BARE_RESPONSE_RE.test(sequence)) {
    return "consume";
  }

  return "none";
}

import type { AgentSession } from "../../agents/types.ts";
import type { KeyAction, KeybindingConfig } from "../../util/keybindings.ts";

import { getToolPermissionInfo } from "../../agents/tool-permission-info.ts";
import { theme } from "../../themes/theme.ts";
import { formatBinding } from "../../util/keybindings.ts";

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

export const MUXOTRON_COUNTER_LABEL = "unanswered/total";

export const MUXOTRON_HINT_COLORS = {
  approve: theme.statusSuccess,
  deny: theme.statusError,
  dismiss: "#a0a0a0",
  goto: "#81c8be",
  /** Dim grey used for hotkey prefixes when the shortcut is inactive
   *  (e.g. while latched into an agent PTY). Picked to be clearly dimmer
   *  than every bg color but still legible on all of them. */
  hotkeyDim: "#707080",
  /** Rose bg for the latch button (review-workflow unlatch toggle). */
  latch: "#babbf1",
  nav: "#3a5a8a",
  navFg: "#e5c890",
} as const;

export interface MuxotronBorderOverlay {
  content: string;
  left: number;
}

export interface MuxotronHintButton {
  color: string;
  /** When true, the hotkey prefix portion of the label (everything up to and
   *  including the ": " separator) is rendered in a dim fg to signal that the
   *  keyboard shortcut is inactive while the button remains clickable. */
  dimHotkey?: boolean;
  disabled?: boolean;
  fg?: string;
  label: string;
  onClick?: () => void;
}

interface BuildMuxotronBorderStrArgs {
  dash: string;
  inner: number;
  labels?: string;
  leftCorner: string;
  rightCorner: string;
  withLabel: boolean;
}

interface BuildMuxotronHintButtonsArgs {
  keybindings: KeybindingConfig;
  latched?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  onDismiss?: () => void;
  onGoto?: () => void;
  onLatchToggle?: () => void;
  onNextAgent?: () => void;
  onPrevAgent?: () => void;
  selectedSession?: AgentSession | null;
}

export function buildMuxotronBorderStr({
  dash,
  inner,
  labels = MUXOTRON_COUNTER_LABEL,
  leftCorner,
  rightCorner,
  withLabel,
}: BuildMuxotronBorderStrArgs): string {
  if (!withLabel) {
    return `${leftCorner}${dash.repeat(inner)}${rightCorner}`;
  }
  const rightBlock = ` ${labels} `;
  const dashCount = inner - rightBlock.length;
  return `${leftCorner}${dash.repeat(Math.max(0, dashCount))}${rightBlock}${rightCorner}`;
}

export function buildMuxotronHintButtons({
  keybindings,
  latched,
  onApprove,
  onDeny,
  onDismiss,
  onGoto,
  onLatchToggle,
  onNextAgent,
  onPrevAgent,
  selectedSession,
}: BuildMuxotronHintButtonsArgs): MuxotronHintButton[] {
  const fmt = (action: KeyAction, label: string): string => {
    const combo = keybindings[action];
    return combo ? `${formatBinding(combo)}: ${label}` : label;
  };

  const canRespondToPermission = selectedSession ? selectedSession.status === "unanswered" : true;

  // In review mode + latched, the letter/arrow keyboard shortcuts are
  // forwarded to the agent's PTY, so the hotkey prefix of each button is
  // rendered dim to signal that. The buttons remain clickable via mouse.
  // The latch button is the exception — agentLatch still unlatches
  // while latched, so its hotkey stays fully lit.
  const dimHotkey = !!selectedSession && !!latched;

  // Permission-response strip: approve / deny / goto / dismiss.
  if (!selectedSession) {
    return [
      {
        color: canRespondToPermission ? MUXOTRON_HINT_COLORS.approve : theme.textDim,
        disabled: !canRespondToPermission,
        label: fmt("agentPermApprove", "approve"),
        onClick: canRespondToPermission ? onApprove : undefined,
      },
      {
        color: canRespondToPermission ? MUXOTRON_HINT_COLORS.deny : theme.textDim,
        disabled: !canRespondToPermission,
        label: fmt("agentPermDeny", "deny"),
        onClick: canRespondToPermission ? onDeny : undefined,
      },
      { color: MUXOTRON_HINT_COLORS.goto, label: fmt("agentPermGoto", "goto"), onClick: onGoto },
      {
        color: MUXOTRON_HINT_COLORS.dismiss,
        label: fmt("agentPermDismiss", "dismiss"),
        onClick: onDismiss,
      },
    ];
  }

  // Review-workflow strip: latch / goto / prev / next. Approve and deny
  // are intentionally absent — the review flow is for surveying agents that
  // may or may not have a pending permission, so permission-shaped actions
  // don't belong here. While latched, the same button toggles back out so
  // its label flips from "latch" to "release".
  return [
    {
      color: MUXOTRON_HINT_COLORS.latch,
      label: fmt("agentLatch", latched ? "release" : "latch"),
      onClick: onLatchToggle,
    },
    { color: MUXOTRON_HINT_COLORS.goto, dimHotkey, label: fmt("agentReviewGoto", "goto"), onClick: onGoto },
    {
      color: MUXOTRON_HINT_COLORS.nav,
      dimHotkey: latched,
      fg: MUXOTRON_HINT_COLORS.navFg,
      label: "↑: prev",
      onClick: onPrevAgent,
    },
    {
      color: MUXOTRON_HINT_COLORS.nav,
      dimHotkey: latched,
      fg: MUXOTRON_HINT_COLORS.navFg,
      label: "↓: next",
      onClick: onNextAgent,
    },
  ];
}

export function buildMuxotronToolInfo(session: AgentSession | undefined, preserveNewlines = false): string {
  if (!session) return "";
  if (session.status !== "unanswered") return "Running";
  const info = getToolPermissionInfo(
    session.agentType,
    session.lastEvent?.toolName,
    session.lastEvent?.toolInput,
    session.lastEvent?.notification,
  );
  return sanitizeMuxotronDisplayText(preserveNewlines ? info.detail : info.summary, preserveNewlines);
}

export function formatMuxotronCount(n: number): string {
  return String(n).padStart(3, "0");
}

export function getFirstUnansweredSession(
  sessions: AgentSession[],
  activePaneId?: null | string,
): AgentSession | undefined {
  return sessions
    .filter((session) => session.status === "unanswered" && !session.dismissed && session.paneId !== activePaneId)
    .sort((a, b) => a.startedAt - b.startedAt)[0];
}

/**
 * Decides whether the muxotron should render a dashed border. The dashed
 * pattern signals "latch available" — it appears only when a latch keybinding
 * is configured, the user isn't currently engaged with an agent, and at least
 * one undismissed permission request is active somewhere.
 *
 * "Engaged" depends on which latch path is in play:
 *  - review workflow (tree-selected agent): `reviewLatched` is the truth.
 *    `muxotronFocusActive` is already true while previewing, so it can't be
 *    used as the engaged signal here.
 *  - perm-request latch (no tree selection): pressing agentLatch zooms the
 *    muxotron via handleAgentLatch, which flips `muxotronFocusActive` but
 *    leaves `reviewLatched` false — so the focus flag is the engaged signal.
 *
 * The eqActive caller takes visual precedence (its heavy solid chars already
 * carry their own alert meaning), so it's checked by the caller before this.
 */
export function isMuxotronDashed(input: {
  agentLatchBindingLabel?: string;
  eqActive: boolean;
  hasActivePermissionRequest: boolean;
  muxotronFocusActive: boolean;
  reviewLatched: boolean;
  selectedSession: boolean;
}): boolean {
  if (input.eqActive) return false;
  if (!input.agentLatchBindingLabel) return false;
  if (!input.hasActivePermissionRequest) return false;
  const isEngaged = input.selectedSession ? input.reviewLatched : input.muxotronFocusActive;
  return !isEngaged;
}

/**
 * Punches periodic gaps into horizontal border runs by replacing every 4th
 * horizontal dash char with a space. The caller must render the result with
 * an opaque bg so the gap cells don't let underlying content bleed through.
 * Covers light/heavy/scribble variants so it composes with scribbleCycle.
 */
export function punchDashedBorderGaps(s: string): string {
  const DASH_CHARS = "─━┅┄";
  let dashSeen = 0;
  let out = "";
  for (const ch of s) {
    if (DASH_CHARS.includes(ch)) {
      dashSeen += 1;
      if (dashSeen % 4 === 0) {
        out += " ";
        continue;
      }
    }
    out += ch;
  }
  return out;
}

export function sanitizeMuxotronDisplayText(text: string, preserveNewlines = false): string {
  const normalized = preserveNewlines
    ? text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    : text.replaceAll("\r\n", " ").replaceAll("\r", " ").replaceAll("\n", " ");
  let out = "";
  for (const ch of normalized) {
    if (!isMuxotronControlChar(ch, preserveNewlines)) out += ch;
  }
  return out;
}

export function splitMuxotronBorderOverlays(
  borderStr: string,
  baseLeft = 0,
): { lineStr: string; overlays: MuxotronBorderOverlay[] } {
  const lineChars: string[] = [];
  const overlays: MuxotronBorderOverlay[] = [];
  let textStart = -1;
  let textBuffer = "";

  for (let i = 0; i < borderStr.length; i++) {
    const ch = borderStr[i]!;
    const isLineChar = "╭╮╰╯│─┏┓┗┛┃━┅┇┻".includes(ch);
    if (isLineChar) {
      if (textBuffer.length > 0) {
        overlays.push({ content: textBuffer, left: baseLeft + textStart });
        textBuffer = "";
        textStart = -1;
      }
      lineChars[i] = ch;
      continue;
    }
    if (textStart === -1) textStart = i;
    textBuffer += ch;
    lineChars[i] = " ";
  }

  if (textBuffer.length > 0) {
    overlays.push({ content: textBuffer, left: baseLeft + textStart });
  }

  return { lineStr: lineChars.join(""), overlays };
}

export function toSuperscript(n: number): string {
  return String(n)
    .split("")
    .map((digit) => SUPERSCRIPT_DIGITS[+digit])
    .join("");
}

function isMuxotronControlChar(ch: string, preserveNewlines: boolean): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (preserveNewlines && code === 0x0a) return false;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

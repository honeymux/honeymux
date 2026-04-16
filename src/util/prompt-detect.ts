export interface PanePromptTapState {
  atPrompt: boolean;
  carry: string;
  hasPromptMarks: boolean;
}

export type PromptClickMode = "not-prompt" | "prompt" | "unknown";

export interface PromptInputStart {
  x: number;
  y: number;
}

const ESC = "\x1b";
const OSC_PREFIX = `${ESC}]`;
const OSC_ST = `${ESC}\\`;
const MAX_CARRY = 256;

/**
 * Analyze raw tmux %output chunks for semantic prompt markers.
 *
 * Supports OSC 133 (FinalTerm/VTE/Ghostty-style shell integration) and
 * OSC 3008 (systemd shell context). The returned state is immutable.
 */
export function analyzePromptChunk(chunk: string, priorState: PanePromptTapState): PanePromptTapState {
  const nextState: PanePromptTapState = {
    atPrompt: priorState.atPrompt,
    carry: "",
    hasPromptMarks: priorState.hasPromptMarks,
  };
  const text = priorState.carry + chunk;
  let index = 0;

  while (index < text.length) {
    const oscIndex = text.indexOf(OSC_PREFIX, index);
    if (oscIndex === -1) {
      nextState.carry = trailingPrefix(text);
      return nextState;
    }

    let end = -1;
    let terminatorLen = 0;
    for (let i = oscIndex + OSC_PREFIX.length; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === "\x07") {
        end = i;
        terminatorLen = 1;
        break;
      }
      if (ch === ESC && text.startsWith(OSC_ST, i)) {
        end = i;
        terminatorLen = OSC_ST.length;
        break;
      }
    }

    if (end === -1) {
      nextState.carry = text.slice(oscIndex).slice(-MAX_CARRY);
      return nextState;
    }

    applyOsc(text.slice(oscIndex + OSC_PREFIX.length, end), nextState);
    index = end + terminatorLen;
  }

  nextState.carry = "";
  return nextState;
}

export function initialPanePromptTapState(): PanePromptTapState {
  return {
    atPrompt: false,
    carry: "",
    hasPromptMarks: false,
  };
}

function applyOsc(content: string, state: PanePromptTapState): void {
  if (content.startsWith("133;")) {
    const code = content.slice(4, 5);
    if (code === "A" || code === "B" || code === "P") {
      state.hasPromptMarks = true;
      state.atPrompt = true;
    } else if (code === "C" || code === "D") {
      state.hasPromptMarks = true;
      state.atPrompt = false;
    }
    return;
  }

  if (!content.startsWith("3008;")) return;
  if (content.includes(";type=shell")) {
    state.hasPromptMarks = true;
    state.atPrompt = true;
    return;
  }
  if (content.includes(";type=command")) {
    state.hasPromptMarks = true;
    state.atPrompt = false;
  }
}

function trailingPrefix(text: string): string {
  if (text.endsWith(OSC_PREFIX)) return OSC_PREFIX;
  if (text.endsWith(ESC)) return ESC;
  return "";
}

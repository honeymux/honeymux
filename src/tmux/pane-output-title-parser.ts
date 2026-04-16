export interface PaneOutputTitleParserState {
  carry: string;
  discardPrevWasEsc: boolean;
  discardingOsc: boolean;
}

export interface PaneOutputTitleUpdate {
  state: PaneOutputTitleParserState;
  title?: string;
}

const BEL = "\x07";
const ESC = "\x1b";
const OSC_PREFIX = `${ESC}]`;
const OSC_ST = `${ESC}\\`;
const MAX_BUFFERED_TITLE_OSC_CHARS = 4096;

export function initialPaneOutputTitleParserState(): PaneOutputTitleParserState {
  return {
    carry: "",
    discardPrevWasEsc: false,
    discardingOsc: false,
  };
}

export function parsePaneOutputTitleUpdate(
  chunk: string,
  priorState: PaneOutputTitleParserState,
): PaneOutputTitleUpdate {
  let carry = priorState.carry;
  let discardPrevWasEsc = priorState.discardPrevWasEsc;
  let discardingOsc = priorState.discardingOsc;
  let latestTitle: string | undefined;

  let index = 0;
  while (index < chunk.length) {
    const ch = chunk[index]!;

    if (discardingOsc) {
      if (ch === BEL) {
        discardingOsc = false;
        discardPrevWasEsc = false;
      } else if (discardPrevWasEsc && ch === "\\") {
        discardingOsc = false;
        discardPrevWasEsc = false;
      } else {
        discardPrevWasEsc = ch === ESC;
      }
      index++;
      continue;
    }

    if (carry.length > 0) {
      if (carry === ESC) {
        if (ch === "]") {
          carry = OSC_PREFIX;
          index++;
          continue;
        }
        carry = "";
        continue;
      }

      carry += ch;
      if (ch === BEL || carry.endsWith(OSC_ST)) {
        const title = parseCapturedTitleOsc(carry);
        if (title !== undefined) latestTitle = title;
        carry = "";
      } else if (carry.length > MAX_BUFFERED_TITLE_OSC_CHARS) {
        carry = "";
        discardingOsc = true;
        discardPrevWasEsc = ch === ESC;
      }
      index++;
      continue;
    }

    if (ch === ESC) {
      carry = ESC;
    }
    index++;
  }

  return {
    state: {
      carry,
      discardPrevWasEsc,
      discardingOsc,
    },
    title: latestTitle,
  };
}

function parseCapturedTitleOsc(osc: string): string | undefined {
  const terminatorLength = osc.endsWith(OSC_ST) ? OSC_ST.length : osc.endsWith(BEL) ? BEL.length : 0;
  if (terminatorLength === 0 || !osc.startsWith(OSC_PREFIX)) return undefined;

  const content = osc.slice(OSC_PREFIX.length, osc.length - terminatorLength);
  const separatorIdx = content.indexOf(";");
  if (separatorIdx === -1) return undefined;

  const oscNumber = content.slice(0, separatorIdx);
  if (oscNumber !== "0" && oscNumber !== "2") return undefined;
  return content.slice(separatorIdx + 1);
}

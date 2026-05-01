/**
 * Strip terminal-query escape sequences from a byte stream.
 *
 * Why: a remote-backed local pane displays output forwarded from a remote
 * tmux. The output sometimes contains query escape sequences a remote program
 * issued at its own terminal (DA1/DA2/DA3, CPR, DSR, XTVERSION, XTGETTCAP,
 * DECRQM/DECRQSS, OSC color/clipboard queries). Local tmux, acting as the
 * terminal for the local proxy pane, parses those queries and writes its
 * own replies into the proxy's pty. If the proxy then forwards stdin to the
 * remote pane, those replies reach the remote program a second time, after
 * remote tmux has already answered — corrupting any program tracking the
 * exchange. Stripping queries from the output stream before local tmux
 * sees them prevents the duplicate reply at the source.
 *
 * The stripper is stateful so it can hold an incomplete sequence at a chunk
 * boundary and finish parsing it when the next chunk arrives.
 */

const APC_INTRODUCER = 0x5f; // _
const BEL = 0x07;
const CSI_INTRODUCER = 0x5b; // [
const DCS_INTRODUCER = 0x50; // P
const DOLLAR = 0x24;
const ESC = 0x1b;
const MAX_HELD_BYTES = 64 * 1024;
const OSC_INTRODUCER = 0x5d; // ]
const PLUS = 0x2b;
const PM_INTRODUCER = 0x5e; // ^
const QUESTION = 0x3f;
const SEMICOLON = 0x3b;
const ST_FINAL = 0x5c; // \ in ESC \

export class TmuxQueryStripper {
  private held: Uint8Array = new Uint8Array(0);

  /**
   * Process a chunk of bytes. Returns the same bytes with query sequences
   * removed. Bytes that complete a sequence held from a previous chunk are
   * consumed; bytes that begin a sequence not yet terminated are held back
   * for the next call.
   */
  filter(input: Uint8Array): Uint8Array {
    if (input.length === 0 && this.held.length === 0) return EMPTY;

    const buf = this.held.length === 0 ? input : concat(this.held, input);

    // Bail out of catastrophically large unterminated state — emit verbatim
    // and resync. Realistic terminal sequences fit in well under 64 KiB.
    if (buf.length > MAX_HELD_BYTES) {
      this.held = new Uint8Array(0);
      return buf;
    }

    const chunks: Uint8Array[] = [];
    let pos = 0;
    while (pos < buf.length) {
      let escIdx = pos;
      while (escIdx < buf.length && buf[escIdx] !== ESC) escIdx++;
      if (escIdx > pos) chunks.push(buf.subarray(pos, escIdx));
      pos = escIdx;
      if (pos >= buf.length) break;

      const end = findSequenceEnd(buf, pos);
      if (end === -1) break; // incomplete; hold the rest
      if (!isQuerySequence(buf, pos, end)) chunks.push(buf.subarray(pos, end));
      pos = end;
    }

    this.held = pos < buf.length ? buf.slice(pos) : new Uint8Array(0);

    if (chunks.length === 0) return EMPTY;
    if (chunks.length === 1) return chunks[0]!;
    return concatChunks(chunks);
  }
}

/**
 * Locate the byte just past a complete escape sequence starting at `start`.
 * Returns -1 if the sequence is incomplete and more input is needed.
 *
 * Recognizes CSI (`ESC [`), OSC (`ESC ]`), DCS/APC/PM (`ESC P|_|^`) and
 * one-byte ESC sequences. Does not validate the body of the sequence beyond
 * what is needed to find its terminator.
 */
export function findSequenceEnd(buf: Uint8Array, start: number): number {
  if (buf[start] !== ESC) throw new Error("findSequenceEnd called outside an escape sequence");
  if (start + 1 >= buf.length) return -1;
  const second = buf[start + 1];

  if (second === CSI_INTRODUCER) {
    let i = start + 2;
    while (i < buf.length) {
      const b = buf[i]!;
      if (b >= 0x40 && b <= 0x7e) return i + 1;
      if (b < 0x20 || b > 0x3f) return i + 1; // junk byte ends the sequence
      i++;
    }
    return -1;
  }

  if (second === OSC_INTRODUCER) {
    let i = start + 2;
    while (i < buf.length) {
      if (buf[i] === BEL) return i + 1;
      if (buf[i] === ESC) {
        if (i + 1 >= buf.length) return -1;
        if (buf[i + 1] === ST_FINAL) return i + 2;
        return i + 1; // bare ESC inside OSC — terminate defensively
      }
      i++;
    }
    return -1;
  }

  if (second === DCS_INTRODUCER || second === APC_INTRODUCER || second === PM_INTRODUCER) {
    let i = start + 2;
    while (i < buf.length) {
      if (buf[i] === ESC) {
        if (i + 1 >= buf.length) return -1;
        if (buf[i + 1] === ST_FINAL) return i + 2;
        return i + 1;
      }
      i++;
    }
    return -1;
  }

  return start + 2;
}

/**
 * Decide whether a complete escape sequence is a terminal query the local
 * pane's terminal (tmux) would otherwise reply to.
 */
export function isQuerySequence(buf: Uint8Array, start: number, end: number): boolean {
  if (end - start < 3) return false;
  const second = buf[start + 1];
  if (second === CSI_INTRODUCER) return isQueryCsi(buf, start, end);
  if (second === OSC_INTRODUCER) return isQueryOsc(buf, start, end);
  if (second === DCS_INTRODUCER) return isQueryDcs(buf, start, end);
  return false;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function isQueryCsi(buf: Uint8Array, start: number, end: number): boolean {
  const final = buf[end - 1];
  // DA1/DA2/DA3 replies-as-queries all end in 'c'; DSR family ends in 'n';
  // XTVERSION ends in 'q'.
  if (final === 0x63 /* c */) return true;
  if (final === 0x6e /* n */) return true;
  if (final === 0x71 /* q */) return true;
  // DECRQM: ESC [ ... $ p
  if (final === 0x70 /* p */ && end - start >= 4 && buf[end - 2] === DOLLAR) return true;
  return false;
}

function isQueryDcs(buf: Uint8Array, start: number, end: number): boolean {
  // Skip numeric params and ';' between ESC P and the introducer pair.
  let i = start + 2;
  while (i < end - 2 && ((buf[i]! >= 0x30 && buf[i]! <= 0x39) || buf[i] === SEMICOLON)) i++;
  if (i >= end - 2) return false;

  const intermediate = buf[i];
  const final = buf[i + 1];
  if (final !== 0x71 /* q */) return false;
  // XTGETTCAP uses '+ q'; DECRQSS uses '$ q'.
  return intermediate === PLUS || intermediate === DOLLAR;
}

function isQueryOsc(buf: Uint8Array, start: number, end: number): boolean {
  // Locate payload boundaries inside ESC ] ... <BEL|ST>.
  let payloadEnd = end;
  if (buf[end - 1] === BEL) payloadEnd = end - 1;
  else if (end - start >= 4 && buf[end - 2] === ESC && buf[end - 1] === ST_FINAL) payloadEnd = end - 2;
  const payloadStart = start + 2;
  if (payloadEnd <= payloadStart) return false;

  let lastSemi = -1;
  for (let i = payloadStart; i < payloadEnd; i++) if (buf[i] === SEMICOLON) lastSemi = i;
  if (lastSemi === -1) return false;
  // Treat OSC as a query iff the last `;`-separated parameter is exactly "?".
  return payloadEnd - lastSemi === 2 && buf[lastSemi + 1] === QUESTION;
}

const EMPTY = new Uint8Array(0);

export interface ControlModeNotificationHandlers {
  onExit?: () => void;
  onLayoutChange?: (windowId: string, layoutString: string) => void;
  onPaneOutput?: (paneId: string, data: string) => void;
  onPaneOutputBytes?: (paneId: string, data: Uint8Array) => void;
  onPaneTitleChanged?: (paneId: string, title: string) => void;
  onSessionChanged?: (fromSession: string, toSession: string) => void;
  onSessionRenamed?: (oldName: string, newName: string) => void;
  onSessionWindowChanged?: () => void;
  onSubscriptionChanged?: (notification: SubscriptionChangedNotification) => void;
  onWindowAdd?: (windowId: string) => void;
  onWindowClose?: (windowId: string) => void;
  onWindowPaneChanged?: (windowId: string, paneId: string) => void;
  onWindowRenamed?: (windowId: string, newName: string) => void;
}

export interface ControlModePendingCommand {
  reject: (error: Error) => void;
  resolve: (output: string) => void;
}

export interface SubscriptionChangedNotification {
  name: string;
  paneId: string;
  sessionId: string;
  value: string;
  windowId: string;
  windowIndex: string;
}

interface ControlModeParserOptions {
  getPendingQueue: () => ControlModePendingCommand[];
  isClosed: () => boolean;
  notifications?: ControlModeNotificationHandlers;
  onReady?: () => void;
}

const PANE_ID_RE = /^%\d+$/;
const UTF8_DECODER = new TextDecoder();
export const MAX_CONTROL_LINE_BYTES = 256 * 1024;
export const MAX_CONTROL_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_CONTROL_RESPONSE_LINES = 100_000;

export class ControlModeParser {
  private currentResponse: {
    bytes: number;
    discardUntilTerminator: boolean;
    lineCount: number;
    lines: string[];
  } | null = null;
  private discardingOversizedLine = false;
  private lineBuffer = Buffer.alloc(0);

  constructor(private options: ControlModeParserOptions) {}

  async consumeStream(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength === 0) continue;

        this.consumeChunk(value);
      }
    } catch {
      // Stream ended
    }

    if (!this.discardingOversizedLine && this.lineBuffer.byteLength > 0) {
      this.parseRawLine(this.lineBuffer);
    }
    this.lineBuffer = Buffer.alloc(0);
    this.discardingOversizedLine = false;
  }

  parseLine(line: string): void {
    if (Buffer.byteLength(line) > MAX_CONTROL_LINE_BYTES) {
      this.handleOversizedLine();
      return;
    }

    if (line.startsWith("%output ")) {
      this.emitPaneOutput(line.substring(8));
      return;
    }

    this.parseDecodedLine(line, Buffer.byteLength(line));
  }

  private consumeChunk(chunk: Uint8Array): void {
    let remaining = Buffer.from(chunk);

    while (remaining.length > 0) {
      if (this.discardingOversizedLine) {
        const newlineIdx = remaining.indexOf(0x0a);
        if (newlineIdx === -1) {
          return;
        }
        remaining = remaining.subarray(newlineIdx + 1);
        this.discardingOversizedLine = false;
        continue;
      }

      const newlineIdx = remaining.indexOf(0x0a);
      if (newlineIdx === -1) {
        this.lineBuffer =
          this.lineBuffer.length === 0 ? Buffer.from(remaining) : Buffer.concat([this.lineBuffer, remaining]);
        if (this.lineBuffer.byteLength > MAX_CONTROL_LINE_BYTES) {
          this.handleOversizedLine();
          this.lineBuffer = Buffer.alloc(0);
          this.discardingOversizedLine = true;
        }
        return;
      }

      const segment = remaining.subarray(0, newlineIdx);
      const line = this.lineBuffer.length === 0 ? Buffer.from(segment) : Buffer.concat([this.lineBuffer, segment]);
      this.lineBuffer = Buffer.alloc(0);

      if (line.byteLength > MAX_CONTROL_LINE_BYTES) {
        this.handleOversizedLine();
      } else {
        this.parseRawLine(line);
      }

      remaining = remaining.subarray(newlineIdx + 1);
    }
  }

  private emitPaneOutput(escapedLine: string): void {
    const spaceIdx = escapedLine.indexOf(" ");
    if (spaceIdx === -1) return;

    const paneId = escapedLine.substring(0, spaceIdx);
    const data = unescapeTmuxOutputBytes(Buffer.from(escapedLine.substring(spaceIdx + 1), "latin1"));
    this.options.notifications?.onPaneOutputBytes?.(paneId, data);
    this.options.notifications?.onPaneOutput?.(paneId, decodeTmuxOutputUtf8(data));
  }

  private emitPaneOutputLineBytes(line: Uint8Array): void {
    const paneIdStart = 8;
    const spaceIdx = line.indexOf(0x20, paneIdStart);
    if (spaceIdx === -1) return;

    const paneId = decodeUtf8(line.subarray(paneIdStart, spaceIdx));
    const data = unescapeTmuxOutputBytes(line.subarray(spaceIdx + 1));
    this.options.notifications?.onPaneOutputBytes?.(paneId, data);
    this.options.notifications?.onPaneOutput?.(paneId, decodeTmuxOutputUtf8(data));
  }

  private handleOversizedLine(): void {
    if (!this.currentResponse || this.currentResponse.discardUntilTerminator) return;
    this.rejectAndDiscardOversizedResponse();
  }

  private parseDecodedLine(line: string, rawByteLength: number): void {
    if (line.startsWith("%begin ")) {
      this.currentResponse = { bytes: 0, discardUntilTerminator: false, lineCount: 0, lines: [] };
      return;
    }

    if (line.startsWith("%end ")) {
      if (this.currentResponse) {
        if (!this.currentResponse.discardUntilTerminator) {
          const pending = this.options.getPendingQueue().shift();
          pending?.resolve(this.currentResponse.lines.join("\n"));
        }
      }
      this.currentResponse = null;
      this.options.onReady?.();
      return;
    }

    if (line.startsWith("%error ")) {
      if (this.currentResponse) {
        if (!this.currentResponse.discardUntilTerminator) {
          const pending = this.options.getPendingQueue().shift();
          pending?.reject(new Error(this.currentResponse.lines.join("\n")));
        }
      }
      this.currentResponse = null;
      this.options.onReady?.();
      return;
    }

    if (this.options.isClosed()) return;

    if (line.startsWith("%window-add ")) {
      this.options.notifications?.onWindowAdd?.(line.substring(12).trim());
      return;
    }

    if (line.startsWith("%window-close ")) {
      this.options.notifications?.onWindowClose?.(line.substring(14).trim());
      return;
    }

    if (line.startsWith("%unlinked-window-close ")) {
      this.options.notifications?.onWindowClose?.(line.substring(23).trim());
      return;
    }

    if (line.startsWith("%session-window-changed ")) {
      this.options.notifications?.onSessionWindowChanged?.();
      return;
    }

    if (line.startsWith("%window-renamed ")) {
      const rest = line.substring(16);
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx !== -1) {
        this.options.notifications?.onWindowRenamed?.(rest.substring(0, spaceIdx), rest.substring(spaceIdx + 1));
      }
      return;
    }

    if (line.startsWith("%session-changed ")) {
      const rest = line.substring(17);
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx !== -1) {
        this.options.notifications?.onSessionChanged?.(rest.substring(0, spaceIdx), rest.substring(spaceIdx + 1));
      }
      return;
    }

    if (line.startsWith("%session-renamed ")) {
      const rest = line.substring(17);
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx !== -1) {
        this.options.notifications?.onSessionRenamed?.(rest.substring(0, spaceIdx), rest.substring(spaceIdx + 1));
      }
      return;
    }

    if (line.startsWith("%layout-change ")) {
      const parts = line.substring(15).split(" ");
      this.options.notifications?.onLayoutChange?.(parts[0] ?? "", parts[1] ?? "");
      return;
    }

    if (line.startsWith("%window-pane-changed ")) {
      const parts = line.substring(21).split(" ");
      this.options.notifications?.onWindowPaneChanged?.(parts[0] ?? "", parts[1] ?? "");
      return;
    }

    if (line.startsWith("%pane-title-changed ")) {
      const rest = line.substring(20);
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx !== -1) {
        this.options.notifications?.onPaneTitleChanged?.(rest.substring(0, spaceIdx), rest.substring(spaceIdx + 1));
      }
      return;
    }

    if (line.startsWith("%subscription-changed ")) {
      const rest = line.substring(22);
      const separator = " : ";
      const separatorIdx = rest.indexOf(separator);
      if (separatorIdx !== -1) {
        const meta = rest.substring(0, separatorIdx).trim().split(/\s+/);
        const name = meta[0] ?? "";
        const sessionId = meta[1] ?? "";
        const windowId = meta[2] ?? "";
        const windowIndex = meta[3] ?? "";
        const paneId = meta.find((part) => PANE_ID_RE.test(part)) ?? "";
        const value = rest.substring(separatorIdx + separator.length);
        this.options.notifications?.onSubscriptionChanged?.({
          name,
          paneId,
          sessionId,
          value,
          windowId,
          windowIndex,
        });
      }
      return;
    }

    if (line.startsWith("%exit")) {
      this.options.notifications?.onExit?.();
      return;
    }

    if (this.currentResponse) {
      if (this.currentResponse.discardUntilTerminator) return;
      const lineBytes = rawByteLength + 1;
      this.currentResponse.lineCount += 1;
      this.currentResponse.bytes += lineBytes;
      if (
        this.currentResponse.lineCount > MAX_CONTROL_RESPONSE_LINES ||
        this.currentResponse.bytes > MAX_CONTROL_RESPONSE_BYTES
      ) {
        this.rejectAndDiscardOversizedResponse();
        return;
      }
      this.currentResponse.lines.push(line);
      return;
    }

    if (line.startsWith("%")) {
      return;
    }
  }

  private parseRawLine(line: Uint8Array): void {
    if (startsWithAscii(line, "%output ")) {
      this.emitPaneOutputLineBytes(line);
      return;
    }

    this.parseDecodedLine(decodeUtf8(line), line.byteLength);
  }

  private rejectAndDiscardOversizedResponse(): void {
    const response = this.currentResponse;
    if (!response || response.discardUntilTerminator) return;

    response.lines = [];
    response.bytes = 0;
    response.lineCount = 0;
    response.discardUntilTerminator = true;

    const pending = this.options.getPendingQueue().shift();
    pending?.reject(
      new Error(
        `tmux control response exceeded bounds (${MAX_CONTROL_RESPONSE_LINES} lines, ${MAX_CONTROL_RESPONSE_BYTES} bytes)`,
      ),
    );
  }
}

/**
 * Unescape tmux control-mode %output data.
 * tmux uses C-style octal escaping: \NNN for bytes, \\ for literal backslash.
 */
export function unescapeTmuxOutput(s: string): string {
  return decodeTmuxOutputUtf8(unescapeTmuxOutputBytes(Buffer.from(s, "latin1")));
}

export function unescapeTmuxOutputBytes(s: ArrayLike<number>): Uint8Array {
  const bytes: number[] = [];

  for (let i = 0; i < s.length; i++) {
    const byte = s[i]!;
    if (byte !== 0x5c) {
      bytes.push(byte);
      continue;
    }

    const next = s[i + 1];
    if (next === 0x5c) {
      bytes.push(0x5c);
      i += 1;
      continue;
    }

    const d1 = s[i + 1];
    const d2 = s[i + 2];
    const d3 = s[i + 3];
    if (isOctalDigit(d1) && isOctalDigit(d2) && isOctalDigit(d3)) {
      bytes.push(((d1 - 0x30) << 6) | ((d2 - 0x30) << 3) | (d3 - 0x30));
      i += 3;
      continue;
    }

    bytes.push(byte);
  }

  return Uint8Array.from(bytes);
}

function decodeTmuxOutputUtf8(s: ArrayLike<number>): string {
  return decodeUtf8(s);
}

function decodeUtf8(s: ArrayLike<number>): string {
  return UTF8_DECODER.decode(Uint8Array.from(s));
}

function isOctalDigit(value: number | undefined): value is number {
  return value !== undefined && value >= 0x30 && value <= 0x37;
}

function startsWithAscii(s: Uint8Array, prefix: string): boolean {
  if (s.length < prefix.length) return false;

  for (let i = 0; i < prefix.length; i++) {
    if (s[i] !== prefix.charCodeAt(i)) return false;
  }

  return true;
}

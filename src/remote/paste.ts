import { randomBytes } from "node:crypto";

import { encodeTmuxDoubleQuotedString, quoteTmuxArg } from "../tmux/escape.ts";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

export interface RemotePasteClient {
  sendCommand(cmd: string): Promise<string>;
}

interface PasteTextIntoRemotePaneOptions {
  bufferName?: string;
}

export function extractBracketedPastePayload(data: string): null | string {
  if (!data.startsWith(BRACKETED_PASTE_START) || !data.endsWith(BRACKETED_PASTE_END)) return null;
  return data.slice(BRACKETED_PASTE_START.length, data.length - BRACKETED_PASTE_END.length);
}

/**
 * Stage `text` as a remote tmux paste buffer and paste it into `remotePaneId`
 * in a single control-mode command sequence.
 *
 * The wire form is `set-buffer -b NAME "<encoded>" ; paste-buffer -p -d -b
 * NAME -t paneId`, sent as one line via the existing control-mode pipe. Both
 * commands ride the same FIFO transport as keystrokes, so subsequent keystrokes
 * cannot overtake the paste, and the paste itself is atomic at the wire level
 * (one synchronous write of one line, processed by tmux as a single command
 * sequence).
 *
 * `set-buffer` is used (rather than `load-buffer -`) because tmux explicitly
 * forbids `load-buffer -` for control-mode clients (file.c returns EBADF when
 * the client is `CLIENT_CONTROL`). The escape-encoded `set-buffer` arg is the
 * documented way to deliver arbitrary bytes through the command channel.
 */
export async function pasteTextIntoRemotePane(
  client: RemotePasteClient,
  remotePaneId: string,
  text: string,
  options: PasteTextIntoRemotePaneOptions = {},
): Promise<void> {
  if (text.length === 0) return;

  const bufferName = options.bufferName ?? `hmx-paste-${randomBytes(8).toString("hex")}`;
  const quotedBufferName = quoteTmuxArg("bufferName", bufferName);
  const quotedPaneId = quoteTmuxArg("remotePaneId", remotePaneId);
  const encodedText = encodeTmuxDoubleQuotedString(text);

  try {
    await client.sendCommand(
      `set-buffer -b ${quotedBufferName} ${encodedText} ; paste-buffer -p -d -b ${quotedBufferName} -t ${quotedPaneId}`,
    );
  } catch (err) {
    await client.sendCommand(`delete-buffer -b ${quotedBufferName}`).catch(() => {});
    throw err;
  }
}

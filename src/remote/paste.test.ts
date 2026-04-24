import { describe, expect, it, mock } from "bun:test";

import { extractBracketedPastePayload, pasteTextIntoRemotePane } from "./paste.ts";

describe("remote paste helpers", () => {
  it("extracts exact bracketed paste payloads", () => {
    expect(extractBracketedPastePayload("\x1b[200~hello\x1b[201~")).toBe("hello");
    expect(extractBracketedPastePayload("x\x1b[200~hello\x1b[201~")).toBeNull();
    expect(extractBracketedPastePayload("\x1b[200~hello\x1b[201~x")).toBeNull();
  });

  it("sends set-buffer and paste-buffer as a single control-mode command", async () => {
    const sendCommand = mock(async () => "");

    await pasteTextIntoRemotePane({ sendCommand }, "%77", "hello\n';\x1b[31mworld", { bufferName: "hmx-paste-test" });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith(
      `set-buffer -b 'hmx-paste-test' "hello\\012';\\033[31mworld" ; paste-buffer -p -d -b 'hmx-paste-test' -t '%77'`,
    );
  });

  it("does nothing for empty pastes", async () => {
    const sendCommand = mock(async () => "");
    await pasteTextIntoRemotePane({ sendCommand }, "%77", "", { bufferName: "hmx-paste-test" });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("deletes the temporary paste buffer if the combined command fails", async () => {
    const error = new Error("pane missing");
    const sendCommand = mock(async (cmd: string) => {
      if (cmd.startsWith("set-buffer")) throw error;
      return "";
    });

    await expect(
      pasteTextIntoRemotePane({ sendCommand }, "%77", "hello", { bufferName: "hmx-paste-test" }),
    ).rejects.toThrow(error);

    expect(sendCommand).toHaveBeenLastCalledWith("delete-buffer -b 'hmx-paste-test'");
  });
});

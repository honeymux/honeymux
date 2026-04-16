import { describe, expect, mock, test } from "bun:test";

import type { ControlModePendingCommand } from "./control-mode-parser.ts";

import {
  ControlModeParser,
  MAX_CONTROL_LINE_BYTES,
  unescapeTmuxOutput,
  unescapeTmuxOutputBytes,
} from "./control-mode-parser.ts";

function createParserHarness() {
  const pendingQueue: ControlModePendingCommand[] = [];
  const onReady = mock(() => {});
  const onExit = mock(() => {});
  const onWindowAdd = mock((_windowId: string) => {});
  const onPaneOutputBytes = mock((_paneId: string, _data: Uint8Array) => {});
  const onSubscriptionChanged = mock(
    (_name: string, _sessionId: string, _windowId: string, _windowIndex: string, _paneId: string, _value: string) => {},
  );
  const onPaneOutput = mock((_paneId: string, _data: string) => {});
  let closed = false;

  const parser = new ControlModeParser({
    getPendingQueue: () => pendingQueue,
    isClosed: () => closed,
    notifications: {
      onExit: () => {
        closed = true;
        onExit();
      },
      onPaneOutput,
      onPaneOutputBytes,
      onSubscriptionChanged: ({ name, paneId, sessionId, value, windowId, windowIndex }) =>
        onSubscriptionChanged(name, sessionId, windowId, windowIndex, paneId, value),
      onWindowAdd,
    },
    onReady,
  });

  return { onExit, onPaneOutput, onPaneOutputBytes, onReady, onSubscriptionChanged, onWindowAdd, parser, pendingQueue };
}

describe("ControlModeParser", () => {
  test("resolves pending commands on %end and signals readiness", () => {
    const { onReady, parser, pendingQueue } = createParserHarness();
    let resolved = "";

    pendingQueue.push({
      reject: () => {},
      resolve: (output) => {
        resolved = output;
      },
    });

    parser.parseLine("%begin 1 0 0");
    parser.parseLine("alpha");
    parser.parseLine("beta");
    parser.parseLine("%end 1 0 0");

    expect(resolved).toBe("alpha\nbeta");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("rejects pending commands on %error and still signals readiness", () => {
    const { onReady, parser, pendingQueue } = createParserHarness();
    let rejected = "";

    pendingQueue.push({
      reject: (error) => {
        rejected = error.message;
      },
      resolve: () => {},
    });

    parser.parseLine("%begin 1 0 0");
    parser.parseLine("bad");
    parser.parseLine("%error 1 0 0");

    expect(rejected).toBe("bad");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("dispatches notifications while not swallowing %-prefixed response data", () => {
    const { onWindowAdd, parser, pendingQueue } = createParserHarness();
    let resolved = "";

    pendingQueue.push({
      reject: () => {},
      resolve: (output) => {
        resolved = output;
      },
    });

    parser.parseLine("%begin 1 0 0");
    parser.parseLine("%window-add @9");
    parser.parseLine("%\t@1\t0\tbash\t1");
    parser.parseLine("%end 1 0 0");

    expect(onWindowAdd).toHaveBeenCalledWith("@9");
    expect(resolved).toBe("%\t@1\t0\tbash\t1");
  });

  test("parses subscription-changed notifications", () => {
    const { onSubscriptionChanged, parser } = createParserHarness();

    parser.parseLine("%subscription-changed hmx-pane-tab-labels $1 @3 1 %7 : claude");

    expect(onSubscriptionChanged).toHaveBeenCalledWith("hmx-pane-tab-labels", "$1", "@3", "1", "%7", "claude");
  });

  test("unescapes pane output notifications", () => {
    const { onPaneOutput, onPaneOutputBytes, parser } = createParserHarness();

    parser.parseLine(String.raw`%output %7 hello\040world\\done`);

    expect(onPaneOutput).toHaveBeenCalledWith("%7", "hello world\\done");
    expect(unescapeTmuxOutput(String.raw`line\012next`)).toBe("line\nnext");
    expect(onPaneOutputBytes).toHaveBeenCalledWith("%7", Uint8Array.from(Buffer.from("hello world\\done")));
  });

  test("marks exit through the supplied callback", () => {
    const { onExit, parser } = createParserHarness();

    parser.parseLine("%exit");

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("rejects oversized responses and resynchronizes at the terminator", () => {
    const { parser, pendingQueue } = createParserHarness();
    let rejected = "";
    let resolved = "";

    pendingQueue.push({
      reject: (error) => {
        rejected = error.message;
      },
      resolve: () => {},
    });
    pendingQueue.push({
      reject: () => {},
      resolve: (output) => {
        resolved = output;
      },
    });

    parser.parseLine("%begin 1 0 0");
    parser.parseLine("x".repeat(MAX_CONTROL_LINE_BYTES + 1));
    parser.parseLine("%end 1 0 0");

    parser.parseLine("%begin 2 0 0");
    parser.parseLine("ok");
    parser.parseLine("%end 2 0 0");

    expect(rejected).toContain("tmux control response exceeded bounds");
    expect(resolved).toBe("ok");
  });

  test("drops oversized partial lines and resumes on the next newline", async () => {
    const { onWindowAdd, parser } = createParserHarness();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(MAX_CONTROL_LINE_BYTES + 1)));
        controller.enqueue(new TextEncoder().encode("\n%window-add @9\n"));
        controller.close();
      },
    });

    await parser.consumeStream(stream);

    expect(onWindowAdd).toHaveBeenCalledWith("@9");
  });

  test("preserves raw utf-8 %output bytes while still decoding the text event", async () => {
    const { onPaneOutput, onPaneOutputBytes, parser } = createParserHarness();
    const utf8Text = "hello 你好 👋";
    const utf8Bytes = Buffer.from(utf8Text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.concat([Buffer.from("%output %7 "), utf8Bytes, Buffer.from("\n")]));
        controller.close();
      },
    });

    await parser.consumeStream(stream);

    expect(onPaneOutput).toHaveBeenCalledWith("%7", utf8Text);
    expect(onPaneOutputBytes).toHaveBeenCalledTimes(1);
    expect(Buffer.from(onPaneOutputBytes.mock.calls[0]![1])).toEqual(utf8Bytes);
    expect(unescapeTmuxOutputBytes(utf8Bytes)).toEqual(Uint8Array.from(utf8Bytes));
  });
});

import { afterEach, describe, expect, test } from "bun:test";

import { cursorAlertPostRender, setCursorAlertActive } from "./cursor-alert.ts";
import { setTerminalOutputWriter } from "./terminal-output.ts";

function captureOutput(): string[] {
  const output: string[] = [];
  setTerminalOutputWriter((data) => {
    output.push(typeof data === "string" ? data : Buffer.from(data).toString("utf-8"));
  });
  return output;
}

afterEach(() => {
  setCursorAlertActive(false);
  setTerminalOutputWriter();
});

describe("cursor alert terminal output", () => {
  test("resets cursor color with BEL-terminated OSC", () => {
    const output = captureOutput();

    cursorAlertPostRender();

    expect(output).toEqual(["\x1b]112\x07"]);
  });

  test("sets and restores cursor color and shape with BEL-terminated OSC", () => {
    const output = captureOutput();

    setCursorAlertActive(true, "underline", "on", "#336699");

    expect(output[0]).toBe("\x1b]12;rgb:33/66/99\x07");
    expect(output[1]).toBe("\x1b[3 q");

    output.length = 0;
    cursorAlertPostRender();

    expect(output).toEqual(["\x1b]12;rgb:33/66/99\x07"]);

    output.length = 0;
    setCursorAlertActive(false);

    expect(output[0]).toBe("\x1b]112\x07");
    expect(output[1]?.startsWith("\x1b[")).toBe(true);
    expect(output[1]?.endsWith(" q")).toBe(true);
  });

  test('shape="default" sends only the color sequence on activation', () => {
    const output = captureOutput();

    setCursorAlertActive(true, "default", "on", "#abcdef");

    expect(output).toEqual(["\x1b]12;rgb:ab/cd/ef\x07"]);

    output.length = 0;
    setCursorAlertActive(false);

    expect(output).toEqual(["\x1b]112\x07"]);
  });

  test('blink="default" sends only the color sequence on activation', () => {
    const output = captureOutput();

    setCursorAlertActive(true, "block", "default", "#112233");

    expect(output).toEqual(["\x1b]12;rgb:11/22/33\x07"]);

    output.length = 0;
    setCursorAlertActive(false);

    expect(output).toEqual(["\x1b]112\x07"]);
  });

  test('blink="off" sends the steady DECSCUSR param', () => {
    const output = captureOutput();

    setCursorAlertActive(true, "bar", "off", "#000000");

    expect(output[1]).toBe("\x1b[6 q");
  });
});

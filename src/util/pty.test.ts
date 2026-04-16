import { describe, expect, test } from "bun:test";

import { createPassthroughForwarder } from "./pty.ts";

function forwardChunks(
  chunks: string[],
  policyOsc52Passthrough: "all" | "off" | "write-only" = "off",
  policyOtherOscPassthrough: "allow" | "off" = "allow",
  maxBufferedOscBytes?: number,
): string {
  const writes: string[] = [];
  const forward = createPassthroughForwarder({
    maxBufferedOscBytes,
    policyOsc52Passthrough,
    policyOtherOscPassthrough,
    write(data) {
      writes.push(typeof data === "string" ? data : Buffer.from(data).toString("binary"));
    },
  });
  for (const chunk of chunks) {
    forward(Buffer.from(chunk, "binary"));
  }
  return writes.join("");
}

describe("createPassthroughForwarder", () => {
  test("drops OSC 52 clipboard writes by default", () => {
    const output = forwardChunks(["\x1b]52;c;SGVsbG8=\x07"]);
    expect(output).toBe("");
  });

  test("forwards OSC 52 clipboard writes in write-only mode", () => {
    const output = forwardChunks(["\x1b]52;c;SGVsbG8=\x07"], "write-only");
    expect(output).toBe("\x1b]52;c;SGVsbG8=\x1b\\");
  });

  test("blocks OSC 52 clipboard queries in write-only mode", () => {
    const output = forwardChunks(["\x1b]52;c;?\x07"], "write-only");
    expect(output).toBe("");
  });

  test("forwards OSC 52 clipboard queries in all mode, including split sequences", () => {
    const output = forwardChunks(["\x1b]52;c;?", "\x07"], "all");
    expect(output).toBe("\x1b]52;c;?\x1b\\");
  });

  test("still forwards non-clipboard OSC sequences when OSC 52 passthrough is off", () => {
    const output = forwardChunks(["\x1b]2;honeymux\x07"]);
    expect(output).toBe("\x1b]2;honeymux\x1b\\");
  });

  test("drops non-clipboard OSC sequences when other OSC passthrough is off", () => {
    const output = forwardChunks(["\x1b]2;honeymux\x07"], "off", "off");
    expect(output).toBe("");
  });

  test("drops oversized unterminated OSC sequences and recovers for later passthrough", () => {
    const output = forwardChunks(["\x1b]2;1234567890", "abcdef", "\x07", "\x1b]2;ok\x07"], "off", "allow", 8);
    expect(output).toBe("\x1b]2;ok\x1b\\");
  });

  test("recovers when an oversized OSC ends with ST split across chunks", () => {
    const output = forwardChunks(["\x1b]2;1234567890\x1b", "\\", "\x1b]2;after\x07"], "off", "allow", 8);
    expect(output).toBe("\x1b]2;after\x1b\\");
  });
});

import { describe, expect, it } from "bun:test";

import { encodeTmuxDoubleQuotedString } from "./escape.ts";

describe("encodeTmuxDoubleQuotedString", () => {
  it("emits printable ASCII verbatim inside double quotes", () => {
    expect(encodeTmuxDoubleQuotedString("hello world")).toBe('"hello world"');
  });

  it('escapes parser-special chars `\\`, `"`, `$`, `~`', () => {
    expect(encodeTmuxDoubleQuotedString('a\\b"c$d~e')).toBe('"a\\\\b\\"c\\$d\\~e"');
  });

  it("encodes LF as octal so the wire stays single-line", () => {
    expect(encodeTmuxDoubleQuotedString("a\nb")).toBe('"a\\012b"');
  });

  it("encodes ESC and other control bytes as octal", () => {
    expect(encodeTmuxDoubleQuotedString("a\x1b[31mb\x07")).toBe('"a\\033[31mb\\007"');
  });

  it("encodes the full byte range up to 0xFF", () => {
    const bytes = Buffer.from([0x01, 0x7f, 0x80, 0xff]).toString("binary");
    expect(encodeTmuxDoubleQuotedString(bytes)).toBe('"\\001\\177\\302\\200\\303\\277"');
  });

  it("emits multi-byte UTF-8 as octal byte escapes", () => {
    // U+00E9 (é) → 0xC3 0xA9
    expect(encodeTmuxDoubleQuotedString("café")).toBe('"caf\\303\\251"');
  });

  it("strips embedded null bytes", () => {
    expect(encodeTmuxDoubleQuotedString("a\0b")).toBe('"ab"');
  });

  it("returns an empty quoted string for empty input", () => {
    expect(encodeTmuxDoubleQuotedString("")).toBe('""');
  });
});

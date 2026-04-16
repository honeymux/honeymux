import { expect, test } from "bun:test";

import { formatArgv, parseArgv } from "./argv.ts";

// --- parseArgv ---

test("parseArgv: simple words", () => {
  expect(parseArgv("nvim .")).toEqual(["nvim", "."]);
});

test("parseArgv: multiple spaces between args", () => {
  expect(parseArgv("nvim   .")).toEqual(["nvim", "."]);
});

test("parseArgv: leading/trailing whitespace", () => {
  expect(parseArgv("  nvim .  ")).toEqual(["nvim", "."]);
});

test("parseArgv: empty input", () => {
  expect(parseArgv("")).toEqual([]);
});

test("parseArgv: whitespace only", () => {
  expect(parseArgv("   ")).toEqual([]);
});

test("parseArgv: single-quoted string", () => {
  expect(parseArgv("echo 'hello world'")).toEqual(["echo", "hello world"]);
});

test("parseArgv: double-quoted string", () => {
  expect(parseArgv('echo "hello world"')).toEqual(["echo", "hello world"]);
});

test("parseArgv: backslash escape outside quotes", () => {
  expect(parseArgv("echo hello\\ world")).toEqual(["echo", "hello world"]);
});

test("parseArgv: backslash escape inside double quotes", () => {
  expect(parseArgv('echo "hello \\"world\\""')).toEqual(["echo", 'hello "world"']);
});

test("parseArgv: single quotes preserve everything literally", () => {
  expect(parseArgv("echo 'hello\\nworld'")).toEqual(["echo", "hello\\nworld"]);
});

test("parseArgv: bash -c with complex command", () => {
  expect(parseArgv('bash -c "echo hello && echo world"')).toEqual(["bash", "-c", "echo hello && echo world"]);
});

test("parseArgv: mixed quotes", () => {
  expect(parseArgv(`git commit -m "it's done"`)).toEqual(["git", "commit", "-m", "it's done"]);
});

test("parseArgv: program with flags", () => {
  expect(parseArgv("claude --resume abc123")).toEqual(["claude", "--resume", "abc123"]);
});

test("parseArgv: program path with spaces", () => {
  expect(parseArgv("'/usr/local/my app/run' --flag")).toEqual(["/usr/local/my app/run", "--flag"]);
});

test("parseArgv: tab as separator", () => {
  expect(parseArgv("nvim\t.")).toEqual(["nvim", "."]);
});

test("parseArgv: adjacent quotes build single arg", () => {
  expect(parseArgv("'hello'" + '"world"')).toEqual(["helloworld"]);
});

test("parseArgv: empty quoted string", () => {
  expect(parseArgv("echo ''")).toEqual(["echo", ""]);
});

// --- formatArgv ---

test("formatArgv: simple args", () => {
  expect(formatArgv(["nvim", "."])).toBe("nvim .");
});

test("formatArgv: arg with spaces gets quoted", () => {
  expect(formatArgv(["echo", "hello world"])).toBe("echo 'hello world'");
});

test("formatArgv: arg with single quotes gets escaped", () => {
  expect(formatArgv(["echo", "it's"])).toBe("echo 'it'\\''s'");
});

test("formatArgv: empty arg becomes ''", () => {
  expect(formatArgv(["echo", ""])).toBe("echo ''");
});

test("formatArgv: empty array", () => {
  expect(formatArgv([])).toBe("");
});

test("formatArgv: args with special chars", () => {
  expect(formatArgv(["bash", "-c", "echo hello && echo world"])).toBe("bash -c 'echo hello && echo world'");
});

// --- round-trip ---

test("round-trip: simple command", () => {
  const input = "nvim .";
  expect(formatArgv(parseArgv(input))).toBe(input);
});

test("round-trip: quoted arg preserves content", () => {
  const argv = ["claude", "--resume", "my session id"];
  expect(parseArgv(formatArgv(argv))).toEqual(argv);
});

test("round-trip: bash -c command", () => {
  const argv = ["bash", "-c", "npm run dev && npm test"];
  expect(parseArgv(formatArgv(argv))).toEqual(argv);
});

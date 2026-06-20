import { describe, expect, test } from "bun:test";

import { hasCap, resolveColortermEnv, setTermCaps } from "./terminal-caps.ts";

describe("resolveColortermEnv", () => {
  // Guards the SSH 256-color regression: OpenTUI degrades to 256-color unless
  // COLORTERM advertises truecolor, and SSH does not forward COLORTERM. Without
  // advertising it, truecolor cells quantize to the host palette (e.g. white ->
  // palette index 15 -> a non-white hue).
  test("advertises truecolor when COLORTERM is unset", () => {
    expect(resolveColortermEnv(undefined)).toBe("truecolor");
    expect(resolveColortermEnv("")).toBe("truecolor");
  });

  test("respects an explicit COLORTERM already in the environment", () => {
    expect(resolveColortermEnv("truecolor")).toBeUndefined();
    expect(resolveColortermEnv("24bit")).toBeUndefined();
    expect(resolveColortermEnv("256")).toBeUndefined();
  });
});

describe("hasCap", () => {
  test("reflects probed capabilities", () => {
    setTermCaps(new Map([["Tc", ""]]));
    expect(hasCap("Tc")).toBe(true);
    expect(hasCap("RGB")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveColortermEnv } from "./terminal-caps.ts";

/**
 * End-to-end guard for the SSH 256-color regression.
 *
 * OpenTUI emits 24-bit truecolor only when it detects `rgb` support, which it
 * derives from `$COLORTERM`. SSH does not forward COLORTERM, so without
 * Honeymux advertising it the renderer silently selects 256-color and every
 * truecolor cell quantizes to the host palette (white -> palette index 15 ->
 * wrong hue). These tests drive OpenTUI's *real* capability detection, so they
 * fail if the Honeymux fix is removed OR if OpenTUI changes how it decides
 * truecolor.
 *
 * The detection runs in a child process: creating a real renderer writes
 * terminal-setup escapes straight to fd 1, so we isolate that in a subprocess
 * (stdout discarded) and read the detected capability back over stderr.
 */

const PROBE = [
  'const { createCliRenderer } = await import("@opentui/core");',
  "const r = await createCliRenderer({ useThread: false, exitOnCtrlC: false, width: 8, height: 2 });",
  "const rgb = r.capabilities?.rgb;",
  "r.destroy?.();",
  'process.stderr.write("__RGB__" + rgb + "__\\n");',
  "process.exit(0);",
].join("\n");

/** Whether OpenTUI selects 24-bit truecolor for the given COLORTERM value. */
async function detectsTrueColor(colorterm: string | undefined): Promise<boolean> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env["COLORTERM"];
  if (colorterm !== undefined) env["COLORTERM"] = colorterm;

  const proc = Bun.spawn([process.execPath, "-e", PROBE], {
    cwd: join(import.meta.dir, "..", ".."),
    env,
    stderr: "pipe",
    stdout: "ignore",
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  const match = stderr.match(/__RGB__(true|false)__/);
  if (!match) throw new Error(`renderer probe did not report rgb (stderr: ${stderr.slice(0, 300)})`);
  return match[1] === "true";
}

describe("truecolor output mode", () => {
  test("OpenTUI enables truecolor when COLORTERM advertises it", async () => {
    expect(await detectsTrueColor("truecolor")).toBe(true);
  });

  // Canary: documents the bug condition. If this flips to true (OpenTUI
  // defaulting to truecolor again) the advertisement is no longer load-bearing
  // — revisit rather than silently relying on it.
  test("OpenTUI falls back to 256-color when COLORTERM is absent", async () => {
    expect(await detectsTrueColor(undefined)).toBe(false);
  });

  test("Honeymux's COLORTERM advertisement restores truecolor when the environment strips it", async () => {
    // Simulate SSH stripping COLORTERM, then apply Honeymux's startup decision.
    const advertised = resolveColortermEnv(undefined);
    expect(await detectsTrueColor(advertised)).toBe(true);
  });
});

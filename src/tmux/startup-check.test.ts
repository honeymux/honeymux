import { describe, expect, test } from "bun:test";

import { checkTmuxStartupRequirements } from "./startup-check.ts";

describe("checkTmuxStartupRequirements", () => {
  test("returns a friendly install message when tmux is missing from PATH", async () => {
    const result = await checkTmuxStartupRequirements(
      () => null,
      () => {
        throw new Error("spawn should not be called when tmux is missing");
      },
    );

    expect(result).toEqual({
      message:
        "honeymux requires tmux but it doesn't appear to be installed.\n" +
        "Install it with your package manager — e.g.:\n" +
        "  brew install tmux        # macOS\n" +
        "  sudo apt install tmux    # Debian/Ubuntu\n" +
        "  sudo dnf install tmux    # Fedora",
      ok: false,
    });
  });

  test("returns a friendly install message when spawning tmux fails with ENOENT", async () => {
    const result = await checkTmuxStartupRequirements(
      () => "/usr/bin/tmux",
      () => {
        const error = new Error("Executable not found");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      },
    );

    expect(result).toEqual({
      message:
        "honeymux requires tmux but it doesn't appear to be installed.\n" +
        "Install it with your package manager — e.g.:\n" +
        "  brew install tmux        # macOS\n" +
        "  sudo apt install tmux    # Debian/Ubuntu\n" +
        "  sudo dnf install tmux    # Fedora",
      ok: false,
    });
  });

  test("returns a friendly upgrade message when tmux is too old", async () => {
    const result = await checkTmuxStartupRequirements(
      () => "/usr/bin/tmux",
      () => buildProcess("tmux 3.2\n"),
    );

    expect(result).toEqual({
      message:
        "honeymux requires tmux 3.3 or later but found tmux 3.2.\n" +
        "Upgrade tmux with your package manager — e.g.:\n" +
        "  brew upgrade tmux        # macOS\n" +
        "  sudo apt install tmux    # Debian/Ubuntu (may need a newer repo)\n" +
        "  sudo dnf install tmux    # Fedora",
      ok: false,
    });
  });

  test("returns the detected version when tmux satisfies the minimum version", async () => {
    const result = await checkTmuxStartupRequirements(
      () => "/usr/bin/tmux",
      () => buildProcess("tmux 3.3a\n"),
    );

    expect(result).toEqual({
      ok: true,
      version: "tmux 3.3a",
    });
  });
});

function buildProcess(
  output: string,
  exitCode = 0,
): {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
} {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Blob([output]).stream(),
  };
}

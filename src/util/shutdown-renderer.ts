import type { CliRenderer } from "@opentui/core";

import { writeTerminalOutput } from "./terminal-output.ts";
import { MODIFY_OTHER_KEYS_DISABLE } from "./terminal-sequences.ts";

type DisableInputModesRendererLike = Pick<CliRenderer, "disableKittyKeyboard" | "stdin">;
type ShutdownRendererLike = Pick<CliRenderer, "destroy" | "idle" | "stop">;

type StdinLike = Pick<NodeJS.ReadStream, "off" | "on" | "removeListener"> | null | undefined;

export async function disableInputModesBeforeShutdown(
  renderer: DisableInputModesRendererLike,
  quietMs: number = 75,
  maxMs: number = 500,
): Promise<void> {
  const quietPromise = waitForStdinQuiet(renderer.stdin, quietMs, maxMs);

  try {
    renderer.disableKittyKeyboard();
  } catch {
    // best-effort
  }

  try {
    writeTerminalOutput(MODIFY_OTHER_KEYS_DISABLE);
  } catch {
    // best-effort
  }

  // Keep stdin attached until trailing key-release bytes have gone quiet so
  // they are still consumed by Honeymux instead of landing in the parent shell.
  await quietPromise;
}

export async function shutdownRenderer(renderer: ShutdownRendererLike): Promise<void> {
  try {
    renderer.stop();
  } catch {
    // best-effort stop before destroy
  }

  try {
    await renderer.idle();
  } catch {
    // best-effort wait for an in-flight frame to finish
  }

  try {
    renderer.destroy();
  } catch {
    // already destroyed
  }
}

export async function waitForStdinQuiet(stdin: StdinLike, quietMs: number = 75, maxMs: number = 500): Promise<void> {
  if (!stdin || quietMs <= 0 || maxMs <= 0) {
    if (quietMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, quietMs));
    }
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;

      if (quietTimer !== null) clearTimeout(quietTimer);
      if (maxTimer !== null) clearTimeout(maxTimer);

      removeDataListener(stdin, onData);
      resolve();
    };

    const armQuietTimer = () => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };

    const onData = () => {
      armQuietTimer();
    };

    stdin.on("data", onData);
    armQuietTimer();
    maxTimer = setTimeout(finish, maxMs);
  });
}

function removeDataListener(stdin: NonNullable<StdinLike>, listener: () => void): void {
  if (typeof stdin.off === "function") {
    stdin.off("data", listener);
    return;
  }
  stdin.removeListener("data", listener);
}

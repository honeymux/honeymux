import { describe, expect, test } from "bun:test";

import type { AgentSession } from "../../agents/types.ts";
import type { TmuxKeyBindings } from "../../tmux/types.ts";

import {
  getTmuxSplitSequences,
  handlePermissionPromptInput,
  resolveHoneybeamDirection,
  shouldDenyPermissionPrompt,
  shouldMarkPermissionPromptAnswered,
} from "./use-pty-write-pipeline.ts";

const KEY_BINDINGS: TmuxKeyBindings = {
  closePane: "ctrl-b + x",
  detach: "ctrl-b + d",
  killWindow: "ctrl-b + &",
  newWindow: "ctrl-b + c",
  prefix: "ctrl-b",
  selectWindow: [],
  splitHorizontal: 'ctrl-b + "',
  splitVertical: "ctrl-b + %",
};

describe("pty write pipeline helpers", () => {
  test("derives tmux prefix and split sequences", () => {
    expect(getTmuxSplitSequences(null)).toEqual({
      horizontalSplitSequence: null,
      prefixSequence: null,
      verticalSplitSequence: null,
    });
    expect(getTmuxSplitSequences(KEY_BINDINGS)).toEqual({
      horizontalSplitSequence: '"',
      prefixSequence: "\u0002",
      verticalSplitSequence: "%",
    });
  });

  test("detects the honeybeam split direction from the post-prefix key", () => {
    expect(resolveHoneybeamDirection("%", "%", '"')).toBe("vertical");
    expect(resolveHoneybeamDirection('"', "%", '"')).toBe("horizontal");
    expect(resolveHoneybeamDirection("x", "%", '"')).toBeNull();
  });

  test("treats enter as answered and escape/ctrl-c as deny", () => {
    expect(shouldMarkPermissionPromptAnswered("\r")).toBe(true);
    expect(shouldMarkPermissionPromptAnswered("\x1b")).toBe(false);
    expect(shouldDenyPermissionPrompt("\x03")).toBe(true);
    expect(shouldDenyPermissionPrompt("\x1b")).toBe(true);
    expect(shouldDenyPermissionPrompt("x")).toBe(false);
    expect(shouldMarkPermissionPromptAnswered("x")).toBe(false);
  });

  test("routes Ctrl-C through respondToPermission, markAnswered, and send-keys", () => {
    const calls: Array<[string, string, "allow" | "deny"]> = [];
    const answered: string[] = [];
    const sentKeys: Array<[string, string]> = [];
    const session: AgentSession = {
      agentType: "claude",
      cwd: "/work",
      lastEvent: {
        agentType: "claude",
        cwd: "/work",
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 1,
        toolUseId: "tool-1",
      },
      paneId: "%1",
      sessionId: "sess-1",
      startedAt: 1,
      status: "unanswered",
    };

    const result = handlePermissionPromptInput({
      data: "\x03",
      paneId: "%1",
      respondToPermission: (sessionId, toolUseId, decision) => {
        calls.push([sessionId, toolUseId, decision]);
      },
      sendKeyToPane: (paneId, keyName) => {
        sentKeys.push([paneId, keyName]);
      },
      store: {
        getSessions: () => [session],
        markAnswered: (sessionId) => {
          answered.push(sessionId);
        },
      },
    });

    expect(result).toEqual({ action: "deny", handled: true });
    expect(calls).toEqual([["sess-1", "tool-1", "deny"]]);
    // For agents whose provider.respondToPermission is a no-op (codex/gemini),
    // markAnswered is the only thing that clears the unanswered state.
    expect(answered).toEqual(["sess-1"]);
    expect(sentKeys).toEqual([["%1", "C-c"]]);
  });

  test("routes Enter through markAnswered and send-keys (no respondToPermission)", () => {
    const answered: string[] = [];
    const sentKeys: Array<[string, string]> = [];
    const session: AgentSession = {
      agentType: "claude",
      cwd: "/work",
      lastEvent: {
        agentType: "claude",
        cwd: "/work",
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 1,
      },
      paneId: "%1",
      sessionId: "sess-1",
      startedAt: 1,
      status: "unanswered",
    };

    const result = handlePermissionPromptInput({
      data: "\r",
      paneId: "%1",
      respondToPermission: () => {
        throw new Error("unexpected respondToPermission");
      },
      sendKeyToPane: (paneId, keyName) => {
        sentKeys.push([paneId, keyName]);
      },
      store: {
        getSessions: () => [session],
        markAnswered: (sessionId) => {
          answered.push(sessionId);
        },
      },
    });

    expect(result).toEqual({ action: "markAnswered", handled: true });
    expect(answered).toEqual(["sess-1"]);
    expect(sentKeys).toEqual([["%1", "Enter"]]);
  });

  test("skips send-keys for remote sessions and reports handled=false", () => {
    const answered: string[] = [];
    const sentKeys: Array<[string, string]> = [];
    const session: AgentSession = {
      agentType: "claude",
      cwd: "/work",
      isRemote: true,
      lastEvent: {
        agentType: "claude",
        cwd: "/work",
        sessionId: "sess-1",
        status: "unanswered",
        timestamp: 1,
      },
      paneId: "%1",
      sessionId: "sess-1",
      startedAt: 1,
      status: "unanswered",
    };

    const result = handlePermissionPromptInput({
      data: "\x1b",
      paneId: "%1",
      respondToPermission: () => {},
      sendKeyToPane: (paneId, keyName) => {
        sentKeys.push([paneId, keyName]);
      },
      store: {
        getSessions: () => [session],
        markAnswered: (sessionId) => {
          answered.push(sessionId);
        },
      },
    });

    expect(result).toEqual({ action: "deny", handled: false });
    expect(answered).toEqual(["sess-1"]);
    expect(sentKeys).toEqual([]);
  });
});

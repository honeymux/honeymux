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

  test("routes explicit cancel through the permission response path", () => {
    const calls: Array<[string, string, "allow" | "deny"]> = [];
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

    const action = handlePermissionPromptInput({
      data: "\x03",
      paneId: "%1",
      respondToPermission: (sessionId, toolUseId, decision) => {
        calls.push([sessionId, toolUseId, decision]);
      },
      store: {
        getSessions: () => [session],
        markAnswered: () => {
          throw new Error("unexpected markAnswered");
        },
      },
    });

    expect(action).toBe("deny");
    expect(calls).toEqual([["sess-1", "tool-1", "deny"]]);
  });

  test("keeps enter on the local answered-state path", () => {
    const answered: string[] = [];
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

    const action = handlePermissionPromptInput({
      data: "\r",
      paneId: "%1",
      respondToPermission: () => {
        throw new Error("unexpected respondToPermission");
      },
      store: {
        getSessions: () => [session],
        markAnswered: (sessionId) => {
          answered.push(sessionId);
        },
      },
    });

    expect(action).toBe("markAnswered");
    expect(answered).toEqual(["sess-1"]);
  });
});

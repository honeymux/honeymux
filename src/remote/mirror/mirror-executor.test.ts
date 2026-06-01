import { describe, expect, mock, test } from "bun:test";

import type { Mutation } from "./reconciler.ts";

import { applyMutations } from "./mirror-executor.ts";

describe("applyMutations", () => {
  test("create-window: captures returned ids and tags both window + initial pane", async () => {
    const runRemote = mock(async (cmd: string) => {
      if (cmd.startsWith("new-window")) return "@100 %200";
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { initialLocalPaneId: "%10", initialPaneIsRemoteBacked: true, kind: "create-window", localWindowId: "@1" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    expect(result.appliedCreateWindows.get("@1")).toBe("@100");
    expect(result.appliedSplits.get("%10")).toBe("%200");

    // Verify the tag-setting commands were issued, with tmux-quoted args.
    const calls = runRemote.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("new-window -d -P"),
        expect.stringContaining("set-option -w -t '@100' @hmx-local-window-id '@1'"),
        expect.stringContaining("set-option -p -t '%200' @hmx-local-pane-id '%10'"),
      ]),
    );
  });

  test("split-window: captures the new pane id and tags it", async () => {
    const runRemote = mock(async (cmd: string) => {
      if (cmd.startsWith("split-window")) return "%201";
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { isRemoteBacked: true, kind: "split-window", localPaneId: "%11", remoteWindowId: "@100" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    expect(result.appliedSplits.get("%11")).toBe("%201");
    expect(runRemote).toHaveBeenCalledWith(expect.stringContaining("set-option -p -t '%201' @hmx-local-pane-id '%11'"));
  });

  test("split-window: records an untagged phantom in appliedSplits but writes no routing tag", async () => {
    const runRemote = mock(async (cmd: string) => {
      if (cmd.startsWith("split-window")) return "%201";
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { isRemoteBacked: false, kind: "split-window", localPaneId: "%11", remoteWindowId: "@100" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    // Pairing recorded so remotePaneFor() resolves the un-converted pane...
    expect(result.appliedSplits.get("%11")).toBe("%201");
    // ...but no @hmx-local-pane-id tag (tagging phantoms churns the mirror).
    expect(runRemote).not.toHaveBeenCalledWith(expect.stringContaining("@hmx-local-pane-id"));
  });

  test("create-window: records an untagged phantom initial pane but tags only the window", async () => {
    const runRemote = mock(async (cmd: string) => {
      if (cmd.startsWith("new-window")) return "@100 %200";
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { initialLocalPaneId: "%10", initialPaneIsRemoteBacked: false, kind: "create-window", localWindowId: "@1" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    expect(result.appliedCreateWindows.get("@1")).toBe("@100");
    expect(result.appliedSplits.get("%10")).toBe("%200");
    const calls = runRemote.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([expect.stringContaining("@hmx-local-window-id '@1'")]));
    expect(runRemote).not.toHaveBeenCalledWith(expect.stringContaining("@hmx-local-pane-id"));
  });

  test("apply-layout: tracks the layout string it successfully applied", async () => {
    const runRemote = mock(async () => "");
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [{ kind: "apply-layout", layout: "aaaa,80x24,0,0,200", remoteWindowId: "@100" }];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    expect(result.appliedLayouts.get("@100")).toBe("aaaa,80x24,0,0,200");
  });

  test("apply-layout: resizes the window to the layout's dimensions before laying it out", async () => {
    // `select-layout` under `window-size smallest` can't shrink a window below
    // the control-client width, so the window must be `resize-window`d to the
    // local layout's exact size first — and that resize must precede the layout.
    const calls: string[] = [];
    const runRemote = mock(async (cmd: string) => {
      calls.push(cmd);
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [{ kind: "apply-layout", layout: "aaaa,121x30,0,0,200", remoteWindowId: "@100" }];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    const resizeIdx = calls.findIndex((c) => c.startsWith("resize-window"));
    const layoutIdx = calls.findIndex((c) => c.startsWith("select-layout"));
    expect(calls[resizeIdx]).toBe("resize-window -t '@100' -x 121 -y 30");
    expect(resizeIdx).toBeLessThan(layoutIdx);
  });

  test("apply-layout: skips the resize when the layout carries no parseable dimensions", async () => {
    const calls: string[] = [];
    const runRemote = mock(async (cmd: string) => {
      calls.push(cmd);
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [{ kind: "apply-layout", layout: "x", remoteWindowId: "@100" }];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("resize-window"))).toBe(false);
    expect(calls.some((c) => c.startsWith("select-layout"))).toBe(true);
  });

  test("swap-pane: issues swap-pane -d with both pane ids tmux-quoted", async () => {
    const runRemote = mock(async () => "");
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { kind: "swap-pane", remoteWindowId: "@100", sourcePaneId: "%200", targetPaneId: "%201" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(0);
    expect(runRemote).toHaveBeenCalledWith("swap-pane -d -s '%200' -t '%201'");
  });

  test("collects per-mutation failures without aborting subsequent ones", async () => {
    const runRemote = mock(async (cmd: string) => {
      if (cmd.startsWith("kill-pane")) throw new Error("pane already dead");
      return "";
    });
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { kind: "kill-pane", reason: "orphan", remotePaneId: "%999" },
      { kind: "apply-layout", layout: "x", remoteWindowId: "@100" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.error).toContain("pane already dead");
    expect(result.appliedLayouts.get("@100")).toBe("x"); // second mutation still ran
  });

  test("split-window with empty pane-id response is reported as a failure", async () => {
    const runRemote = mock(async () => "");
    const runLocal = mock(async () => "");

    const mutations: Mutation[] = [
      { isRemoteBacked: true, kind: "split-window", localPaneId: "%11", remoteWindowId: "@100" },
    ];
    const result = await applyMutations(mutations, { label: "test", runLocal, runRemote });

    expect(result.failures).toHaveLength(1);
    expect(result.appliedSplits.size).toBe(0);
  });
});

import { describe, expect, it } from "bun:test";

import { computeTerminalMetrics } from "../../util/pane-layout.ts";
import {
  buildAgentsDialogProps,
  closeOverflowDropdown,
  emitTmuxKeyBindingHint,
  selectOverflowTab,
} from "./use-tmux-pane-view-model.ts";

describe("use-tmux-pane-view-model helpers", () => {
  it("computes terminal metrics for each UI mode", () => {
    const full = computeTerminalMetrics({
      height: 40,
      uiMode: "adaptive",
      width: 120,
    });
    expect(full.cols).toBe(120);
    expect(full.rows).toBe(37);
    expect(full.tooSmall).toBe(false);

    const marquee = computeTerminalMetrics({
      height: 20,
      uiMode: "marquee-top",
      width: 50,
    });
    expect(marquee.cols).toBe(50);
    expect(marquee.rows).toBe(17);

    const raw = computeTerminalMetrics({
      height: 20,
      uiMode: "raw",
      width: 50,
    });
    expect(raw.cols).toBe(50);
    expect(raw.rows).toBe(20);
  });

  it("clamps tiny dimensions and marks tooSmall", () => {
    const metrics = computeTerminalMetrics({
      height: 5,
      uiMode: "adaptive",
      width: 12,
    });

    expect(metrics.cols).toBe(12);
    expect(metrics.rows).toBe(3);
    expect(metrics.tooSmall).toBe(true);
  });

  it("closes overflow and clears dropdown handler", () => {
    const dropdownInputRef = {
      current: () => true,
    };
    let open = true;

    closeOverflowDropdown(dropdownInputRef, (next) => {
      open = next;
    });

    expect(dropdownInputRef.current).toBeNull();
    expect(open).toBe(false);
  });

  it("selecting overflow tab closes dropdown and triggers tab click", () => {
    const dropdownInputRef = {
      current: () => true,
    };
    let open = true;
    let selectedIndex = -1;

    selectOverflowTab({
      dropdownInputRef,
      index: 3,
      onTabClick: (index) => {
        selectedIndex = index;
      },
      setOverflowOpen: (next) => {
        open = next;
      },
    });

    expect(dropdownInputRef.current).toBeNull();
    expect(open).toBe(false);
    expect(selectedIndex).toBe(3);
  });

  it("gates agents dialog props on required inputs", () => {
    const closed = buildAgentsDialogProps({
      agentSessionsForDialog: [],
      agentsDialogOpen: false,
      dropdownInputRef: { current: () => true },
      height: 40,
      onAgentsDialogClose: () => {},
      onAgentsDialogSelect: () => {},
      registryRef: undefined,
      width: 100,
    });
    expect(closed).toBeNull();

    const missingInputRef = buildAgentsDialogProps({
      agentSessionsForDialog: [],
      agentsDialogOpen: true,
      dropdownInputRef: undefined,
      height: 40,
      onAgentsDialogClose: () => {},
      onAgentsDialogSelect: () => {},
      registryRef: undefined,
      width: 100,
    });
    expect(missingInputRef).toBeNull();

    const sessions = [{ id: "s1" }] as any[];
    const dialog = buildAgentsDialogProps({
      agentSessionsForDialog: sessions as any,
      agentsDialogOpen: true,
      dropdownInputRef: { current: () => true },
      height: 40,
      onAgentsDialogClose: () => {},
      onAgentsDialogSelect: () => {},
      registryRef: undefined,
      width: 120,
    });

    expect(dialog).not.toBeNull();
    expect(dialog?.sessions).toBe(sessions);
    expect(dialog?.width).toBe(120);
  });

  it("emits tmux key binding hints only when enabled and present", () => {
    const emitted: string[] = [];

    emitTmuxKeyBindingHint(true, "ctrl+b + 1", (hint) => emitted.push(hint));
    emitTmuxKeyBindingHint(false, "ctrl+b + 2", (hint) => emitted.push(hint));
    emitTmuxKeyBindingHint(true, undefined, (hint) => emitted.push(hint));

    expect(emitted).toEqual(["ctrl+b + 1"]);
  });
});

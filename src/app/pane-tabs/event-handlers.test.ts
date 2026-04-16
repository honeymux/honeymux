import { describe, expect, mock, test } from "bun:test";

import type { PaneTabGroup } from "./types.ts";

import {
  PANE_TAB_DEAD_SUBSCRIPTION,
  PANE_TAB_LABEL_SUBSCRIPTION,
  applyExternalWindowRename,
  createPaneTabTmuxEventHandlers,
  registerPaneTabFormatSubscriptions,
} from "./event-handlers.ts";

class FakePaneTabEventClient {
  clearFormatSubscription = mock(async (_name: string) => {});
  setFormatSubscription = mock(async (_name: string, _target: string, _format: string) => {});
}

describe("pane tab event handlers", () => {
  test("applyExternalWindowRename updates all managed groups sharing a host window", () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          explicitWindowName: "dev",
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%1" }],
          windowId: "@1",
        },
      ],
      [
        "slot-2",
        {
          activeIndex: 0,
          explicitWindowName: "dev",
          slotHeight: 24,
          slotKey: "slot-2",
          slotWidth: 80,
          tabs: [{ label: "logs", paneId: "%2" }],
          windowId: "@1",
        },
      ],
    ]);

    const nextGroups = applyExternalWindowRename(groups, "@1", "workspace");

    expect(nextGroups?.get("slot-1")?.explicitWindowName).toBe("workspace");
    expect(nextGroups?.get("slot-2")?.explicitWindowName).toBe("workspace");
  });

  test("queues label refresh only for refreshable pane metadata events", () => {
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2", userLabel: "logs" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const queueLabelRefresh = mock(() => {});
    const handlers = createPaneTabTmuxEventHandlers({
      commitGroups: mock((_groups: Map<string, PaneTabGroup>) => {}),
      getGroups: () => groups,
      queueBootstrap: mock(() => {}),
      queueLabelRefresh,
      validateTabGroups: mock(() => {}),
    });

    handlers.handlePaneTitleChanged("%1");
    handlers.handlePaneTitleChanged("%2");
    handlers.handleLabelSubscriptionChanged(PANE_TAB_LABEL_SUBSCRIPTION, "", "", "", "%1");
    handlers.handleLabelSubscriptionChanged("other", "", "", "", "%1");
    handlers.handleWindowPaneChanged();

    expect(queueLabelRefresh).toHaveBeenCalledTimes(3);
  });

  test("validates on every dead-pane subscription regardless of group membership", () => {
    // Regression: the previous implementation gated validation on
    // findPaneTabGroupByPaneId, which dropped events whenever groupsRef
    // lagged a racing doNewTab/doSwitchTab commit by one tick — leaving
    // stale pane tabs wedged until an unrelated layout-change arrived.
    const groups = new Map<string, PaneTabGroup>([
      [
        "slot-1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "slot-1",
          slotWidth: 80,
          tabs: [
            { label: "bash", paneId: "%1" },
            { label: "logs", paneId: "%2" },
          ],
          windowId: "@1",
        },
      ],
    ]);
    const validateTabGroups = mock(() => {});
    const handlers = createPaneTabTmuxEventHandlers({
      commitGroups: mock((_groups: Map<string, PaneTabGroup>) => {}),
      getGroups: () => groups,
      queueBootstrap: mock(() => {}),
      queueLabelRefresh: mock(() => {}),
      validateTabGroups,
    });

    handlers.handleDeadPaneSubscriptionChanged(PANE_TAB_DEAD_SUBSCRIPTION, "", "", "", "%2", "1");
    // Pane not yet committed into groupsRef must still trigger validation.
    handlers.handleDeadPaneSubscriptionChanged(PANE_TAB_DEAD_SUBSCRIPTION, "", "", "", "%9", "1");
    // Transitions back to alive and unrelated subscriptions must not.
    handlers.handleDeadPaneSubscriptionChanged(PANE_TAB_DEAD_SUBSCRIPTION, "", "", "", "%2", "0");
    handlers.handleDeadPaneSubscriptionChanged("other", "", "", "", "%2", "1");

    expect(validateTabGroups).toHaveBeenCalledTimes(2);
  });

  test("validates dead panes even when groupsRef is transiently empty", () => {
    // Race scenario: subscription fires for a pane whose group commit is
    // still in flight (groupsRef.size === 0).  The handler must still
    // forward the signal — doValidate will early-return harmlessly if
    // there really is nothing to validate.
    const validateTabGroups = mock(() => {});
    const handlers = createPaneTabTmuxEventHandlers({
      commitGroups: mock((_groups: Map<string, PaneTabGroup>) => {}),
      getGroups: () => new Map<string, PaneTabGroup>(),
      queueBootstrap: mock(() => {}),
      queueLabelRefresh: mock(() => {}),
      validateTabGroups,
    });

    handlers.handleDeadPaneSubscriptionChanged(PANE_TAB_DEAD_SUBSCRIPTION, "", "", "", "%5", "1");

    expect(validateTabGroups).toHaveBeenCalledTimes(1);
  });

  test("window-pane-changed validates as a remain-on-exit backstop", () => {
    // Regression: pane tabs enable remain-on-exit, so a shell death emits
    // no layout-change.  window-pane-changed (which tmux still fires in
    // many pane-death scenarios) is the cheapest extra resync signal.
    const validateTabGroups = mock(() => {});
    const handlers = createPaneTabTmuxEventHandlers({
      commitGroups: mock((_groups: Map<string, PaneTabGroup>) => {}),
      getGroups: () => new Map<string, PaneTabGroup>(),
      queueBootstrap: mock(() => {}),
      queueLabelRefresh: mock(() => {}),
      validateTabGroups,
    });

    handlers.handleWindowPaneChanged();

    expect(validateTabGroups).toHaveBeenCalledTimes(1);
  });

  test("registerPaneTabFormatSubscriptions installs and clears both subscriptions", () => {
    const client = new FakePaneTabEventClient();

    const cleanup = registerPaneTabFormatSubscriptions(client as never);

    expect(client.setFormatSubscription).toHaveBeenCalledWith("hmx-pane-tab-labels", "%*", "#{pane_current_command}");
    expect(client.setFormatSubscription).toHaveBeenCalledWith("hmx-pane-tab-dead", "%*", "#{pane_dead}");

    cleanup();

    expect(client.clearFormatSubscription).toHaveBeenCalledWith("hmx-pane-tab-labels");
    expect(client.clearFormatSubscription).toHaveBeenCalledWith("hmx-pane-tab-dead");
  });
});

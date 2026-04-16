import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { PaneTabGroup } from "./types.ts";

import {
  findPaneTabGroupEntriesByWindowId,
  groupOwnsHostWindowName,
  paneNeedsPaneTabLabelRefresh,
} from "./selectors.ts";

export const PANE_TAB_DEAD_SUBSCRIPTION = "hmx-pane-tab-dead";
export const PANE_TAB_LABEL_SUBSCRIPTION = "hmx-pane-tab-labels";

export interface PaneTabTmuxEventHandlers {
  handleBootstrap: () => void;
  handleDeadPaneSubscriptionChanged: (
    name: string,
    sessionId: string,
    windowId: string,
    windowIndex: string,
    paneId: string,
    value: string,
  ) => void;
  handleLabelSubscriptionChanged: (
    name: string,
    sessionId: string,
    windowId: string,
    windowIndex: string,
    paneId: string,
  ) => void;
  handlePaneTitleChanged: (paneId: string) => void;
  handleWindowPaneChanged: () => void;
  handleWindowRename: (windowId: string, name: string) => void;
}

interface CreatePaneTabTmuxEventHandlersOptions {
  commitGroups: (groups: Map<string, PaneTabGroup>) => void;
  getGroups: () => Map<string, PaneTabGroup>;
  queueBootstrap: () => void;
  queueLabelRefresh: () => void;
  validateTabGroups: () => void;
}

export function applyExternalWindowRename(
  groups: Map<string, PaneTabGroup>,
  windowId: string,
  name: string,
): Map<string, PaneTabGroup> | null {
  if (name.startsWith("_hmx_")) return null;

  const entries = findPaneTabGroupEntriesByWindowId(groups, windowId).filter(([, group]) =>
    groupOwnsHostWindowName(group),
  );
  if (entries.length === 0) return null;

  const nextGroups = new Map(groups);
  let changed = false;

  if (entries.length === 1) {
    const [slotKey, group] = entries[0]!;
    const expectedName = group.explicitWindowName ?? group.tabs[group.activeIndex]?.label;
    if (expectedName && name !== expectedName) {
      nextGroups.set(slotKey, { ...group, explicitWindowName: name });
      changed = true;
    }
    return changed ? nextGroups : null;
  }

  for (const [slotKey, group] of entries) {
    if (group.explicitWindowName === name) continue;
    nextGroups.set(slotKey, { ...group, explicitWindowName: name });
    changed = true;
  }

  return changed ? nextGroups : null;
}

export function createPaneTabTmuxEventHandlers({
  commitGroups,
  getGroups,
  queueBootstrap,
  queueLabelRefresh,
  validateTabGroups,
}: CreatePaneTabTmuxEventHandlersOptions): PaneTabTmuxEventHandlers {
  return {
    handleBootstrap() {
      queueBootstrap();
    },
    handleDeadPaneSubscriptionChanged(
      name: string,
      _sessionId: string,
      _windowId: string,
      _windowIndex: string,
      _paneId: string,
      value: string,
    ) {
      // Do not gate on `findPaneTabGroupByPaneId(paneId)` — groupsRef can lag
      // a racing doNewTab/doSwitchTab commit by one tick, and dropping the
      // only signal tmux emits for a remain-on-exit death leaves the stale
      // tab wedged until an unrelated layout-change arrives.  doValidate is a
      // no-op when there is nothing dead.
      if (name !== PANE_TAB_DEAD_SUBSCRIPTION || value !== "1") return;
      validateTabGroups();
    },
    handleLabelSubscriptionChanged(
      name: string,
      _sessionId: string,
      _windowId: string,
      _windowIndex: string,
      paneId: string,
    ) {
      if (name !== PANE_TAB_LABEL_SUBSCRIPTION) return;
      if (!paneNeedsPaneTabLabelRefresh(getGroups(), paneId)) return;
      queueLabelRefresh();
    },
    handlePaneTitleChanged(paneId: string) {
      if (!paneNeedsPaneTabLabelRefresh(getGroups(), paneId)) return;
      queueLabelRefresh();
    },
    handleWindowPaneChanged() {
      // Backstop for dead-pane cleanup when `remain-on-exit` suppresses
      // layout-change: tmux still fires window-pane-changed in many
      // pane-death scenarios.  doValidate is cheap when nothing is dead.
      validateTabGroups();
      queueLabelRefresh();
    },
    handleWindowRename(windowId: string, name: string) {
      const nextGroups = applyExternalWindowRename(getGroups(), windowId, name);
      if (nextGroups) commitGroups(nextGroups);
      queueLabelRefresh();
    },
  };
}

export function registerPaneTabFormatSubscriptions(client: TmuxControlClient): () => void {
  void client.setFormatSubscription(PANE_TAB_LABEL_SUBSCRIPTION, "%*", "#{pane_current_command}").catch(() => {});
  void client.setFormatSubscription(PANE_TAB_DEAD_SUBSCRIPTION, "%*", "#{pane_dead}").catch(() => {});

  return () => {
    void client.clearFormatSubscription(PANE_TAB_LABEL_SUBSCRIPTION).catch(() => {});
    void client.clearFormatSubscription(PANE_TAB_DEAD_SUBSCRIPTION).catch(() => {});
  };
}

export function registerPaneTabTmuxEventHandlers(
  client: TmuxControlClient,
  handlers: PaneTabTmuxEventHandlers,
): () => void {
  client.on("layout-change", handlers.handleBootstrap);
  client.on("pane-title-changed", handlers.handlePaneTitleChanged);
  client.on("subscription-changed", handlers.handleLabelSubscriptionChanged);
  client.on("subscription-changed", handlers.handleDeadPaneSubscriptionChanged);
  client.on("window-add", handlers.handleBootstrap);
  client.on("window-pane-changed", handlers.handleWindowPaneChanged);
  client.on("window-renamed", handlers.handleWindowRename);

  return () => {
    client.off("layout-change", handlers.handleBootstrap);
    client.off("pane-title-changed", handlers.handlePaneTitleChanged);
    client.off("subscription-changed", handlers.handleLabelSubscriptionChanged);
    client.off("subscription-changed", handlers.handleDeadPaneSubscriptionChanged);
    client.off("window-add", handlers.handleBootstrap);
    client.off("window-pane-changed", handlers.handleWindowPaneChanged);
    client.off("window-renamed", handlers.handleWindowRename);
  };
}

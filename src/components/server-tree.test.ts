import { describe, expect, it } from "bun:test";

import type { PaneTabGroup } from "../app/pane-tabs/types.ts";

import { stringWidth } from "../util/text.ts";
import { applyTreePaneFieldUpdate, buildTreeRows, coalesceTreeData, fitTreeLabel } from "./server-tree.tsx";

describe("buildTreeRows", () => {
  it("shows the stable slot key on parent rows for multi-tab panes", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [
            { label: "shell", paneId: "%1" },
            { label: "logs", paneId: "%9" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [
          {
            active: true,
            command: "bash",
            id: "%9",
            index: 0,
            pid: 123,
            sessionName: "alpha",
            windowId: "@1",
          },
        ],
        sessions: [{ attached: true, id: "$1", name: "alpha" }],
        windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
      },
      "alpha",
      paneTabGroups,
    );

    const parentRow = rows.find((row) => row.type === "pane");
    expect(parentRow).toBeDefined();
    expect(parentRow?.id).toBe("%1");
    expect(parentRow?.paneId).toBe("%9");
  });

  it("keeps pane-tab navigation pinned to the visible host pane", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 1,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [
            { label: "shell", paneId: "%1" },
            { label: "logs", paneId: "%9" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [
          {
            active: true,
            command: "bash",
            id: "%9",
            index: 0,
            pid: 123,
            sessionName: "alpha",
            windowId: "@1",
          },
        ],
        sessions: [{ attached: true, id: "$1", name: "alpha" }],
        windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
      },
      "alpha",
      paneTabGroups,
    );

    const shellTabRow = rows.find((row) => row.type === "pane-tab" && row.paneId === "%1");
    expect(shellTabRow).toBeDefined();
    expect(shellTabRow?.navigatePaneId).toBe("%9");
  });

  it("keeps showing the live pane id for non-tabbed panes", () => {
    const rows = buildTreeRows(
      {
        panes: [
          {
            active: true,
            command: "bash",
            id: "%9",
            index: 0,
            pid: 123,
            sessionName: "alpha",
            windowId: "@1",
          },
        ],
        sessions: [{ attached: true, id: "$1", name: "alpha" }],
        windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
      },
      "alpha",
      new Map(),
    );

    const parentRow = rows.find((row) => row.type === "pane");
    expect(parentRow).toBeDefined();
    expect(parentRow?.id).toBe("%9");
    expect(parentRow?.paneId).toBe("%9");
  });

  it("strips control characters from rendered tmux labels", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%9",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "%9",
          slotWidth: 80,
          tabs: [
            { label: "logs\npane", paneId: "%9" },
            { label: "tail\t-f", paneId: "%10" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [
          {
            active: true,
            command: "bash\n-x",
            id: "%9",
            index: 0,
            pid: 123,
            sessionName: "alpha\nbeta",
            title: "pane\ttitle",
            windowId: "@1",
          },
        ],
        sessions: [{ attached: true, id: "$1", name: "alpha\nbeta" }],
        windows: [{ active: true, id: "@1", index: 0, name: "main\twin", sessionName: "alpha\nbeta" }],
      },
      "alpha\nbeta",
      paneTabGroups,
    );

    expect(rows.find((row) => row.type === "session")?.label).toBe("□ alphabeta");
    expect(rows.find((row) => row.type === "window")?.label).toBe("▣ mainwin");
    expect(rows.find((row) => row.type === "pane")?.label).toBe("■ logspane");
    expect(rows.find((row) => row.type === "pane")?.title).toBe("panetitle");
    expect(rows.find((row) => row.type === "pane-tab")?.label).toBe("ʭ logspane");
  });

  it("exposes OSC pane titles on pane rows via the title field", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%9",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "%9",
          slotWidth: 80,
          tabs: [{ label: "bash", paneId: "%9" }],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [
          {
            active: true,
            command: "bash",
            id: "%9",
            index: 0,
            pid: 123,
            sessionName: "alpha",
            title: "vim src/app.tsx",
            windowId: "@1",
          },
        ],
        sessions: [{ attached: true, id: "$1", name: "alpha" }],
        windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
      },
      "alpha",
      paneTabGroups,
    );

    const paneRow = rows.find((row) => row.type === "pane");
    expect(paneRow?.label).toBe("■ bash");
    expect(paneRow?.title).toBe("vim src/app.tsx");
  });

  it("creates a child tab row even for single-tab groups", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%5",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "%5",
          slotWidth: 80,
          tabs: [{ label: "shell", paneId: "%5" }],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [{ active: true, command: "zsh", id: "%5", index: 0, pid: 100, sessionName: "main", windowId: "@1" }],
        sessions: [{ attached: true, id: "$1", name: "main" }],
        windows: [{ active: true, id: "@1", index: 0, name: "work", sessionName: "main" }],
      },
      "main",
      paneTabGroups,
    );

    const paneRow = rows.find((r) => r.type === "pane");
    expect(paneRow).toBeDefined();
    expect(paneRow?.label).toBe("■ shell");
    expect(paneRow?.id).toBe("%5");

    const tabRows = rows.filter((r) => r.type === "pane-tab");
    expect(tabRows).toHaveLength(1);
    expect(tabRows[0]?.label).toBe("ʭ shell");
    expect(tabRows[0]?.paneId).toBe("%5");
  });

  it("shows tab count on pane row for multi-tab groups", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 0,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [
            { label: "shell", paneId: "%1" },
            { label: "logs", paneId: "%2" },
            { label: "build", paneId: "%3" },
          ],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [{ active: true, command: "zsh", id: "%1", index: 0, pid: 100, sessionName: "main", windowId: "@1" }],
        sessions: [{ attached: true, id: "$1", name: "main" }],
        windows: [{ active: true, id: "@1", index: 0, name: "work", sessionName: "main" }],
      },
      "main",
      paneTabGroups,
    );

    const paneRow = rows.find((r) => r.type === "pane");
    expect(paneRow?.label).toBe("■ shell");

    const tabRows = rows.filter((r) => r.type === "pane-tab");
    expect(tabRows).toHaveLength(3);
  });

  it("falls back to the pane command when pane-tab activeIndex is stale", () => {
    const paneTabGroups = new Map<string, PaneTabGroup>([
      [
        "%1",
        {
          activeIndex: 4,
          slotHeight: 24,
          slotKey: "%1",
          slotWidth: 80,
          tabs: [{ label: "shell", paneId: "%1" }],
          windowId: "@1",
        },
      ],
    ]);

    const rows = buildTreeRows(
      {
        panes: [{ active: true, command: "zsh", id: "%1", index: 0, pid: 100, sessionName: "main", windowId: "@1" }],
        sessions: [{ attached: true, id: "$1", name: "main" }],
        windows: [{ active: true, id: "@1", index: 0, name: "work", sessionName: "main" }],
      },
      "main",
      paneTabGroups,
    );

    const paneRow = rows.find((row) => row.type === "pane");
    expect(paneRow?.label).toBe("■ zsh");
  });

  it("shows no tab info for panes without a tab group", () => {
    const rows = buildTreeRows(
      {
        panes: [{ active: true, command: "zsh", id: "%5", index: 0, pid: 100, sessionName: "main", windowId: "@1" }],
        sessions: [{ attached: true, id: "$1", name: "main" }],
        windows: [{ active: true, id: "@1", index: 0, name: "work", sessionName: "main" }],
      },
      "main",
      new Map(),
    );

    const paneRow = rows.find((r) => r.type === "pane");
    expect(paneRow?.label).toBe("■ zsh");
    expect(paneRow?.id).toBe("%5");

    const tabRows = rows.filter((r) => r.type === "pane-tab");
    expect(tabRows).toHaveLength(0);
  });

  it("truncates wide labels in the tree with an ellipsis", () => {
    const fitted = fitTreeLabel("└─ ", "▣ 東京都  北京市", 14);
    expect(fitted).toBe("▣ 東京都…");
    expect(stringWidth(fitted)).toBe(9);
  });
});

describe("coalesceTreeData", () => {
  it("keeps the previous snapshot when a refresh reports only staging windows", () => {
    const previous = {
      panes: [{ active: true, command: "bash", id: "%1", index: 0, pid: 1, sessionName: "alpha", windowId: "@1" }],
      sessions: [{ attached: true, id: "$1", name: "alpha" }],
      windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
    };
    const next = {
      panes: [],
      sessions: [{ attached: true, id: "$1", name: "alpha" }],
      windows: [{ active: true, id: "@2", index: 0, name: "_hmx_tab", sessionName: "alpha" }],
    };

    expect(coalesceTreeData(previous, next)).toBe(previous);
  });

  it("accepts the next snapshot when it still has at least one visible window", () => {
    const previous = {
      panes: [{ active: true, command: "bash", id: "%1", index: 0, pid: 1, sessionName: "alpha", windowId: "@1" }],
      sessions: [{ attached: true, id: "$1", name: "alpha" }],
      windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
    };
    const next = {
      panes: [{ active: true, command: "top", id: "%2", index: 0, pid: 2, sessionName: "alpha", windowId: "@3" }],
      sessions: [{ attached: true, id: "$1", name: "alpha" }],
      windows: [
        { active: false, id: "@2", index: 1, name: "_hmx_tab", sessionName: "alpha" },
        { active: true, id: "@3", index: 0, name: "work", sessionName: "alpha" },
      ],
    };

    expect(coalesceTreeData(previous, next)).toBe(next);
  });
});

describe("applyTreePaneFieldUpdate", () => {
  it("updates pane titles without touching other panes", () => {
    const data = {
      panes: [
        {
          active: true,
          command: "claude",
          id: "%1",
          index: 0,
          pid: 101,
          sessionName: "alpha",
          title: "bow",
          windowId: "@1",
        },
        {
          active: false,
          command: "bash",
          id: "%2",
          index: 1,
          pid: 202,
          sessionName: "alpha",
          title: "shell",
          windowId: "@1",
        },
      ],
      sessions: [{ attached: true, id: "$1", name: "alpha" }],
      windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
    };

    const next = applyTreePaneFieldUpdate(data, "%1", "title", "Claude Code");

    expect(next).not.toBe(data);
    expect(next?.panes[0]?.title).toBe("Claude Code");
    expect(next?.panes[1]).toBe(data.panes[1]);
    expect(next?.sessions).toBe(data.sessions);
    expect(next?.windows).toBe(data.windows);
  });

  it("normalizes empty command and title values the same way as getFullTree", () => {
    const data = {
      panes: [
        {
          active: true,
          command: "claude",
          cwd: "/tmp",
          id: "%1",
          index: 0,
          pid: 101,
          sessionName: "alpha",
          title: "Claude Code",
          windowId: "@1",
        },
      ],
      sessions: [{ attached: true, id: "$1", name: "alpha" }],
      windows: [{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }],
    };

    const commandReset = applyTreePaneFieldUpdate(data, "%1", "command", "");
    const titleReset = applyTreePaneFieldUpdate(data, "%1", "title", "");

    expect(commandReset?.panes[0]?.command).toBe("shell");
    expect(titleReset?.panes[0]?.title).toBeUndefined();
  });
});

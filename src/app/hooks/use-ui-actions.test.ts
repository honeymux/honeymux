import { describe, expect, test } from "bun:test";

import { EventEmitter } from "../../util/event-emitter.ts";
import { summarizeSessionInfo, waitForNextHoneybeamTopologyChange } from "./use-ui-actions.ts";

class TestTopologyEmitter extends EventEmitter {
  trigger(event: string): void {
    this.emit(event);
  }
}

describe("summarizeSessionInfo", () => {
  test("counts single-tab groups when restoring session delete details", () => {
    const info = summarizeSessionInfo(
      {
        paneTabActive: new Set(),
        paneTabMembers: new Set(),
        paneWindowIds: new Map([["%1", "@1"]]),
        windowNames: new Map([["@1", "main"]]),
        windowPanes: new Map([["@1", 1]]),
      },
      {
        borderLines: "single",
        groups: [
          {
            activePaneId: "%1",
            slotKey: "%1",
            tabs: [{ label: "bash", paneId: "%1" }],
          },
        ],
      },
    );

    expect(info).toEqual({ paneTabsEnabled: 1, panes: 1, windows: 1 });
  });

  test("counts pane tabs from live tmux markers", () => {
    const info = summarizeSessionInfo(
      {
        paneTabActive: new Set(["%1"]),
        paneTabMembers: new Set(["%1", "%10", "%9"]),
        paneWindowIds: new Map([
          ["%1", "@1"],
          ["%10", "@10"],
          ["%20", "@2"],
          ["%21", "@2"],
          ["%9", "@9"],
        ]),
        windowNames: new Map([
          ["@1", "main"],
          ["@10", "_hmx_tab"],
          ["@2", "editor"],
          ["@9", "_hmx_tab"],
        ]),
        windowPanes: new Map([
          ["@1", 1],
          ["@10", 1],
          ["@2", 2],
          ["@9", 1],
        ]),
      },
      null,
    );

    expect(info).toEqual({ paneTabsEnabled: 3, panes: 3, windows: 2 });
  });

  test("falls back to persisted pane-tab state when live markers are unavailable", () => {
    const info = summarizeSessionInfo(
      {
        paneTabActive: new Set(),
        paneTabMembers: new Set(),
        paneWindowIds: new Map([
          ["%1", "@1"],
          ["%2", "@2"],
          ["%9", "@9"],
        ]),
        windowNames: new Map([
          ["@1", "main"],
          ["@2", "_hmx_tab"],
          ["@9", "_hmx_tab"],
        ]),
        windowPanes: new Map([
          ["@1", 1],
          ["@2", 1],
          ["@9", 1],
        ]),
      },
      {
        borderLines: "single",
        groups: [
          {
            activePaneId: "%1",
            slotKey: "%1",
            tabs: [
              { label: "bash", paneId: "%1" },
              { label: "logs", paneId: "%2" },
              { label: "tail", paneId: "%9" },
            ],
          },
        ],
      },
    );

    expect(info).toEqual({ paneTabsEnabled: 3, panes: 1, windows: 1 });
  });
});

describe("waitForNextHoneybeamTopologyChange", () => {
  test("resolves when tmux emits the next topology event", async () => {
    const client = new TestTopologyEmitter();
    const wait = waitForNextHoneybeamTopologyChange(client, 1000);

    client.trigger("layout-change");

    await wait;
  });
});

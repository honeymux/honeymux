import { describe, expect, test } from "bun:test";

import {
  parseActivePaneCwdOutput,
  parseActivePaneGeometryOutput,
  parseActivePaneScreenshotInfoOutput,
  parseAllPaneInfoOutput,
  parseFullTreeOutputs,
  parseKeyBindingsOutput,
  parseListAllPaneIdsOutput,
  parseListPanesInWindowOutput,
  parseListSessionsOutput,
  parseListWindowPaneIdsOutput,
  parseListWindowsOutput,
  parsePaneCommandsOutput,
  parsePaneContextOutput,
  parsePaneTtyMappingsOutput,
  parseSessionInfoOutputs,
  parseSessionSummaryOutputs,
  parseStatusBarInfoOutput,
} from "./control-client-parsers.ts";

describe("control client parsers", () => {
  test("parses windows and sessions output", () => {
    expect(parseListWindowsOutput("@1\t0\tmain\t1\t%3\tlayout-1\n@2\t1\ttop\t0\t%7\tlayout-2")).toEqual([
      { active: true, id: "@1", index: 0, layout: "layout-1", name: "main", paneId: "%3" },
      { active: false, id: "@2", index: 1, layout: "layout-2", name: "top", paneId: "%7" },
    ]);

    expect(parseListSessionsOutput("$1\talpha\t1\t#ff0\n$2\tbeta\t0\t")).toEqual([
      { attached: true, color: "#ff0", id: "$1", name: "alpha" },
      { attached: false, color: undefined, id: "$2", name: "beta" },
    ]);
  });

  test("parses session info outputs with pane-tab markers", () => {
    const info = parseSessionInfoOutputs(
      "alpha",
      " @1\t3\tbash\n @2\t1\t_hmx_tab",
      " alpha\t%3\t@1\t1\t1\n alpha\t%4\t@1\t1\t\n alpha\t%5\t@2\t\t\n beta\t%8\t@9\t1\t1",
    );

    expect(info.windowPanes.get("@1")).toBe(3);
    expect(info.windowNames.get("@2")).toBe("_hmx_tab");
    expect(info.paneWindowIds.get("%4")).toBe("@1");
    expect([...info.paneTabMembers]).toEqual(["%3", "%4"]);
    expect([...info.paneTabActive]).toEqual(["%3"]);
  });

  test("parses full tree outputs and preserves tabbed pane titles", () => {
    const tree = parseFullTreeOutputs(
      "$1\talpha\t1\t#f00",
      "alpha\t@1\t0\tmain\t1",
      ["alpha\t@1\t%3\t0\t1\tvim\t123\t/tmp/demo\tremote-a\tTitle\tWith\tTabs", "alpha\t@1\t%4\t1\t0\t\t0\t\t\t"].join(
        "\n",
      ),
    );

    expect(tree.sessions).toEqual([{ attached: true, color: "#f00", id: "$1", name: "alpha" }]);
    expect(tree.windows).toEqual([{ active: true, id: "@1", index: 0, name: "main", sessionName: "alpha" }]);
    expect(tree.panes).toEqual([
      {
        active: true,
        command: "vim",
        cwd: "/tmp/demo",
        id: "%3",
        index: 0,
        pid: 123,
        remoteHost: "remote-a",
        sessionName: "alpha",
        title: "Title\tWith\tTabs",
        windowId: "@1",
      },
      {
        active: false,
        command: "shell",
        cwd: undefined,
        id: "%4",
        index: 1,
        pid: 0,
        remoteHost: undefined,
        sessionName: "alpha",
        title: undefined,
        windowId: "@1",
      },
    ]);
  });

  test("parses session summary counts", () => {
    expect(parseSessionSummaryOutputs("$1\n$2\n", "@1\n@2\n@3\n", "0\n1\n")).toEqual({
      panes: 2,
      sessions: 2,
      windows: 3,
    });
  });

  test("parses key bindings and falls back for missing select-window bindings", () => {
    const bindings = parseKeyBindingsOutput(
      "C-b\n",
      [
        String.raw`bind-key -T prefix % split-window -h`,
        String.raw`bind-key -T prefix \" new-window`,
        String.raw`bind-key -T prefix x confirm-before -p "kill-pane?" kill-pane`,
        String.raw`bind-key -T prefix & confirm-before -p "kill-window #W? (y/n)" kill-window`,
        String.raw`bind-key -T prefix d detach-client`,
        String.raw`bind-key -T prefix 1 select-window -t :=1`,
      ].join("\n"),
    );

    expect(bindings.prefix).toBe("ctrl+b");
    expect(bindings.splitVertical).toBe("ctrl+b + %");
    expect(bindings.newWindow).toBe('ctrl+b + "');
    expect(bindings.closePane).toBe("ctrl+b + x");
    expect(bindings.killWindow).toBe("ctrl+b + &");
    expect(bindings.detach).toBe("ctrl+b + d");
    expect(bindings.selectWindow[0]).toBe("ctrl+b + 0");
    expect(bindings.selectWindow[1]).toBe("ctrl+b + 1");
  });

  test("parses status bar info", () => {
    expect(parseStatusBarInfoOutput("off", "top")).toBeNull();
    expect(parseStatusBarInfoOutput("3", "top")).toEqual({ lines: 3, position: "top" });
    expect(parseStatusBarInfoOutput("on", "bottom")).toEqual({ lines: 1, position: "bottom" });
  });

  test("parses active pane geometry, cwd, and screenshot info", () => {
    expect(parseActivePaneGeometryOutput("0 0 0 10 10\n1 3 4 120 40")).toEqual({
      height: 40,
      left: 3,
      top: 4,
      width: 120,
    });
    expect(parseActivePaneCwdOutput("0 /tmp/ignore\n1 /tmp/demo dir")).toBe("/tmp/demo dir");
    expect(parseActivePaneScreenshotInfoOutput("0 %1 0 0 10 10 /tmp/ignore\n1 %7 3 4 120 40 /tmp/demo dir")).toEqual({
      cwd: "/tmp/demo dir",
      height: 40,
      left: 3,
      paneId: "%7",
      top: 4,
      width: 120,
    });
  });

  test("parses pane context output", () => {
    expect(parsePaneContextOutput("main\t$1\teditor\t@3\t%7\tbash")).toEqual({
      paneId: "%7",
      paneName: "bash",
      sessionId: "$1",
      sessionName: "main",
      windowId: "@3",
      windowName: "editor",
    });
    // empty pane command
    expect(parsePaneContextOutput("s\t$0\tw\t@0\t%0\t").paneName).toBe("");
  });

  test("parses pane inventory outputs", () => {
    expect(parseAllPaneInfoOutput("123 bash /dev/pts/1 0 0 80 24 1 %3\n456 vim /dev/pts/2 81 0 80 24 0 %4")).toEqual([
      {
        active: true,
        command: "bash",
        height: 24,
        id: "%3",
        left: 0,
        pid: 123,
        top: 0,
        tty: "/dev/pts/1",
        width: 80,
      },
      {
        active: false,
        command: "vim",
        height: 24,
        id: "%4",
        left: 81,
        pid: 456,
        top: 0,
        tty: "/dev/pts/2",
        width: 80,
      },
    ]);

    expect(parseListPanesInWindowOutput(" %3 80 24 1\n %4 60 20 0")).toEqual([
      { active: true, height: 24, id: "%3", width: 80 },
      { active: false, height: 20, id: "%4", width: 60 },
    ]);

    expect(parseListAllPaneIdsOutput(" %3\n %4\n")).toEqual(new Set(["%3", "%4"]));
    expect(parseListWindowPaneIdsOutput(" 2 %8\n 0 %3\n 1 %4")).toEqual(["%3", "%4", "%8"]);
    expect(parsePaneTtyMappingsOutput("/dev/pts/1\t%3\talpha\t@1\n/dev/pts/2\t%4\tbeta\t@2")).toEqual([
      { paneId: "%3", sessionName: "alpha", tty: "/dev/pts/1", windowId: "@1" },
      { paneId: "%4", sessionName: "beta", tty: "/dev/pts/2", windowId: "@2" },
    ]);
  });

  test("parses pane commands for only the requested pane ids", () => {
    const commands = parsePaneCommandsOutput(" %3 bash\n %4 vim\n %5 top", ["%4", "%5"]);
    expect(commands).toEqual(
      new Map([
        ["%4", "vim"],
        ["%5", "top"],
      ]),
    );
  });
});

import { describe, expect, mock, test } from "bun:test";

import { TmuxControlClient, quoteSessionTarget } from "./control-client.ts";
import { quoteTmuxArg } from "./escape.ts";

describe("TmuxControlClient connection guards", () => {
  test("rejects mouse flag queries before connect instead of queueing forever", async () => {
    const client = new TmuxControlClient();

    await expect(client.getActiveMouseAnyFlag()).rejects.toThrow("Client not connected");
  });
});

describe("TmuxControlClient.setClientSize", () => {
  test("sends refresh-client -C on the first call and dedups identical subsequent calls", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.setClientSize({ cols: 120, rows: 40 });
    await client.setClientSize({ cols: 120, rows: 40 });
    await client.setClientSize({ cols: 200, rows: 60 });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, "refresh-client -C 120,40");
    expect(sendCommand).toHaveBeenNthCalledWith(2, "refresh-client -C 200,60");
  });

  test("clamps to the minimum floor before sending", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.setClientSize({ cols: 10, rows: 5 });

    expect(sendCommand).toHaveBeenCalledWith("refresh-client -C 80,24");
  });
});

describe("TmuxControlClient.getSessionInfo", () => {
  test("collects pane-tab markers across all windows in the target session", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (command: string) => {
      if (
        command ===
        `list-windows -t ${quoteTmuxArg("name", "wefwef")} -F ' #{window_id}\t#{window_panes}\t#{window_name}'`
      ) {
        return [
          " @1\t3\tbash",
          " @2\t1\t_hmx_tab",
          " @3\t1\t_hmx_tab",
          " @4\t1\t_hmx_tab",
          " @5\t1\t_hmx_tab",
          " @6\t1\t_hmx_tab",
          " @7\t1\t_hmx_tab",
          " @8\t1\t_hmx_tab",
          " @9\t1\t_hmx_tab",
        ].join("\n");
      }
      if (
        command ===
        "list-panes -a -F ' #{session_name}\t#{pane_id}\t#{window_id}\t#{@hmx-pane-tab-member}\t#{@hmx-pane-tab-active}'"
      ) {
        return [
          " honeymux\t%0\t@0\t\t",
          " wefwef\t%3\t@1\t1\t1",
          " wefwef\t%10\t@1\t1\t1",
          " wefwef\t%11\t@1\t\t",
          " wefwef\t%1\t@2\t1\t",
          " wefwef\t%2\t@3\t1\t",
          " wefwef\t%4\t@4\t1\t",
          " wefwef\t%5\t@5\t1\t",
          " wefwef\t%6\t@6\t1\t",
          " wefwef\t%7\t@7\t1\t",
          " wefwef\t%8\t@8\t1\t",
          " wefwef\t%9\t@9\t1\t",
        ].join("\n");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    const info = await client.getSessionInfo("wefwef");

    expect(info.windowPanes.get("@1")).toBe(3);
    expect(info.paneTabMembers.size).toBe(10);
    expect(info.paneTabActive.size).toBe(2);
    expect(info.paneWindowIds.get("%9")).toBe("@9");
  });
});

describe("TmuxControlClient.listPaneTtyMappings", () => {
  test("uses the control client instead of spawning tmux directly", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (command: string) => {
      if (command === "list-panes -a -F '#{pane_tty}\t#{pane_id}\t#{session_name}\t#{window_id}'") {
        return "/dev/pts/1\t%3\talpha\t@1\n/dev/pts/2\t%4\tbeta\t@2";
      }
      throw new Error(`unexpected command: ${command}`);
    });

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await expect(client.listPaneTtyMappings()).resolves.toEqual([
      { paneId: "%3", sessionName: "alpha", tty: "/dev/pts/1", windowId: "@1" },
      { paneId: "%4", sessionName: "beta", tty: "/dev/pts/2", windowId: "@2" },
    ]);
  });
});

describe("TmuxControlClient.setStatusLeft", () => {
  test("quotes the session target before sending the control-mode command", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    const sessionName = "foo status-left aaa ; display-message PWNED ; set-option -t foo";
    const value = "#[fg=#ff0] !";

    await client.setStatusLeft(sessionName, value);

    expect(sendCommand).toHaveBeenCalledWith(
      `set-option -t ${quoteTmuxArg("sessionName", sessionName)} status-left ${quoteTmuxArg("status-left", value)}`,
    );
  });
});

describe("TmuxControlClient split targeting", () => {
  test("targets horizontal splits to an explicit pane when provided", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.splitHorizontal("%7");

    expect(sendCommand).toHaveBeenCalledWith(`split-window -v -t ${quoteTmuxArg("paneId", "%7")}`);
  });

  test("targets vertical splits to an explicit pane when provided", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.splitVertical("%9");

    expect(sendCommand).toHaveBeenCalledWith(`split-window -h -t ${quoteTmuxArg("paneId", "%9")}`);
  });
});

describe("TmuxControlClient.runCommandArgs", () => {
  test("quotes argv-style commands before sending them to tmux control mode", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.runCommandArgs(["new-window", "-t", "alpha beta", "-c", "/tmp/demo dir", "--", "bash"]);

    expect(sendCommand).toHaveBeenCalledWith(`'new-window' '-t' 'alpha beta' '-c' '/tmp/demo dir' '--' 'bash'`);
  });
});

describe("TmuxControlClient session user options", () => {
  test("sets a session user option with quoted name and value", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.setSessionUserOption("alpha", "@hmx-pane-tabs-v1", '{"groups":[]}');

    expect(sendCommand).toHaveBeenCalledWith(
      `set-option -t ${quoteSessionTarget("sessionName", "alpha")} ${quoteTmuxArg("optionName", "@hmx-pane-tabs-v1")} ${quoteTmuxArg("optionValue", '{"groups":[]}')}`,
    );
  });

  test("returns null when a session user option is unset", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (command: string) => {
      if (
        command ===
        `show-options -qv -t ${quoteSessionTarget("sessionName", "alpha")} ${quoteTmuxArg("optionName", "@hmx-pane-tabs-v1")}`
      ) {
        return "";
      }
      throw new Error(`unexpected command: ${command}`);
    });

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await expect(client.getSessionUserOption("alpha", "@hmx-pane-tabs-v1")).resolves.toBeNull();
  });
});

describe("TmuxControlClient.moveSessionWindowToSession", () => {
  test("quotes both session-scoped targets with a trailing colon", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.moveSessionWindowToSession("source name", "dest name");

    expect(sendCommand).toHaveBeenCalledWith(
      `move-window -s ${quoteSessionTarget("sourceSession", "source name")} -t ${quoteSessionTarget("targetSession", "dest name")}`,
    );
  });
});

describe("TmuxControlClient.getAutomaticRename", () => {
  test("falls back to the global window option when there is no local override", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (command: string) => {
      if (command === `show-options -v -w -t ${quoteTmuxArg("windowId", "@1")} automatic-rename`) return "";
      if (command === "show-options -g -v -w automatic-rename") return "on";
      throw new Error(`unexpected command: ${command}`);
    });

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await expect(client.getAutomaticRename("@1")).resolves.toBe(true);
  });

  test("returns the window-local override when present", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (command: string) => {
      if (command === `show-options -v -w -t ${quoteTmuxArg("windowId", "@3")} automatic-rename`) return "off";
      throw new Error(`unexpected command: ${command}`);
    });

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await expect(client.getAutomaticRename("@3")).resolves.toBe(false);
  });
});

describe("TmuxControlClient format subscriptions", () => {
  test("quotes format subscription arguments before sending refresh-client -B", async () => {
    const client = new TmuxControlClient();
    const sendCommand = mock(async (_command: string) => "");

    (client as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;

    await client.setFormatSubscription("hmx-pane-tab-labels", "%*", "#{pane_current_command}");
    await client.clearFormatSubscription("hmx-pane-tab-labels");

    expect(sendCommand).toHaveBeenNthCalledWith(
      1,
      `refresh-client -B ${quoteTmuxArg("subscription", "hmx-pane-tab-labels:%*:#{pane_current_command}")}`,
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      `refresh-client -B ${quoteTmuxArg("subscription", "hmx-pane-tab-labels")}`,
    );
  });

  test("parses subscription-changed notifications and emits the pane id and value", () => {
    const client = new TmuxControlClient();
    const handler = mock(
      (
        _name: string,
        _sessionId: string,
        _windowId: string,
        _windowIndex: string,
        _paneId: string,
        _value: string,
      ) => {},
    );
    client.on("subscription-changed", handler);

    (client as unknown as { parseLine: (line: string) => void }).parseLine(
      "%subscription-changed hmx-pane-tab-labels $1 @3 1 %7 : claude",
    );

    expect(handler).toHaveBeenCalledWith("hmx-pane-tab-labels", "$1", "@3", "1", "%7", "claude");
  });
});

describe("TmuxControlClient parseLine: %-prefixed response data", () => {
  test("response lines starting with % are accumulated as data, not dropped by the notification catch-all", () => {
    const client = new TmuxControlClient();
    const parseLine = (client as unknown as { parseLine: (line: string) => void }).parseLine.bind(client);

    // Simulate a command response with data lines that start with %
    // (e.g. list-windows output for a session named "%")
    parseLine("%begin 1234 0 0");
    parseLine("%\t@1\t0\tbash\t1");
    parseLine("%\t@2\t1\thtop\t0");

    // Provide a pending command to receive the response
    let resolved = "";
    const pendingQueue = (
      client as unknown as { pendingQueue: Array<{ reject: (e: Error) => void; resolve: (v: string) => void }> }
    ).pendingQueue;
    pendingQueue.push({
      reject: () => {},
      resolve: (v) => {
        resolved = v;
      },
    });

    parseLine("%end 1234 0 0");

    expect(resolved).toBe("%\t@1\t0\tbash\t1\n%\t@2\t1\thtop\t0");
  });
});

describe("quoteSessionTarget", () => {
  test("appends colon to force session:window parse path", () => {
    expect(quoteSessionTarget("s", "mySession")).toBe("'mySession:'");
  });

  test("session names starting with % are safely resolved via trailing colon", () => {
    expect(quoteSessionTarget("s", "%")).toBe("'%:'");
    expect(quoteSessionTarget("s", "%foo")).toBe("'%foo:'");
  });

  test("session names starting with @ are safely resolved via trailing colon", () => {
    expect(quoteSessionTarget("s", "@bar")).toBe("'@bar:'");
  });

  test("session names starting with $ still receive the session-target fallback literal", () => {
    expect(quoteSessionTarget("s", "$")).toBe("'$:'");
  });

  test("handles single quotes in session names", () => {
    expect(quoteSessionTarget("s", "it's")).toBe("'it'\\''s:'");
  });
});

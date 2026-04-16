import { describe, expect, mock, test } from "bun:test";

import {
  RemoteControlClient,
  appendBoundedSshText,
  buildRemoteHookSocketPathProbeCommand,
  finalizeSshText,
  sanitizeSshText,
  truncateSshText,
} from "./remote-control-client.ts";

function createClient(): RemoteControlClient {
  return new RemoteControlClient(
    {
      host: "example-host",
      name: "dev-box",
    },
    "mirror-alpha",
  );
}

describe("RemoteControlClient parser wiring", () => {
  test("emits a dedicated tmux-exit event on protocol exit", () => {
    const client = createClient();
    const onExit = mock(() => {});
    const onTmuxExit = mock(() => {});

    client.on("exit", onExit);
    client.on("tmux-exit", onTmuxExit);

    const parseLine = (client as unknown as { parseLine: (line: string) => void }).parseLine.bind(client);
    (client as unknown as { parser: unknown }).parser = (
      client as unknown as { createParser: () => unknown }
    ).createParser();

    parseLine("%exit");

    expect(onTmuxExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("emits pane output and layout notifications through the shared parser", () => {
    const client = createClient();
    const onPaneOutput = mock((_paneId: string, _data: string) => {});
    const onPaneOutputBytes = mock((_paneId: string, _data: Uint8Array) => {});
    const onLayoutChange = mock((_windowId: string, _layout: string) => {});

    client.on("pane-output", onPaneOutput);
    client.on("pane-output-bytes", onPaneOutputBytes);
    client.on("layout-change", onLayoutChange);

    const parseLine = (client as unknown as { parseLine: (line: string) => void }).parseLine.bind(client);
    (client as unknown as { parser: unknown }).parser = (
      client as unknown as { createParser: () => unknown }
    ).createParser();

    parseLine(String.raw`%output %7 hello\040world`);
    parseLine("%layout-change @3 layout-xyz");

    expect(onPaneOutput).toHaveBeenCalledWith("%7", "hello world");
    expect(onPaneOutputBytes).toHaveBeenCalledWith("%7", Uint8Array.from(Buffer.from("hello world")));
    expect(onLayoutChange).toHaveBeenCalledWith("@3", "layout-xyz");
  });

  test("adds a stream-local remote hook forward when configured", () => {
    const client = new RemoteControlClient(
      {
        host: "example-host",
        name: "dev-box",
      },
      "mirror-alpha",
      { localSocketPath: "/tmp/hmx-local.sock" },
    );

    (client as unknown as { resolvedRemoteHookSocketPath: string }).resolvedRemoteHookSocketPath =
      "/home/dev/.local/state/honeymux/runtime/hmx-remote.sock";

    const args = (client as unknown as { buildSshArgs: (includeHookForward?: boolean) => string[] }).buildSshArgs(true);

    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toContain("-R");
    expect(args).toContain("/home/dev/.local/state/honeymux/runtime/hmx-remote.sock:/tmp/hmx-local.sock");
    expect(args).toContain("StreamLocalBindUnlink=yes");
  });

  test("builds a remote hook path probe command without escaping shell expansion", () => {
    const command = buildRemoteHookSocketPathProbeCommand("hmx-remote-hook.sock");

    expect(command).toContain("${XDG_STATE_HOME:-$HOME/.local/state}");
    expect(command).toContain('rm -f "$runtime/$1"');
    expect(command).toContain("hmx-remote-hook.sock");
    expect(command).not.toContain("\\${XDG_STATE_HOME:-$HOME/.local/state}");
  });

  test("sanitizes SSH stderr text before display", () => {
    expect(sanitizeSshText("bad\tline\n\x1b[31mwarn\x1b[0m\u0007")).toBe("bad line warn");
  });

  test("bounds retained SSH stderr and marks truncation", () => {
    expect(appendBoundedSshText("abcd", "efgh", 6)).toEqual({
      text: "cdefgh",
      wasTruncated: true,
    });
    expect(finalizeSshText("cdefgh", true)).toBe("[truncated] cdefgh");
  });

  test("caps warning text length after sanitization", () => {
    expect(truncateSshText("abc\n\tdef", 6)).toBe("abc d…");
  });
});

import { describe, expect, mock, test } from "bun:test";

import {
  RemoteControlClient,
  appendBoundedSshText,
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

  test("adds a TCP remote hook forward when configured", () => {
    const client = new RemoteControlClient(
      {
        host: "example-host",
        name: "dev-box",
      },
      "mirror-alpha",
      { localTcpPort: 51234 },
    );

    const args = (client as unknown as { buildSshArgs: (includeHookForward?: boolean) => string[] }).buildSshArgs(true);

    expect(args).toContain("-R");
    expect(args).toContain("127.0.0.1:0:127.0.0.1:51234");
    expect(args).not.toContain("StreamLocalBindUnlink=yes");
    expect(args).not.toContain("ExitOnForwardFailure=yes");
  });

  test("captures the remote forward port from ssh stderr", () => {
    const client = new RemoteControlClient(
      {
        host: "example-host",
        name: "dev-box",
      },
      "mirror-alpha",
      { localTcpPort: 51234 },
    );

    const internals = client as unknown as {
      maybeCaptureAllocatedPort: (chunk: string) => void;
      remoteHookTcpPort: number | undefined;
    };

    internals.maybeCaptureAllocatedPort("Allocated port ");
    internals.maybeCaptureAllocatedPort("46157 for remote forward to 127.0.0.1:51234\n");

    expect(client.remoteHookTcpPort).toBe(46157);
  });

  test("emits hook-port-resolved when the allocated port is captured", () => {
    const client = new RemoteControlClient(
      {
        host: "example-host",
        name: "dev-box",
      },
      "mirror-alpha",
      { localTcpPort: 51234 },
    );

    const onResolved = mock((_port: number) => {});
    client.on("hook-port-resolved", onResolved);

    const detect = (
      client as unknown as { maybeCaptureAllocatedPort: (chunk: string) => void }
    ).maybeCaptureAllocatedPort.bind(client);
    detect("Allocated port 46157 for remote forward to 127.0.0.1:51234\n");
    detect("Allocated port 46158 for remote forward to 127.0.0.1:51234\n");

    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(46157);
  });

  test("clears hookForwardingRejected on reconnect so a fresh -R is attempted", () => {
    const client = new RemoteControlClient(
      {
        host: "example-host",
        name: "dev-box",
      },
      "mirror-alpha",
      { localTcpPort: 51234 },
    );

    const internals = client as unknown as {
      maybeMarkHookForwardingFailure: (chunk: string) => void;
      resetConnectionState: () => void;
    };
    internals.maybeMarkHookForwardingFailure("remote port forwarding failed for listen port 0\n");
    expect(client.hookForwardingRejected).toBe(true);
    expect(
      (client as unknown as { buildSshArgs: (includeHookForward?: boolean) => string[] }).buildSshArgs(true),
    ).not.toContain("-R");

    internals.resetConnectionState();

    expect(client.hookForwardingRejected).toBe(false);
    expect(
      (client as unknown as { buildSshArgs: (includeHookForward?: boolean) => string[] }).buildSshArgs(true),
    ).toContain("-R");
  });

  test("disables the remote hook forward after the server rejects port forwarding", () => {
    const client = new RemoteControlClient(
      {
        host: "example-host",
        name: "dev-box",
      },
      "mirror-alpha",
      { localTcpPort: 51234 },
    );

    const onWarning = mock((_message: string) => {});
    client.on("warning", onWarning);

    const detect = (
      client as unknown as { maybeMarkHookForwardingFailure: (chunk: string) => void }
    ).maybeMarkHookForwardingFailure.bind(client);
    detect("remote port forwarding failed for listen port 0\n");
    detect("remote port forwarding failed for listen port 0\n");

    expect(client.hookForwardingRejected).toBe(true);
    expect(onWarning).toHaveBeenCalledTimes(1);

    const args = (client as unknown as { buildSshArgs: (includeHookForward?: boolean) => string[] }).buildSshArgs(true);
    expect(args).not.toContain("-R");
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

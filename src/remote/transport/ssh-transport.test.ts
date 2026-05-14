import { describe, expect, mock, test } from "bun:test";

import {
  SshTransport,
  appendBoundedSshText,
  finalizeSshText,
  sanitizeSshText,
  truncateSshText,
} from "./ssh-transport.ts";

function makeTransport(hookPort?: number, _unused?: string): SshTransport {
  const hookForward = hookPort !== undefined ? { localTcpPort: hookPort } : undefined;
  return new SshTransport(
    {
      host: "example-host",
      name: "dev-box",
    },
    "honeymux-test",
    hookForward,
  );
}

describe("SshTransport buildSshArgs", () => {
  test("adds TCP `-R 127.0.0.1:0:127.0.0.1:<port>` when hookForward is set", () => {
    const transport = makeTransport(45678, "tok");
    const args = (transport as unknown as { buildSshArgs: (includeHookForward: boolean) => string[] }).buildSshArgs(
      true,
    );

    expect(args).toContain("-R");
    expect(args).toContain("127.0.0.1:0:127.0.0.1:45678");
    expect(args).not.toContain("ExitOnForwardFailure=yes");
    expect(args).not.toContain("StreamLocalBindUnlink=yes");
  });

  test("omits `-R` when no hookForward is configured", () => {
    const transport = makeTransport();
    const args = (transport as unknown as { buildSshArgs: (includeHookForward: boolean) => string[] }).buildSshArgs(
      true,
    );

    expect(args).not.toContain("-R");
  });

  test("omits `-R` once forwarding has been rejected, even with hookForward configured", () => {
    const transport = makeTransport(45678, "tok");
    (transport as unknown as { _hookForwardingFailed: boolean })._hookForwardingFailed = true;

    const args = (transport as unknown as { buildSshArgs: (includeHookForward: boolean) => string[] }).buildSshArgs(
      true,
    );

    expect(args).not.toContain("-R");
  });
});

describe("SshTransport stderr parsing", () => {
  test("captures the sshd-allocated remote forward port from stderr", () => {
    const transport = makeTransport(45678, "tok");
    const onPort = mock((_port: number) => {});
    transport.onHookPortResolved(onPort);

    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "Allocated port 23456 for remote forward to 127.0.0.1:45678\n",
    );

    expect(transport.hookTcpPort).toBe(23456);
    expect(onPort).toHaveBeenCalledWith(23456);
  });

  test("reassembles a port-allocation message split across chunks", () => {
    const transport = makeTransport(45678, "tok");
    const onPort = mock((_port: number) => {});
    transport.onHookPortResolved(onPort);

    const proc = transport as unknown as { processStderrChunk: (chunk: string) => void };
    proc.processStderrChunk("Allocated port 234");
    expect(transport.hookTcpPort).toBeUndefined();
    proc.processStderrChunk("56 for remote forward to 127.0.0.1:45678\n");

    expect(transport.hookTcpPort).toBe(23456);
    expect(onPort).toHaveBeenCalledTimes(1);
  });

  test("only captures the first allocated-port occurrence per start", () => {
    const transport = makeTransport(45678, "tok");
    const onPort = mock((_port: number) => {});
    transport.onHookPortResolved(onPort);

    const proc = transport as unknown as { processStderrChunk: (chunk: string) => void };
    proc.processStderrChunk("Allocated port 11111 for remote forward to 127.0.0.1:45678\n");
    proc.processStderrChunk("Allocated port 22222 for remote forward to 127.0.0.1:45678\n");

    expect(transport.hookTcpPort).toBe(11111);
    expect(onPort).toHaveBeenCalledTimes(1);
  });

  test("rejects out-of-range port numbers", () => {
    const transport = makeTransport(45678, "tok");
    const onPort = mock((_port: number) => {});
    transport.onHookPortResolved(onPort);

    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "Allocated port 65536 for remote forward to 127.0.0.1:45678\n",
    );

    expect(transport.hookTcpPort).toBeUndefined();
    expect(onPort).not.toHaveBeenCalled();
  });

  test("ignores allocated-port announcements for unrelated forwards (e.g. user ssh_config RemoteForward)", () => {
    const transport = makeTransport(45678, "tok");
    const onPort = mock((_port: number) => {});
    transport.onHookPortResolved(onPort);

    const proc = transport as unknown as { processStderrChunk: (chunk: string) => void };
    // User's ssh_config has its own RemoteForward 0:somewhere:2222 — sshd
    // announces a port for that first. The destination doesn't match our
    // local hook port so we must NOT bind to it.
    proc.processStderrChunk("Allocated port 11111 for remote forward to other.example:2222\n");
    expect(transport.hookTcpPort).toBeUndefined();

    // Now our own forward is announced with the correct destination.
    proc.processStderrChunk("Allocated port 23456 for remote forward to 127.0.0.1:45678\n");
    expect(transport.hookTcpPort).toBe(23456);
    expect(onPort).toHaveBeenCalledTimes(1);
    expect(onPort).toHaveBeenCalledWith(23456);
  });

  test("persists hookForwardingRejected across reconnects via constructor flag", () => {
    const transport = new SshTransport({ host: "example", name: "dev" }, "honeymux-test", {
      localTcpPort: 45678,
      rejected: true,
    });

    expect(transport.hookForwardingRejected).toBe(true);
    const args = (transport as unknown as { buildSshArgs: (includeHookForward: boolean) => string[] }).buildSshArgs(
      true,
    );
    expect(args).not.toContain("-R");
  });

  test("fires onForwardingRejected synchronously when the rejection pattern is parsed", () => {
    const transport = makeTransport(45678, "tok");
    const onRejected = mock(() => {});
    transport.onForwardingRejected(onRejected);

    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "Warning: remote port forwarding failed for listen port 23456\n",
    );

    // Synchronous: handler must have run BEFORE we observe the getter.
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(transport.hookForwardingRejected).toBe(true);
  });

  test("flags forwarding as rejected when stderr matches the OpenSSH rejection pattern", () => {
    const transport = makeTransport(45678, "tok");
    const onWarning = mock((_msg: string) => {});
    transport.onWarning(onWarning);

    expect(transport.hookForwardingRejected).toBe(false);
    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "Warning: remote port forwarding failed for listen port 23456\n",
    );

    expect(transport.hookForwardingRejected).toBe(true);
    expect(onWarning).toHaveBeenCalled();
  });

  test("rejection pattern detection still works for the stream-local error variant", () => {
    const transport = makeTransport(45678, "tok");
    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "remote port forwarding failed for listen path /tmp/socket\n",
    );

    expect(transport.hookForwardingRejected).toBe(true);
  });

  test("does not flag rejection when no hookForward is configured", () => {
    const transport = makeTransport();
    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "remote port forwarding failed for listen port 1234\n",
    );

    expect(transport.hookForwardingRejected).toBe(false);
  });

  test("ignores rejection messages that arrive AFTER our forward was successfully allocated", () => {
    const transport = makeTransport(45678, "tok");
    const onRejected = mock(() => {});
    transport.onForwardingRejected(onRejected);

    const proc = transport as unknown as { processStderrChunk: (chunk: string) => void };
    // First, our own forward is successfully allocated.
    proc.processStderrChunk("Allocated port 23456 for remote forward to 127.0.0.1:45678\n");
    expect(transport.hookTcpPort).toBe(23456);

    // Now a user-config RemoteForward fails. That must NOT poison our state.
    proc.processStderrChunk("Warning: remote port forwarding failed for listen port 9999\n");

    expect(transport.hookForwardingRejected).toBe(false);
    expect(onRejected).not.toHaveBeenCalled();
  });

  test("reassembles rejection messages split across stderr chunks", () => {
    const transport = makeTransport(45678, "tok");
    const onRejected = mock(() => {});
    transport.onForwardingRejected(onRejected);

    const proc = transport as unknown as { processStderrChunk: (chunk: string) => void };
    proc.processStderrChunk("Warning: remote port for");
    expect(transport.hookForwardingRejected).toBe(false);
    proc.processStderrChunk("warding failed for listen port 0\n");

    expect(transport.hookForwardingRejected).toBe(true);
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  test("preserves stderr line order within a single chunk (user-config rejection then our allocation)", () => {
    const transport = makeTransport(45678, "tok");
    const onRejected = mock(() => {});
    transport.onForwardingRejected(onRejected);

    // sshd processes -R requests in order. If a user-config RemoteForward
    // (also `listen port 0` with a different destination) is rejected before
    // our own request is honored, both messages can arrive in one stderr
    // read. The destination check in the allocation pattern means the
    // rejection line trips our sticky bit before we can prove the rejection
    // belonged to someone else — a known limitation. This test pins the
    // current behaviour so any future change is intentional.
    (transport as unknown as { processStderrChunk: (chunk: string) => void }).processStderrChunk(
      "Warning: remote port forwarding failed for listen port 0\nAllocated port 23456 for remote forward to 127.0.0.1:45678\n",
    );

    expect(transport.hookForwardingRejected).toBe(true);
    expect(onRejected).toHaveBeenCalledTimes(1);
    // We still capture our own allocated port, so the local proxy still works
    // for any process that connects to it before the option is cleared.
    expect(transport.hookTcpPort).toBe(23456);
  });
});

describe("SSH stderr text helpers", () => {
  test("sanitizes stderr text before display", () => {
    expect(sanitizeSshText("bad\tline\n\x1b[31mwarn\x1b[0m")).toBe("bad line warn");
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

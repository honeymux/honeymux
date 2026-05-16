import { describe, expect, test } from "bun:test";

import { RemoteControlClient } from "./remote-control-client.ts";

function createClient(hookForward?: { authToken: string; localTcpPort: number }): RemoteControlClient {
  return new RemoteControlClient(
    {
      host: "example-host",
      name: "dev-box",
    },
    "mirror-alpha",
    hookForward,
  );
}

describe("RemoteControlClient facade", () => {
  test("isConnected is false before any connection", () => {
    const client = createClient();
    expect(client.isConnected).toBe(false);
  });

  test("hookAuthToken reflects the configured token", () => {
    const client = createClient({ authToken: "secret123", localTcpPort: 9000 });
    expect(client.hookAuthToken).toBe("secret123");
  });

  test("hookAuthToken is undefined when no forward configured", () => {
    const client = createClient();
    expect(client.hookAuthToken).toBeUndefined();
  });

  test("hookForwardingRejected defaults to false before any transport is active", () => {
    const client = createClient({ authToken: "tok", localTcpPort: 9000 });
    expect(client.hookForwardingRejected).toBe(false);
  });

  test("remoteHookTcpPort is undefined before any transport is active", () => {
    const client = createClient({ authToken: "tok", localTcpPort: 9000 });
    expect(client.remoteHookTcpPort).toBeUndefined();
  });

  test("sendCommand rejects when client has not been started", async () => {
    const client = createClient();
    await expect(client.sendCommand("list-sessions")).rejects.toThrow();
  });

  test("destroy is idempotent and stops a never-started client cleanly", () => {
    const client = createClient();
    client.destroy();
    client.destroy();
    expect(client.isConnected).toBe(false);
  });
});

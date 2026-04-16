import { describe, expect, it } from "bun:test";

import { configRemoteServersToDraft } from "./config-helpers.ts";

describe("configRemoteServersToDraft", () => {
  it("preserves agent forwarding flags from persisted config", () => {
    expect(
      configRemoteServersToDraft({
        remote: [
          { agentForwarding: true, host: "example.com", name: "alpha" },
          { host: "example.net", name: "beta" },
        ],
      } as any),
    ).toEqual([
      { agentForwarding: true, host: "example.com", name: "alpha" },
      { agentForwarding: undefined, host: "example.net", name: "beta" },
    ]);
  });

  it("returns an empty list when no remotes are configured", () => {
    expect(configRemoteServersToDraft({} as any)).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import { getRemoteConfigKey, shouldStartRemoteManager } from "./use-remote-manager.ts";

describe("remote manager helpers", () => {
  test("only starts when connected and remotes are configured", () => {
    expect(shouldStartRemoteManager(false, [{ host: "dev-box", name: "dev" }])).toBe(false);
    expect(shouldStartRemoteManager(true, undefined)).toBe(false);
    expect(shouldStartRemoteManager(true, [])).toBe(false);
    expect(shouldStartRemoteManager(true, [{ host: "dev-box", name: "dev" }])).toBe(true);
  });

  test("serializes remote configs into a stable lifecycle key", () => {
    expect(getRemoteConfigKey(undefined)).toBe("null");
    expect(getRemoteConfigKey([{ agentForwarding: true, host: "dev-box", name: "dev" }])).toBe(
      '[{"agentForwarding":true,"host":"dev-box","name":"dev"}]',
    );
  });
});

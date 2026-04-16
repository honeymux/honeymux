import { describe, expect, test } from "bun:test";

import { defaultConfig, mergeLoadedConfig, serializeConfigForSave, validateConfig } from "./config.ts";

describe("config", () => {
  test("defaults local OSC passthrough policies", () => {
    expect(defaultConfig().policyLocalOsc52Passthrough).toBe("write-only");
    expect(defaultConfig().policyLocalOtherOscPassthrough).toBe("allow");
  });

  test("defaults to the built-in dracula theme selection", () => {
    expect(defaultConfig().themeBuiltin).toBe("dracula");
    expect(defaultConfig().themeMode).toBe("built-in");
  });

  test("defaults metaSavedAt to 0", () => {
    expect(defaultConfig().metaSavedAt).toBe(0);
  });

  test("accepts valid OSC passthrough values", () => {
    expect(
      validateConfig({
        ...defaultConfig(),
        policyLocalOsc52Passthrough: "all",
        policyLocalOtherOscPassthrough: "off",
      }),
    ).toBeNull();
  });

  test("accepts valid theme selection values", () => {
    expect(validateConfig({ ...defaultConfig(), themeBuiltin: "catppuccin-mocha", themeMode: "built-in" })).toBeNull();
    expect(validateConfig({ ...defaultConfig(), themeMode: "custom" })).toBeNull();
  });

  test("accepts valid tmuxPrefixKeyAlias values", () => {
    expect(validateConfig({ ...defaultConfig(), tmuxPrefixKeyAlias: "right_shift" })).toBeNull();
  });

  test("merges loaded config values onto defaults", () => {
    expect(
      mergeLoadedConfig({
        policyLocalOsc52Passthrough: "all",
      }).policyLocalOsc52Passthrough,
    ).toBe("all");
    expect(
      mergeLoadedConfig({
        policyLocalOtherOscPassthrough: "off",
      }).policyLocalOtherOscPassthrough,
    ).toBe("off");
  });

  test("preserves persisted remote servers when merging loaded config", () => {
    expect(
      mergeLoadedConfig({
        remote: [{ agentForwarding: true, host: "dev-box", name: "dev" }],
      }).remote,
    ).toEqual([{ agentForwarding: true, host: "dev-box", name: "dev" }]);
  });

  test("ignores unknown loaded config keys", () => {
    const merged = mergeLoadedConfig({
      policyOsc52Passthrough: "all",
    } as any);
    expect(Object.hasOwn(merged, "policyOsc52Passthrough")).toBe(false);
    expect(merged.policyLocalOsc52Passthrough).toBe("write-only");
  });

  test("serializes config with sorted keys and a replaced save timestamp", () => {
    const config = {
      ...defaultConfig(),
      metaSavedAt: 1,
      remote: [{ host: "dev-box", name: "dev" }],
    };
    const serialized = serializeConfigForSave(config, 1234);
    const parsed = JSON.parse(serialized) as ReturnType<typeof defaultConfig>;
    const keys = Object.keys(parsed);

    expect(parsed.metaSavedAt).toBe(1234);
    expect(parsed.remote).toEqual([{ host: "dev-box", name: "dev" }]);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  test("rejects invalid local OSC52 passthrough values", () => {
    expect(validateConfig({ ...defaultConfig(), policyLocalOsc52Passthrough: "maybe" as any })).toContain(
      "Invalid policyLocalOsc52Passthrough",
    );
  });

  test("rejects invalid local other-OSC passthrough values", () => {
    expect(validateConfig({ ...defaultConfig(), policyLocalOtherOscPassthrough: "maybe" as any })).toContain(
      "Invalid policyLocalOtherOscPassthrough",
    );
  });

  test("rejects invalid theme selection values", () => {
    expect(validateConfig({ ...defaultConfig(), themeMode: "maybe" as any })).toContain("Invalid themeMode");
    expect(validateConfig({ ...defaultConfig(), themeBuiltin: "custom" as any })).toContain("Invalid themeBuiltin");
  });

  test("rejects invalid tmuxPrefixKeyAlias values", () => {
    expect(validateConfig({ ...defaultConfig(), tmuxPrefixKeyAlias: "enter" as any })).toContain(
      "Invalid tmuxPrefixKeyAlias",
    );
  });
});

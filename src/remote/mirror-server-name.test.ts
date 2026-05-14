import { describe, expect, test } from "bun:test";

import { deriveMirrorTmuxServerName } from "./mirror-server-name.ts";

describe("deriveMirrorTmuxServerName", () => {
  test("combines short hostname and start_time", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "laptop.local",
      getStartTime: async () => "1715000000",
    });
    expect(name).toBe("honeymux-laptop-1715000000");
  });

  test("uses only the first dot-segment of the hostname", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "host.sub.example.com",
      getStartTime: async () => "42",
    });
    expect(name).toBe("honeymux-host-42");
  });

  test("strips characters outside [A-Za-z0-9._-]", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "wei$rd!name",
      getStartTime: async () => "100",
    });
    expect(name).toBe("honeymux-weirdname-100");
  });

  test("truncates very long hostnames to 24 chars", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "a".repeat(80),
      getStartTime: async () => "9",
    });
    expect(name).toBe(`honeymux-${"a".repeat(24)}-9`);
  });

  test("omits hostname when sanitization yields empty string", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "!!!",
      getStartTime: async () => "7",
    });
    expect(name).toBe("honeymux-7");
  });

  test("omits start_time when null", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "laptop",
      getStartTime: async () => null,
    });
    expect(name).toBe("honeymux-laptop");
  });

  test("falls back to honeymux-bridge when both components are missing", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "",
      getStartTime: async () => null,
    });
    expect(name).toBe("honeymux-bridge");
  });

  test("treats whitespace-only hostname as missing", async () => {
    const name = await deriveMirrorTmuxServerName({
      getHostname: () => "   ",
      getStartTime: async () => "11",
    });
    expect(name).toBe("honeymux-11");
  });
});

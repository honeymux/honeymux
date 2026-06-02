import { describe, expect, it } from "bun:test";

import { STAGING_PLACEHOLDER_NAME, isManagedTabWindow } from "./tab-window-marker.ts";

describe("isManagedTabWindow", () => {
  it("treats windows carrying the @hmx-tab-window marker as staging", () => {
    expect(isManagedTabWindow({ name: "editor", tabWindow: true })).toBe(true);
  });

  it("treats freshly created placeholder windows as staging before the marker lands", () => {
    expect(isManagedTabWindow({ name: STAGING_PLACEHOLDER_NAME, tabWindow: false })).toBe(true);
  });

  it("leaves ordinary windows visible even when their name matches a tab label", () => {
    expect(isManagedTabWindow({ name: "editor", tabWindow: false })).toBe(false);
    expect(isManagedTabWindow({ name: "main" })).toBe(false);
  });
});

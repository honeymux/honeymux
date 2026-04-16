import { describe, expect, test } from "bun:test";

import { AGENT_CURSOR_COLOR_SWATCH } from "./options-dialog-setting-row.tsx";

describe("options dialog setting row helpers", () => {
  test("uses real block glyphs for the agent cursor color swatch", () => {
    expect(AGENT_CURSOR_COLOR_SWATCH).toBe("██");
    expect(AGENT_CURSOR_COLOR_SWATCH).not.toBe("\\u2588\\u2588");
  });
});

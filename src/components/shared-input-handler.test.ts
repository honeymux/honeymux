import { describe, expect, test } from "bun:test";

import { claimSharedInputHandler, releaseSharedInputHandler } from "./shared-input-handler.ts";

describe("shared input handler helpers", () => {
  test("claims and releases the shared handler while ownership is unchanged", () => {
    const sharedRef: { current: null | string } = { current: null };
    const ownerRef: { current: null | string } = { current: null };

    const cleanup = claimSharedInputHandler(sharedRef, ownerRef, "rename");

    expect(sharedRef.current).toBe("rename");
    expect(ownerRef.current).toBe("rename");

    cleanup();

    expect(sharedRef.current).toBeNull();
    expect(ownerRef.current).toBeNull();
  });

  test("cleanup does not clear a newer shared handler", () => {
    const sharedRef: { current: null | string } = { current: null };
    const firstOwnerRef: { current: null | string } = { current: null };
    const secondOwnerRef: { current: null | string } = { current: null };

    const cleanup = claimSharedInputHandler(sharedRef, firstOwnerRef, "menu");
    claimSharedInputHandler(sharedRef, secondOwnerRef, "rename");

    cleanup();

    expect(sharedRef.current).toBe("rename");
    expect(firstOwnerRef.current).toBeNull();
    expect(secondOwnerRef.current).toBe("rename");
  });

  test("release clears the currently owned handler immediately", () => {
    const sharedRef: { current: null | string } = { current: null };
    const ownerRef: { current: null | string } = { current: null };

    claimSharedInputHandler(sharedRef, ownerRef, "rename");
    releaseSharedInputHandler(sharedRef, ownerRef);

    expect(sharedRef.current).toBeNull();
    expect(ownerRef.current).toBeNull();
  });
});

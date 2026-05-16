import { describe, expect, test } from "bun:test";

import { EMPTY_PENDING_VIEW, PendingMappings } from "./pending-mappings.ts";

describe("PendingMappings", () => {
  test("hold registers a pairing visible in both directions", () => {
    const pending = new PendingMappings();
    pending.hold("%10", "%200");
    const view = pending.view();
    expect(view.localToRemote.get("%10")).toBe("%200");
    expect(view.remoteToLocal.get("%200")).toBe("%10");
  });

  test("released holds disappear from both maps", () => {
    const pending = new PendingMappings();
    const release = pending.hold("%10", "%200");
    release();
    const view = pending.view();
    expect(view.localToRemote.size).toBe(0);
    expect(view.remoteToLocal.size).toBe(0);
  });

  test("maintains bijection when a local pane is re-pointed to a new remote", () => {
    // Same local %10 is paired first with %200, then re-paired with %201
    // (e.g. revert-then-reconvert during a hand-off). The stale
    // remoteToLocal[%200] = %10 entry MUST be evicted, otherwise the
    // reconciler would pair %200 with %10 via the pending overlay even
    // though %200 no longer represents the pending peer.
    const pending = new PendingMappings();
    pending.hold("%10", "%200");
    pending.hold("%10", "%201");
    const view = pending.view();
    expect(view.localToRemote.get("%10")).toBe("%201");
    expect(view.remoteToLocal.get("%200")).toBeUndefined();
    expect(view.remoteToLocal.get("%201")).toBe("%10");
  });

  test("maintains bijection when a remote pane is re-pointed to a new local", () => {
    // Conversely: same remote %200 re-paired from local %10 to local %11.
    const pending = new PendingMappings();
    pending.hold("%10", "%200");
    pending.hold("%11", "%200");
    const view = pending.view();
    expect(view.localToRemote.get("%10")).toBeUndefined();
    expect(view.localToRemote.get("%11")).toBe("%200");
    expect(view.remoteToLocal.get("%200")).toBe("%11");
  });

  test("releasing an out-of-date hold does not delete the new pairing", () => {
    // First release call (for %10 → %200) fires AFTER %10 has been re-held
    // for %201. The release must not delete the new entry.
    const pending = new PendingMappings();
    const release1 = pending.hold("%10", "%200");
    pending.hold("%10", "%201");
    release1();
    const view = pending.view();
    expect(view.localToRemote.get("%10")).toBe("%201");
    expect(view.remoteToLocal.get("%201")).toBe("%10");
  });

  test("view() returns a frozen, defensive snapshot", () => {
    const pending = new PendingMappings();
    pending.hold("%10", "%200");
    const view = pending.view();
    // Mutating the underlying class state must not affect the captured view.
    pending.hold("%10", "%201");
    expect(view.localToRemote.get("%10")).toBe("%200");
    expect(view.remoteToLocal.get("%200")).toBe("%10");
    // The view itself is frozen.
    expect(Object.isFrozen(view)).toBe(true);
  });

  test("EMPTY_PENDING_VIEW is a usable, empty, frozen view", () => {
    expect(Object.isFrozen(EMPTY_PENDING_VIEW)).toBe(true);
    expect(EMPTY_PENDING_VIEW.localToRemote.size).toBe(0);
    expect(EMPTY_PENDING_VIEW.remoteToLocal.size).toBe(0);
  });
});

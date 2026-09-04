import { describe, expect, it } from "vitest";

import { getOrCreateVisitorId, type StorageLike } from "./identity";

function fakeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("getOrCreateVisitorId", () => {
  it("mints an id on first call", () => {
    const id = getOrCreateVisitorId(fakeStorage(), "channel-1");
    expect(id).toMatch(/.+/);
  });

  it("persists across a simulated reload (same storage, called again)", () => {
    const storage = fakeStorage();
    const first = getOrCreateVisitorId(storage, "channel-1");

    // A "reload" is a fresh page load reading the same persistent storage —
    // there is no other state in this module, so calling again against the
    // same storage instance *is* the reload.
    const second = getOrCreateVisitorId(storage, "channel-1");

    expect(second).toBe(first);
  });

  it("keeps ids separate per channel", () => {
    const storage = fakeStorage();
    const a = getOrCreateVisitorId(storage, "channel-a");
    const b = getOrCreateVisitorId(storage, "channel-b");
    expect(a).not.toBe(b);
  });

  it("mints a fresh id each time when storage never persists (private mode)", () => {
    // A storage that "forgets" everything models blocked/unavailable storage.
    const forgetful: StorageLike = { getItem: () => null, setItem: () => {} };
    const first = getOrCreateVisitorId(forgetful, "channel-1");
    const second = getOrCreateVisitorId(forgetful, "channel-1");
    expect(second).not.toBe(first);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { limitCommandKeys, scopedCommandKeys } from "../app/features/tools/command-keys.ts";

test("failed assistant command identities survive remount only within the same account and scope", () => {
  const firstMount = scopedCommandKeys("csrf-a", "session-1", 1);
  firstMount.set("same-input-without-quote-id", "submit-id");
  const nextMount = scopedCommandKeys("csrf-a", "session-1", 2);
  assert.equal(nextMount.get("same-input-without-quote-id"), "submit-id");
  assert.equal(scopedCommandKeys("csrf-b", "session-1", 2).size, 0);
  assert.equal(scopedCommandKeys("csrf-a", "session-2", 2).size, 0);
  nextMount.delete("same-input-without-quote-id");
  assert.equal(scopedCommandKeys("csrf-a", "session-1", 3).size, 0);
});

test("private in-memory command identities expire and have bounded capacity", () => {
  const keys = scopedCommandKeys("expiry-user", "expiry-scope", 1);
  keys.set("old", "old-id");
  assert.equal(scopedCommandKeys("expiry-user", "expiry-scope", 24 * 60 * 60 * 1000 + 2).size, 0);
  for (let index = 0; index < 100; index++) keys.set(String(index), String(index));
  limitCommandKeys(keys);
  assert.equal(keys.size, 16);
  assert.equal(keys.has("99"), true);
  assert.equal(keys.has("0"), false);
  const oldest = scopedCommandKeys("capacity-user", "scope-0", 100000000);
  oldest.set("old", "old-id");
  for (let index = 1; index <= 32; index++) scopedCommandKeys("capacity-user", `scope-${index}`, 100000000 + index);
  assert.equal(scopedCommandKeys("capacity-user", "scope-0", 100000100).size, 0);
});

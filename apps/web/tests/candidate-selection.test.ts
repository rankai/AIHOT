import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateSelectionValid } from "../app/features/admin/candidate-selection.ts";

test("a previously selected source cannot be submitted during a replacement search or after its empty result", () => {
  const rows = [{ id: "ui-mp-synthetic" }];
  assert.equal(candidateSelectionValid("ui-mp-synthetic", "idle", "mp_account", "mp_account", rows), true);
  assert.equal(candidateSelectionValid("ui-mp-synthetic", "loading", "mp_account", "mp_account", rows), false);
  assert.equal(candidateSelectionValid("ui-mp-synthetic", "idle", "mp_account", "mp_account", []), false);
});
test("binding choices stay within their displayed candidate kind and page", () => {
  assert.equal(candidateSelectionValid("source-a", "idle", "mp_account", "external", [{ id: "source-a" }]), false);
  assert.equal(candidateSelectionValid("source-a", "idle", "external", "external", [{ id: "source-b" }]), false);
  assert.equal(candidateSelectionValid("", "idle", "external", "external", [{ id: "source-a" }]), false);
  assert.equal(candidateSelectionValid("source-b", "idle", "external", "external", [{ id: "source-b" }]), true);
});

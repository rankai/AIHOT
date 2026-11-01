import assert from "node:assert/strict";
import { test } from "node:test";
import { sendsOnEnter } from "../app/features/assistant/composer-keyboard.ts";
test("desktop Enter sends, but IME confirmation, Shift Enter and touch keyboards retain input", () => {
  const enter = { key: "Enter", shiftKey: false, keyCode: 13, isComposing: false };
  assert.equal(sendsOnEnter(enter, false, false), true);
  for (const event of [{ ...enter, shiftKey: true }, { ...enter, keyCode: 229 }, { ...enter, isComposing: true }, { ...enter, key: "a" }]) assert.equal(sendsOnEnter(event, false, false), false);
  assert.equal(sendsOnEnter(enter, true, false), false);
  assert.equal(sendsOnEnter(enter, false, true), false);
});

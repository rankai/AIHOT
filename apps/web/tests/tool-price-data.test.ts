import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePriceMatch, priceMatchRows } from "../app/features/admin/tool-price-data.ts";

test("price conditions preserve exact scalar types including false and zero", () => {
  const match = { "parameters.count": 20, "generateAudio": false, "metadata.resolution": "1K", n: 0, text: "  exact  " };
  assert.deepEqual(parsePriceMatch(priceMatchRows(match)), match);
  assert.deepEqual(parsePriceMatch([]), {});
});

test("price condition editor refuses duplicate, missing and unsafe values", () => {
  for (const key of ["", "parameters..size", "__proto__", "parameters.constructor", "parameters.prototype"]) {
    assert.throws(() => parsePriceMatch([{ key, type: "string", value: "x" }]));
  }
  assert.throws(() => parsePriceMatch([{ key: "n", type: "number", value: "" }]));
  assert.throws(() => parsePriceMatch([{ key: "n", type: "number", value: "Infinity" }]));
  assert.throws(() => parsePriceMatch([{ key: "generateAudio", type: "boolean", value: "no" }]));
  assert.throws(() => parsePriceMatch([{ key: "n", type: "number", value: "1" }, { key: "n", type: "string", value: "1" }]));
});

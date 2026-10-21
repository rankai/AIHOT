import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";

test("multipart retries preserve file identity while separate identical file selections differ", () => {
  const file = new File(["abc"], "same.png", { type: "image/png", lastModified: 7 });
  const another = new File(["abc"], "same.png", { type: "image/png", lastModified: 7 });
  const prepare = (selected: File) => { const form = new FormData(); form.append("file", selected); return prepareAdminBody(form); };
  const first = prepare(file), retry = prepare(file), changed = prepare(another);
  assert.equal(first.json, false);
  assert(first.body instanceof FormData);
  assert.equal(first.body.get("file"), file);
  assert.equal(first.fingerprint, retry.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert(!first.fingerprint?.includes("abc"));
});
test("JSON values retain their body and fingerprint while absent bodies omit JSON headers", () => {
  const body = { prompt: "test", fileKeys: ["private-image"] };
  assert.deepEqual(prepareAdminBody(body), { body: JSON.stringify(body), fingerprint: JSON.stringify(body), json: true });
  assert.deepEqual(prepareAdminBody(null), { body: "null", fingerprint: "null", json: true });
  assert.deepEqual(prepareAdminBody(undefined), { body: undefined, fingerprint: undefined, json: false });
});

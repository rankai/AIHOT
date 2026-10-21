import assert from "node:assert/strict";
import { test } from "node:test";
import { assetContentUrl, referenceIssue, type PrivateAsset } from "../app/features/admin/image-types.ts";
const limits = { referenceBytes: 10_000_000, referencePixels: 16_000_000 };
const asset: PrivateAsset = { key: "uploads/redfox/test", content_type: "image/png", bytes: limits.referenceBytes, purpose: "operation-output", status: "available", metadata: { filename: "image.png", width: 4000, height: 4000 } };
test("an allowed output can be reused at the reference boundary; larger valid outputs require a clear refusal", () => {
  assert.equal(referenceIssue(asset, limits), null);
  assert.match(referenceIssue({ ...asset, bytes: limits.referenceBytes + 1 }, limits)!, /10 MB/);
  assert.match(referenceIssue({ ...asset, metadata: { ...asset.metadata, width: 4096, height: 4096 } }, limits)!, /16 MP/);
});
test("deleted and deleting files are unavailable as references, and private keys remain one encoded path segment", () => {
  for (const status of ["deleted", "deleting"]) assert(referenceIssue({ ...asset, status }, limits));
  assert.equal(assetContentUrl("uploads/redfox/key?x#y"), "/api/admin/assets/uploads%2Fredfox%2Fkey%3Fx%23y/content");
});

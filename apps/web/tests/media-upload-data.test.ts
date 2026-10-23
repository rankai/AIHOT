import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaUploadCommand, mediaUploadIssue, type MediaUploadOptions } from "../app/features/admin/media-upload-data.ts";
import { referenceIssue, type PrivateAsset } from "../app/features/admin/image-types.ts";
const options: MediaUploadOptions = {
  operationId: "6L178PZD", service: "redfox.media", transportVerified: false,
  formats: [
    ["png", "image", "image/png"], ["jpg", "image", "image/jpeg"], ["webp", "image", "image/webp"], ["gif", "image", "image/gif"], ["bmp", "image", "image/bmp"],
    ["mp3", "audio", "audio/mpeg"], ["wav", "audio", "audio/wav"], ["aac", "audio", "audio/aac"], ["ogg", "audio", "audio/ogg"], ["flac", "audio", "audio/flac"],
    ["mp4", "video", "video/mp4"], ["avi", "video", "video/vnd.avi"], ["mov", "video", "video/quicktime"], ["mkv", "video", "video/matroska"], ["webm", "video", "video/webm"],
  ].map(([format, kind, mime]) => ({ format: format!, kind: kind as "image" | "audio" | "video", mime: mime!, extensions: [format!] })),
  limits: { imageBytes: 10_000_000, audioBytes: 20_000_000, videoBytes: 50_000_000, imagePixels: 16_000_000 },
  imageValidation: { gif: { totalFramePixels: 16_000_000 }, bmp: { compression: "uncompressed", dibHeaders: [12, 40, 108, 124], validation: "structure" } },
};
const asset: PrivateAsset = { key: "uploads/redfox/exact-key", content_type: "image/png", bytes: 10, status: "available", purpose: "operation-input", metadata: { filename: "actual.png" } };
test("generic upload accepts all fifteen MIME formats independent of GPT image-reference constraints", () => {
  for (const format of options.formats) {
    const local = { ...asset, content_type: format.mime, bytes: options.limits[`${format.kind}Bytes`] };
    assert.equal(mediaUploadIssue(local, options), null);
    assert.deepEqual(mediaUploadCommand(local, options), { path: "/api/admin/redfox/media/uploads", body: { fileKey: asset.key } });
  }
  const gif = { ...asset, content_type: "image/gif" };
  assert(referenceIssue(gif, { referenceBytes: 10_000_000, referencePixels: 16_000_000 }));
  assert.equal(mediaUploadIssue(gif, options), null);
});
test("unavailable, output-only or over-cap assets cannot create supplier-upload commands", () => {
  for (const status of ["deleted", "deleting"]) assert.throws(() => mediaUploadCommand({ ...asset, status }, options));
  for (const content_type of ["audio/x-m4a", "application/octet-stream"]) assert.throws(() => mediaUploadCommand({ ...asset, content_type }, options));
  for (const [content_type, bytes] of [["image/png", 10_000_001], ["audio/mpeg", 20_000_001], ["video/mp4", 50_000_001]] as const) assert.throws(() => mediaUploadCommand({ ...asset, content_type, bytes }, options));
  assert.equal(mediaUploadIssue({ ...asset, content_type: "video/mp4", bytes: 11_000_000 }, options), null);
});
test("saved content type determines supplier support, never a renamed file or remote URL", () => {
  assert(mediaUploadIssue({ ...asset, content_type: "audio/x-m4a", metadata: { filename: "pretend.png" } }, options));
  const command = mediaUploadCommand({ ...asset, metadata: { filename: "misleading.m4a" } }, options);
  assert.deepEqual(Object.keys(command.body), ["fileKey"]); assert.equal(command.body.fileKey, asset.key);
});

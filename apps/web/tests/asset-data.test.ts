import assert from "node:assert/strict";
import { test } from "node:test";
import { assetKind, assetUploadAccept, assetUploadFile, assetUploadFormat, assetUploadIssue, mergeAssetRows, operationFileAsset } from "../app/features/admin/asset-data.ts";
import type { AssetUploadOptions } from "../app/features/admin/asset-types.ts";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";
import { referenceImage, referenceIssue, type PrivateAsset } from "../app/features/admin/image-types.ts";

const options: AssetUploadOptions = {
  formats: [
    { format: "png", kind: "image", extensions: ["png"], mime: "image/png" },
    { format: "jpg", kind: "image", extensions: ["jpg", "jpeg"], mime: "image/jpeg" },
    { format: "webp", kind: "image", extensions: ["webp"], mime: "image/webp" },
    { format: "gif", kind: "image", extensions: ["gif"], mime: "image/gif" },
    { format: "bmp", kind: "image", extensions: ["bmp"], mime: "image/bmp" },
    { format: "mp3", kind: "audio", extensions: ["mp3"], mime: "audio/mpeg" },
    { format: "wav", kind: "audio", extensions: ["wav"], mime: "audio/wav" },
    { format: "aac", kind: "audio", extensions: ["aac"], mime: "audio/aac" },
    { format: "ogg", kind: "audio", extensions: ["ogg"], mime: "audio/ogg" },
    { format: "flac", kind: "audio", extensions: ["flac"], mime: "audio/flac" },
    { format: "mp4", kind: "video", extensions: ["mp4"], mime: "video/mp4" },
    { format: "avi", kind: "video", extensions: ["avi"], mime: "video/vnd.avi" },
    { format: "mov", kind: "video", extensions: ["mov"], mime: "video/quicktime" },
    { format: "mkv", kind: "video", extensions: ["mkv"], mime: "video/matroska" },
    { format: "webm", kind: "video", extensions: ["webm"], mime: "video/webm" },
  ],
  limits: { imageBytes: 10_000_000, audioBytes: 20_000_000, videoBytes: 50_000_000, imagePixels: 16_000_000 },
  imageValidation: { gif: { totalFramePixels: 16_000_000 }, bmp: { compression: "uncompressed", dibHeaders: [12, 40, 108, 124], validation: "structure" } },
};
const image: PrivateAsset = { key: "local/image", content_type: "image/png", bytes: 100, status: "available", purpose: "admin-upload", metadata: { filename: "legacy.png", width: 4000, height: 4000 } };
const referenceLimits = { referenceBytes: 10_000_000, referencePixels: 16_000_000 };

test("upload accept derives all extension aliases and MIME values; output-only m4a stays excluded", () => {
  const accept = assetUploadAccept(options).split(",");
  assert(accept.includes(".jpeg")); assert(accept.includes(".mkv")); assert(accept.includes("video/matroska"));
  assert(!accept.includes(".m4a")); assert.equal(new Set(accept).size, accept.length);
  assert.equal(assetUploadFormat("many.parts.JPEG", options)?.mime, "image/jpeg");
  assert.equal(assetUploadFormat("output.m4a", options), null);
  assert.equal(assetUploadFormat("noextension", options), null);
});

test("upload caps are decimal bytes per category, including an 11 MB video beyond the image cap", () => {
  for (const [name, limit] of [["photo.png", 10_000_000], ["sound.wav", 20_000_000], ["clip.mp4", 50_000_000]] as const) {
    assert.equal(assetUploadIssue({ name, size: limit }, options), null);
    assert.match(assetUploadIssue({ name, size: limit + 1 }, options)!, new RegExp(`${limit / 1_000_000} MB`));
  }
  assert.equal(assetUploadIssue({ name: "clip.mp4", size: 11_000_000 }, options), null);
  assert(assetUploadIssue({ name: "empty.mp3", size: 0 }, options));
  assert(assetUploadIssue({ name: "wrong.txt", size: 1 }, options));
});

test("canonical MIME declaration wraps without reading the selected bytes and retains retry identity", () => {
  const selected = new File(["local bytes"], "clip.MKV", { type: "", lastModified: 17 });
  selected.arrayBuffer = async () => { throw new Error("must not read whole file"); };
  const first = assetUploadFile(selected, options), retry = assetUploadFile(selected, { ...options });
  assert.equal(first, retry); assert.equal(first.type, "video/matroska");
  assert.equal(first.name, selected.name); assert.equal(first.size, selected.size); assert.equal(first.lastModified, 17);
  const prepare = (file: File) => { const body = new FormData(); body.append("file", file); return prepareAdminBody(body); };
  const prepared = prepare(first);
  assert.equal(prepared.json, false); assert.equal(prepared.fingerprint, prepare(retry).fingerprint);
  const another = new File(["local bytes"], "clip.MKV", { type: "", lastModified: 17 });
  assert.notEqual(prepared.fingerprint, prepare(assetUploadFile(another, options)).fingerprint);
});

test("canonical selections retain identity while wrong browser MIME is a declaration correction only", () => {
  const png = new File(["bytes"], "picture.png", { type: "image/png" });
  assert.equal(assetUploadFile(png, options), png);
  const mislabeled = new File(["bytes"], "sound.wav", { type: "application/octet-stream" });
  assert.equal(assetUploadFile(mislabeled, options).type, "audio/wav");
  assert.throws(() => assetUploadFile(new File(["x"], "sound.m4a"), options));
});

test("legacy MIME still determines presentation and nullable output dimensions do not become image metadata", () => {
  assert.equal(assetKind(image), "image");
  assert.equal(assetKind({ content_type: "audio/x-m4a", metadata: { filename: "output.m4a" } }), "audio");
  assert.equal(assetKind({ content_type: "video/mp4", metadata: { filename: "misleading.png" } }), "video");
  assert.equal(assetKind({ content_type: "application/octet-stream", metadata: { filename: "guess.png" } }), null);
  const output = operationFileAsset({ key: "local/audio", status: "available", contentType: "audio/x-m4a", bytes: 3, filename: "audio.m4a", width: null, height: null });
  assert(output); assert.equal(output.metadata.width, null); assert.equal(assetKind(output), "audio");
  assert.equal(referenceImage(output), false); assert.equal(operationFileAsset(null), null);
});

test("reference candidates require positive finite integer dimensions and actual supported image MIME", () => {
  assert(referenceImage(image)); assert.equal(referenceIssue(image, referenceLimits), null);
  for (const width of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid: PrivateAsset = { ...image, metadata: { ...image.metadata, width } };
    assert.equal(referenceImage(invalid), false); assert(referenceIssue(invalid, referenceLimits));
  }
  for (const content_type of ["image/gif", "image/bmp", "audio/x-m4a", "video/mp4"]) {
    const nonreference: PrivateAsset = { ...image, content_type };
    assert.equal(referenceImage(nonreference), false); assert(referenceIssue(nonreference, referenceLimits));
  }
  assert.equal(referenceImage({ ...image, metadata: { ...image.metadata, kind: "video" } }), false);
  assert.equal(referenceImage({ ...image, metadata: { ...image.metadata, pages: 2 } }), false);
  assert(referenceIssue({ ...image, metadata: { ...image.metadata, height: 4001 } }, referenceLimits));
});

test("asset pages deduplicate keys and delayed available rows cannot revive deleting or deleted files", () => {
  const second = { ...image, key: "local/second" }, deleting = { ...image, status: "deleting" }, deleted = { ...image, status: "deleted" };
  assert.equal(mergeAssetRows([image], [image, second]).length, 2);
  assert.equal(mergeAssetRows([deleting], [image])[0]?.status, "deleting");
  assert.equal(mergeAssetRows([deleted], [image, deleting])[0]?.status, "deleted");
  const updated = mergeAssetRows([image, second], [deleted]);
  assert.equal(updated.length, 2); assert.equal(updated[0]?.status, "deleted");
  assert(referenceIssue(updated[0]!, referenceLimits));
});

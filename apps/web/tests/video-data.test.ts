import assert from "node:assert/strict";
import { test } from "node:test";
import { isVideoOperation, isVideoResult, removeVideoAsset, removeVideoRole, videoDraft, videoFactRows, videoFailureRows, videoFileKeys, videoGenerationBody, videoLastFrameMissing, videoQueryBody, videoReferenceAssets, videoReferenceIssue, videoTaskFacts, videoUploadReferenceLink } from "../app/features/admin/video-data.ts";
import { imageUploadReferenceLink } from "../app/features/admin/image-model-data.ts";
import { assetContentUrl, type ImageOptions, type PrivateAsset } from "../app/features/admin/image-types.ts";
import { operationFileAsset } from "../app/features/admin/asset-data.ts";
import type { VideoDraft, VideoOptions, VideoRole } from "../app/features/admin/video-types.ts";
const options: VideoOptions = {
  modelLabel: "Redfox Seedance", aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"], resolutions: ["480p", "720p"], durationSeconds: { min: 4, max: 15 }, roles: { first_frame: 1, last_frame: 1, reference_image: 9 }, maxReferenceRoles: 11,
  referenceFormats: ["png", "jpeg", "webp"], referenceBytes: 10_000_000, referencePixels: 16_000_000, referenceFrames: 1, outputVideoBytes: 50_000_000, outputImageBytes: 64 * 1024 * 1024, outputImagePixels: 64_000_000,
  limits: { steps: 80, polls: 60, retries: 3, pollDeadlineSeconds: 7200, externalAttempts: 100, saveAttempts: 12, downloadTimeoutMs: 60000, pollIntervalSeconds: 10, maxPollIntervalSeconds: 30 },
  services: { referenceUpload: "redfox.media", submission: "redfox.video", poll: "redfox.poll" }, documentedBaseCny: 15, pollBaseCny: 0, priceBasis: "documented-estimate", billingUnitVerified: false, uploadTransportVerified: false, referenceReuseHint: "explicit",
};
const imageOptions: ImageOptions = { modelLabel: "Redfox GPT2", resolutions: [], sizes: [], maxImages: 4, maxReferences: 2, referenceBytes: 10_000_000, referencePixels: 16_000_000, outputBytes: 64 * 1024 * 1024, outputPixels: 64_000_000, pollLimit: 60, pollDeadlineSeconds: 7200, uploadTransportVerified: false, services: { referenceUpload: "redfox.media", submission: "redfox.image", poll: "redfox.poll" }, submissionCost: null, models: [], newModelLimits: { steps: 80, polls: 60, pollDeadlineSeconds: 7200, saveAttempts: 30 }, priceBasis: "documented-estimate", billingUnitVerified: false, referenceReuseHint: "explicit" };
const asset: PrivateAsset = { key: "uploads/redfox/ref", content_type: "image/png", bytes: 100, status: "available", purpose: "operation-input", metadata: { filename: "ref.png", width: 4000, height: 4000 } };
const draft = (): VideoDraft => ({ ...videoDraft(options), prompt: " \n镜头描述 🎬\n " });

test("text-only generation has exact fixed fields, raw prompt and explicit false flags with no model or media input", () => {
  assert.deepEqual(videoGenerationBody(draft(), options), { prompt: draft().prompt, aspectRatio: "16:9", duration: 4, resolution: "720p", generateAudio: false, returnLastFrame: false, imageWithRoles: [] });
  const body = videoGenerationBody({ ...draft(), aspectRatio: "adaptive", duration: 15, resolution: "480p", generateAudio: true, returnLastFrame: true }, options);
  assert.equal(body.generateAudio, true); assert.equal(body.returnLastFrame, true); assert.equal(body.aspectRatio, "adaptive");
  assert(!Object.hasOwn(body, "model")); assert(!Object.hasOwn(body, "audioUrl"));
});
test("invalid prompt, duration, ratio, resolution or flag cannot produce a submission command", () => {
  for (const patch of [{ prompt: " \n " }, { prompt: "x".repeat(10001) }, { duration: 3 }, { duration: 16 }, { duration: 4.5 }, { duration: NaN }, { aspectRatio: "unknown" }, { resolution: "1080p" }, { generateAudio: 0 as unknown as boolean }]) assert.throws(() => videoGenerationBody({ ...draft(), ...patch }, options));
  assert.equal(videoGenerationBody({ ...draft(), prompt: "x".repeat(10000) }, options).prompt.length, 10000);
});
test("the same file can occupy first and last frame without duplicate uploads; role order and shared explicit receipt remain exact", () => {
  const other = { ...asset, key: "uploads/redfox/other" };
  const selected: VideoDraft = { ...draft(), selected: [asset, other], roles: [{ id: 9, fileKey: asset.key, role: "last_frame" }, { id: 3, fileKey: other.key, role: "reference_image" }, { id: 1, fileKey: asset.key, role: "first_frame" }], confirmedUploads: { [asset.key]: 81 } };
  assert.deepEqual(videoFileKeys(selected.roles), [asset.key, other.key]);
  assert.deepEqual(videoGenerationBody(selected, options).imageWithRoles, [{ fileKey: asset.key, role: "last_frame", uploadResultId: 81 }, { fileKey: other.key, role: "reference_image" }, { fileKey: asset.key, role: "first_frame", uploadResultId: 81 }]);
});
test("each role cap and total role cap are explicit, with eleven legal rows preserved rather than truncated", () => {
  const eleven: VideoDraft = { ...draft(), selected: [asset], roles: ["first_frame", "last_frame", ...Array(9).fill("reference_image")].map((role, id) => ({ id, fileKey: asset.key, role: role as VideoRole })) };
  assert.equal(videoReferenceIssue(eleven, options), null); assert.equal(videoGenerationBody(eleven, options).imageWithRoles.length, 11);
  for (const [role, limit] of Object.entries(options.roles)) {
    const invalid = { ...draft(), selected: [asset], roles: Array.from({ length: limit + 1 }, (_, id) => ({ id, fileKey: asset.key, role: role as VideoRole })) };
    assert(videoReferenceIssue(invalid, options)); assert.throws(() => videoGenerationBody(invalid, options));
  }
  assert.throws(() => videoGenerationBody({ ...eleven, roles: [...eleven.roles, { id: 12, fileKey: asset.key, role: "reference_image" }] }, options));
  assert.throws(() => videoGenerationBody({ ...draft(), selected: [asset], roles: [{ id: 1, fileKey: asset.key, role: "audio" as VideoRole }] }, options));
});
test("reference validation rejects unavailable/non-image/non-single-frame/invalid dimensions without using a remote URL", () => {
  for (const invalid of [{ ...asset, status: "deleted" }, { ...asset, content_type: "video/mp4" }, { ...asset, content_type: "image/gif" }, { ...asset, bytes: 10_000_001 }, { ...asset, metadata: { ...asset.metadata, width: null } }, { ...asset, metadata: { ...asset.metadata, width: 4001 } }, { ...asset, metadata: { ...asset.metadata, pages: 2 } }]) {
    assert.throws(() => videoGenerationBody({ ...draft(), selected: [invalid], roles: [{ id: 1, fileKey: asset.key, role: "reference_image" }] }, options));
  }
  assert.throws(() => videoGenerationBody({ ...draft(), roles: [{ id: 1, fileKey: "missing", role: "first_frame" }] }, options));
  const updated = videoReferenceAssets([asset], [{ ...asset, status: "deleting" }]);
  assert.equal(updated[0]?.status, "deleting"); assert.equal(asset.status, "available");
});
test("removing an asset or its last role clears selected references and explicit reuse; ordinary reselect never revives it", () => {
  const initial: VideoDraft = { ...draft(), selected: [asset], roles: [{ id: 1, fileKey: asset.key, role: "first_frame" }, { id: 2, fileKey: asset.key, role: "last_frame" }], confirmedUploads: { [asset.key]: 99 } };
  const oneRole = removeVideoRole(initial, 1); assert.equal(oneRole.roles.length, 1); assert.equal(oneRole.confirmedUploads[asset.key], 99);
  const cleared = removeVideoRole(oneRole, 2); assert.deepEqual(cleared.selected, []); assert.deepEqual(cleared.roles, []); assert.deepEqual(cleared.confirmedUploads, {});
  assert.deepEqual(removeVideoAsset(initial, asset.key).roles, []);
  const reselected = { ...cleared, selected: [asset], roles: [{ id: 3, fileKey: asset.key, role: "reference_image" as const }] };
  assert.equal(Object.hasOwn(videoGenerationBody(reselected, options).imageWithRoles[0]!, "uploadResultId"), false);
  assert.equal(initial.confirmedUploads[asset.key], 99);
});
test("existing task query preserves ID bytes and never carries generation parameters", () => {
  assert.deepEqual(videoQueryBody(" task-90071992547409931234 \n"), { taskId: " task-90071992547409931234 \n" });
  assert.equal(videoQueryBody("x".repeat(500)).taskId.length, 500);
  for (const value of ["", " \n", "x".repeat(501)]) assert.throws(() => videoQueryBody(value));
});
test("video result ownership distinguishes role-tagged video/last-frame output from ordinary image or platform works", () => {
  assert(isVideoOperation("redfox.video.generate")); assert(isVideoOperation("redfox.video.query")); assert(!isVideoOperation("redfox.image.generate"));
  for (const kind of ["video_task", "video_reference"]) assert(isVideoResult(kind, {}));
  assert(isVideoResult("video", { role: "video" })); assert(isVideoResult("image", { role: "last_frame" }));
  for (const kind of ["query_summary", "image_task", "tiktok_work", "transcription"]) assert(!isVideoResult(kind, {}));
  assert(!isVideoResult("image", {})); assert(!isVideoResult("video", {}));
});
test("terminal IDs survive cleared progress; input/progress priority and actual zero progress ignore usage and metadata", () => {
  const result = { kind: "video_task", data: { taskId: " actual ", status: "completed", usage: { progress: 90 }, metadata: { progress: 80 } } };
  const operation = { progress: {}, inputs: {}, results: [result] };
  assert.equal(videoTaskFacts(operation).taskId, " actual "); assert.equal(videoTaskFacts(operation).progress, null);
  assert.equal(videoTaskFacts({ ...operation, progress: { taskId: "live", providerProgress: 0 }, inputs: { parameters: { taskId: "input" } } }).progress, 0);
  assert.equal(videoTaskFacts({ ...operation, progress: { taskId: "live" } }).taskId, "live");
  assert.equal(videoTaskFacts({ ...operation, inputs: { parameters: { taskId: " query " } } }).taskId, " query ");
  assert.equal(videoTaskFacts({ ...operation, results: [{ kind: "video", data: { role: "video", taskId: " saved " } }] }).taskId, " saved ");
  assert.equal(videoTaskFacts({ ...operation, results: [{ kind: "image_task", data: { taskId: "wrong" } }] }).taskId, null);
  assert.equal(videoTaskFacts({ ...operation, results: [] }).latest, undefined);
});
test("missing-last-frame handling only reads the actual explicit flag and never infers it from query/request metadata", () => {
  assert(videoLastFrameMissing({ lastFrameMissing: true }));
  for (const data of [{}, { lastFrameMissing: false }, { lastFrameMissing: null }, { returnLastFrame: true }, { metadata: { lastFrameMissing: true } }]) assert.equal(videoLastFrameMissing(data), false);
  const query = { progress: {}, inputs: { parameters: { taskId: "query" } }, results: [{ kind: "video_task", data: { taskId: "query", status: "completed" } }] };
  assert.equal(videoLastFrameMissing(videoTaskFacts(query).latest!.data), false);
});
test("actual facts keep null seeds, false audio and raw metadata without upgrading its duration to a validation value", () => {
  const rows = videoFactRows({ taskId: "90071992547409931234", seed: null, generateAudio: false, duration: 4, metadata: { duration: "90071992547409931234", count: 0 }, usage: { progress: 99 } });
  assert.equal(rows[0]?.[1], "90071992547409931234"); assert(rows.some(([key, value]) => key === "实收 seed" && /null/.test(value)));
  assert(rows.some(([, value]) => /false/.test(value))); assert(rows.some(([key, value]) => key.includes("metadata.duration") && key.includes("不作本地验证") && value === "90071992547409931234"));
  assert(!rows.some(([key]) => /usage|进度/.test(key)));
  for (const status of ["processing", "completed"]) assert.deepEqual(videoFailureRows({ status, failReason: null }), []);
  assert.match(videoFailureRows({ status: "failed", failReason: null })[0]![1], /null/); assert.equal(videoFailureRows({ status: "failed", failReason: "" })[0]![1], "空字符串"); assert.equal(videoFailureRows({ status: "failed" })[0]![1], "未提供");
});
test("video reuse CTA shares the already-qualified upload boundary while preserving existing image CTA target", () => {
  const result = { id: 42, kind: "media_upload", data: { operationId: "6L178PZD", resourceUrl: "https://supplier.test/resource" }, fileKey: asset.key, file: { key: asset.key, contentType: "image/png", bytes: 100, status: "available", filename: "ref.png", width: 4000, height: 4000 } };
  const imageLink = new URL(imageUploadReferenceLink(result, imageOptions)!, "https://local.test"), videoLink = new URL(videoUploadReferenceLink(result, imageOptions)!, "https://local.test");
  assert.equal(imageLink.searchParams.get("view"), "images"); assert.equal(imageLink.searchParams.get("imageModel"), "gptImage25");
  assert.equal(videoLink.searchParams.get("view"), "videos"); assert.equal(videoLink.searchParams.get("reference"), asset.key); assert.equal(videoLink.searchParams.get("referenceUploadResult"), "42"); assert(!videoLink.searchParams.has("imageModel"));
  assert.equal(videoUploadReferenceLink({ ...result, file: { ...result.file, status: "deleted" } }, imageOptions), null);
  assert.equal(videoUploadReferenceLink({ ...result, file: { ...result.file, contentType: "audio/x-m4a" } }, imageOptions), null);
});
test("playback conversion selects only the local asset key and nullable media metadata, not result sourceUrl", () => {
  const raw = { sourceUrl: "https://supplier.test/remote.mp4", file: { key: "uploads/redfox/video?x#y", status: "available", contentType: "video/mp4", bytes: 12, filename: "output.mp4", width: null, height: null } };
  const local = operationFileAsset(raw.file); assert(local);
  assert.equal(assetContentUrl(local.key), "/api/admin/assets/uploads%2Fredfox%2Fvideo%3Fx%23y/content");
  assert.equal(local.metadata.width, null); assert(!JSON.stringify(local).includes("supplier.test"));
});

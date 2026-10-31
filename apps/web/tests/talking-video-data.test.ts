import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolAsset } from "@aihot/contracts/user-tools";
import type { VideoOptions } from "../app/features/admin/video-types.ts";
import { talkingVideoBody, talkingVideoPrompt, type TalkingVideoDraft } from "../app/features/tools/talking-video-data.ts";

const options: VideoOptions = {
  modelLabel: "Redfox Seedance", aspectRatios: ["16:9", "9:16"], resolutions: ["480p", "720p"], durationSeconds: { min: 4, max: 15 }, roles: { first_frame: 1, last_frame: 1, reference_image: 9 }, maxReferenceRoles: 11,
  referenceFormats: ["png", "jpeg", "webp"], referenceBytes: 10_000_000, referencePixels: 16_000_000, referenceFrames: 1, outputVideoBytes: 50_000_000, outputImageBytes: 64 * 1024 * 1024, outputImagePixels: 64_000_000,
  limits: { steps: 80, polls: 60, retries: 3, pollDeadlineSeconds: 7200, externalAttempts: 100, saveAttempts: 12, downloadTimeoutMs: 60000, pollIntervalSeconds: 10, maxPollIntervalSeconds: 30 },
  services: { referenceUpload: "redfox.media", submission: "redfox.video", poll: "redfox.poll" }, documentedBaseCny: 15, pollBaseCny: 0, priceBasis: "documented-estimate", billingUnitVerified: false, uploadTransportVerified: false, referenceReuseHint: "explicit",
};
const portrait: ToolAsset = { key: "uploads/redfox/portrait", filename: "portrait.png", contentType: "image/png", bytes: 100, width: 720, height: 1280, createdAt: "2026-10-29T00:00:00Z", contentUrl: "/api/tools/assets/portrait/content", status: "available", uploads: [{ resultId: 41, createdAt: "2026-10-29T00:00:00Z" }] };
const draft = (): TalkingVideoDraft => ({ dialogue: "  大家好，今天分享一个小技巧。\n欢迎收看。  ", actionScript: "  面对镜头微笑，轻轻挥手。  ", portraitKey: portrait.key, aspectRatio: "9:16", resolution: "480p", duration: 4 });

test("talking video combines separate scripts and sends a portrait reference with audio", () => {
  const body = talkingVideoBody(draft(), [portrait], options);
  assert.match(body.prompt, /【口播台词】\n大家好，今天分享一个小技巧。\n欢迎收看。\n\n【动作脚本】\n面对镜头微笑，轻轻挥手。/);
  assert.deepEqual({ ...body, prompt: "script" }, { prompt: "script", aspectRatio: "9:16", resolution: "480p", duration: 4, generateAudio: true, returnLastFrame: false, imageWithRoles: [{ fileKey: portrait.key, role: "reference_image" }] });
  assert(!JSON.stringify(body).includes(portrait.contentUrl));
  assert(!Object.hasOwn(body, "audioUrl"));
});

test("blank scripts and combined prompt overflow cannot reach the paid quote", () => {
  assert.throws(() => talkingVideoPrompt(" \n ", "挥手"), /口播台词/);
  assert.match(talkingVideoPrompt("你好", " \n "), /自然讲述/);
  const overhead = talkingVideoPrompt("x", "y").length - 2;
  assert.equal(talkingVideoPrompt("x".repeat(9999 - overhead), "y").length, 10000);
  assert.throws(() => talkingVideoPrompt("x".repeat(10000 - overhead), "y"), /10000/);
});

test("a missing or unsupported portrait and invalid saved image metadata are rejected", () => {
  assert.throws(() => talkingVideoBody({ ...draft(), portraitKey: "" }, [portrait], options), /人物照片/);
  assert.throws(() => talkingVideoBody(draft(), [], options), /人物照片/);
  for (const change of [{ status: "deleted" }, { contentType: "image/gif" }, { contentType: "audio/mpeg" }, { bytes: 10_000_001 }, { width: undefined }, { width: 16001, height: 1000 }]) {
    assert.throws(() => talkingVideoBody(draft(), [{ ...portrait, ...change }], options));
  }
});

test("supplier upload reuse is explicit and can only name the chosen portrait's receipt", () => {
  assert.equal(Object.hasOwn(talkingVideoBody(draft(), [portrait], options).imageWithRoles[0]!, "uploadResultId"), false);
  assert.equal(talkingVideoBody({ ...draft(), uploadResultId: 41 }, [portrait], options).imageWithRoles[0]?.uploadResultId, 41);
  for (const uploadResultId of [0, -1, 41.5, Number.NaN, 99]) assert.throws(() => talkingVideoBody({ ...draft(), uploadResultId }, [portrait], options), /上传记录/);
  assert.throws(() => talkingVideoBody({ ...draft(), uploadResultId: 41 }, [{ ...portrait, uploads: [] }], options), /上传记录/);
});

test("product and scene references retain their order and meaning, with optional actions", () => {
  const product = { ...portrait, key: "product", filename: "cup.png", uploads: [{ resultId: 42, createdAt: portrait.createdAt }] };
  const scene = { ...portrait, key: "scene", filename: "room.png", uploads: [] };
  const body = talkingVideoBody({ ...draft(), productKey: product.key, sceneKey: scene.key, actionScript: "", referenceUploads: [{ fileKey: product.key, resultId: 42 }] }, [scene, product, portrait], options);
  assert.deepEqual(body.imageWithRoles, [{ fileKey: portrait.key, role: "reference_image" }, { fileKey: product.key, role: "reference_image", uploadResultId: 42 }, { fileKey: scene.key, role: "reference_image" }]);
  assert.match(body.prompt, /参考图1为人物/); assert.match(body.prompt, /参考图2为产品/); assert.match(body.prompt, /参考图3为场景/);
  assert.match(body.prompt, /面对镜头自然讲述/); assert.equal(body.generateAudio, true);
  const sceneOnly = talkingVideoBody({ ...draft(), sceneKey: scene.key }, [portrait, scene], options);
  assert.match(sceneOnly.prompt, /参考图2为场景/); assert.doesNotMatch(sceneOnly.prompt, /产品照片/);
  assert.throws(() => talkingVideoBody({ ...draft(), productKey: portrait.key }, [portrait], options), /不同/);
  assert.throws(() => talkingVideoBody({ ...draft(), sceneKey: "missing" }, [portrait], options), /参考图片/);
  assert.throws(() => talkingVideoBody({ ...draft(), productKey: product.key, referenceUploads: [{ fileKey: product.key, resultId: 41 }] }, [portrait, product], options), /上传记录/);
  assert.throws(() => talkingVideoBody({ ...draft(), productKey: product.key }, [portrait, { ...product, bytes: 10_000_001 }], options), /限制/);
  assert.throws(() => talkingVideoBody({ ...draft(), sceneKey: scene.key }, [portrait, { ...scene, width: 0 }], options), /宽高/);
  assert.throws(() => talkingVideoBody({ ...draft(), productKey: product.key, sceneKey: scene.key, dialogue: "x".repeat(9900) }, [portrait, product, scene], options), /10000/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { manualWorkCandidates, manualWorkDefaultUrl, manualWorkDetailRequest, manualWorkImportRequest, manualWorkNativeUrl, manualWorkPlatform } from "../app/features/admin/manual-work-data.ts";
import { sourceNewPreset } from "../app/features/admin/source-new-preset.ts";

const sph = { platform: "shipinhao", operationId: "E7G00COY", record: { videoId: "opaque-video-1", exportId: "different-export-id" } };
const ks = { platform: "kuaishou", operationId: "27DQ6SF9", record: { photoId: "opaque-supplier-photo-id" } };
const sphUrl = "https://weixin.qq.com/sph/native-slug/?share=a%2Fb", ksUrl = "https://www.kuaishou.com/short-video/different-native-path/?share=a%2Fb";
const rows = [{ id: "source-current", participation_mode: "isolated" }, { id: "editorial", participation_mode: "editorial" }];
const draft = { sourceId: "source-current", url: sphUrl, evidence: "已逐项核实原文与所选作者信源关系", reason: "人工导入" };

test("manual import is limited to the two supported work kinds, never account rows or unrelated platforms", () => {
  assert.equal(manualWorkPlatform("shipinhao_work", sph), "shipinhao");
  assert.equal(manualWorkPlatform("kuaishou_work", ks), "kuaishou");
  for (const [kind, data] of [["shipinhao_account", sph], ["kuaishou_account", ks], ["query_summary", sph], ["shipinhao_work", { ...sph, operationId: "NL4I3533" }], ["kuaishou_work", { ...ks, operationId: "GU17EVLV" }], ["shipinhao_work", ks]] as const) {
    assert.equal(manualWorkPlatform(kind, data), null);
    assert.ok(manualWorkImportRequest(kind, data, draft, "idle", rows).error);
  }
});

test("native links accept only documented platform paths and retain the human-verified query bytes", () => {
  assert.equal(manualWorkNativeUrl("shipinhao", sphUrl), sphUrl);
  assert.equal(manualWorkNativeUrl("kuaishou", ksUrl), ksUrl);
  assert.equal(manualWorkNativeUrl("kuaishou", "http://kuaishou.com/short-video/Ab_1-x"), "http://kuaishou.com/short-video/Ab_1-x");
  const badSph = ["https://weixin.qq.com/profile/slug", "https://www.weixin.qq.com/sph/slug", "https://channels.weixin.qq.com/sph/slug", "https://v.example/short", "https://finder.video.qq.com/video.mp4", "https://weixin.qq.com.evil.test/sph/slug", "https://user:pass@weixin.qq.com/sph/slug", "https://@weixin.qq.com/sph/slug", "https://weixin.qq.com:443/sph/slug", "https://weixin.qq.com:8443/sph/slug", `${sphUrl}#`, `${sphUrl}#part`, "https://weixin.qq.com/sph/slug/extra"];
  const badKs = ["https://kuaishou.com/profile/author", "https://v.kuaishou.com/short", "https://cdn.example/video.mp4", "https://kuaishou.com.evil.test/short-video/id", "https://user:pass@kuaishou.com/short-video/id", "https://@kuaishou.com/short-video/id", "https://kuaishou.com:443/short-video/id", "https://kuaishou.com:8443/short-video/id", `${ksUrl}#`, `${ksUrl}#part`, "https://kuaishou.com/short-video/id/extra"];
  for (const address of [...badSph, "javascript:alert(1)", "data:video/mp4;base64,abc", ksUrl]) assert.equal(manualWorkNativeUrl("shipinhao", address), null, address);
  for (const address of [...badKs, "javascript:alert(1)", sphUrl]) assert.equal(manualWorkNativeUrl("kuaishou", address), null, address);
});

test("explicit source, native original, per-item evidence and reason are mandatory in the minimal import DTO", () => {
  assert.deepEqual(manualWorkImportRequest("shipinhao_work", sph, draft, "idle", rows), { body: { sourceId: draft.sourceId, reason: draft.reason, supplement: { url: sphUrl, evidence: draft.evidence } } });
  assert.deepEqual(manualWorkImportRequest("kuaishou_work", ks, { ...draft, url: ksUrl }, "idle", rows), { body: { sourceId: draft.sourceId, reason: draft.reason, supplement: { url: ksUrl, evidence: draft.evidence } } });
  for (const change of [{ sourceId: "" }, { url: "" }, { evidence: " " }, { reason: " " }, { evidence: "x".repeat(1001) }, { reason: "x".repeat(501) }]) assert.ok(manualWorkImportRequest("shipinhao_work", sph, { ...draft, ...change }, "idle", rows).error);
  // Supplier IDs are not native path IDs, and neither is submitted as author identity.
  assert.notEqual(ks.record.photoId, new URL(ksUrl).pathname.split("/")[2]);
  assert.ok(manualWorkImportRequest("kuaishou_work", ks, { ...draft, url: ksUrl }, "idle", rows).body);
});

test("current idle isolated candidate is required; loading, old pages and editorial selections are rejected", () => {
  assert.deepEqual(manualWorkCandidates(rows), [rows[0]]);
  assert.deepEqual(manualWorkCandidates(undefined), []);
  for (const state of ["loading", "submitting"]) assert.ok(manualWorkImportRequest("shipinhao_work", sph, draft, state, rows).error);
  assert.ok(manualWorkImportRequest("shipinhao_work", sph, draft, "idle", []).error);
  assert.ok(manualWorkImportRequest("shipinhao_work", sph, { ...draft, sourceId: "source-old-page" }, "idle", rows).error);
  assert.ok(manualWorkImportRequest("shipinhao_work", sph, { ...draft, sourceId: "editorial" }, "idle", rows).error);
});

test("only MH share input prefills a native original; received IDs and media URLs never synthesize it", () => {
  assert.equal(manualWorkDefaultUrl({ platform: "shipinhao", operationId: "MH5YA9DL", inputUrl: sphUrl, record: { exportId: "not-videoId" } }), sphUrl);
  assert.equal(manualWorkDefaultUrl({ ...sph, inputUrl: sphUrl }), "");
  assert.equal(manualWorkDefaultUrl({ ...ks, inputUrl: ksUrl, url: ksUrl }), "");
  assert.equal(manualWorkDefaultUrl({ platform: "shipinhao", operationId: "MH5YA9DL", inputUrl: "https://finder.video.qq.com/video.mp4" }), "");
});

test("video-channel search/list detail uses only actual raw videoId and source result PK", () => {
  for (const operationId of ["E7G00COY", "OVUTOTCV"]) assert.deepEqual(manualWorkDetailRequest(42, "shipinhao_work", { ...sph, operationId, identity: { videoId: "not-used" }, requestedWorkId: "not-used", origin: { discoveredAt: "not-used" } }), { operationId: "OE4KUEUO", parameters: { videoId: "opaque-video-1" }, sourceResultId: 42 });
  assert.equal(manualWorkDetailRequest(42, "shipinhao_work", { ...sph, record: { exportId: "not-a-videoId" }, workId: "not-used", requestedWorkId: "not-used" }), null);
  for (const operationId of ["MH5YA9DL", "OE4KUEUO", "NL4I3533"]) assert.equal(manualWorkDetailRequest(42, "shipinhao_work", { ...sph, operationId }), null);
});

test("Kuaishou search/list detail preserves full opaque photoId without using requested or normalized IDs", () => {
  for (const operationId of ["27DQ6SF9", "ZWR31P2A"]) assert.deepEqual(manualWorkDetailRequest(42, "kuaishou_work", { ...ks, operationId, workId: "normalized-not-used", requestedWorkId: "not-used", sourceId: "not-used", origin: { discoveredAt: "not-used" } }), { operationId: "UOM99OQI", parameters: { photoId: ks.record.photoId }, sourceResultId: 42 });
  assert.equal(manualWorkDetailRequest(42, "kuaishou_work", { ...ks, record: {}, workId: "normalized-not-used", requestedWorkId: "not-used" }), null);
  assert.equal(manualWorkDetailRequest(42, "kuaishou_work", { ...ks, operationId: "UOM99OQI" }), null);
  assert.equal(manualWorkDetailRequest(42, "kuaishou_account", ks), null);
  assert.equal(manualWorkDetailRequest(42, "shipinhao_account", sph), null);
  for (const resultId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(manualWorkDetailRequest(resultId, "kuaishou_work", ks), null);
});

test("exact opt-in creation preset initializes isolation and no fulltext/first-party permissions without guessing name or identity", () => {
  const preset = sourceNewPreset("isolated-external");
  assert.deepEqual(preset, { form: { kind: "external", participation_mode: "isolated", first_party: false, site_fulltext: false, syndicate_fulltext: false }, config: {} });
  assert.equal("id" in preset!.form, false); assert.equal("name" in preset!.form, false);
  assert.notEqual(sourceNewPreset("isolated-external")!.config, preset!.config);
});

test("ordinary source creation and other template spellings receive no preset changes", () => {
  for (const template of [null, "", "external", "ISOLATED-EXTERNAL", "isolated-external ", "other"]) assert.equal(sourceNewPreset(template), null);
});

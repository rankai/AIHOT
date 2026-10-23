import assert from "node:assert/strict";
import { test } from "node:test";
import { shipinhaoQueryParameters, shipinhaoResultData, shipinhaoShareUrl } from "../app/features/admin/shipinhao-result-data.ts";
import { kuaishouQueryParameters, kuaishouResultData } from "../app/features/admin/kuaishou-result-data.ts";
import { defaultPlatformValues, type PlatformOperation } from "../app/features/admin/platform-types.ts";

const opaque = "000987654321098765432109876543210";
const share = "https://weixin.qq.com/sph/AbC_123-note/?token=a%2Fb";

test("video-channel share input accepts only the documented host and path without local short-link resolution", () => {
  assert.equal(shipinhaoShareUrl(share), share);
  assert.equal(shipinhaoShareUrl("http://weixin.qq.com/sph/A"), "http://weixin.qq.com/sph/A");
  for (const value of ["https://weixin.qq.com/other/A", "https://wx.example/sph/A", "https://weixin.qq.com.evil.test/sph/A", "https://user:pass@weixin.qq.com/sph/A", "https://weixin.qq.com:443/sph/A", "https://weixin.qq.com:8443/sph/A", `${share}#`, "https://weixin.qq.com/sph/", "https://weixin.qq.com/sph/A/extra", "javascript:alert(1)"]) assert.equal(shipinhaoShareUrl(value), null, value);
  const operation: PlatformOperation = { id: "MH5YA9DL", platform: "shipinhao", label: "分享详情", purpose: "query", schedulableType: null, fields: [{ name: "url", label: "分享链接", type: "string", required: true }] };
  assert.deepEqual(shipinhaoQueryParameters(operation, { url: share }), { url: share });
  assert.throws(() => shipinhaoQueryParameters(operation, { url: "https://example.com/short" }));
});

test("video-channel response exportId and videoId remain distinct and requested IDs cannot fill missing response identity", () => {
  const detail = shipinhaoResultData("shipinhao_work", { requestedWorkId: opaque, workId: null, record: { description: "detail without ID", videoDuration: "18.5" } });
  assert.equal(detail.videoId, null);
  assert.equal(detail.exportId, null);
  assert.equal(detail.requestedWorkId, opaque);
  assert.equal(detail.duration, "18.5", "no inferred unit or conversion");
  const shared = shipinhaoResultData("shipinhao_work", { workId: "export+/=", workIdKind: "exportId", inputUrl: share, record: { exportId: "export+/=", videoId: "response-video-ID" } });
  assert.equal(shared.exportId, "export+/=");
  assert.equal(shared.videoId, "response-video-ID");
  assert.equal(shared.inputUrl, share);
});

test("video-channel account names stay record facts and only safe media fields become links", () => {
  const facts = shipinhaoResultData("shipinhao_account", { identity: {}, inputUrl: share, record: { nickname: "name", findName: opaque, headUrl: "https://cdn.example/avatar.jpg", coverImgUrl: "javascript:alert(1)", videoUrl: "https://user:pass@cdn.example/video.mp4" }, missing: ["缺少稳定作者 ID", { bad: true }] });
  assert.equal(facts.account, true);
  assert.equal(facts.work, false);
  assert.equal(facts.videoId, null);
  assert.equal(facts.exportId, null);
  assert.equal(facts.record.findName, opaque);
  assert.deepEqual(facts.missing, ["缺少稳定作者 ID"]);
  assert.deepEqual(facts.media.map(item => item.field), ["headUrl"]);
  assert.ok(!facts.media.some(item => item.url === share), "query input is not promoted to media or original");
});

test("video-channel search preserves false, Chinese sort choice and declared page/size number types", () => {
  const operation: PlatformOperation = { id: "E7G00COY", platform: "shipinhao", label: "搜索", purpose: "query", schedulableType: null, fields: [
    { name: "keyword", label: "关键词", type: "string", required: true },
    { name: "sort", label: "排序", type: "select", required: false, default: "综合", options: ["综合", "最新", "最多点赞", "最多收藏"].map(value => ({ value, label: value })) },
    { name: "page", label: "页码", type: "integer", required: false, default: 1, constraints: { min: 1 } },
    { name: "size", label: "每页", type: "integer", required: false, default: 20, constraints: { min: 1, max: 50 } },
    { name: "exactMatch", label: "精准", type: "boolean", required: false, default: false },
  ] };
  assert.deepEqual(shipinhaoQueryParameters(operation, { ...defaultPlatformValues(operation), keyword: "query" }), { keyword: "query", sort: "综合", page: 1, size: 20, exactMatch: false });
  assert.throws(() => shipinhaoQueryParameters(operation, { keyword: "query", page: "1.5" }));
  assert.throws(() => shipinhaoQueryParameters(operation, { keyword: "query", size: "51" }));
  assert.throws(() => shipinhaoQueryParameters(operation, { keyword: "query", sort: "unknown" }));
});

test("Kuaishou account-work query requires exactly one locator, retaining its original string namespace", () => {
  const operation: PlatformOperation = { id: "27DQ6SF9", platform: "kuaishou", label: "列表", purpose: "query", schedulableType: null, fields: [
    { name: "kwaiId", label: "展示号", type: "string", required: false },
    { name: "threeXId", label: "主页定位 ID", type: "string", required: false },
    { name: "page", label: "页码", type: "integer", required: false, constraints: { min: 1 } },
    { name: "size", label: "条数", type: "integer", required: false, constraints: { min: 1, max: 50 } },
  ] };
  assert.throws(() => kuaishouQueryParameters(operation, {}));
  assert.throws(() => kuaishouQueryParameters(operation, { kwaiId: " ", threeXId: " " }));
  assert.throws(() => kuaishouQueryParameters(operation, { kwaiId: opaque, threeXId: "profile-locator" }));
  assert.deepEqual(kuaishouQueryParameters(operation, { kwaiId: opaque, page: "2", size: "50" }), { kwaiId: opaque, page: 2, size: 50 });
  assert.deepEqual(kuaishouQueryParameters(operation, { kwaiId: " ", threeXId: "profile-locator" }), { threeXId: "profile-locator" });
});

test("Kuaishou photoId is only a received record field while requestedWorkId and display account locator remain separate", () => {
  const detail = kuaishouResultData("kuaishou_work", { requestedWorkId: opaque, record: { caption: "no returned ID", duration: "1500" } });
  assert.equal(detail.photoId, null);
  assert.equal(detail.requestedWorkId, opaque);
  assert.equal(detail.duration, "1500", "milliseconds are displayed without rounding or converting to seconds");
  const actual = kuaishouResultData("kuaishou_work", { requestedWorkId: "request", record: { photoId: opaque, duration: 0 } });
  assert.equal(actual.photoId, opaque);
  assert.equal(actual.requestedWorkId, "request");
  assert.equal(actual.duration, 0);
  const account = kuaishouResultData("kuaishou_account", { identity: {}, record: { kwaiId: opaque, nickname: "name" } });
  assert.equal(account.account, true);
  assert.equal(account.photoId, null);
  assert.equal(account.record.kwaiId, opaque);
});

test("Kuaishou media includes only safe HTTP(S) links, not response originals or unsupported schemes", () => {
  const facts = kuaishouResultData("kuaishou_work", { url: null, record: { videoUrl: "https://cdn.example/video.mp4", coverUrl: "data:image/png;base64,abc", headUrl: "https://user@cdn.example/avatar.jpg", coverImgUrl: "http://cdn.example/cover.jpg" }, missing: ["视频 CDN 地址不是原文", null] });
  assert.deepEqual(facts.media.map(item => item.field), ["videoUrl", "coverImgUrl"]);
  assert.deepEqual(facts.missing, ["视频 CDN 地址不是原文"]);
});

test("Kuaishou account search retains pageSize input and detail photo IDs are never coerced to numbers", () => {
  const account: PlatformOperation = { id: "GU17EVLV", platform: "kuaishou", label: "账号搜索", purpose: "query", schedulableType: null, fields: [
    { name: "accountName", label: "名称", type: "string", required: true },
    { name: "page", label: "页码", type: "integer", required: false, default: 1, constraints: { min: 1 } },
    { name: "pageSize", label: "每页", type: "integer", required: false, default: 20, constraints: { min: 1, max: 50 } },
  ] };
  assert.deepEqual(kuaishouQueryParameters(account, { ...defaultPlatformValues(account), accountName: "name" }), { accountName: "name", page: 1, pageSize: 20 });
  assert.throws(() => kuaishouQueryParameters(account, { accountName: "name", pageSize: "51" }));
  const detail: PlatformOperation = { ...account, id: "UOM99OQI", fields: [{ name: "photoId", label: "作品 ID", type: "string", required: true }] };
  assert.deepEqual(kuaishouQueryParameters(detail, { photoId: opaque }), { photoId: opaque });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { youtubeDetailRequest, youtubeImportFields, youtubeImportSupplement, youtubeNativeVideo, youtubeQueryParameters } from "../app/features/admin/youtube-result-data.ts";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";

const id = "aB3_9-xyZ01";
const url = `https://www.youtube.com/watch?feature=share&v=${id}&token=a%2Fb`;
const channelId = "opaque_channel-ID_123";
const draft = { url, channelId, evidence: "已核实同一视频及稳定频道身份" };

test("native watch original preserves an exact eleven-character ID and other query bytes", () => {
  assert.deepEqual(youtubeNativeVideo(url), { url, id });
  assert.equal(youtubeNativeVideo(`http://youtube.com/watch?v=${id}&t=12`)?.id, id);
  assert.equal(youtubeNativeVideo(`https://youtube.com/watch?%76=${id}`)?.id, id);
});

test("duplicate v, unsupported paths, short links, credentials, explicit ports and fragments are rejected", () => {
  for (const address of [
    `${url}&v=${id}`, `${url}&v=`, `https://youtube.com/watch?%76=${id}&v=${id}`,
    `https://youtube.com/watch?v=${id.slice(1)}`, `https://youtube.com/watch?v=${id}x`, "https://youtube.com/watch?V=aB3_9-xyZ01",
    `https://youtu.be/${id}`, `https://youtube.com/shorts/${id}`, `https://youtube.com/embed/${id}`, `https://youtube.com/watch/?v=${id}`,
    "https://i.ytimg.com/vi/aB3_9-xyZ01/default.jpg", `https://m.youtube.com/watch?v=${id}`,
    `https://youtube.com.evil.test/watch?v=${id}`, `https://user:pass@youtube.com/watch?v=${id}`, `https://@youtube.com/watch?v=${id}`,
    `https://youtube.com:8443/watch?v=${id}`, `https://youtube.com:443/watch?v=${id}`, `${url}#`, `${url}#part`, "javascript:alert(1)",
  ]) assert.equal(youtubeNativeVideo(address), null, address);
});

test("received unsupported originals and conflicting video IDs cannot be replaced by a valid draft", () => {
  for (const address of [`https://youtu.be/${id}`, `https://youtube.com/shorts/${id}`]) {
    const fields = youtubeImportFields("youtube_work", { workId: id, identity: { channelId }, url: address }, url);
    assert.equal(fields.needsUrl, false);
    assert.equal(fields.canImport, false);
    assert.ok(youtubeImportSupplement(fields, draft).error);
  }
  assert.equal(youtubeImportFields("youtube_work", { workId: "dQw4w9WgXcQ", identity: { channelId }, url }).canImport, false);
});

test("received identity DTO preserves optional author provenance without treating handles or raw channel fields as IDs", () => {
  const fields = youtubeImportFields("youtube_work", { workId: id, url, identity: {}, record: { channelId, author: "display name", channelHandle: "@handle", channelUrl: "https://youtube.com/@handle" } });
  assert.equal(fields.channelId, null);
  assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.equal(fields.needsUrl, false);
  assert.equal(youtubeImportFields("query_summary", { workId: id, url, identity: { channelId } }).canImport, false);
});

test("complete received video and channel fields never become user overrides", () => {
  const fields = youtubeImportFields("youtube_work", { workId: id, url, identity: { channelId } });
  assert.equal(fields.canImport, true);
  assert.deepEqual(youtubeImportSupplement(fields, { url: "https://example.com/replace", evidence: "changed" }), {});
});

test("missing original needs one matching watch ID and evidence; correction leaves received channel intact", () => {
  const fields = youtubeImportFields("youtube_work", { workId: id, identity: { channelId } });
  assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.ok(youtubeImportSupplement(fields, { ...draft, url: url.replace(id, "dQw4w9WgXcQ") }).error);
  assert.ok(youtubeImportSupplement(fields, { ...draft, url: `${url}&v=${id}` }).error);
  assert.ok(youtubeImportSupplement(fields, { ...draft, evidence: " " }).error);
  assert.deepEqual(youtubeImportSupplement(fields, draft), { supplement: { url, evidence: draft.evidence } });
});

test("work import without author ID needs no author supplement or evidence; only missing original is supplemented", () => {
  const fields = youtubeImportFields("youtube_work", { identity: {}, workId: id, url });
  assert.equal(fields.canImport, true); assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.deepEqual(youtubeImportSupplement(fields, { url: "", evidence: "" }), {});
  const noOriginal = youtubeImportFields("youtube_work", { identity: {}, workId: id });
  assert.ok(youtubeImportSupplement(noOriginal, { url, evidence: "" }).error);
  assert.deepEqual(youtubeImportSupplement(noOriginal, { url, evidence: draft.evidence }), { supplement: { url, evidence: draft.evidence } });
});

test("same-video detail payload contains only operation, received ID and actual result PK, even without a channel", () => {
  const data = { platform: "youtube", operationId: "GC5SC5HS", workId: id, identity: {}, origin: { discoveredAt: "user-supplied" }, originResultId: 999, author: "untrusted", url: `https://youtu.be/${id}` };
  assert.deepEqual(youtubeDetailRequest(42, "youtube_work", data), { operationId: "609DF2IR", parameters: { videoId: id }, sourceResultId: 42 });
  assert.equal(youtubeDetailRequest(42, "youtube_work", { ...data, workId: null, record: { videoId: id } }), null);
  assert.equal(youtubeDetailRequest(42, "youtube_work", { ...data, workId: id.slice(1) }), null);
  assert.equal(youtubeDetailRequest(42, "youtube_work", { ...data, operationId: "609DF2IR" }), null);
  assert.equal(youtubeDetailRequest(42, "query_summary", data), null);
  assert.equal(youtubeDetailRequest(42, "youtube_work", { ...data, platform: "other" }), null);
  for (const resultId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(youtubeDetailRequest(resultId, "youtube_work", data), null);
});

test("YouTube forms preserve opaque continuation text and empty tokens while retaining ordinary keyword handling", () => {
  const operation: PlatformOperation = { id: "GC5SC5HS", platform: "youtube", label: "search", purpose: "query", schedulableType: null, fields: [
    { name: "searchQuery", label: "关键词", type: "string", required: true },
    { name: "continuationToken", label: "游标", type: "string", required: false },
  ] };
  const token = "  opaque%2B+/_-==  ";
  assert.deepEqual(youtubeQueryParameters(operation, { searchQuery: " keyword ", continuationToken: token }), { searchQuery: "keyword", continuationToken: token });
  assert.deepEqual(youtubeQueryParameters(operation, { searchQuery: "keyword", continuationToken: "" }), { searchQuery: "keyword", continuationToken: "" });
  assert.deepEqual(platformParameters(operation, { searchQuery: " keyword ", continuationToken: token }), { searchQuery: "keyword", continuationToken: token.trim() }, "other platforms keep their existing shared conversion");
  const detail: PlatformOperation = { ...operation, id: "609DF2IR", fields: [{ name: "videoId", label: "视频 ID", type: "string", required: true }] };
  assert.deepEqual(youtubeQueryParameters(detail, { videoId: id }), { videoId: id });
  assert.throws(() => youtubeQueryParameters(detail, { videoId: "@channel" }));
});

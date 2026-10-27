import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateSelectionValid } from "../app/features/admin/candidate-selection.ts";
import { instagramDetailRequest, instagramImportFields, instagramImportSupplement, instagramMediaLinks, instagramNativePost, instagramQueryParameters } from "../app/features/admin/instagram-result-data.ts";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";

const code = "AbC_123-note-longer-than-eleven";
const url = `https://www.instagram.com/p/${code}/?share=a%2Fb`;
const userId = "987654321098765432109876543210";
const draft = { url, userId, evidence: "已核实同一帖子及稳定作者 ID" };

test("native p and reel permalinks retain opaque shortcode case and query bytes without an eleven-character rule", () => {
  assert.deepEqual(instagramNativePost(url), { url, id: code });
  assert.equal(instagramNativePost(`http://instagram.com/reel/${code}`)?.id, code);
  assert.equal(instagramNativePost("https://instagram.com/p/A/")?.id, "A");
  assert.notEqual(instagramNativePost(url.replace("AbC", "abc"))?.id, code);
});

test("profiles, stories, unsupported hosts, CDN links, credentials, explicit ports and fragments are not originals", () => {
  for (const address of [
    "https://instagram.com/username/", `https://instagram.com/stories/username/${code}/`, `https://instagram.com/reels/${code}/`,
    `https://ig.me/${code}`, `https://cdninstagram.com/p/${code}/`, `https://instagram.com.evil.test/p/${code}/`,
    `https://user:pass@instagram.com/p/${code}/`, `https://@instagram.com/p/${code}/`, `https://instagram.com:8443/p/${code}/`, `https://instagram.com:443/p/${code}/`,
    `${url}#`, `${url}#part`, `https://instagram.com/p/${code}/extra`, "https://instagram.com/p/with.dot/", "https://instagram.com/p/",
    "javascript:alert(1)", "data:image/png;base64,abc",
  ]) assert.equal(instagramNativePost(address), null, address);
});

test("received invalid original cannot be replaced, but same-post explicit detail lookup remains available from a valid code", () => {
  const data = { platform: "instagram", operationId: "GM0TISWI", workId: code, url: "https://ig.me/short", identity: {} };
  const fields = instagramImportFields("instagram_work", data, url);
  assert.equal(fields.canImport, false);
  assert.equal(fields.needsUrl, false);
  assert.ok(instagramImportSupplement(fields, draft).error);
  assert.ok(instagramDetailRequest(42, "instagram_work", data));
  assert.equal(instagramImportFields("instagram_work", { workId: "different-code", url, identity: { userId } }).canImport, false);
});

test("account binding needs received numeric userId; usernames, display names and media IDs do not prove ownership", () => {
  const fields = instagramImportFields("instagram_account", { identity: { userId }, record: { username: "locator", fullName: "display" } });
  assert.equal(fields.canImport, true);
  assert.equal(fields.userId, userId);
  assert.deepEqual(instagramImportSupplement(fields, draft), {});
  const missing = instagramImportFields("instagram_account", { identity: {}, record: { userId, username: "locator", fullName: "display" } });
  assert.equal(missing.canImport, false);
  assert.equal(Object.hasOwn(missing, "needsIdentity"), false);
  assert.ok(instagramImportSupplement(missing, draft).error);
  const work = instagramImportFields("instagram_work", { identity: {}, workId: code, url, record: { mediaId: userId, postId: userId, user: { id: userId }, carouselItems: [{ id: userId }] } });
  assert.equal(Object.hasOwn(work, "needsIdentity"), false);
  assert.equal(instagramImportFields("query_summary", { identity: { userId }, workId: code, url }).canImport, false);
});

test("existing external candidates must remain in the current idle result page and correct kind", () => {
  const current = [{ id: "source-current" }];
  assert.equal(candidateSelectionValid("source-current", "idle", "external", "external", current), true);
  assert.equal(candidateSelectionValid("source-current", "loading", "external", "external", current), false);
  assert.equal(candidateSelectionValid("source-current", "idle", "external", "external", []), false);
  assert.equal(candidateSelectionValid("source-old-page", "idle", "external", "external", current), false);
  assert.equal(candidateSelectionValid("source-current", "idle", "external", "mp_account", current), false);
});

test("complete received identity and original are never emitted as user overrides", () => {
  const fields = instagramImportFields("instagram_work", { workId: code, url, identity: { userId } });
  assert.deepEqual(instagramImportSupplement(fields, { url: "https://example.com/replace", evidence: "changed" }), {});
});

test("missing original needs matching native shortcode and evidence, while no received shortcode can be confirmed by a verified native URL", () => {
  const fields = instagramImportFields("instagram_work", { workId: code, identity: { userId } });
  assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.ok(instagramImportSupplement(fields, { ...draft, url: url.replace(code, "different-code") }).error);
  assert.ok(instagramImportSupplement(fields, { ...draft, evidence: " " }).error);
  assert.deepEqual(instagramImportSupplement(fields, draft), { supplement: { url, evidence: draft.evidence } });
  const noCode = instagramImportFields("instagram_work", { workId: null, url: null, identity: { userId } });
  assert.deepEqual(instagramImportSupplement(noCode, draft), { supplement: { url, evidence: draft.evidence } });
});

test("work import without author ID needs no author supplement or evidence; only missing original is supplemented", () => {
  const fields = instagramImportFields("instagram_work", { identity: {}, workId: code, url });
  assert.equal(fields.canImport, true); assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.deepEqual(instagramImportSupplement(fields, { url: "", evidence: "" }), {});
  const noOriginal = instagramImportFields("instagram_work", { identity: {}, workId: code });
  assert.ok(instagramImportSupplement(noOriginal, { url, evidence: "" }).error);
  assert.deepEqual(instagramImportSupplement(noOriginal, { url, evidence: draft.evidence }), { supplement: { url, evidence: draft.evidence } });
});

test("detail lookup whitelists only received shortcode and actual source result PK, regardless of missing author", () => {
  const data = { platform: "instagram", operationId: "GM0TISWI", workId: code, identity: {}, origin: { discoveredAt: "manual" }, originResultId: 900, author: "untrusted" };
  assert.deepEqual(instagramDetailRequest(42, "instagram_work", data), { operationId: "Z9M88QI8", parameters: { codeOrUrl: code }, sourceResultId: 42 });
  assert.ok(instagramDetailRequest(42, "instagram_work", { ...data, workId: "A" }));
  for (const workId of [null, "", "has.dot", "has space", "https://instagram.com/p/abc/"]) assert.equal(instagramDetailRequest(42, "instagram_work", { ...data, workId, record: { code } }), null);
  assert.equal(instagramDetailRequest(42, "instagram_account", data), null);
  assert.equal(instagramDetailRequest(42, "instagram_work", { ...data, operationId: "Z9M88QI8" }), null);
  assert.equal(instagramDetailRequest(42, "instagram_work", { ...data, platform: "other" }), null);
  for (const resultId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(instagramDetailRequest(resultId, "instagram_work", data), null);
});

test("search keeps opaque pagination token bytes and empty token; other platform string handling stays unchanged", () => {
  const operation: PlatformOperation = { id: "GM0TISWI", platform: "instagram", label: "search", purpose: "query", schedulableType: null, fields: [
    { name: "keyword", label: "keyword", type: "string", required: true },
    { name: "paginationToken", label: "token", type: "string", required: false },
  ] };
  const token = "  opaque%2B+/_-==  ";
  assert.deepEqual(instagramQueryParameters(operation, { keyword: " query ", paginationToken: token }), { keyword: "query", paginationToken: token });
  assert.deepEqual(instagramQueryParameters(operation, { keyword: "query", paginationToken: "" }), { keyword: "query", paginationToken: "" });
  assert.deepEqual(platformParameters(operation, { keyword: " query ", paginationToken: token }), { keyword: "query", paginationToken: token.trim() });
});

test("account query permits username and userId together without XOR, preserving the full ID for upstream priority", () => {
  const operation: PlatformOperation = { id: "3YJT69FL", platform: "instagram", label: "account", purpose: "query", schedulableType: null, fields: [
    { name: "username", label: "username", type: "string", required: false },
    { name: "userId", label: "userId", type: "string", required: false },
  ] };
  assert.deepEqual(instagramQueryParameters(operation, { username: "ignored-locator", userId }), { username: "ignored-locator", userId });
  assert.deepEqual(instagramQueryParameters(operation, { userId }), { userId });
  assert.deepEqual(instagramQueryParameters(operation, { username: "locator" }), { username: "locator" });
  assert.throws(() => instagramQueryParameters(operation, {}));
  assert.throws(() => instagramQueryParameters(operation, { username: "locator", userId: "not-digits" }));
  const detail: PlatformOperation = { ...operation, id: "Z9M88QI8", fields: [{ name: "codeOrUrl", label: "code", type: "string", required: true }] };
  for (const codeOrUrl of ["A", code, url, `https://instagram.com/reel/${code}/`]) assert.deepEqual(instagramQueryParameters(detail, { codeOrUrl }), { codeOrUrl });
  assert.throws(() => instagramQueryParameters(detail, { codeOrUrl: "https://instagram.com/stories/name/123/" }));
});

test("safe media links remain visible for video plus carousel records without treating child IDs as identity", () => {
  const record = { mediaType: 2, videoUrl: "https://cdn.example/video.mp4", thumbnailUrl: "https://cdn.example/cover.jpg", imageUrl: "javascript:alert(1)", carouselItems: [{ id: userId, isVideo: false, imageUrl: "https://cdn.example/child.jpg" }, { id: "2", isVideo: true, videoUrl: "https://user:pass@cdn.example/unsafe.mp4", thumbnailUrl: "https://cdn.example/child-cover.jpg" }] };
  assert.deepEqual(instagramMediaLinks(record).map(item => item.field), ["videoUrl", "thumbnailUrl"]);
  assert.deepEqual(record.carouselItems.map(item => instagramMediaLinks(item).map(link => link.field)), [["imageUrl"], ["thumbnailUrl"]]);
  assert.equal(record.carouselItems[0]!.id, userId);
  assert.deepEqual(instagramMediaLinks({ videoUrl: "data:video/mp4;base64,abc", profilePicUrl: "https://cdn.example/avatar.jpg" }).map(item => item.field), ["profilePicUrl"]);
});

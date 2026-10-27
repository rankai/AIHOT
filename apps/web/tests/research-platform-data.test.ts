import assert from "node:assert/strict";
import { test } from "node:test";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";
import { isResearchPlatform, isResearchResult, researchBodyFields, researchCaution, researchFactText, researchLinks, researchQueryParameters, researchRecordRows, researchScalarRows, researchSummaryRows } from "../app/features/admin/research-platform-data.ts";

const base: Omit<PlatformOperation, "id" | "platform" | "fields"> = { label: "query", purpose: "query", schedulableType: null };
const huge = "000987654321098765432109876543210";

test("only the five bounded research platforms and matching result kinds use this presentation", () => {
  for (const platform of ["qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu"]) {
    assert.equal(isResearchPlatform(platform), true);
    assert.equal(isResearchResult(`${platform}_work`, { platform }), true);
    assert.equal(isResearchResult("query_summary", { platform }), true);
    assert.equal(isResearchResult("toutiao_work", { platform }), false);
    assert.equal(isResearchResult("image", { platform }), false);
  }
  for (const platform of [null, "toutiao", "shipinhao", "kuaishou", "unknown"]) assert.equal(isResearchPlatform(platform), false);
  assert.equal(isResearchResult("dongchedi_account", { platform: "dongchedi" }), true);
});

test("Baijiahao account page keeps opaque whitespace and strings while empty required input is rejected", () => {
  const operation: PlatformOperation = { ...base, id: "API_1789097000885", platform: "baijiahao", fields: [{ name: "page", label: "page", type: "string", required: true }, { name: "keyword", label: "keyword", type: "string", required: true }] };
  const page = "  opaque%2B+/_-==  ";
  assert.deepEqual(researchQueryParameters(operation, { page, keyword: " query " }), { page, keyword: "query" });
  assert.deepEqual(researchQueryParameters(operation, { page: " ", keyword: "query" }), { page: " ", keyword: "query" });
  assert.deepEqual(researchQueryParameters(operation, { page: huge, keyword: "query" }), { page: huge, keyword: "query" });
  assert.throws(() => researchQueryParameters(operation, { page: "", keyword: "query" }));
  assert.throws(() => researchQueryParameters(operation, { page, keyword: " " }));
  assert.deepEqual(platformParameters(operation, { page, keyword: " query " }), { page: page.trim(), keyword: "query" });
});

test("Yiche list timestamp can be omitted or empty and otherwise preserves raw prior-page text without inventing now", () => {
  const operation: PlatformOperation = { ...base, id: "YGYYT0G0", platform: "yiche", fields: [{ name: "userId", label: "userId", type: "string", required: true }, { name: "timestamp", label: "timestamp", type: "string", required: false }] };
  assert.deepEqual(researchQueryParameters(operation, { userId: huge }), { userId: huge });
  for (const timestamp of ["", "  ", "  1760000000123  ", huge]) assert.deepEqual(researchQueryParameters(operation, { userId: huge, timestamp }), { userId: huge, timestamp });
});

test("numeric-string pages and offsets are not rounded, while integer zero and safe-integer validation remain unchanged", () => {
  const search: PlatformOperation = { ...base, id: "CI7VW144", platform: "qichezhijia", fields: [{ name: "keyword", label: "keyword", type: "string", required: true }, { name: "offset", label: "offset", type: "string", required: true }, { name: "page", label: "page", type: "string", required: true }, { name: "sourceType", label: "sourceType", type: "select", required: true, options: ["club", "article", "video"].map(value => ({ value, label: value })) }] };
  assert.deepEqual(researchQueryParameters(search, { keyword: "query", offset: huge, page: huge, sourceType: "club" }), { keyword: "query", offset: huge, page: huge, sourceType: "club" });
  assert.throws(() => researchQueryParameters(search, { keyword: "query", offset: "", page: "1", sourceType: "club" }));
  const detail: PlatformOperation = { ...base, id: "TE6AGWAF", platform: "qichezhijia", fields: [{ name: "videoId", label: "videoId", type: "string", required: true }, { name: "videoType", label: "videoType", type: "integer", required: true }] };
  assert.deepEqual(researchQueryParameters(detail, { videoId: huge, videoType: "0" }), { videoId: huge, videoType: 0 });
  assert.throws(() => researchQueryParameters(detail, { videoId: huge, videoType: huge }));
  const article = { ...detail, id: "LLCI8QTE", fields: [{ name: "page", label: "page", type: "integer" as const, required: true }] };
  assert.deepEqual(researchQueryParameters(article, { page: "0" }), { page: 0 });
});

test("Zhihu retains exact keword spelling and zvide enum without silently accepting other names", () => {
  const operation: PlatformOperation = { ...base, id: "API_1789095347662", platform: "zhihu", fields: [{ name: "offset", label: "offset", type: "string", required: true }, { name: "keword", label: "keword", type: "string", required: true }, { name: "vertical", label: "vertical", type: "select", required: false, options: ["answer", "article", "zvide"].map(value => ({ value, label: value })) }] };
  assert.deepEqual(researchQueryParameters(operation, { offset: huge, keword: "query", vertical: "zvide", keyword: "not-sent" }), { offset: huge, keword: "query", vertical: "zvide" });
  assert.throws(() => researchQueryParameters(operation, { offset: "0", keyword: "wrong-name" }));
  assert.throws(() => researchQueryParameters(operation, { offset: "0", keword: "query", vertical: "zvideo" }));
});

test("received identifiers, namespaces, nested author and outer account context remain separate without fallback", () => {
  const data = { platform: "yiche", identity: { userId: "nested-user" }, workNamespace: { operationId: "YGYYT0G0", sourceType: "club", workType: 0 }, requestedWorkId: "input-only", requestContext: { userId: "requested-author" }, accountContext: { userId: "outer-account" }, record: { authorId: "top-level-author", authorInfo: { userId: "nested-user", authorName: "name" }, workId: huge } };
  assert.deepEqual(researchScalarRows(data.identity), [["userId", "nested-user"]]);
  assert.deepEqual(researchScalarRows(data.accountContext), [["userId", "outer-account"]]);
  const rows = researchRecordRows(data);
  assert.ok(rows.some(([key, value]) => key === "响应 authorId" && value === "top-level-author"));
  assert.ok(rows.some(([key, value]) => key === "响应 workId" && value === huge));
  assert.equal(rows.some(([, value]) => value === "requested-author" || value === "outer-account"), false);
  assert.deepEqual(researchScalarRows({}), []);
  assert.match(researchCaution("qichezhijia"), /club、article、video/);
  assert.match(researchCaution("baijiahao"), /uk、uid、secUid/);
});

test("Yiche milliseconds duration and explicit durationSeconds stay distinct even if the generic DTO unit is seconds", () => {
  const rows = researchRecordRows({ platform: "yiche", operationId: "YGYYT0G0", durationUnit: "seconds", record: { publishTime: "1760000000123", duration: "1500", durationSeconds: 0 } });
  assert.ok(rows.some(([key, value]) => key === "原始 publishTime（毫秒）" && value === "1760000000123"));
  assert.ok(rows.some(([key, value]) => key === "响应 duration（毫秒）" && value === "1500"));
  assert.ok(rows.some(([key, value]) => key === "响应 durationSeconds（秒）" && value === "0"));
  const unknown = researchRecordRows({ platform: "yiche", operationId: "3BXWEB6Y", record: { duration: "15" } });
  assert.ok(unknown.some(([key]) => key === "响应 duration（单位未说明）"));
});

test("per-operation publication and duration units never promote unknown or relative timestamps", () => {
  const dongSearch = researchRecordRows({ platform: "dongchedi", operationId: "W86F8SSK", record: { publishTime: 0, durationSeconds: null } });
  assert.ok(dongSearch.some(([key, value]) => key === "原始 publishTime（秒）" && value === "0"));
  assert.ok(dongSearch.some(([key, value]) => key === "响应 durationSeconds（秒）" && value === "null（上游为空）"));
  const dongDetail = researchRecordRows({ platform: "dongchedi", operationId: "QQ5E3EZ9", record: { publishTime: "昨天", workType: 1 } });
  assert.ok(dongDetail.some(([key, value]) => key.includes("单位 / 时区未由此确定") && value === "昨天"));
  for (const [platform, operationId] of [["qichezhijia", "4BOZ9DLE"], ["baijiahao", "API_1789097000761"]]) assert.ok(researchRecordRows({ platform, operationId, record: { duration: "10" } }).some(([key]) => key === "响应 duration（秒）"));
  const zhihu = researchRecordRows({ platform: "zhihu", record: { publishTime: huge, isEnd: false } });
  assert.ok(zhihu.some(([key, value]) => key.includes("单位 / 时区未由此确定") && value === huge));
  assert.ok(zhihu.some(([key, value]) => key === "本项 isEnd（不合成为整页状态）" && value === "false（布尔值）"));
});

test("actual count, total, combined result counts and opaque page remain independent, preserving false versus zero types", () => {
  const summary = researchSummaryRows({ count: 3, total: "500", accountCount: 1, workCount: 2, page: "  opaque%2B+==  ", hasMore: false });
  assert.ok(summary.some(([key, value]) => key === "本次实际返回 count" && value === "3（number）"));
  assert.ok(summary.some(([key, value]) => key === "上游 total" && value === "500（string）"));
  assert.ok(summary.some(([key, value]) => key === "上游 page" && value === "  opaque%2B+==  （string）"));
  assert.ok(summary.some(([key, value]) => key === "上游 hasMore" && value === "false（布尔值）"));
  assert.notDeepEqual(researchSummaryRows({ hasMore: 0 }), researchSummaryRows({ hasMore: "0" }));
  assert.deepEqual(researchSummaryRows({ count: 0 }), [["本次实际返回 count", "0（number）"]]);
  assert.equal(researchSummaryRows({ count: 0 }).some(([key]) => key.includes("hasMore")), false);
});

test("media arrays and resources expose only safe HTTP(S) anchors; unsafe and relative values remain textual facts", () => {
  const data = { platform: "yiche", record: { imageList: ["https://cdn.example/pic.jpg", "//cdn.example/relative.jpg", "javascript:alert(1)"], resources: [{ downloadUrl: "https://cdn.example/video.mp4" }, { downloadUrl: "https://user:pass@cdn.example/unsafe.mp4" }, { downloadUrl: null }], authorInfo: { avatar: "https://cdn.example/avatar.jpg" } } };
  const links = researchLinks(data);
  assert.equal(links.find(item => item.key === "imageList[0]")?.url, "https://cdn.example/pic.jpg");
  assert.equal(links.find(item => item.key === "imageList[1]")?.value, "//cdn.example/relative.jpg");
  assert.equal(links.find(item => item.key === "imageList[1]")?.url, null);
  assert.equal(links.find(item => item.key === "imageList[2]")?.url, null);
  assert.equal(links.find(item => item.key === "resources[0].downloadUrl")?.url, "https://cdn.example/video.mp4");
  assert.equal(links.find(item => item.key === "resources[1].downloadUrl")?.url, null);
  assert.equal(links.find(item => item.key === "resources[2].downloadUrl")?.value, null);
  assert.equal(links.find(item => item.key === "authorInfo.avatar")?.url, "https://cdn.example/avatar.jpg");
});

test("Baijiahao video author homepage and media stay separate from a missing original", () => {
  const data = { platform: "baijiahao", operationId: "API_1789097000761", url: null, record: { url: "https://author.example/profile", playUrl: "https://cdn.example/video.mp4", accountUrl: "https://author.example/other", posterImage: "data:image/png;base64,abc" } };
  const links = researchLinks(data);
  assert.match(links.find(item => item.key === "url")!.role, /作者主页，不是作品原文/);
  assert.match(links.find(item => item.key === "playUrl")!.role, /不是原文/);
  assert.equal(links.find(item => item.key === "posterImage")?.url, null);
  assert.equal(data.url, null);
  assert.equal(researchLinks({ platform: "zhihu", record: { opusId: huge, uid: huge } }).length, 0);
});

test("HTML-looking bodies are returned unchanged as text, with null/empty/false facts intact", () => {
  const html = '<script>alert(1)</script><img src="https://cdn.example/a.jpg">';
  assert.deepEqual(researchBodyFields({ record: { content: html, clearContent: "", description: null } }), [["content", html], ["clearContent", "空字符串"], ["description", "null（上游为空）"]]);
  assert.equal(researchFactText(false), "false（布尔值）");
  assert.equal(researchFactText(0), "0");
  assert.equal(researchFactText("0"), "0");
  assert.equal(researchFactText(null), "null（上游为空）");
});

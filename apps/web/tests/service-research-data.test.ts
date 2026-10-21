import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";
import { isServiceResearchPlatform, isServiceResearchResult, serviceHotItems, serviceLink, serviceRecordRows, serviceResearchParameters, serviceRole, serviceSummaryRows, serviceXMedia } from "../app/features/admin/service-research-data.ts";

const base: Omit<PlatformOperation, "id" | "platform" | "fields"> = { label: "query", purpose: "query", schedulableType: null };
const hot: PlatformOperation = { ...base, id: "W94P1QH1", platform: "hot-research", fields: [
  { name: "platforms", label: "平台列表", type: "integer-array", required: false, options: ["1", "2", "5", "7", "8", "9", "10"].map(value => ({ value, label: value })) },
  { name: "keywords", label: "关键词列表", type: "string-array", required: true },
  { name: "startDate", label: "startDate", type: "string", required: true }, { name: "endDate", label: "endDate", type: "string", required: true },
] };
const dates = { startDate: "2026-10-01", endDate: "2026-10-02" };
const huge = "000987654321098765432109876543210";

test("keyword lines become a true string array without comma splitting or trimming deliberate word whitespace", () => {
  const parameters = serviceResearchParameters(hot, { ...dates, keywords: "  car, battery  \nAI OR tools\r\nline-three", platforms: "1\n10" });
  assert.deepEqual(parameters, { ...dates, keywords: ["  car, battery  ", "AI OR tools", "line-three"], platforms: [1, 10] });
  const prepared = prepareAdminBody({ operationId: hot.id, parameters });
  assert.equal(prepared.json, true);
  assert.deepEqual(JSON.parse(String(prepared.body)).parameters.platforms, [1, 10]);
  assert.deepEqual(JSON.parse(String(prepared.body)).parameters.keywords, ["  car, battery  ", "AI OR tools", "line-three"]);
});

test("empty keyword lines are explicitly rejected rather than silently deleting lines or creating words", () => {
  for (const keywords of ["", " ", "one\n", "one\n\ntwo", "one\n \ntwo", "\none"]) assert.throws(() => serviceResearchParameters(hot, { ...dates, keywords }), /非空词/);
});

test("unselected platforms omit the optional array and the seven descriptor choices exclude Xiaohongshu", () => {
  assert.deepEqual(serviceResearchParameters(hot, { ...dates, keywords: "one", platforms: "" }), { ...dates, keywords: ["one"] });
  assert.deepEqual(serviceResearchParameters(hot, { ...dates, keywords: "one", platforms: "1\n2\n5\n7\n8\n9\n10" }).platforms, [1, 2, 5, 7, 8, 9, 10]);
  for (const platforms of ["6", "0", "1.5", huge, "1\nnot-an-option"]) assert.throws(() => serviceResearchParameters(hot, { ...dates, keywords: "one", platforms }), /有效/);
});

test("X cursor preserves opaque leading/trailing spaces and pipe bytes, without altering other scalar handling", () => {
  const operation: PlatformOperation = { ...base, id: "5K5EG87P", platform: "x-research", fields: [{ name: "keyword", label: "keyword", type: "string", required: true }, { name: "cursor", label: "cursor", type: "string", required: false }, { name: "searchType", label: "searchType", type: "select", required: false, options: ["Top", "Latest", "Media", "People", "Lists"].map(value => ({ value, label: value })) }] };
  const cursor = "  opaque%2B+/_-==|scope  ";
  assert.deepEqual(serviceResearchParameters(operation, { keyword: " query ", cursor, searchType: "People" }), { keyword: "query", cursor, searchType: "People" });
  assert.deepEqual(serviceResearchParameters(operation, { keyword: "query", cursor: "" }), { keyword: "query" });
  assert.equal(platformParameters(operation, { keyword: " query ", cursor }).cursor, cursor.trim());
  assert.throws(() => serviceResearchParameters(operation, { keyword: "query", searchType: "Accounts" }));
});

test("account pagination preserves original strings including large values and omits empty fields without injecting defaults", () => {
  const operation: PlatformOperation = { ...base, id: "API_1792043329817", platform: "redfox-account", fields: [{ name: "pageNum", label: "pageNum", type: "string", required: false }, { name: "pageSize", label: "pageSize", type: "string", required: false }] };
  assert.deepEqual(serviceResearchParameters(operation, { pageNum: `  ${huge}  `, pageSize: " 20 " }), { pageNum: `  ${huge}  `, pageSize: " 20 " });
  assert.deepEqual(serviceResearchParameters(operation, { pageNum: "", pageSize: "" }), {});
  assert.deepEqual(serviceResearchParameters(operation, {}), {});
  const balance = { ...operation, id: "API_1792036841619", fields: [] };
  assert.deepEqual(serviceResearchParameters(balance, { pageNum: "10", amount: "100", apiKey: "not-forwarded" }), {});
});

test("new result dispatch distinguishes actual DTO platforms and known account operations from old X and image results", () => {
  for (const kind of ["x_research_work", "x_comment", "x_followee", "x_account_rank", "query_summary"]) assert.equal(isServiceResearchResult(kind, { platform: "x-research" }), true);
  assert.equal(isServiceResearchResult("hotspot_research", { platform: "hot-research" }), true);
  assert.equal(isServiceResearchResult("query_summary", { platform: "redfox", operationId: "API_1792043329817" }), true);
  assert.equal(isServiceResearchResult("redfox_balance", { platform: "redfox", operationId: "API_1792036841619" }), true);
  assert.equal(isServiceResearchResult("account", { platform: "x-research" }), false);
  assert.equal(isServiceResearchResult("image", { platform: "redfox", operationId: "API_1792036841619" }), false);
  assert.equal(isServiceResearchResult("query_summary", { platform: "redfox", operationId: "unknown" }), false);
  for (const platform of ["qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu", "shipinhao"]) assert.equal(isServiceResearchPlatform(platform), false);
});

test("comment roots and replies retain independent roles and overall count is distinct from replyCount", () => {
  assert.equal(serviceRole("x_comment", { role: "thread-root" }), "线程根推文");
  assert.equal(serviceRole("x_comment", { role: "reply" }), "评论回复");
  assert.equal(serviceRole("x_comment", {}), "评论角色未说明");
  const rows = serviceSummaryRows({ count: 3, replyCount: 2, cursor: "  original|cursor  " });
  assert.deepEqual(rows.slice(0, 2), [["本次实际结果 count", "3（number）"], ["收到 replyCount", "2（number）"]]);
  assert.ok(rows.some(([key, value]) => key === "收到 cursor" && value === "  original|cursor  （string）"));
});

test("summary preserves false, zero, null and opaque cursors without inventing a hasMore field", () => {
  const rows = serviceSummaryRows({ count: 0, total: "0", moreUsers: false, nextCursor: null });
  assert.ok(rows.some(([key, value]) => key === "本次实际结果 count" && value === "0（number）"));
  assert.ok(rows.some(([key, value]) => key === "收到 total" && value === "0（string）"));
  assert.ok(rows.some(([key, value]) => key === "收到 moreUsers" && value === "false（布尔值）"));
  assert.ok(rows.some(([key, value]) => key === "收到 nextCursor" && value === "null（上游为空）"));
  assert.equal(rows.some(([key]) => key.includes("hasMore")), false);
});

test("aggregate hotspot groups expose only their received nested items and empty groups remain empty", () => {
  const first = { title: "topic one", hotCount: "0", url: "https://search.example/?q=one" }, second = { title: "topic two", index: 0 };
  assert.deepEqual(serviceHotItems({ operationId: "9Y4EX7RW", record: { keyword: "group", plats: ["微博"], hotSpotList: [first, second] } }), [first, second]);
  assert.deepEqual(serviceHotItems({ operationId: "9Y4EX7RW", record: { hotSpotList: [] } }), []);
  assert.deepEqual(serviceHotItems({ operationId: "W94P1QH1", group: "wbList", record: first }), [first]);
  assert.deepEqual(serviceHotItems({ operationId: "S28Q6HUD", record: second }), [second]);
});

test("media variants remain safe links or textual facts, with millisecond duration zero retained", () => {
  const media = serviceXMedia({ medias: [{ type: "video", durationMillis: 0, coverUrl: "https://cdn.example/cover.jpg", variants: [{ url: "https://cdn.example/video.mp4" }, { url: "javascript:alert(1)" }, { url: "https://user:pass@cdn.example/unsafe.mp4" }, { url: "//cdn.example/relative.mp4" }] }] });
  assert.deepEqual(media[0]?.fields, [["type", "video"], ["durationMillis", "0"]]);
  assert.deepEqual(media[0]?.links.map(link => link.url), ["https://cdn.example/cover.jpg", "https://cdn.example/video.mp4", null, null, null]);
  assert.equal(media[0]?.links.at(-1)?.value, "//cdn.example/relative.mp4");
  assert.equal(serviceLink("https://search.example/?q=keyword")?.url, "https://search.example/?q=keyword");
  assert.equal(serviceLink("data:image/png;base64,abc")?.url, null);
  assert.equal(serviceLink(huge)?.url, null);
});

test("points zero and long decimal strings remain points facts, with raw timestamps and no currency or ID conversion", () => {
  assert.deepEqual(serviceRecordRows({ totalAvailablePoints: 0, freeAvailablePoints: "0.00", paidAvailablePoints: huge }, ["totalAvailablePoints", "freeAvailablePoints", "paidAvailablePoints"]), [["totalAvailablePoints", "0"], ["freeAvailablePoints", "0.00"], ["paidAvailablePoints", huge]]);
  const entry = { points: "1.20", reason: "call", reasonDesc: "query", gmtCreate: "2026-10-20 12:34:56" };
  const rows = serviceRecordRows(entry, ["points", "reason", "reasonDesc", "gmtCreate"]);
  assert.deepEqual(rows.at(-1), ["gmtCreate（原串，时区未由此确定）", entry.gmtCreate]);
  assert.equal(serviceRole("redfox_consumption", {}), "积分调用记录");
  assert.deepEqual([entry, { ...entry }].map(record => serviceRecordRows(record, ["points", "gmtCreate"])), [serviceRecordRows(entry, ["points", "gmtCreate"]), serviceRecordRows(entry, ["points", "gmtCreate"])]);
});

test("rank JSON fields and large received user IDs are retained as strings rather than parsed or replaced by handles", () => {
  const networksJson = '[{"id":"9007199254740993123","name":"not-permanent"}]';
  assert.deepEqual(serviceRecordRows({ networksJson, userId: huge, username: "locator", requestedScreenName: "request-scope" }, ["networksJson", "userId", "username"]), [["networksJson", networksJson], ["userId", huge], ["username", "locator"]]);
  assert.deepEqual(serviceRecordRows({ requestedScreenName: "request-scope" }, ["userId", "username"]), []);
});

test("rank metrics preserve received zero, null, large strings and profile text without estimating missing values", () => {
  const record = { xFollowerCount: huge, xScore: 0, growthAbsolute: null, growthPercentage: "0.00%", statDate: "2026-10-20", biography: "first line\n<script>plain text</script>", countryName: "中国", gender: "未知", pictureUrl: "https://cdn.example/rank-avatar.jpg" };
  const keys = ["xFollowerCount", "xScore", "growthAbsolute", "growthPercentage", "statDate", "biography", "countryName", "gender"];
  assert.deepEqual(serviceRecordRows(record, keys), [["xFollowerCount", huge], ["xScore", "0"], ["growthAbsolute", "null（上游为空）"], ["growthPercentage", "0.00%"], ["statDate", "2026-10-20"], ["biography", record.biography], ["countryName", "中国"], ["gender", "未知"]]);
  assert.deepEqual(serviceRecordRows({ xScore: 0 }, keys), [["xScore", "0"]]);
  assert.equal(serviceLink(record.pictureUrl)?.url, record.pictureUrl);
  assert.equal(serviceLink("https://user:pass@cdn.example/rank-avatar.jpg")?.url, null);
});

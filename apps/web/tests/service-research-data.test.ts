import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";
import { agentKeyXContextRows, agentKeyXRecordRows, agentKeyXRole, agentKeyXScopeRows, agentKeyXSummaryRows, isAgentKeyXResearch, isServiceResearchPlatform, isServiceResearchResult, serviceHotItems, serviceLink, serviceRecordRows, serviceResearchParameters, serviceRole, serviceSummaryRows, serviceXMedia } from "../app/features/admin/service-research-data.ts";

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

test("AgentKey Weibo hot cards and related suggestions dispatch only the exact successful tools and preserve zero metrics", () => {
  const hot = { provider: "agentkey", platform: "weibo", operationId: "UAQ90A1F", tool: "TikHub/fetch_hot_search_api_v1_weibo_app_fetch_hot_search_get", record: { desc: "实收热词", desc_extr: 0 } };
  const related = { ...hot, operationId: "weibo.related_search", tool: "TikHub/fetch_similar_search_api_v1_weibo_web_v2_fetch_similar_search_get", record: { suggestion: "相关词", count: 0, discuss: 0 } };
  assert.equal(isServiceResearchResult("hotspot_research", hot), true);
  assert.equal(isServiceResearchResult("search_suggestion", related), true);
  assert.equal(isServiceResearchResult("query_summary", related), true);
  for (const data of [hot, related]) {
    assert.equal(isServiceResearchResult("weibo_work", data), false);
    assert.equal(isServiceResearchResult("hotspot_research", { ...data, tool: "other" }), false);
    assert(!serviceHotItems(data).some(item => Object.hasOwn(item, "rank")));
  }
  assert.deepEqual(serviceRecordRows(hot.record, ["desc", "desc_extr", "rank"]), [["desc", "实收热词"], ["desc_extr", "0"]]);
  assert.deepEqual(serviceRecordRows(related.record, ["suggestion", "count", "discuss"]), [["suggestion", "相关词"], ["count", "0"], ["discuss", "0"]]);
});


test("AgentKey X has its own research dispatch, received snake-case fields and typed empty facts", () => {
  const data = { platform: "x-research", provider: "agentkey" };
  assert.equal(isAgentKeyXResearch(data), true);
  for (const provider of ["redfox", "socialdata", undefined]) assert.equal(isAgentKeyXResearch({ ...data, provider }), false);
  for (const kind of ["x_research_work", "x_detail_work", "account", "x_comment", "x_followee", "hotspot_research", "query_summary"]) assert.equal(isServiceResearchResult(kind, data), true);
  assert.equal(isServiceResearchResult("article", data), false);
  assert.equal(isServiceResearchResult("account", { ...data, provider: "redfox" }), false);
  assert.deepEqual(agentKeyXRecordRows({ rest_id: huge, screen_name: null, followers_count: 0, verified: false, userId: "wrong", username: "wrong", secret: "omit" }, "author"), [["rest_id", huge], ["screen_name", "null（上游为空）"], ["followers_count", "0"], ["verified", "false（布尔值）"]]);
  assert.deepEqual(agentKeyXRecordRows({ user_id: huge, screen_name: "member", profile: "wrong role" }, "member"), [["user_id", huge], ["screen_name", "member"]]);
  assert.deepEqual(agentKeyXRecordRows({ profile: "received", rest_id: huge, protected: false, friends: 0 }, "profile"), [["profile", "received"], ["rest_id", huge], ["protected", "false（布尔值）"], ["friends", "0"]]);
  assert.deepEqual(agentKeyXRecordRows({ name: "trend", description: null, context: "scope", rank: 1, heat: 2 }, "trend"), [["name", "trend"], ["description", "null（上游为空）"], ["context", "scope"]]);
  assert.deepEqual(agentKeyXSummaryRows({ count: 0, pagination: { next_cursor: null, prev_cursor: "", cursor: "  opaque|next  ", more_users: false }, hasMore: true }), [["count", "0"], ["实收 pagination.next_cursor", "null（上游为空）"], ["实收 pagination.prev_cursor", "空字符串"], ["实收 pagination.cursor", "  opaque|next  "], ["实收 pagination.more_users", "false（布尔值）"]]);
  assert.deepEqual(agentKeyXScopeRows({ list_id: huge, received: "unknown", author: "not scope" }), [["list_id", huge]]);
});

test("AgentKey X displays received account context without mandatory author ID and rejects actual context conflicts", () => {
  const author = { rest_id: huge, screen_name: null }, authorContext = { rest_id: huge, screen_name: "actual", source: "received-account-context" };
  assert.deepEqual(agentKeyXContextRows({ author, authorContext }), [["rest_id", huge], ["screen_name", "actual"], ["source", "received-account-context"]]);
  assert.equal(author.screen_name, null);
  assert.deepEqual(agentKeyXContextRows({ author: null, authorContext }), [["rest_id", huge], ["screen_name", "actual"], ["source", "received-account-context"]]);
  for (const patch of [{ author: { rest_id: "other" } }, { authorContext: { ...authorContext, source: "request" } }]) assert.deepEqual(agentKeyXContextRows({ author, authorContext, ...patch }), []);
  for (const [identityRole, label] of [["follower", "粉丝账号"], ["followee", "关注账号"], ["list-member", "列表成员账号"], ["community-member", "社区成员账号"]]) assert.equal(agentKeyXRole("x_followee", { identityRole }), label);
  assert.equal(agentKeyXRole("x_comment", {}), "会话中的帖子（非直接回复证明）");
  assert.equal(agentKeyXRole("x_research_work", { role: "retweet-wrapper" }), "转发外层帖子");
});

test("AgentKey X selected search schema preserves the actual keyword while old Redfox trimming remains", () => {
  const operation: PlatformOperation = { ...base, id: "5K5EG87P", platform: "x-research", fields: [{ name: "keyword", label: "词", type: "string", required: true }, { name: "search_type", label: "排序", type: "select", required: true, options: [{ value: "Top", label: "Top" }] }] };
  assert.deepEqual(serviceResearchParameters(operation, { keyword: "  ordinary from:scope OR text  ", search_type: "Top", cursor: "ignored" }), { keyword: "  ordinary from:scope OR text  ", search_type: "Top" });
});


test("AgentKey X profile preserves received pinned ID arrays including empty and absent states", () => {
  const pinned = ["000123456789012345678901", "9007199254740993987"];
  assert.deepEqual(agentKeyXRecordRows({ pinned_tweet_ids_str: pinned }, "profile"), [["pinned_tweet_ids_str", JSON.stringify(pinned)]]);
  assert.deepEqual(agentKeyXRecordRows({ pinned_tweet_ids_str: [] }, "profile"), [["pinned_tweet_ids_str", "[]（空列表，0 项）"]]);
  assert.deepEqual(agentKeyXRecordRows({}, "profile"), []);
  assert.deepEqual(agentKeyXRecordRows({ pinned_tweet_ids_str: null }, "profile"), [["pinned_tweet_ids_str", "null（上游为空）"]]);
  assert.deepEqual(agentKeyXRecordRows({ pinned_tweet_ids_str: pinned }, "member"), []);
});

test("X account query and subscription fields require one actual locator and a safe numeric user ID", () => {
  const operation: PlatformOperation = { ...base, id: "x.account_posts", platform: "x-research", fields: [{ name: "screen_name", label: "账号名", type: "string", required: false }, { name: "rest_id", label: "用户 ID", type: "integer", required: false, constraints: { min: 1, max: Number.MAX_SAFE_INTEGER } }] };
  assert.deepEqual(serviceResearchParameters(operation, { screen_name: "actual_user" }), { screen_name: "actual_user" });
  assert.deepEqual(serviceResearchParameters(operation, { rest_id: "123" }), { rest_id: 123 });
  const invalid: Array<Record<string, string>> = [{}, { screen_name: "actual_user", rest_id: "123" }, { rest_id: "9007199254740992" }, { rest_id: "-1" }, { rest_id: "1.5" }, { screen_name: "@wrong" }];
  for (const values of invalid) assert.throws(() => serviceResearchParameters(operation, values));
});

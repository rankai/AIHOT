import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPlatformValues, platformParameters, type PlatformOperation, type PlatformField } from "../app/features/admin/platform-types.ts";
import { prepareAdminBody } from "../app/features/admin/action-body.ts";
import { isSocialResearchOperation, isSocialResearchResult, socialAllowsEmptyField, socialAuthor, socialLinks, socialPagingRows, socialQueryParameters, socialRecordRows, socialResearchPlatform, socialRole, socialTimeRows, socialUnsafeCursor } from "../app/features/admin/social-research-data.ts";

const id = "000900719925474099312345", opaque = "  cursor/+==|keep spaces  ";
const text = (name: string, required = true): PlatformField => ({ name, label: name, type: "string", required });
const integer = (name: string): PlatformField => ({ name, label: name, type: "integer", required: true });
function op(id: string, platform: string, fields: PlatformField[]): PlatformOperation { return { id, platform, fields, label: id, purpose: "query", schedulableType: null }; }
const following = op("API_1790577699794", "tiktok", [text("userId", false), text("secUserId", false), text("minTime"), text("pageToken")]);
const comment = op("API_1790581645603", "tiktok", [text("aweme_id"), integer("cursor")]);
const reply = op("API_1791446025175", "tiktok", [text("itemId"), text("commentId"), integer("cursor"), integer("count")]);
const toutiao = op("ZMFVK589", "toutiao", [text("opusId"), text("offset", false)]);
const youtube = op("WULKP6JP", "youtube", [text("videoId"), text("continuationToken", false), { name: "sortBy", label: "sortBy", type: "select", required: false, options: ["top", "newest"].map(value => ({ value, label: value })) }]);
const instagram = op("U1SGKF2G", "instagram", [text("codeOrUrl"), { name: "sortBy", label: "sortBy", type: "select", required: true, default: "recent", options: ["recent", "popular"].map(value => ({ value, label: value })) }, text("paginationToken", false)]);
const operations = [following, comment, reply, toutiao, youtube, instagram];

test("six operation IDs own only matching platform research kinds, without consuming existing work/account results", () => {
  for (const operation of operations) {
    assert.equal(isSocialResearchOperation(operation), true);
    assert.equal(socialResearchPlatform(operation.id), operation.platform);
    const data = { platform: operation.platform, operationId: operation.id };
    assert.equal(isSocialResearchResult(operation === following ? "social_followee" : "social_comment", data), true);
    assert.equal(isSocialResearchResult("query_summary", { ...data, role: "social-research-summary" }), true);
    for (const kind of ["account", "article", "image", `${operation.platform}_work`, `${operation.platform}_account`]) assert.equal(isSocialResearchResult(kind, data), false);
    assert.equal(isSocialResearchResult(operation === following ? "social_comment" : "social_followee", data), false);
    assert.equal(isSocialResearchResult("query_summary", data), false);
    assert.equal(isSocialResearchResult("query_summary", { ...data, platform: "weibo", role: "social-research-summary" }), false);
  }
  assert.equal(isSocialResearchOperation({ ...youtube, id: "GC5SC5HS" }), false);
  assert.equal(isSocialResearchOperation({ ...following, platform: "instagram" }), false);
  assert.equal(isSocialResearchResult("social_comment", { platform: "tiktok", operationId: "unknown" }), false);
  assert.equal(socialResearchPlatform(undefined), null);
});

test("the following first-page token is a required wire empty string and only that field permits an empty form value", () => {
  const values = { ...defaultPlatformValues(following), userId: id, minTime: "0" };
  assert.equal(socialAllowsEmptyField(following.id, "pageToken"), true);
  for (const [operationId, name] of [[following.id, "minTime"], [comment.id, "pageToken"], ["unrelated", "pageToken"]]) assert.equal(socialAllowsEmptyField(operationId!, name!), false);
  assert.throws(() => platformParameters(following, values), /pageToken/);
  const parameters = socialQueryParameters(following, values);
  assert.deepEqual(parameters, { userId: id, minTime: "0", pageToken: "" });
  assert.deepEqual(JSON.parse(String(prepareAdminBody({ operationId: following.id, parameters }).body)), { operationId: following.id, parameters: { userId: id, minTime: "0", pageToken: "" } });
  assert.throws(() => socialQueryParameters(following, { userId: id, pageToken: "" }), /minTime/);
});

test("following locator XOR and numeric-string user IDs are checked without converting IDs or guessing author identity", () => {
  const page = { minTime: "0", pageToken: "" };
  assert.deepEqual(socialQueryParameters(following, { ...page, secUserId: " received-sec " }), { ...page, secUserId: "received-sec" });
  for (const values of [{ ...page }, { ...page, userId: id, secUserId: "sec" }, { ...page, userId: "not-numeric" }, { ...page, userId: "1e20" }]) assert.throws(() => socialQueryParameters(following, values));
});

test("all documented opaque cursor/token fields preserve whitespace while optional initial tokens are omitted", () => {
  assert.deepEqual(socialQueryParameters(following, { userId: id, minTime: opaque, pageToken: opaque }), { userId: id, minTime: opaque, pageToken: opaque });
  assert.deepEqual(socialQueryParameters(toutiao, { opusId: id, offset: opaque }), { opusId: id, offset: opaque });
  assert.deepEqual(socialQueryParameters(youtube, { videoId: "video", continuationToken: opaque }), { videoId: "video", continuationToken: opaque });
  assert.deepEqual(socialQueryParameters(instagram, { ...defaultPlatformValues(instagram), codeOrUrl: "code", paginationToken: opaque }), { codeOrUrl: "code", sortBy: "recent", paginationToken: opaque });
  assert.deepEqual(socialQueryParameters(youtube, { videoId: "video", continuationToken: "" }), { videoId: "video" });
  assert.deepEqual(socialQueryParameters(toutiao, { opusId: id, offset: " " }), { opusId: id, offset: " " });
  assert.deepEqual(socialQueryParameters(instagram, { codeOrUrl: "code", sortBy: "recent", paginationToken: "" }), { codeOrUrl: "code", sortBy: "recent" });
});

test("integer cursor/count remain numbers including zero while work/comment IDs remain exact strings", () => {
  assert.deepEqual(socialQueryParameters(comment, { aweme_id: id, cursor: "0" }), { aweme_id: id, cursor: 0 });
  assert.deepEqual(socialQueryParameters(reply, { itemId: id, commentId: id, cursor: "0", count: "0" }), { itemId: id, commentId: id, cursor: 0, count: 0 });
  for (const cursor of [id, "9007199254740992", "0.5", "Infinity", "NaN"]) assert.throws(() => socialQueryParameters(comment, { aweme_id: id, cursor }), /安全整数/);
  assert.throws(() => socialQueryParameters(reply, { itemId: id, commentId: id, cursor: "0", count: id }), /安全整数/);
  assert.throws(() => socialQueryParameters({ ...reply, id: "unrelated" }, {}), /不是/);
});

test("received metrics, null reply targets and false flags are displayed without dropping or inferring values", () => {
  const rows = socialRecordRows({ commentId: id, workId: id, likeCount: "1万", replyCount: "0", hasMoreReplies: false, likedByAuthor: false, isPinned: false, isEdited: false, replyToUserId: null, threadId: 0, userName: "<script>plain text</script>", fansCount: id, content: "body", publishTime: 0 });
  for (const [key, expected] of [["commentId", id], ["likeCount", "1万"], ["replyCount", "0"], ["hasMoreReplies", "false（布尔值）"], ["replyToUserId", "null（上游为空）"], ["threadId", "0"], ["userName", "<script>plain text</script>"], ["fansCount", id]]) assert.ok(rows.some(([label, value]) => label.endsWith(`· ${key}`) && value === expected));
  assert.equal(rows.some(([key]) => key === "content" || key.includes("publishTime")), false);
  assert.deepEqual(socialRecordRows(undefined), []);
});

test("nested actual commenters are kept separate from requested authors and no absent record is fabricated", () => {
  const data = { operationId: comment.id, requestedScope: { userId: "requested-user" }, identity: { userId: "actual-id" }, record: { userData: { userId: "actual-id", userName: "actual-name" } } };
  assert.deepEqual(socialAuthor(data), { field: "userData", record: data.record.userData });
  assert.deepEqual(socialAuthor({ ...data, record: {} }), { field: "userData", record: {} });
  assert.deepEqual(socialAuthor({ operationId: youtube.id, record: { author: { channelId: id, displayName: "name", isCreator: false } } })?.record, { channelId: id, displayName: "name", isCreator: false });
  assert.deepEqual(socialAuthor({ operationId: instagram.id, record: { user: { id, username: "locator" } } })?.record, { id, username: "locator" });
  assert.equal(socialAuthor({ operationId: following.id, requestedScope: { userId: id }, record: {} }), null);
  assert.equal(socialRole({ role: "comment-reply" }), "评论回复");
  assert.equal(socialRole({ role: "followee" }), "关注列表中的账号");
});

test("per-field time units preserve seconds, unknown update time and relative YouTube strings without date conversion", () => {
  assert.deepEqual(socialTimeRows({ record: { createTime: "1700000000", updateTime: "2026-10-20 12:00:00" }, timeUnits: { createTime: "seconds", updateTime: "unspecified" } }), [["原始 createTime（秒）", "1700000000"], ["原始 updateTime（单位 / 时区未说明）", "2026-10-20 12:00:00"]]);
  assert.deepEqual(socialTimeRows({ record: { publishedTime: "4年前" }, timeUnits: { publishedTime: "relative-or-unspecified" } }), [["原始 publishedTime（相对时间或未说明时区）", "4年前"]]);
  assert.deepEqual(socialTimeRows({ record: { publishTime: 0, createdAt: 0, createTime: 0 }, timeUnits: { publishTime: "seconds", createdAt: "seconds", createTime: "seconds" } }).map(([, value]) => value), ["0", "0", "0"]);
  assert.ok(socialTimeRows({ record: { updateTime: null } })[0]?.[1].includes("null"));
});

test("paging paths preserve actual count separately from upstream count, false/zero/null and both token positions", () => {
  const rows = socialPagingRows({ count: 1, reportedPaging: { root: { continuationToken: " root-token " }, data: { continuationToken: " data-token ", count: 15, total: 0, hasMore: false, nextCursor: 0, pageToken: null } } });
  assert.deepEqual(rows.slice(0, 3), [["本次实际返回 count", "1（number）"], ["响应根.continuationToken", " root-token （string）"], ["响应 data.continuationToken", " data-token （string）"]]);
  for (const [key, expected] of [["响应 data.count（上游报告值）", "15（number）"], ["响应 data.total", "0（number）"], ["响应 data.hasMore", "false（布尔值）"], ["响应 data.nextCursor", "0（number）"], ["响应 data.pageToken", "null（上游为空）"]]) assert.ok(rows.some(([label, value]) => label === key && value === expected));
  assert.deepEqual(socialPagingRows({ count: 0, reportedPaging: { data: { hasMore: 1, pageToken: null } } }), [["本次实际返回 count", "0（number）"], ["响应 data.hasMore", "1（number）"], ["响应 data.pageToken", "null（上游为空）"]]);
  assert.deepEqual(socialPagingRows({ count: 0, reportedPaging: { root: { offset: "" } } }), [["本次实际返回 count", "0（number）"], ["响应根.offset", "空字符串（string）"]]);
  assert.deepEqual(socialPagingRows({ count: 0 }), [["本次实际返回 count", "0（number）"]]);
});

test("out-of-range received numeric cursors are detected without changing raw strings or rounding them", () => {
  for (const nextCursor of [id, "9007199254740992", "-9007199254740992", Number.MAX_SAFE_INTEGER + 1]) assert.equal(socialUnsafeCursor({ reportedPaging: { data: { nextCursor } } }), true);
  for (const nextCursor of [0, "0", "00000000", Number.MAX_SAFE_INTEGER, "9007199254740991", null, undefined]) assert.equal(socialUnsafeCursor({ reportedPaging: { data: { nextCursor } } }), false);
});

test("avatar/share/image links are safe anchors or raw facts, never guessed work originals from requested IDs", () => {
  const data = { operationId: comment.id, requestedScope: { aweme_id: id }, record: { avatarImage: "https://cdn.example/avatar.jpg", userData: { avatarImage: "https://user:pass@cdn.example/avatar.jpg" }, shareData: { shareLink: "https://share.example/?token=raw", shareTitle: "Title" }, images: ["//cdn.example/relative.jpg", { url: "javascript:alert(1)", urlList: ["http://cdn.example/image.jpg", "data:image/png;base64,abc"] }] } };
  const links = socialLinks(data);
  assert.deepEqual(links.map(link => link.url), ["https://cdn.example/avatar.jpg", null, "https://share.example/?token=raw", null, null, "http://cdn.example/image.jpg", null]);
  assert.equal(links[1]?.value, data.record.userData.avatarImage);
  assert.equal(links.some(link => link.field.includes("requestedScope") || link.url?.includes(id)), false);
  assert.deepEqual(socialLinks({ operationId: youtube.id, requestedScope: { videoId: id }, record: {} }), []);
});

test("AgentKey Weibo exact comment/following tools preserve nested actual user, parent-comment scope, zero and opaque paging", () => {
  const comments = { provider: "agentkey", platform: "weibo", operationId: "weibo.comments", tool: "TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get", requestedScope: { status_id: "999" }, receivedScope: null, record: { id: "111", rootid: "222", text: "实收评论", created_at: "Thu Oct 22 08:00:00 +0800 2026", like_counts: 0, user: { uid: "333", screen_name: "实收评论者", friends_count: 0 } } };
  assert.equal(isSocialResearchResult("social_comment", comments), true);
  assert.equal(isSocialResearchResult("query_summary", comments), true);
  assert.equal(isSocialResearchResult("social_followee", comments), false);
  assert.equal(isSocialResearchResult("social_comment", { ...comments, tool: "other" }), false);
  assert.deepEqual(socialAuthor(comments)?.record, comments.record.user);
  assert(socialRecordRows(comments.record).some(([label, value]) => label.includes("父评论") && value === "222"));
  assert(socialRecordRows(comments.record).some(([label, value]) => label.includes("like_counts") && value === "0"));
  assert(socialTimeRows(comments).some(([label, value]) => label.includes("created_at") && value.includes("+0800")));
  const following = { ...comments, operationId: "weibo.following", tool: "TikHub/fetch_user_following_api_v1_weibo_app_fetch_user_following_get", role: "followee", record: { user: { uid: "444", description: "关注账号简介", followers_count: 0 } } };
  assert.equal(isSocialResearchResult("social_followee", following), true);
  assert.equal(socialRole(following), "关注列表中的账号");
  assert.deepEqual(socialAuthor(following)?.record, following.record.user);
  assert.deepEqual(socialPagingRows({ ...following, count: 0, pagination: { since_id: " opaque cursor ", total_cnt: 0 } }), [["本次实际返回 count", "0（number）"], ["响应 data.since_id", " opaque cursor （string）"], ["响应 data.total_cnt", "0（number）"]]);
});


test("Weibo comment IDs and raw created_at stay distinct from nested user identity and work time", () => {
  const data = { provider: "agentkey", platform: "weibo", operationId: "weibo.comments", tool: "TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get", record: { id: "8000123", idstr: "8000123", created_at: "Thu Oct 22 08:00:00 +0800 2026", user: { id: "7004567" } } };
  assert.deepEqual(socialRecordRows(data.record, data), [["评论 ID · id", "8000123"], ["评论 ID 字符串 · idstr", "8000123"]]);
  assert.deepEqual(socialRecordRows(data.record.user), [["用户 ID · id", "7004567"]]);
  assert.deepEqual(socialTimeRows(data), [["实收原始时间 · created_at", data.record.created_at]]);
  const other = { ...data, provider: "redfox" };
  assert.equal(socialRecordRows(other.record, other)[0]?.[0], "用户 ID · id");
  assert.match(socialTimeRows(other)[0]![0], /单位 \/ 时区未说明/);
});

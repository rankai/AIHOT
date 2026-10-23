import assert from "node:assert/strict";
import { test } from "node:test";
import { clearXhsCommentDraft, isXhsCommentOperation, isXhsCommentResult, xhsCommentDrafts, xhsCommentEmptyMessage, xhsCommentLinks, xhsCommentQueryBody, xhsCommentRecordRows, xhsCommentSubmitBody, xhsCommentTaskFacts, xhsCommentTaskRows } from "../app/features/admin/xhs-comment-data.ts";
import type { XhsCommentOptions } from "../app/features/admin/xhs-comment-types.ts";
const options: XhsCommentOptions = {
  platform: "xiaohongshu", library: "wide", defaultDataNum: 20, allDataNum: -1, dataNumMax: Number.MAX_SAFE_INTEGER, dataNumMaxBasis: "local-safe-integer", idMaxLength: 500,
  services: { submission: "redfox.query", poll: "redfox.poll" }, billing: { unitComments: 20, documentedBaseCny: 0.06, submissionCost: null, basis: "actual batches; rounding unknown" },
  limits: { steps: 50, polls: 48, retries: 3, pollDeadlineSeconds: 72 * 3600, externalAttempts: 100, firstPollDelaySeconds: 24 * 3600, pollIntervalSeconds: 3600 }, queryPollDeadlineSeconds: 48 * 3600,
  deadlineBasis: "creation including budget wait", firstPollBasis: "local received time", resultKinds: ["xhs_comment_task", "xhs_comment"],
};
test("default submission is finite20 and exact raw opusId; all is sent only by explicit selection", () => {
  const drafts = xhsCommentDrafts(options); assert.equal(drafts.submit.dataNum, "20"); assert.equal(drafts.submit.quantityMode, "count");
  const submit = { ...drafts.submit, opusId: " 90071992547409931234 \n" };
  assert.deepEqual(xhsCommentSubmitBody(submit, options), { opusId: submit.opusId, dataNum: 20 });
  assert.deepEqual(xhsCommentSubmitBody({ ...submit, quantityMode: "all", dataNum: "not used" }, options), { opusId: submit.opusId, dataNum: -1 });
  assert.throws(() => xhsCommentSubmitBody({ ...submit, dataNum: "-1" }, options));
});
test("positive counts are safe integers without an invented supplier maximum or number rounding", () => {
  const submit = { ...xhsCommentDrafts(options).submit, opusId: "note" };
  for (const dataNum of ["1", "21", "1000000", String(Number.MAX_SAFE_INTEGER)]) assert.equal(xhsCommentSubmitBody({ ...submit, dataNum }, options).dataNum, Number(dataNum));
  for (const dataNum of ["", "0", "-2", "1.5", "1e3", "9007199254740992", "9007199254740993", "Infinity"]) assert.throws(() => xhsCommentSubmitBody({ ...submit, dataNum }, options));
});
test("both ID inputs reject blanks/oversize while preserving original500-character IDs and query-only shape", () => {
  const raw = " task-90071992547409931234 \n";
  assert.deepEqual(xhsCommentQueryBody(raw), { taskId: raw }); assert.deepEqual(Object.keys(xhsCommentQueryBody(raw)), ["taskId"]);
  assert.equal(xhsCommentQueryBody("x".repeat(500)).taskId.length, 500);
  assert.equal(xhsCommentSubmitBody({ ...xhsCommentDrafts(options).submit, opusId: "x".repeat(500) }, options).opusId.length, 500);
  for (const id of ["", " \n", "x".repeat(501)]) { assert.throws(() => xhsCommentQueryBody(id)); assert.throws(() => xhsCommentSubmitBody({ ...xhsCommentDrafts(options).submit, opusId: id }, options)); }
});
test("clearing one draft never clears the other and clear-submit restores20 rather than all", () => {
  const drafts = { submit: { opusId: " raw note ", quantityMode: "all" as const, dataNum: "200" }, query: { taskId: " raw task " } };
  const clearSubmit = clearXhsCommentDraft(drafts, "submit", options);
  assert.deepEqual(clearSubmit.submit, { opusId: "", quantityMode: "count", dataNum: "20" }); assert.deepEqual(clearSubmit.query, drafts.query);
  const clearQuery = clearXhsCommentDraft(drafts, "query", options);
  assert.deepEqual(clearQuery.submit, drafts.submit); assert.deepEqual(clearQuery.query, { taskId: "" }); assert.equal(drafts.query.taskId, " raw task ");
});
test("async comment ownership does not intercept old platform works, sync social comments or other task kinds", () => {
  assert(isXhsCommentOperation("redfox.xhs_comments.submit")); assert(isXhsCommentOperation("redfox.xhs_comments.query")); assert(!isXhsCommentOperation("redfox.sync.query"));
  assert(isXhsCommentResult("xhs_comment_task", {})); assert(isXhsCommentResult("xhs_comment", { platform: "xiaohongshu" }));
  assert(!isXhsCommentResult("xhs_comment", { platform: "tiktok" }));
  for (const kind of ["social_comment", "xiaohongshu_work", "query_summary", "video_task", "ai_search_task"]) assert(!isXhsCommentResult(kind, { platform: "xiaohongshu" }));
});
test("actualCount/dataNum/received stay independent and visibleAfterTime remains the exact unzoned string", () => {
  const visible = "2026-10-24 01:02:03", data = { taskId: "task", status: "completed", visibleAfterTime: visible, dataNum: "50", received: "52", actualCount: 2 };
  const rows = xhsCommentTaskRows(data);
  assert.equal(rows.find(([label]) => label.includes("visibleAfterTime"))?.[1], visible);
  assert.equal(rows.find(([label]) => label === "上游 dataNum")?.[1], "50"); assert.equal(rows.find(([label]) => label.startsWith("上游 received"))?.[1], "52"); assert.equal(rows.find(([label]) => label === "该次响应实际评论记录数")?.[1], "2");
  const operation = { progress: {}, inputs: {}, results: [{ kind: "xhs_comment_task", data }, { kind: "xhs_comment", data: { platform: "xiaohongshu", taskId: "task" } }] };
  const facts = xhsCommentTaskFacts(operation); assert.equal(facts.pageCommentCount, 1); assert(!Object.hasOwn(facts, "progress"));
});
test("zero/null/huge numeric-string comment fields and raw comment time are not dropped or reinterpreted", () => {
  const rows = xhsCommentRecordRows({ record: { commentId: "90071992547409931234", noteId: "note", commenterId: "90071992547409935555", nickname: "评论者", likeNum: 0, subCommentCount: null, ipLocation: "", createTime: "昨天 09:10" } });
  assert.equal(rows.find(([label]) => label === "评论 ID")?.[1], "90071992547409931234"); assert.equal(rows.find(([label]) => label === "点赞数原值")?.[1], "0"); assert.match(rows.find(([label]) => label === "子评论数原值")![1], /null/);
  assert.equal(rows.find(([label]) => label.includes("原始发布时间"))?.[1], "昨天 09:10");
  const task = xhsCommentTaskRows({ dataNum: 0, received: null, actualCount: 0 }); assert.equal(task[0]?.[1], "0"); assert.match(task[1]![1], /null/); assert.equal(task[2]?.[1], "0");
});
test("media anchors only use safe preselected fields, never raw avatar/picture URLs bypassing backendnull", () => {
  const links = xhsCommentLinks({ avatarUrl: null, pictures: [{ url: "https://example.test/photo", originUrl: "javascript:alert(1)" }, { url: "//example.test/relative", originUrl: "https://user:pass@example.test/file" }], record: { avatar: "https://example.test/raw-avatar", pictures: [{ url: "https://example.test/raw-image" }] } });
  assert.equal(links.length, 5); assert.equal(links[0]?.url, null); assert.equal(links[1]?.url, "https://example.test/photo");
  assert(links.slice(2).every(link => link.url === null)); assert(!links.some(link => String(link.value).includes("raw-avatar")));
});
test("cleared terminal progress retains task identity from query, task history or current-page comments without cross-task fallback", () => {
  const operation = { progress: {}, inputs: {}, results: [{ kind: "xhs_comment_task", data: { taskId: " saved ", status: "completed", actualCount: 0 } }] };
  assert.equal(xhsCommentTaskFacts(operation).taskId, " saved ");
  assert.equal(xhsCommentTaskFacts({ ...operation, progress: { taskId: " live " }, inputs: { parameters: { taskId: " request " } } }).taskId, " live ");
  assert.equal(xhsCommentTaskFacts({ ...operation, inputs: { parameters: { taskId: " request " } } }).taskId, " request ");
  assert.equal(xhsCommentTaskFacts({ ...operation, results: [{ kind: "xhs_comment", data: { platform: "xiaohongshu", taskId: " comment-task " } }] }).taskId, " comment-task ");
  assert.equal(xhsCommentTaskFacts({ ...operation, results: [{ kind: "ai_search_task", data: { taskId: "wrong" } }] }).taskId, null);
  assert.equal(xhsCommentTaskFacts({ ...operation, results: [] }).latest, undefined);
});
test("legitimate empty completion requires explicit completed actualCount0; pending/missing-list facts do not become empty completion", () => {
  assert.match(xhsCommentEmptyMessage([{ kind: "xhs_comment_task", data: { status: "completed", actualCount: 0 } }]), /完成响应实际返回 0/);
  for (const data of [{ status: "pending", actualCount: 0 }, { status: "processing", received: 0 }, { status: "completed" }, { status: "completed", actualCount: null }]) assert.match(xhsCommentEmptyMessage([{ kind: "xhs_comment_task", data }]), /不能据此判断/);
});

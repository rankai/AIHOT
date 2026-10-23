import { safeExternalUrl } from "./platform-types.ts";
import { researchFactText, researchObject } from "./research-platform-data.ts";
import type { XhsCommentDrafts, XhsCommentOptions } from "./xhs-comment-types.ts";
export function isXhsCommentOperation(key: string) { return key === "redfox.xhs_comments.submit" || key === "redfox.xhs_comments.query"; }
export function isXhsCommentResult(kind: string, data: Record<string, unknown>) { return kind === "xhs_comment_task" || kind === "xhs_comment" && data.platform === "xiaohongshu"; }
export function xhsCommentDrafts(options: XhsCommentOptions, taskId = ""): XhsCommentDrafts { return { submit: { opusId: "", quantityMode: "count", dataNum: String(options.defaultDataNum) }, query: { taskId } }; }
export function clearXhsCommentDraft(drafts: XhsCommentDrafts, mode: "submit" | "query", options: XhsCommentOptions): XhsCommentDrafts { const initial = xhsCommentDrafts(options); return { ...drafts, [mode]: initial[mode] }; }
function validId(value: string, max: number) { if (!value.trim() || value.length > max) throw new Error(`请填写非空 ID，最多 ${max} 字符；原串将保留。`); }
export function xhsCommentSubmitBody(draft: XhsCommentDrafts["submit"], options: XhsCommentOptions) {
  validId(draft.opusId, options.idMaxLength);
  let dataNum: number;
  if (draft.quantityMode === "all") dataNum = options.allDataNum;
  else {
    if (!/^\d+$/.test(draft.dataNum.trim())) throw new Error("请填写正整数数量；全部评论须通过对应选项显式选择。");
    dataNum = Number(draft.dataNum.trim());
    if (!Number.isSafeInteger(dataNum) || dataNum <= 0 || dataNum > options.dataNumMax) throw new Error("数量须为本地可精确表示的正整数；供应商未说明最大条数。");
  }
  return { opusId: draft.opusId, dataNum };
}
export function xhsCommentQueryBody(taskId: string, max = 500) { validId(taskId, max); return { taskId }; }
export const xhsCommentStatuses: Record<string, string> = { pending: "待查询", processing: "处理中", completed: "供应商查询完成" };
export function xhsCommentTaskRows(data: Record<string, unknown>): Array<[string, string]> {
  return [["taskId", "实收任务 ID"], ["requestedOpusId", "提交时请求作品 ID（不是评论者身份）"], ["requestedDataNum", "提交请求数量（-1 为显式全部）"], ["visibleAfterTime", "上游 visibleAfterTime（原串，时区未核实）"], ["dataNum", "上游 dataNum"], ["received", "上游 received（条数事实，不是百分比）"], ["actualCount", "该次响应实际评论记录数"]].flatMap(([key, label]) => Object.hasOwn(data, key!) ? [[label!, researchFactText(data[key!])]] as Array<[string, string]> : []);
}
export function xhsCommentRecordRows(data: Record<string, unknown>): Array<[string, string]> {
  const record = researchObject(data.record);
  return [["commentId", "评论 ID"], ["noteId", "响应作品 noteId"], ["commenterId", "评论者 ID（不是作品作者）"], ["nickname", "评论者昵称"], ["likeNum", "点赞数原值"], ["subCommentCount", "子评论数原值"], ["ipLocation", "上游 IP 属地"], ["createTime", "原始发布时间（时区未核实）"]].flatMap(([key, label]) => Object.hasOwn(record, key!) ? [[label!, researchFactText(record[key!])]] as Array<[string, string]> : []);
}
export function xhsCommentLinks(data: Record<string, unknown>) {
  const links: Array<{ label: string; value: unknown; url: string | null }> = [];
  if (Object.hasOwn(data, "avatarUrl")) links.push({ label: "评论者头像", value: data.avatarUrl, url: safeExternalUrl(data.avatarUrl) });
  if (Array.isArray(data.pictures)) data.pictures.forEach((value, index) => { const picture = researchObject(value); for (const key of ["url", "originUrl"]) if (Object.hasOwn(picture, key)) links.push({ label: `评论图片 ${index + 1} · ${key}`, value: picture[key], url: safeExternalUrl(picture[key]) }); });
  return links;
}
export function xhsCommentEmptyMessage(results: Array<{ kind: string; data: Record<string, unknown> }>) {
  const latest = results.findLast(row => row.kind === "xhs_comment_task");
  return latest?.data.status === "completed" && latest.data.actualCount === 0 ? "本页记录的完成响应实际返回 0 条评论。" : "本页还没有评论记录；可查看进度、历史或其他结果分页，不能据此判断全部评论为空。";
}
export function xhsCommentTaskFacts(operation: { progress: Record<string, unknown>; inputs: { parameters?: Record<string, unknown> }; results: Array<{ kind: string; data: Record<string, unknown> }> }) {
  const rows = operation.results.filter(row => isXhsCommentResult(row.kind, row.data));
  const latest = rows.findLast(row => row.kind === "xhs_comment_task"), savedId = rows.findLast(row => typeof row.data.taskId === "string");
  const taskId = typeof operation.progress.taskId === "string" ? operation.progress.taskId : typeof operation.inputs.parameters?.taskId === "string" ? operation.inputs.parameters.taskId : savedId ? savedId.data.taskId as string : null;
  const visible = rows.findLast(row => row.kind === "xhs_comment_task" && Object.hasOwn(row.data, "visibleAfterTime"));
  return { taskId, latest, visible, pageCommentCount: rows.filter(row => row.kind === "xhs_comment").length };
}

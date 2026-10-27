import { researchObject } from "./research-platform-data.ts";
import type { OperationResult } from "./operation-types.ts";
import { douyinImportFields } from "./douyin-result-data.ts";
import { xiaohongshuImportFields } from "./xiaohongshu-result-data.ts";
import { wechatImportFields } from "./wechat-result-data.ts";
import { tiktokImportFields } from "./tiktok-result-data.ts";
import { bilibiliImportFields } from "./bilibili-result-data.ts";
import { youtubeImportFields } from "./youtube-result-data.ts";
import { instagramImportFields } from "./instagram-result-data.ts";
import { toutiaoImportFields } from "./toutiao-result-data.ts";
import { weiboImportFields } from "./weibo-result-data.ts";
import { xSearchImportState } from "./x-search-import-data.ts";

export function selectableWorkResult(result: OperationResult): boolean {
  if (result.articleId || !Number.isSafeInteger(result.id) || result.id < 1) return false;
  const { kind, data } = result;
  if (kind === "x_research_work" || kind === "x_detail_work") return xSearchImportState(result).canImport;
  if (kind === "weibo_work") { const fields = weiboImportFields(kind, data); return fields.canImport && !fields.missingUid && !fields.missingUrl; }
  const complete = (fields: { canImport: boolean; needsIdentity: boolean; needsUrl: boolean }) => fields.canImport && !fields.needsIdentity && !fields.needsUrl;
  switch (kind) {
    case "douyin_work": return complete(douyinImportFields(kind, data));
    case "xiaohongshu_work": return complete(xiaohongshuImportFields(kind, data));
    case "wechat_work": return complete(wechatImportFields(kind, data));
    case "tiktok_work": return complete(tiktokImportFields(kind, data));
    case "bilibili_work": return complete(bilibiliImportFields(kind, data));
    case "youtube_work": return complete(youtubeImportFields(kind, data));
    case "instagram_work": return complete(instagramImportFields(kind, data));
    case "toutiao_work": return complete(toutiaoImportFields(kind, data));
    default: return false;
  }
}
export function workResultTitle(result: OperationResult) {
  const data = result.data, record = researchObject(data.record);
  const title = [data.title, record.title].find(value => typeof value === "string" && value.trim());
  if (typeof title === "string") return title;
  const text = [data.text, record.text, data.content, record.content, data.captionText, record.captionText].find(value => typeof value === "string" && value.trim());
  return typeof text === "string" ? Array.from(text).slice(0, 80).join("") : "作品";
}
export function pageWorkCandidates(results: readonly OperationResult[]) { return results.slice(0, 100).filter(selectableWorkResult); }
export function workImportReason(raw: string) {
  const reason = raw.trim();
  if (!reason || reason.length > 500) throw new Error("请填写 1–500 字符的操作原因。");
  return { reason };
}
/** One explicit command per item, in current-page order. Never retry or continue after failure/navigation. */
export async function importSelectedWorks(input: { results: readonly OperationResult[]; selectedIds: readonly number[]; reason: string; isCurrent: () => boolean; submit: (id: number, body: { reason: string }) => Promise<boolean> }) {
  const candidates = pageWorkCandidates(input.results), selected = new Set(input.selectedIds), ids = candidates.filter(result => selected.has(result.id)).map(result => result.id), body = workImportReason(input.reason);
  if (!ids.length || ids.length !== selected.size) throw new Error("选择包含不在本页或需逐条核实的结果，请重新选择。");
  const succeeded: number[] = [];
  for (const id of ids) {
    if (!input.isCurrent()) return { succeeded, remaining: ids.filter(id => !succeeded.includes(id)), failedId: null, interrupted: true };
    let success = false;
    try { success = await input.submit(id, body); } catch { /* Treat an uncertain command as failure; retry requires explicit action. */ }
    if (!success) return { succeeded, remaining: ids.filter(id => !succeeded.includes(id)), failedId: id, interrupted: !input.isCurrent() };
    succeeded.push(id);
  }
  return { succeeded, remaining: [], failedId: null, interrupted: !input.isCurrent() };
}

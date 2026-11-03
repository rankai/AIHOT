import { z } from "zod";
import { sha256 } from "../../lib/ids.ts";
import { toolSafeUrl } from "../../users/tool-results.ts";
import { redfoxRequest } from "./client.ts";
import { WECHAT_HOT_OPERATION, WechatHotInput } from "./wechat-hot-contract.ts";
import type { PaidRequestOptions } from "../receipts.ts";
const metric = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]).nullable().optional();
const article = z.object({ id: z.union([z.string(), z.number().int().safe()]).nullable().optional(),
  title: z.string().nullable().optional(), author: z.string().nullable().optional(), authorName: z.string().nullable().optional(),
  url: z.string().nullable().optional(), summary: z.string().nullable().optional(), publishTime: z.string().nullable().optional(), publicTime: z.string().nullable().optional(),
  popularityScore: metric, recencyScore: metric, relevanceScore: metric, totalScore: metric,
  clicksCount: metric, watchCount: metric, likeCount: metric, commentsCount: metric,
}).passthrough();
export function parseWechatHot(raw: unknown, input: z.infer<typeof WechatHotInput>) {
  const { articles } = z.object({ articles: z.array(article).max(10000) }).parse(raw);
  const seen = new Set<string>();
  let excludedCount = 0;
  const results: { kind: string; itemKey: string; data: Record<string, unknown> }[] = [];
  for (const row of articles) {
    const url = toolSafeUrl(row.url);
    const id = row.id == null ? null : String(row.id).trim();
    // A stable id identifies an article; otherwise only an actual original-article URL is reliable.
    const reliable = url && new URL(url).hostname === "mp.weixin.qq.com" && new URL(url).pathname.startsWith("/s");
    const identity = id ? `id:${id}` : reliable ? `url:${url}` : null;
    if (!identity) { excludedCount++; continue; }
    if (seen.has(identity)) continue;
    seen.add(identity);
    const text = row.summary ?? "";
    const metrics = Object.fromEntries(["clicksCount", "watchCount", "likeCount", "commentsCount", "popularityScore", "recencyScore", "relevanceScore", "totalScore"].map(key => [key, row[key] ?? null]));
    const missing = [!row.title && "title", !url && "url", !text && "summary", !(row.publicTime ?? row.publishTime) && "publishTime",
      ...Object.entries(metrics).filter(([, value]) => value === null).map(([key]) => key)].filter(Boolean);
    if (results.length < 10) results.push({ kind: "wechat_hot_article", itemKey: sha256(identity), data: {
      platform: "wechat", operationId: WECHAT_HOT_OPERATION, sourceId: id, title: row.title?.slice(0, 300) || "未提供标题",
      url, text: text.slice(0, 1500), authorName: (row.authorName ?? row.author)?.slice(0, 200) ?? null,
      publishTime: (row.publicTime ?? row.publishTime)?.slice(0, 100) ?? null, ...metrics, missing, textTruncated: text.length > 1500, textMeaning: "summary",
    } });
  }
  const projectedCount = results.length;
  results.push({ kind: "wechat_hot_research", itemKey: "summary", data: { platform: "wechat", operationId: WECHAT_HOT_OPERATION,
    rawCount: articles.length, deduplicatedCount: seen.size, projectedCount, excludedCount,
    truncated: seen.size > 10 || results.some(row => row.data.textTruncated), ...input,
    limitation: "仅有标题和摘要，不能据此声称已阅读全文；未返回的互动数为未知", } });
  return results;
}
export async function queryWechatHot(parameters: Record<string, unknown>, window: string, options: PaidRequestOptions) {
  const input = WechatHotInput.parse(parameters);
  const response = await redfoxRequest(WECHAT_HOT_OPERATION, input, window, "query", options);
  return { ...response, results: parseWechatHot(response.data, input) };
}

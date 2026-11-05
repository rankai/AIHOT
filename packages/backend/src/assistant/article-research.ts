import type { AssistantArticleResearch, AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import type { Db } from "../db.ts";

const xhsMetrics: Record<string, string> = { likedCount: "点赞", collectedCount: "收藏", commentsCount: "评论", sharedCount: "分享", interactiveCount: "互动总数", totalScore: "综合分" };
const wechatMetrics: Record<string, string> = { clicksCount: "阅读", watchCount: "在看", likeCount: "点赞", commentsCount: "评论", popularityScore: "热度分", recencyScore: "时效分", relevanceScore: "相关分", totalScore: "综合分" };
const labels: Record<string, string> = { title: "标题", content: "内容结构", tags: "标签", opening: "开头", structure: "结构", language: "语言", interaction: "互动", keyword: "高频词" };
const present = (value: unknown): value is string => typeof value === "string" && !!value.trim();

/** Only observations supported by saved samples and actual returned fields reach the author. */
export function articleResearch(platform: AssistantArticleResearch["platform"], analysis: Record<string, any>, cited: Record<string, any>[], explanation: string): AssistantArticleResearch {
  return {
    platform, analysisCallId: analysis.analysisCallId, application: explanation,
    patterns: Object.entries(analysis.patterns).flatMap(([key, value]: [string, any]) =>
      value.sampleIds?.length && !(platform === "wechat" && ["opening", "structure"].includes(key)) &&
        (key !== "interaction" || analysis.samples.some((sample: any) => value.sampleIds.includes(sample.sourceId) &&
          Object.keys(platform === "xiaohongshu" ? xhsMetrics : wechatMetrics).some(metric => {
            const actual = platform === "xiaohongshu" ? sample.metrics?.[metric] : sample[metric];
            return actual !== null && actual !== undefined;
          })))
        ? [{ label: labels[key] ?? key, observation: value.observation }] : []),
    references: cited.slice(0, 3).map(sample => ({
      sourceId: sample.sourceId, title: sample.title, url: sample.url ?? null,
      ...(present(sample.author ?? sample.authorName) ? { author: sample.author ?? sample.authorName } : {}),
      ...(present(sample.authorUrl) ? { authorUrl: sample.authorUrl } : {}),
      metrics: Object.entries(platform === "xiaohongshu" ? xhsMetrics : wechatMetrics).flatMap(([key, label]) => {
        const value = platform === "xiaohongshu" ? sample.metrics?.[key] : sample[key];
        return typeof value === "number" && Number.isFinite(value) || present(value) ? [{ label, value: value as string | number }] : [];
      }),
    })),
  };
}

/** Exact historical system suffix. Never identify an appendix by its heading alone. */
export function legacyResearchAppendix(platform: AssistantArticleResearch["platform"], analysis: Record<string, any>, cited: Record<string, any>[], explanation: string) {
  if (platform === "xiaohongshu") {
    const patterns = analysis.patterns;
    const references = cited.slice(0, 2).map(sample =>
      `- ${sample.title}：${sample.url ?? "原文链接未返回"}；作者：${sample.author ?? "未知"}；作者主页：${sample.authorUrl ?? "未知"}；` +
      Object.entries(sample.metrics).map(([key, value]) => `${xhsMetrics[key]}：${value ?? "未知"}`).join("，"));
    return `\n\n### 爆款公式来源（已验证研究）\n标题：${patterns.title.observation}\n内容结构：${patterns.content.observation}\n标签：${patterns.tags.observation}\n互动：${patterns.interaction.observation}\n本稿应用：${explanation}\n研究范围：${analysis.samples.length}条；${analysis.limitations.join("；")}\n以下为本次研究参考，不代表已核实正文中的事实。\n${references.join("\n")}`;
  }
  const oldLabels: Record<string, string> = { title: "标题", opening: "开头", structure: "结构", language: "语言", interaction: "互动", keyword: "关键词" };
  const patterns = Object.entries(analysis.patterns).map(([key, value]: [string, any]) => `${oldLabels[key]}：${value.observation}`).join("\n");
  const references = cited.slice(0, 2).map(s => `- ${s.title}；${s.url ?? "原文链接未提供"}；作者：${s.authorName ?? "未知"}；阅读：${s.clicksCount ?? "未知"}；在看：${s.watchCount ?? "未知"}；点赞：${s.likeCount ?? "未知"}；评论：${s.commentsCount ?? "未知"}`).join("\n");
  const scope = `${analysis.samples.length}条实际样本；${analysis.limitations.join("；")}`.slice(0, 1000);
  return `\n\n### 公众号爆款规律来源（已验证研究）\n${patterns}\n本稿应用：${explanation}\n研究范围：${scope}\n以下为本次标题与摘要研究参考，不代表已核实原文或正文中的事实。\n${references}`;
}

/** Batch read-only projection; an uncertain historical body stays byte-for-byte unchanged. */
export async function projectArticleVersions<T extends { content: AssistantArtifactContent; source_snapshot?: AssistantSource[] }>(db: Db, sessionId: string, rows: readonly T[]): Promise<T[]> {
  const ids = [...new Set(rows.filter(row => !row.content.research).flatMap(row => (row.source_snapshot ?? []).flatMap(source => typeof source.research?.analysisCallId === "string" ? [source.research.analysisCallId] : [])))];
  if (!ids.length) return [...rows];
  const analyses = await db`SELECT c.id,c.name,c.result FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id
    WHERE t.session_id=${sessionId} AND c.id::text IN ${db(ids)} AND c.state='completed' AND c.name IN ('analyze_xhs_research','analyze_wechat_research')`;
  return rows.map(row => {
    if (row.content.research) return row;
    try {
      const sources = (row.source_snapshot ?? []).filter(source => row.content.sources.includes(source.id) && source.research);
      if (!sources.length) return row;
      const verification = sources[0]!.research!;
      if (typeof verification.application?.explanation !== "string" || sources.some(source => source.research!.analysisCallId !== verification.analysisCallId || source.research!.application?.explanation !== verification.application.explanation)) return row;
      const saved = analyses.find(analysis => analysis.id === verification.analysisCallId);
      if (!saved) return row;
      const analysis = saved.result;
      const cited = analysis.samples.filter((sample: any) => row.content.sources.includes(sample.sourceId));
      if (!cited.length || sources.some(source => !cited.some((sample: any) => sample.sourceId === source.id))) return row;
      const platform = saved.name === "analyze_xhs_research" ? "xiaohongshu" : "wechat";
      const appendix = legacyResearchAppendix(platform, analysis, cited, verification.application.explanation);
      if (!row.content.body.endsWith(appendix) || row.content.body.length <= appendix.length) return row;
      return { ...row, content: { ...row.content, body: row.content.body.slice(0, -appendix.length), research: articleResearch(platform, { ...analysis, analysisCallId: saved.id }, cited, verification.application.explanation) } };
    } catch { return row; }
  });
}

/** The chosen article is writing material; platform research stays attached to its saved version. */
export function articleInputProjection<T extends Record<string, any>>(row: T): T {
  if (!["text-draft", "xhs-note"].includes(row.kind)) return row;
  const { research, scope, partial, ...content } = row.content;
  return { ...row, content, source_snapshot: (row.source_snapshot ?? []).map(({ research, ...source }: AssistantSource) => source) };
}

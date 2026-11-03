import { z } from "zod";
import { beijingDate, addDays } from "@aihot/contracts/time";
import type { AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import type { Tx } from "../db.ts";
import { projectToolResult } from "../users/tool-results.ts";
import { contextTokens } from "./context.ts";
import { conflict } from "./store.ts";

export function researchClock(now = new Date()) {
  const today = beijingDate(now);
  const ago = (days: number) => addDays(today, -days);
  return { timeZone: "Asia/Shanghai", today, earliestDate: ago(30), latestDate: ago(1), defaultStartDate: ago(7) };
}
export function validateResearchWindow(clock: ReturnType<typeof researchClock>, start: string, end: string) {
  if (start > end || start < clock.earliestDate || end > clock.latestDate)
    throw conflict(`检索日期须在${clock.earliestDate}至${clock.latestDate}内；保留用户明确日期并说明限制，不得静默改期`);
}
const summary = z.string().trim().min(1).max(2000);
const ids = z.array(z.string().regex(/^search:\d+$/)).min(1).max(50);
const pattern = z.object({ sampleIds: ids, observation: summary }).strict();
export const ResearchAnalysis = z.object({
  activationId: z.string().uuid(),
  topic: summary,
  samples: z.array(z.object({ sourceId: z.string().regex(/^search:\d+$/), relevance: summary }).strict()).min(1).max(50),
  titlePattern: pattern,
  contentPattern: pattern,
  tagPattern: pattern,
  interactionPattern: pattern,
  applicationPlan: summary,
  limitations: z.array(summary).max(20),
}).strict();
export const ResearchApplication = z.object({ analysisCallId: z.string().uuid(), explanation: summary }).strict();
const metrics = ["likedCount", "collectedCount", "commentsCount", "sharedCount", "interactiveCount", "totalScore"];
const noWeb = "未执行网页搜索，不能验证最新热点";
/** Preserve summary rows independently of the 50-note cap; no raw envelopes reach the model. */
export function researchResults(rows: { id: number; kind: string; data: any }[]) {
  const notes = rows.filter((r) => r.kind === "xiaohongshu_work");
  const ordered = [...notes.filter((r) => r.data.role === "keyword_match"), ...notes.filter((r) => r.data.role !== "keyword_match")];
  const projected = ordered.slice(0, 50).map((r) => {
    const p = projectToolResult(r);
    return { id: p.id, kind: p.kind, title: p.title.slice(0, 120), text: p.text.slice(0, 1000),
      textTruncated: p.text.length > 1000, url: p.url,
      details: Object.fromEntries(["role", "authorNickname", "createTime", ...metrics].filter((key) => p.details[key] !== undefined).map((key) => [key, p.details[key]])) };
  });
  // Reserve the remaining frozen 24k context for the skill, transcript and draft schema.
  // Keep every shown sample identity; shorten text, never silently drop note records.
  while (contextTokens(JSON.stringify(projected)) > 5000 && projected.some((p) => p.text.length > 24)) {
    for (const p of projected) if (p.text.length > 24) {
      p.text = p.text.slice(0, Math.max(24, Math.floor(p.text.length / 2))); p.textTruncated = true;
    }
  }
  return {
    results: projected,
    metadata: rows.filter((r) => r.kind === "xiaohongshu_research").map((r) => {
      const p = projectToolResult(r);
      return { id: p.id, kind: p.kind, details: p.details, text: p.text.slice(0, 1500), textTruncated: p.text.length > 1500 };
    }),
    totalNotes: notes.length, shownNotes: projected.length, limited: notes.length > 50,
    limitations: [noWeb, "正文按上下文预算截断；只能分析可见片段；未返回的互动/评分为未知"],
  };
}
export async function analyzeResearch(tx: Tx, turn: Record<string, any>, callId: string, raw: unknown) {
  const input = ResearchAnalysis.parse(raw);
  const rows = await tx`SELECT z.id,z.kind,z.data,c.id AS call_id,c.input FROM operation_results z
    JOIN assistant_tool_calls c ON c.child_run_id=z.run_id JOIN operation_runs r ON r.id=z.run_id
    WHERE c.turn_id=${turn.id} AND c.name='search_xhs_notes' AND c.state='completed' AND r.status='completed'
      AND c.input->>'activationId'=${input.activationId} AND z.kind='xiaohongshu_work' ORDER BY z.id`;
  const eligible = rows.filter((r) => r.data.role === "keyword_match" && projectToolResult(r as any).url && projectToolResult(r as any).text.trim());
  const unique = new Map(eligible.slice(0, 50).map((r) => [projectToolResult(r as any).url, r]));
  const shown = new Map(researchResults(rows.map((r) => ({ id: r.id, kind: r.kind, data: r.data }))).results.map((r) => [`search:${r.id}`, r]));
  const samples = input.samples.map((s) => {
    const row = [...unique.values()].find((r) => `search:${r.id}` === s.sourceId);
    if (!row) throw conflict("分析样本必须来自本激活已完成关键词检索的有正文和原文链接笔记，推荐结果不能代替");
    const p = projectToolResult(row as any);
    return { author: p.details.authorNickname ?? null, authorUrl: p.links.find((link) => ["profileUrl", "userJumpUrl", "homeUrl"].includes(link.label))?.url ?? null, sourceId: s.sourceId, relevance: s.relevance, keyword: row.input.keyword,
      searchCallId: row.call_id, startDate: row.input.startDate, endDate: row.input.endDate,
      title: p.title, url: p.url, text: shown.get(s.sourceId)?.text ?? "", textTruncated: shown.get(s.sourceId)?.textTruncated ?? true,
      metrics: Object.fromEntries(metrics.map((key) => [key, p.details[key] ?? null])) };
  });
  const selected = new Set(samples.map((s) => s.sourceId));
  if (selected.size !== samples.length) throw conflict("分析样本不得重复");
  for (const field of [input.titlePattern, input.contentPattern, input.tagPattern, input.interactionPattern])
    if (field.sampleIds.some((id) => !selected.has(id))) throw conflict("规律引用必须指向本次分析实际样本");
  const limitations = [...new Set([noWeb, ...input.limitations,
    ...(samples.length < 50 ? [`实际分析${samples.length}条，未达到50条目标`] : []),
    ...(samples.some((s) => s.textTruncated) ? ["部分正文截断，仅分析可见片段"] : []),
    ...(samples.some((s) => Object.values(s.metrics).some((v) => v === null)) ? ["部分互动或评分未知，不能补算或声称数据排名"] : []),
  ])];
  return { analysisCallId: callId, activationId: input.activationId, topic: input.topic, samples,
    patterns: { title: input.titlePattern, content: input.contentPattern, tags: input.tagPattern, interaction: input.interactionPattern },
    applicationPlan: input.applicationPlan, limitations };
}
export async function verifyResearchDelivery(tx: Tx, turn: Record<string, any>, activationId: string,
  content: AssistantArtifactContent, sources: AssistantSource[], raw: unknown, target?: { artifactId?: string; baseVersion: number }) {
  const application = ResearchApplication.parse(raw);
  const [analysis] = await tx`SELECT c.*,t.snapshot,t.session_id FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id
    WHERE c.id=${application.analysisCallId} AND c.name='analyze_xhs_research' AND c.state='completed' AND t.session_id=${turn.session_id}`;
  if (!analysis) throw conflict("M1必须先完成真实检索与规律分析，不能交付材料稿");
  const same = analysis.turn_id === turn.id && analysis.result.activationId === activationId;
  let inherited = false;
  if (!same && target?.artifactId && target.baseVersion > 0) for (const selected of turn.snapshot.selected ?? []) {
    if (selected.artifact_id !== target.artifactId || !selected.version) continue;
    const [version] = await tx`SELECT source_snapshot FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${selected.artifact_id} AND version=${selected.version}`;
    if (version?.source_snapshot.some((s: AssistantSource) => s.research?.analysisCallId === analysis.id)) inherited = true;
  }
  if (!same && !inherited) throw conflict("分析不属于当前激活或选定的已验证稿件版本");
  const ids = new Set(analysis.result.samples.map((s: any) => s.sourceId));
  const cited = sources.filter((s) => content.sources.includes(s.id) && ids.has(s.id));
  if (cited.length < Math.min(2, ids.size))
    throw conflict("研究稿需要引用实际分析样本");
  const { analysisCallId, ...applied } = application;
  const patterns = analysis.result.patterns;
  const references = analysis.result.samples.filter((sample: any) => cited.some((s) => s.id === sample.sourceId)).map((sample: any) =>
    `- ${sample.title}：${sample.url}；作者：${sample.author ?? "未知"}；作者主页：${sample.authorUrl ?? "未知"}；` +
    Object.entries(sample.metrics).map(([key, value]) => `${({ likedCount: "点赞", collectedCount: "收藏", commentsCount: "评论", sharedCount: "分享", interactiveCount: "互动总数", totalScore: "综合分" } as Record<string, string>)[key]}：${value ?? "未知"}`).join("，"));
  // The observable research summary is server-rendered from persisted analysis, never just a heading check.
  const formula = `\n\n### 爆款公式来源（已验证研究）\n标题：${patterns.title.observation}\n内容结构：${patterns.content.observation}\n标签：${patterns.tags.observation}\n互动：${patterns.interaction.observation}\n本稿应用：${application.explanation}\n研究范围：${analysis.result.samples.length}条；${analysis.result.limitations.join("；")}\n${references.join("\n")}`;
  const marker = "\n\n### 爆款公式来源（已验证研究）";
  const body = content.body.split(marker)[0]!.replace(/\n\n(?:#{1,6} )?爆款公式来源[：:][\s\S]*$/, "");
  return {
    content: { ...content, body: body + formula, partial: true,
      scope: `${analysis.result.samples.length}条实际研究样本；${analysis.result.limitations.join("；")}`.slice(0, 1000) },
    sources: sources.map((s) => cited.some((c) => c.id === s.id) ? { ...s, research: { analysisCallId, application: applied } } : s),
  };
}

/** Model transcript needs the summary and identities, not another copy of source bodies. */
export function analysisSummary(result: Record<string, any>) {
  const { samples, ...summary } = result;
  return { ...summary, sampleCount: samples.length, sampleIds: samples.map((sample: any) => sample.sourceId) };
}

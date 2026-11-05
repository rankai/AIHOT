import { z } from "zod";
import { beijingDate, addDays } from "@aihot/contracts/time";
import type { AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import type { Tx } from "../db.ts";
import { projectToolResult } from "../users/tool-results.ts";
import { contextTokens } from "./context.ts";
import { conflict } from "./store.ts";
import { DraftArgumentsError } from "./tool-arguments.ts";
import { researchCitations, selectResearchSamples } from "./research-sources.ts";

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
const ids = z.array(z.string().max(200)).max(50);
const pattern = z.object({ sampleIds: ids, observation: summary }).strict();
export const ResearchAnalysis = z.object({
  activationId: z.string().uuid(),
  topic: summary,
  samples: z.array(z.object({ sourceId: z.string().max(200), relevance: summary.default("未单独说明与主题的关联") }).strict()).max(50),
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
type ResearchRow = { id: number; kind: string; data: any };
type ResearchEvidenceRow = ResearchRow & { call_id: string; input: { keyword: string; startDate: string; endDate: string } };
/** Availability comes from real keyword matches; selection deduplicates the referenced works. */
function eligibleResearch(rows: ResearchRow[], shown: Map<string, { availableDimensions: string[] }>) {
  const eligible = rows.filter((r) => r.kind === "xiaohongshu_work" && r.data.role === "keyword_match" && shown.get(`search:${r.id}`)?.availableDimensions.length);
  return new Map(eligible.map((r) => [`search:${r.id}`, r]));
}
/** Missing bodies and links do not invalidate a returned title or interaction count. */
function researchDimensions(row: ResearchRow, visibleText: string, visibleTitle: string) {
  const p = projectToolResult(row), dimensions: string[] = [];
  const title = row.data.record ? row.data.record.title : row.data.title;
  if (typeof title === "string" && title.trim() && visibleTitle.trim()) dimensions.push("titlePattern");
  if (visibleText.trim()) dimensions.push("contentPattern");
  if (String(p.details.captionHashtags ?? "").trim() || /#[^\s#]+/.test(`${visibleTitle}\n${visibleText}`)) dimensions.push("tagPattern");
  if (metrics.some((key) => p.details[key] !== undefined && p.details[key] !== null)) dimensions.push("interactionPattern");
  return dimensions;
}
async function researchEvidence(tx: Tx, turnId: string, activationId: string) {
  const rows = await tx<ResearchEvidenceRow[]>`SELECT z.id,z.kind,z.data,c.id AS call_id,c.input FROM operation_results z
    JOIN assistant_tool_calls c ON c.child_run_id=z.run_id JOIN operation_runs r ON r.id=z.run_id
    WHERE c.turn_id=${turnId} AND c.name='search_xhs_notes' AND c.state='completed' AND r.status='completed'
      AND c.input->>'activationId'=${activationId} AND z.kind='xiaohongshu_work' ORDER BY z.id`;
  const projected = researchResults(rows);
  return { rows, projected, eligible: eligibleResearch(rows, new Map(projected.results.map((r) => [`search:${r.id}`, r]))) };
}
/** Preserve summary rows independently of the 50-note cap; no raw envelopes reach the model. */
export function researchResults(rows: { id: number; kind: string; data: any }[]) {
  const notes = rows.filter((r) => r.kind === "xiaohongshu_work");
  const ordered = [...notes.filter((r) => r.data.role === "keyword_match"), ...notes.filter((r) => r.data.role !== "keyword_match")];
  const projected = ordered.slice(0, 50).map((r) => {
    const p = projectToolResult(r);
    return { id: p.id, kind: p.kind, title: p.title.slice(0, 120), text: p.text.slice(0, 1000),
      textTruncated: p.text.length > 1000, url: p.url, availableDimensions: researchDimensions(r, p.text.slice(0, 1000), p.title.slice(0, 120)),
      details: Object.fromEntries(["role", "authorNickname", "createTime", "captionHashtags", ...metrics].filter((key) => p.details[key] !== undefined).map((key) => [key, p.details[key]])) };
  });
  // Reserve the remaining frozen 24k context for the skill, transcript and draft schema.
  // Keep every shown sample identity; shorten text, never silently drop note records.
  while (contextTokens(JSON.stringify(projected)) > 5000 && projected.some((p) => p.text.length > 24)) {
    for (const p of projected) if (p.text.length > 24) {
      p.text = p.text.slice(0, Math.max(24, Math.floor(p.text.length / 2))); p.textTruncated = true;
    }
  }
  for (const [index, p] of projected.entries()) p.availableDimensions = researchDimensions(ordered[index]!, p.text, p.title);
  return {
    results: projected,
    metadata: rows.filter((r) => r.kind === "xiaohongshu_research").map((r) => {
      const p = projectToolResult(r);
      return { id: p.id, kind: p.kind, details: p.details, text: p.text.slice(0, 1500), textTruncated: p.text.length > 1500 };
    }),
    totalNotes: notes.length, shownNotes: projected.length, limited: notes.length > 50,
    validSampleIds: [...eligibleResearch(rows, new Map(projected.map((r) => [`search:${r.id}`, r]))).keys()],
    limitations: [noWeb, "各维度只使用实际返回字段；缺失正文不能作为内容结构依据，缺失链接不得补写；正文按上下文预算截断；未返回的互动/评分为未知"],
  };
}
export async function analyzeResearch(tx: Tx, turn: Record<string, any>, callId: string, raw: unknown) {
  const input = ResearchAnalysis.parse(raw);
  const { rows, projected, eligible } = await researchEvidence(tx, turn.id, input.activationId);
  const fields = ["titlePattern", "contentPattern", "tagPattern", "interactionPattern"] as const;
  const explicit = new Map(input.samples.map((sample) => [sample.sourceId, sample.relevance]));
  const referenced = [...new Set([...explicit.keys(), ...fields.flatMap((field) => input[field].sampleIds)])];
  // Tool references are selections from the current activation's real evidence, not new
  // authority. Ignore unusable or unknown entries and preserve each supported observation.
  const selection = selectResearchSamples(referenced, new Map([...eligible].map(([id, row]) => [id, projectToolResult(row).url])));
  const selected = selection.sampleIds;
  if (!selected.length) throw new DraftArgumentsError(new z.ZodError([
    { code: "custom", path: ["samples"], message: "没有可用的研究依据" },
  ]), "这些引用未取得可用研究依据。只使用本激活已完成检索的validSampleIds；若没有可用样本，请说明材料不足并ask_question暂停，不保存研究稿，不重新检索或扩大范围。", { validSampleIds: [...eligible.keys()] });
  const shown = new Map(projected.results.map((r) => [`search:${r.id}`, r]));
  const supported = Object.fromEntries(fields.map((field) => {
    const sampleIds = selection.normalize(input[field].sampleIds).filter((id) => shown.get(id)?.availableDimensions.includes(field));
    return [field, { sampleIds, observation: sampleIds.length ? input[field].observation : "本维度没有可用研究依据，无法确认规律。" }];
  })) as Record<(typeof fields)[number], z.infer<typeof pattern>>;
  const samples = selected.map((sourceId) => {
    const row = rows.find((r) => `search:${r.id}` === sourceId)!;
    const p = projectToolResult(row as any);
    return { author: p.details.authorNickname ?? null, authorUrl: p.links.find((link) => ["profileUrl", "userJumpUrl", "homeUrl"].includes(link.label))?.url ?? null, sourceId, relevance: explicit.get(sourceId) ?? "仅在规律引用中列出，未单独说明与主题的关联", keyword: row.input.keyword,
      searchCallId: row.call_id, startDate: row.input.startDate, endDate: row.input.endDate,
      title: p.title, url: p.url, text: shown.get(sourceId)?.text ?? "", textTruncated: shown.get(sourceId)?.textTruncated ?? true,
      metrics: Object.fromEntries(metrics.map((key) => [key, p.details[key] ?? null])) };
  });
  if (supported.interactionPattern.sampleIds.every((id) => {
    const sample = samples.find((sample) => sample.sourceId === id)!;
    return Object.values(sample.metrics).every((value) => value === null);
  })) supported.interactionPattern.observation = "互动或评分数据不足，无法确认互动规律或比较排名。";
  const limitations = [...new Set([noWeb, ...input.limitations,
    ...(referenced.length > selected.length ? ["研究按可用依据去重；无可用字段、推荐回退及不属于本激活有效范围的引用未作为研究依据"] : []),
    ...fields.filter((field) => !supported[field].sampleIds.length).map((field) => `${({ titlePattern: "标题", contentPattern: "内容", tagPattern: "标签", interactionPattern: "互动" })[field]}维度缺少可用依据，未确认规律`),
    ...(samples.some((s) => !s.text.trim()) ? ["部分样本未返回正文，仅用于实际存在的标题、标签或互动维度，不作为内容结构依据"] : []),
    ...(samples.some((s) => !s.url) ? ["部分样本未返回可验证原文链接，保留真实检索编号，不补写链接"] : []),
    ...(samples.length < 50 ? [`实际分析${samples.length}条，未达到50条目标`] : []),
    ...(samples.some((s) => s.textTruncated) ? ["部分正文截断，仅分析可见片段"] : []),
    ...(samples.some((s) => Object.values(s.metrics).some((v) => v === null)) ? ["部分互动或评分未知，不能补算或声称数据排名"] : []),
  ])];
  return { analysisCallId: callId, activationId: input.activationId, topic: input.topic, samples,
    patterns: { title: supported.titlePattern, content: supported.contentPattern, tags: supported.tagPattern, interaction: supported.interactionPattern },
    applicationPlan: input.applicationPlan, limitations };
}
export async function verifyResearchDelivery(tx: Tx, turn: Record<string, any>, activationId: string,
  content: AssistantArtifactContent, sources: AssistantSource[], raw: unknown, target?: { artifactId?: string; baseVersion: number }) {
  const application = ResearchApplication.parse(raw);
  const [analysis] = await tx`SELECT c.*,t.snapshot,t.session_id FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id
    WHERE c.id=${application.analysisCallId} AND c.name='analyze_xhs_research' AND c.state='completed' AND t.session_id=${turn.session_id}`;
  if (!analysis || !analysis.result.samples?.length) throw conflict("M1必须先完成真实检索与规律分析，不能交付材料稿");
  const same = analysis.turn_id === turn.id && analysis.result.activationId === activationId;
  let inherited = false;
  if (!same && target?.artifactId && target.baseVersion > 0) for (const selected of turn.snapshot.selected ?? []) {
    if (selected.artifact_id !== target.artifactId || !selected.version) continue;
    const [version] = await tx`SELECT source_snapshot FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${selected.artifact_id} AND version=${selected.version}`;
    if (version?.source_snapshot.some((s: AssistantSource) => s.research?.analysisCallId === analysis.id)) inherited = true;
  }
  if (!same && !inherited) throw conflict("分析不属于当前激活或选定的已验证稿件版本");
  const citation = researchCitations(analysis.result.samples, content.sources, sources, analysis.id, application.explanation);
  const patterns = analysis.result.patterns;
  const references = citation.cited.slice(0, 2).map((sample: any) =>
    `- ${sample.title}：${sample.url ?? "原文链接未返回"}；作者：${sample.author ?? "未知"}；作者主页：${sample.authorUrl ?? "未知"}；` +
    Object.entries(sample.metrics).map(([key, value]) => `${({ likedCount: "点赞", collectedCount: "收藏", commentsCount: "评论", sharedCount: "分享", interactiveCount: "互动总数", totalScore: "综合分" } as Record<string, string>)[key]}：${value ?? "未知"}`).join("，"));
  // The observable research summary is server-rendered from persisted analysis, never just a heading check.
  const formula = `\n\n### 爆款公式来源（已验证研究）\n标题：${patterns.title.observation}\n内容结构：${patterns.content.observation}\n标签：${patterns.tags.observation}\n互动：${patterns.interaction.observation}\n本稿应用：${application.explanation}\n研究范围：${analysis.result.samples.length}条；${analysis.result.limitations.join("；")}\n以下为本次研究参考，不代表已核实正文中的事实。\n${references.join("\n")}`;
  const marker = "\n\n### 爆款公式来源（已验证研究）";
  const body = content.body.split(marker)[0]!.replace(/\n\n(?:#{1,6} )?爆款公式来源[：:][\s\S]*$/, "");
  return {
    content: { ...content, body: body + formula, sources: citation.sourceIds, partial: true,
      scope: `${analysis.result.samples.length}条实际研究样本；${analysis.result.limitations.join("；")}`.slice(0, 1000) },
    sources: citation.sources,
  };
}

/** Model transcript needs the summary and identities, not another copy of source bodies. */
export function analysisSummary(result: Record<string, any>) {
  const { samples, ...summary } = result;
  return { ...summary, sampleCount: samples.length, sampleIds: samples.map((sample: any) => sample.sourceId) };
}

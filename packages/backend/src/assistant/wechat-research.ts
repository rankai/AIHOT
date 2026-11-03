import { z } from "zod";
import type { AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import type { Tx } from "../db.ts";
import { contextTokens } from "./context.ts";
import { conflict } from "./store.ts";
import { ResearchApplication } from "./xhs-research.ts";
const text = z.string().trim().min(1).max(2000);
const sourceId = z.string().regex(/^search:\d+$/);
const pattern = z.object({ sampleIds: z.array(sourceId).min(1).max(10), observation: text }).strict();
export const WechatAnalysis = z.object({ activationId: z.string().uuid(), topic: text,
  samples: z.array(z.object({ sourceId, relevance: text }).strict()).min(1).max(10),
  titlePattern: pattern, openingPattern: pattern, structurePattern: pattern, languagePattern: pattern,
  interactionPattern: pattern, keywordPattern: pattern, applicationPlan: text, limitations: z.array(text).max(20),
}).strict();
export function wechatResearchResults(rows: { id: number; kind: string; data: any }[]) {
  const articles = rows.filter(r => r.kind === "wechat_hot_article");
  const results = articles.slice(0, 10).map(r => ({ id: r.id,
    title: r.data.title.slice(0, 60), authorName: r.data.authorName?.slice(0, 40) ?? null,
    publishTime: r.data.publishTime?.slice(0, 40) ?? null, url: r.data.url,
    text: (r.data.text ?? "").slice(0, 1000), textMeaning: "summary",
    textTruncated: Boolean(r.data.textTruncated || r.data.text?.length > 1000),
    ...Object.fromEntries(["clicksCount", "watchCount", "likeCount", "commentsCount", "popularityScore", "recencyScore", "relevanceScore", "totalScore"].map(key => [key, r.data[key] ?? null])),
    missing: r.data.missing,
  }));
  const projection = { results, metadata: rows.filter(r => r.kind === "wechat_hot_research").slice(0, 1).map(r => r.data),
    totalArticles: articles.length, shownArticles: results.length, limited: articles.length > 10,
    limitations: ["仅提供标题和摘要；摘要按上下文预算截断，只能分析可见片段；未返回的互动数据为未知"] };
  // Two approved queries share the frozen context with rules, material and analysis.
  // Preserve every sample identity and the stored result; only shorten model excerpts.
  while (contextTokens(JSON.stringify(projection)) > 3000 && results.some(r => r.text.length > 24)) {
    for (const result of results) if (result.text.length > 24) {
      result.text = result.text.slice(0, Math.max(24, Math.floor(result.text.length / 2)));
      result.textTruncated = true;
    }
  }
  return projection;
}
export async function analyzeWechatResearch(tx: Tx, turn: Record<string, any>, callId: string, raw: unknown) {
  const input = WechatAnalysis.parse(raw);
  const rows = await tx`SELECT z.id,z.kind,z.data,c.id AS call_id,c.input,c.result AS call_result FROM operation_results z
    JOIN assistant_tool_calls c ON c.child_run_id=z.run_id JOIN operation_runs r ON r.id=z.run_id
    WHERE c.turn_id=${turn.id} AND c.name='search_wechat_articles' AND c.state='completed' AND r.status='completed'
      AND c.input->>'activationId'=${input.activationId} AND z.kind='wechat_hot_article' ORDER BY z.id`;
  const samples = input.samples.map(sample => {
    const row = rows.find(row => `search:${row.id}` === sample.sourceId);
    if (!row || !(row.data.text?.trim() || row.data.title !== "未提供标题")) throw conflict("分析必须来自本激活本回合真实检索的可用公众号样本");
    // Use the exact persisted tool projection seen by the model, including historical shapes.
    const shown = row.call_result?.results?.find((result: any) => String(result.id) === String(row.id));
    if (!shown) throw conflict("分析样本不在已交付的检索结果中");
    return { ...row.data, text: shown.text ?? "", textTruncated: Boolean(shown.textTruncated), sourceId: sample.sourceId, relevance: sample.relevance, searchCallId: row.call_id,
      startDate: row.input.startDate, endDate: row.input.endDate, keyword: row.input.keyword };
  });
  const ids = new Set(samples.map(s => s.sourceId));
  if (ids.size !== samples.length) throw conflict("分析样本不得重复");
  const patterns = { title: input.titlePattern, opening: input.openingPattern, structure: input.structurePattern,
    language: input.languagePattern, interaction: input.interactionPattern, keyword: input.keywordPattern };
  for (const value of Object.values(patterns)) if (value.sampleIds.some(id => !ids.has(id))) throw conflict("规律必须引用本次分析的实际样本");
  return { analysisCallId: callId, activationId: input.activationId, topic: input.topic, samples, patterns,
    applicationPlan: input.applicationPlan, limitations: [...new Set(["仅查询标题和摘要，未读取全文；全文开头、段落和结尾现有样本不足以判断", ...input.limitations,
      ...(samples.length < 10 ? [`实际分析${samples.length}条样本`] : []),
      ...(samples.some(s => s.textTruncated) ? ["部分摘要截断"] : []),
      ...(samples.some(s => s.missing?.length || [s.clicksCount,s.watchCount,s.likeCount,s.commentsCount].some(v => v == null)) ? ["部分来源字段未提供，互动缺失为未知"] : []),
    ])] };
}
export async function verifyWechatDelivery(tx: Tx, turn: Record<string, any>, activationId: string,
  content: AssistantArtifactContent, sources: AssistantSource[], raw: unknown, target: { artifactId?: string; baseVersion: number }) {
  const application = ResearchApplication.parse(raw);
  const [analysis] = await tx`SELECT c.*,t.session_id FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id
    WHERE c.id=${application.analysisCallId} AND c.name='analyze_wechat_research' AND c.state='completed' AND t.session_id=${turn.session_id}`;
  if (!analysis || !analysis.result.samples?.length) throw conflict("公众号稿件必须先有真实检索与规律分析");
  const same = analysis.turn_id === turn.id && analysis.result.activationId === activationId;
  let inherited = false;
  if (!same && target.artifactId && target.baseVersion > 0) for (const selected of turn.snapshot.selected ?? []) {
    if (selected.artifact_id !== target.artifactId || !selected.version) continue;
    const [version] = await tx`SELECT source_snapshot FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${selected.artifact_id} AND version=${selected.version}`;
    if (version?.source_snapshot.some((s: AssistantSource) => s.research?.analysisCallId === analysis.id)) inherited = true;
  }
  if (!same && !inherited) throw conflict("研究不属于本激活或精确选定旧稿的已验证研究");
  const ids = new Set(analysis.result.samples.map((s: any) => s.sourceId));
  const cited = sources.filter(s => content.sources.includes(s.id) && ids.has(s.id));
  if (cited.length < Math.min(2,ids.size)) throw conflict("公众号稿件需要引用实际分析样本");
  const labels: Record<string,string> = { title:"标题", opening:"开头", structure:"结构", language:"语言", interaction:"互动", keyword:"关键词" };
  const patternText = Object.entries(analysis.result.patterns).map(([key,value]:[string,any]) => `${labels[key]}：${value.observation}`).join("\n");
  const references = analysis.result.samples.filter((s:any) => cited.some(c => c.id===s.sourceId)).map((s:any) => `- ${s.title}；${s.url ?? "原文链接未提供"}；作者：${s.authorName ?? "未知"}；阅读：${s.clicksCount ?? "未知"}；在看：${s.watchCount ?? "未知"}；点赞：${s.likeCount ?? "未知"}；评论：${s.commentsCount ?? "未知"}`).join("\n");
  const marker = "\n\n### 公众号爆款规律来源（已验证研究）";
  const scope = `${analysis.result.samples.length}条实际样本；${analysis.result.limitations.join("；")}`.slice(0,1000);
  return { content: { ...content, body: content.body.split(marker)[0] + marker + `\n${patternText}\n本稿应用：${application.explanation}\n研究范围：${scope}\n${references}`, partial:true, scope },
    sources: sources.map(s => cited.some(c => c.id===s.id) ? { ...s, research:{ analysisCallId:analysis.id, application:{explanation:application.explanation} } } : s) };
}

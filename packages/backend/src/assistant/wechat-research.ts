import { z } from "zod";
import type { AssistantArtifactContent, AssistantSource } from "@aihot/contracts/assistant";
import type { Tx } from "../db.ts";
import { contextTokens } from "./context.ts";
import { conflict } from "./store.ts";
import { ResearchApplication } from "./xhs-research.ts";
import { DraftArgumentsError } from "./tool-arguments.ts";
import { researchCitations, selectResearchSamples } from "./research-sources.ts";
const text = z.string().trim().min(1).max(2000);
const sourceId = z.string().max(200);
const pattern = z.object({ sampleIds: z.array(sourceId).max(10), observation: text }).strict();
export const WechatAnalysis = z.object({ activationId: z.string().uuid(), topic: text,
  samples: z.array(z.object({ sourceId, relevance: text.default("未单独说明与主题的关联") }).strict()).max(10),
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
  // Preserve the exact summaries actually delivered to the model, including legacy payloads.
  const shown = new Map<string, any>(rows.flatMap((row) => {
    const article = row.call_result?.results?.find((result: any) => String(result.id) === String(row.id));
    return article && (article.text?.trim() || article.title && article.title !== "未提供标题") ? [[`search:${row.id}`, article] as const] : [];
  }));
  const fields = { title: "titlePattern", opening: "openingPattern", structure: "structurePattern",
    language: "languagePattern", interaction: "interactionPattern", keyword: "keywordPattern" } as const;
  const explicit = new Map(input.samples.map((sample) => [sample.sourceId, sample.relevance]));
  const references = [...new Set([...explicit.keys(), ...Object.values(fields).flatMap((field) => input[field].sampleIds)])];
  const selection = selectResearchSamples(references, new Map([...shown].map(([id, article]) => [id, article.url ?? null])));
  if (!selection.sampleIds.length) throw new DraftArgumentsError(new z.ZodError([
    { code: "custom", path: ["samples"], message: "没有可用公众号研究依据" },
  ]), "所列引用没有可用的公众号标题或摘要。只使用本激活已完成查询交付的真实样本；若材料不足，请ask_question说明并暂停，不保存研究稿，不新增检索。", { validSampleIds: [...shown.keys()] });
  const samples = selection.sampleIds.map((sourceId) => {
    const row = rows.find((row) => `search:${row.id}` === sourceId)!;
    const article = shown.get(sourceId)!;
    return { ...row.data, text: article.text ?? "", textTruncated: Boolean(article.textTruncated), textMeaning: "summary", sourceId,
      relevance: explicit.get(sourceId) ?? "仅在规律引用中列出，未单独说明与主题的关联", searchCallId: row.call_id,
      startDate: row.input.startDate, endDate: row.input.endDate, keyword: row.input.keyword };
  });
  const patterns = Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    const sampleIds = selection.normalize(input[field].sampleIds);
    const observation = !sampleIds.length ? "本维度没有可用研究依据，无法确认规律。" :
      ["opening", "structure"].includes(key) ? "仅有标题和摘要，未读取全文，无法确认全文开头、段落或结尾结构。" :
      key === "interaction" && sampleIds.every(id => {
        const sample = samples.find(sample => sample.sourceId === id)!;
        return [sample.clicksCount,sample.watchCount,sample.likeCount,sample.commentsCount,sample.totalScore].every(value => value == null);
      }) ? "互动数据未返回，无法确认互动规律或比较排名。" :
      `${key === "title" ? "基于可见标题：" : "仅基于可见标题和摘要："}${input[field].observation}`;
    return [key, { sampleIds, observation }];
  }));
  return { analysisCallId: callId, activationId: input.activationId, topic: input.topic, samples, patterns,
    applicationPlan: input.applicationPlan, limitations: [...new Set(["仅查询标题和摘要，未读取全文；全文开头、段落和结尾现有样本不足以判断", ...input.limitations,
      ...(references.length > samples.length ? ["研究按可用依据去重；无依据或不属于本激活有效范围的引用未纳入"] : []),
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
  const citation = researchCitations(analysis.result.samples, content.sources, sources, analysis.id, application.explanation);
  const labels: Record<string,string> = { title:"标题", opening:"开头", structure:"结构", language:"语言", interaction:"互动", keyword:"关键词" };
  const patternText = Object.entries(analysis.result.patterns).map(([key,value]:[string,any]) => `${labels[key]}：${value.observation}`).join("\n");
  const references = citation.cited.slice(0,2).map((s:any) => `- ${s.title}；${s.url ?? "原文链接未提供"}；作者：${s.authorName ?? "未知"}；阅读：${s.clicksCount ?? "未知"}；在看：${s.watchCount ?? "未知"}；点赞：${s.likeCount ?? "未知"}；评论：${s.commentsCount ?? "未知"}`).join("\n");
  const marker = "\n\n### 公众号爆款规律来源（已验证研究）";
  const scope = `${analysis.result.samples.length}条实际样本；${analysis.result.limitations.join("；")}`.slice(0,1000);
  return { content: { ...content, sources: citation.sourceIds, body: content.body.split(marker)[0] + marker + `\n${patternText}\n本稿应用：${application.explanation}\n研究范围：${scope}\n以下为本次标题与摘要研究参考，不代表已核实原文或正文中的事实。\n${references}`, partial:true, scope },
    sources: citation.sources };
}

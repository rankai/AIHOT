import { SaveCoverPlan,CoverPlanReference } from "./cover-plan-contract.ts";
import { persistCoverPlan,resolveCoverImage,COVER_DELIVERY_CONTRACT } from "./cover-plan.ts";
import { CoverVisionProposal,CoverVisionInput } from "./cover-vision-contract.ts";
import { prepareCoverVisionInput,coverVisionIntent,createCoverVisionTx } from "./cover-vision.ts";
import { checkBudget } from "../providers/receipts.ts";
import { XHS_COVER_OPERATION, XhsCoverInput } from "../providers/redfox/xhs-cover-contract.ts";
import { createImageGenerationTx } from "../providers/redfox/images.ts";
import { Size } from "../providers/redfox/image-models.ts";
import { WechatAnalysis, analyzeWechatResearch, verifyWechatDelivery } from "./wechat-research.ts";
import { WECHAT_HOT_OPERATION, WechatHotInput } from "../providers/redfox/wechat-hot-contract.ts";
import { ResearchAnalysis, ResearchApplication, analyzeResearch, verifyResearchDelivery } from "./xhs-research.ts";
import { researchTaskPolicy, validateResearchSearch } from "./research-window.ts";
import { DraftArgumentsError } from "./tool-arguments.ts";
export { DraftArgumentsError } from "./tool-arguments.ts";
import { checkAuto, linkAuto } from "./fees.ts";
import { AccountError } from "../users/accounts.ts";
import { assertMemberCostEligible } from "../users/member-pricing.ts";
import { projectToolResult } from "../users/tool-results.ts";
import type { AssistantSource } from "@aihot/contracts/assistant";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Tx } from "../db.ts";
import { creditHash, chargeForRun } from "../users/credits-core.ts";
import { normalizeToolInput } from "../users/tool-input.ts";
import { quoteTool } from "../users/credits.ts";
import { createSynchronousQueryTx } from "../providers/redfox/synchronous.ts";
import { profile, resolveCandidate } from "./catalog.ts";
import { ownedTurn } from "./controls.ts";
import { event, conflict, saveArtifact, Content } from "./store.ts";
import { resumeRun } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const text = { type: "string" };
export const baseTools = {
  load_skill: {
    description: "从冻结目录加载技能模块，仅下一模型步骤可使用新工具",
    schema: object({ skillId: text, moduleId: text }, ["skillId", "moduleId"]),
  },
  read_skill_reference: {
    description: "读取本回合已激活技能包内声明资源",
    schema: object({ activationId: text, resourceId: text }, ["activationId", "resourceId"]),
  },
  ask_question: { description: "提出需要用户回答的问题；不算创作交付", schema: object({ text }, ["text"]) },
};
const SaveDraftInput = z.object({
  activationId: z.string().uuid(),
  kind: z.enum(["text-draft", "xhs-note"]),
  artifactId: z.string().uuid().optional(),
  baseVersion: z.number().int().min(0),
  content: Content,
  researchApplication: ResearchApplication.partial().optional(),
}).strict();
// Research scope is computed from verified server evidence; other writing contracts stay unchanged.
const ResearchDraftInput = SaveDraftInput.extend({
  content: Content.extend({ sources: z.array(Content.shape.sources.element).max(50).default([]),
    partial: Content.shape.partial.default(false), scope: Content.shape.scope.default("研究范围由服务端生成") }),
});
export const ImageProposal = z.object({ activationId:z.string().uuid(), title:z.string().trim().min(1).max(300), prompt:z.string().min(1).max(10000), size:Size.default("1:1"),planReference:CoverPlanReference.optional() }).strict();
/** Deterministic supported subset; resource text has already passed package integrity validation. */
export function resolveImageSize(prompt: string, candidate?: z.infer<typeof Size>, platformSpecs?: string): z.infer<typeof Size> {
  const invalid = () => new DraftArgumentsError(new z.ZodError([{code:"custom",path:["prompt"],message:"Unsupported or conflicting image ratio"}]), "图片比例不支持或相互冲突，请保留原提示词并询问用户明确一个支持的比例；不要猜测接近比例。");
  if (!prompt.trim()) throw invalid();
  const specs = platformSpecs ? z.array(z.object({keywords:z.array(z.string().min(1)),provider_aspect_ratio:Size,size:z.string(),alternate_size:z.string().nullable()})).parse(JSON.parse(platformSpecs)) : [];
  const explicit: string[] = [];
  for (const match of prompt.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*([:：/xX×])\s*(\d+(?:\.\d+)?)(?![\d.])/g)) {
    const w = Number(match[1]), h = Number(match[3]);
    const documentedSize = /[xX×]/.test(match[2]!) ? specs.find(spec => [spec.size,spec.alternate_size].includes(`${w}x${h}`))?.provider_aspect_ratio : undefined;
    const mapped = documentedSize ?? (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)
      ? ((match[2] === ":" || match[2] === "：" || match[2] === "/") && w === 2.35 && h === 1 ? "21:9" : Size.options.find(ratio => { const [a,b] = ratio.split(":").map(Number); return w * b! === h * a!; }))
      : undefined);
    if (!mapped) throw invalid();
    explicit.push(mapped);
  }
  if (new Set(explicit).size > 1) throw invalid();
  if (explicit.length) return Size.parse(explicit[0]);
  if (platformSpecs) {
    const found = specs.find(spec => spec.keywords.some(keyword => prompt.toLowerCase().includes(keyword.toLowerCase())));
    if (found) return found.provider_aspect_ratio;
  }
  return candidate ?? "1:1";
}
const SearchInput = z.object({ activationId: z.string().uuid(), keyword: z.string().trim().min(1).max(200),
  startDate: z.iso.date(), endDate: z.iso.date() }).strict();
// Match the vendor's normalized keyword contract; its transform/refinements run before any quote.
const CoverSearchInput = XhsCoverInput.extend({ activationId: z.string().uuid() });
const WechatSearchInput = SearchInput.extend({ keyword: WechatHotInput.shape.keyword });
const searchCorrection = "请按检索工具schema和冻结researchClock修正参数；保留用户明确范围，无法满足时提问说明限制，不得静默改期。";
const dateArgumentsError = (message: string) => new DraftArgumentsError(new z.ZodError([
  { code: "custom", path: ["startDate"], message },
]), `${message}。${searchCorrection}`);
export const businessTools = {
  generate_image: { description:"准备单张1K图片的独立报价，不会外发。仅用户专用批准入口可执行；不支持参考图、编辑、批量或其他模型。提示词应明确主题、构图、风格与文字要求。", schema:z.toJSONSchema(ImageProposal, {io:"input"}) },
  analyze_wechat_research: { description: "分析本激活真实返回标题和摘要的六维规律；显式选样和规律引用共同确定研究样本，只使用真实可用来源并去重。仅有摘要不能声称读过全文、引用原文断言或验证全文开头/段落/结尾；无依据维度如实写不足，缺失互动数未知。有样本直接继续，不为不足10条或摘要截断增加范围确认。", schema: z.toJSONSchema(WechatAnalysis) },
  save_xhs_cover_plan: {description:"保存恰好三套有真实视觉研究依据的封面方案。summary 概括观察到的设计规律，不另报检索、去重或观察数量；页面使用本版研究记录展示这些数据。仅方案用next=plans-only结束；否则next=choose保存后等待用户选择，选择不等于付款。历史方案仅限本轮明确选中版本，修订使用artifactId/baseVersion。",schema:z.toJSONSchema(SaveCoverPlan,{io:"input"})},
  analyze_xhs_covers: { description: "对本回合已查询的真实封面进行视觉分析，最多20个sourceId并说明选样理由。仅创建独立报价，必须人工专用入口批准，旧检索自动授权无效。不得传URL或声称仅凭元数据看过图。", schema:z.toJSONSchema(CoverVisionProposal) },
  search_xhs_covers: { description: "创建爆款封面候选查询报价，最多5个去重词，含分隔逗号总长最多30个UTF-16单元（emoji计2）。每父回合仅一次，必须专用入口人工确认，旧自动授权无效。startDate默认researchClock.earliestDate，须在冻结近30天范围内；供应商T+1数据，仅支持起始日期，不接受endDate。不自动补查或重试；返回元数据不是看图分析。", schema: z.toJSONSchema(SearchInput.omit({ endDate: true }).extend({ keyword: z.string().min(1).max(30).describe("1–5个去重关键词，用英文逗号分隔；包括逗号总长≤30个UTF-16单元，emoji计2。超限需重新精简选择，不截断或拆成多次查询") })) },
  search_wechat_articles: { description: "创建公众号热文查询报价：关键词用英文逗号合并，最多5词200字符。每次必须用户专用入口人工确认，父创作自动授权无效。researchClock.today为冻结业务日期，默认D-7至D，保留用户明确日期。不会自动扩期或重试。", schema: z.toJSONSchema(SearchInput.extend({ keyword: z.string().min(1).max(200).regex(/^[^,，]+(?:[,，][^,，]+){0,4}$/).describe("1–5个去重关键词，以英文逗号分隔；总长不超过200个Unicode字符") })) },
  analyze_xhs_research: {
    description: "基于当前激活已完成关键词检索的实际样本，保存可观察的标题、内容结构、标签、互动规律及应用计划。显式选样与四种规律引用共同确定实际研究样本；不需要重复抄写同一ID，只引用真实search:ID，说明可判断的主题关联，推荐回退不算样本。缺少依据的维度如实说明不足，缺少互动数据明确未知。有可用样本即可继续创作；样本不足50条或正文截断只需如实披露，不另行询问范围确认。",
    schema: z.toJSONSchema(ResearchAnalysis),
  },
  save_draft: {
    description: "保存并交付符合已激活模块合同的稿件；遵循该模块已加载的写作规程。本次唯一成功研究由服务端关联，不必复述analysisCallId；有多份或明确指定时使用researchApplication。规律和参考由服务端保存并单独展示，body只填可发布正文，不写主标题、备选标题列表、标签或研究附注或把摘要写成已核实原文引语。新建不传artifactId且baseVersion为0；修改仅使用已给定稿件ID和版本。sources使用输入消息ID或真实取得的引用，不编造来源。改写直接依据用户原文，不要求研究、风格确认或遥测。",
    schema: z.toJSONSchema(SaveDraftInput),
  },
  search_xhs_notes: {
    description: "自主创建单关键词检索的独立报价与待批准建议，这是本地准备，无需先询问能否取报价，不会立即外发。只有服务端已确认的本会话自动授权或用户专用批准入口才可执行真实检索，聊天同意不算批准。不自动翻页或扩期。沿用用户已明确的关键词和日期，缺业务参数才询问。",
    schema: z.toJSONSchema(SearchInput),
  },
};
export function assertBusinessTool(turn: Record<string, any>, name: string) {
  if (
    !turn.snapshot.allowedTools?.includes(name) ||
    !(profile(turn.snapshot.assistantId).tools as readonly string[]).includes(name)
  )
    throw conflict("工具不在冻结授权与当前许可的交集中");
}
export async function sourceCandidates(tx: Tx, turn: Record<string, any>): Promise<AssistantSource[]> {
  const sourceSnapshot: AssistantSource[] = [
    { id: "current-message", kind: "user-material", label: "本回合用户提供的材料", url: null },
  ];
  for (const item of turn.snapshot.selected ?? []) {
    if (item.id) {
      sourceSnapshot.push({
        id: `input:${item.id}`,
        kind: "user-material",
        label: item.source?.filename || "选定文本材料",
        url: null,
      });
    }
    if (item.artifact_id) {
      sourceSnapshot.push({
        id: `artifact:${item.artifact_id}:${item.version}`,
        kind: "artifact",
        label: String(item.content?.title ?? "已有稿件"),
        url: null,
      });
      // New turns freeze this server-owned metadata with the exact selected version.
      // Older accepted turns lack it; read only that version, never the latest or its body links.
      const savedSources = item.source_snapshot ?? (
        await tx`SELECT source_snapshot FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${item.artifact_id} AND version=${item.version}`
      )[0]?.source_snapshot ?? [];
      sourceSnapshot.push(...savedSources);
    }
  }
  const research =
    await tx`SELECT z.id,z.kind,z.data FROM operation_results z JOIN assistant_tool_calls c ON c.child_run_id=z.run_id JOIN operation_runs r ON r.id=z.run_id WHERE c.turn_id=${turn.id} AND c.state='completed' AND r.status='completed' AND coalesce(c.result->>'researchSuperseded','false')<>'true' AND c.name IN ('search_xhs_notes','search_wechat_articles')`;
  for (const row of research) {
    const projected = projectToolResult({ id: row.id, kind: row.kind, data: row.data });
    sourceSnapshot.push({ id: `search:${row.id}`, kind: "research", label: projected.title, url: projected.url });
  }

  return [...new Map(sourceSnapshot.map((source) => [source.id, source])).values()];
}
export async function activeTools(tx: Tx, turn: Record<string, any>) {
  const activations = await tx`SELECT * FROM assistant_activations WHERE turn_id=${turn.id}`;
  const tools: Record<string, any> = { ...baseTools };
  for (const a of activations) {
    const { module } = await resolveCandidate(turn.snapshot.candidates, a.candidate.skillId, a.candidate.moduleId);
    for (const id of module.tools)
      if (
        turn.snapshot.allowedTools?.includes(id) &&
        (profile(turn.snapshot.assistantId).tools as readonly string[]).includes(id)
      )
        tools[id] = businessTools[id];
  }
  if(turn.snapshot.taskScope){
    const descriptions: Record<string,string> = {
      generate_image: "使用本任务已冻结的单张 1K 图片项目，按 taskScope 的规格生成，不再次确认费用。封面任务必须引用用户选定的方案；不得扩大张数、规格或自动重试。",
      search_xhs_covers: "使用本任务已冻结的封面查询项目直接检索。每任务一次，1—5 个去重关键词，含分隔逗号总长最多30个UTF-16单元（emoji计2），不得截断或拆成多次查询。按 researchClock 的 T+1 查询，不传 endDate，不自动重试。返回的元数据不能代替真实图片视觉观察。",
      analyze_xhs_covers: "使用本任务已冻结的视觉项目读取真实封面图片，最多 20 个 sourceIds；无需再次确认费用，只能分析本任务检索得到的来源。",
      search_xhs_notes: "使用本任务已冻结的查询项目直接检索，一个关键词并按工具参数指定日期；不翻页、扩大范围或自动重试，无需再次确认费用。",
      search_wechat_articles: "使用本任务已冻结的公众号查询项目直接检索，最多两次、每次 1—5 个关键词合计最多 200 字；默认 D-7 到 D，不自动重试，无需再次确认费用。",
    };
    for(const [name,description] of Object.entries(descriptions)){
      if(tools[name])tools[name]={...tools[name],description};
    }
    if(researchTaskPolicy(turn.snapshot)) {
      const name=researchTaskPolicy(turn.snapshot)==='xhs-empty-window@1'?'search_xhs_notes':'search_wechat_articles';
      if(tools[name])tools[name]={...tools[name],description:`使用一次已确认费用的冻结研究查询；首查日期由taskScope.research确定。模型仅调用一次；宿主按真实已保存结果自动决定是否同词扩至30天，最多两次，不换词或翻页。指定日期或只查一次时不扩。最终无可用样本由宿主正常结束并说明查询结果，不保存稿件，不另行询问写稿。${name==='search_wechat_articles'?'按接口原始数0–9扩期，10及以上不扩；扩期后使用第二次结果。':'仅无可分析关键词命中才扩，一条可用笔记即可继续；热门推荐不算命中。'}`};
      const [searched]=await tx`SELECT 1 FROM assistant_tool_calls WHERE turn_id=${turn.id} AND name=${name} AND child_run_id IS NOT NULL LIMIT 1`;
      if(searched)delete tools[name];
    }
    if(turn.snapshot.taskScope.delivery==='plans-only')delete tools.generate_image;
  }
  const requiredAnalyses: string[] = [];
  for (const a of activations) {
    const { module } = await resolveCandidate(turn.snapshot.candidates, a.candidate.skillId, a.candidate.moduleId);
    for (const name of ["analyze_xhs_research", "analyze_wechat_research"] as const) if (module.tools.includes(name)) requiredAnalyses.push(name);
  }
  let inheritedTargets: string[] | null = null;
  if (tools.save_draft && activations.length && requiredAnalyses.length > 0) {
    const analyses = await tx`SELECT id,result FROM assistant_tool_calls WHERE turn_id=${turn.id} AND name IN ${tx(requiredAnalyses)} AND state='completed'`;
    let ready = analyses.length > 0;
    if (!ready) inheritedTargets = [];
    if (inheritedTargets) for (const selected of turn.snapshot.selected ?? []) {
      if (!selected.artifact_id || !selected.version) continue;
      const [version] = await tx`SELECT source_snapshot FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${selected.artifact_id} AND version=${selected.version}`;
      if (version?.source_snapshot.some((source: AssistantSource) => source.research?.analysisCallId)) {
        ready = true; inheritedTargets.push(selected.artifact_id);
      }
    }
    if (!ready) delete tools.save_draft;
  }
  if (tools.save_draft) {
    const sources = await sourceCandidates(tx, turn);
    const researchDraft = requiredAnalyses.length > 0;
    const schema: any = researchDraft ? z.toJSONSchema(ResearchDraftInput, { io: "input" }) : structuredClone(tools.save_draft.schema);
    const allArtifacts = await tx`SELECT artifact_id AS "artifactId",max(version)::int AS version FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND kind IN ('text-draft','xhs-note') GROUP BY artifact_id ORDER BY artifact_id`;
    const artifacts = inheritedTargets ? allArtifacts.filter((a) => inheritedTargets.includes(a.artifactId)) : allArtifacts;
    if (inheritedTargets) schema.required.push("artifactId");
    if (artifacts.length) schema.properties.artifactId.enum = artifacts.map((artifact) => artifact.artifactId);
    else delete schema.properties.artifactId;
    schema.properties.content.properties.sources.items.enum = sources.map((source) => source.id);
    tools.save_draft = {
      ...tools.save_draft,
      schema,
      description: tools.save_draft.description + (inheritedTargets ? " 当前仅可修改以下已选稿件并复用其确切版本研究；新建或修改其他稿件必须本回合重新研究。" : "") + " 可修改稿件：" + JSON.stringify(artifacts) + " 可用来源（ID只引用这张表；链接直接使用url，不得由ID拼接）：" + JSON.stringify(sources.map(({ id, kind, label, url }) => ({ id, kind, label: label.slice(0, 60), url }))),
    };
  }
  return { tools, activationIds: activations.map((a) => String(a.id)) };
}
export async function activation(tx: Tx, turn: Record<string, any>, id: string) {
  const [a] =
    await tx`SELECT * FROM assistant_activations WHERE id=${z.string().uuid().parse(id)} AND turn_id=${turn.id}`;
  if (!a) throw conflict("技能激活记录不可访问");
  return { a, ...(await resolveCandidate(turn.snapshot.candidates, a.candidate.skillId, a.candidate.moduleId)) };
}
async function researchApplication(tx: Tx, turn: Record<string, any>, activationId: string, name: string,
  raw: unknown, target: { artifactId?: string; baseVersion: number }) {
  const parsed = ResearchApplication.partial().safeParse(raw ?? {});
  if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请说明使用哪份已完成研究；不重新检索。");
  const explanation = parsed.data.explanation ?? "沿用本次已完成研究，以下来源作为写作参考。";
  const requested = parsed.data.analysisCallId;
  const candidates = await tx`SELECT id FROM assistant_tool_calls WHERE turn_id=${turn.id} AND name=${name}
    AND state='completed' AND input->>'activationId'=${activationId} AND result->>'activationId'=${activationId}`;
  if ((!candidates.length || requested) && target.artifactId && target.baseVersion > 0) {
    const selected = (turn.snapshot.selected ?? []).filter((item: any) => item.artifact_id === target.artifactId && item.version);
    const exact = selected.find((item: any) => item.version === target.baseVersion);
    const ids = new Set<string>();
    for (const item of !requested && exact ? [exact] : selected) {
      const [version] = await tx`SELECT source_snapshot FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${target.artifactId} AND version=${item.version}`;
      for (const source of (version?.source_snapshot ?? []) as AssistantSource[]) if (source.research) ids.add(source.research.analysisCallId);
    }
    if (ids.size) candidates.push(...await tx`SELECT c.id FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id
      WHERE c.id IN ${tx([...ids])} AND c.name=${name} AND c.state='completed' AND t.session_id=${turn.session_id}`);
  }
  if (requested) {
    if (!candidates.some((candidate) => candidate.id === requested)) throw new DraftArgumentsError(new z.ZodError([
      { code: "custom", path: ["researchApplication", "analysisCallId"], message: "本次任务无法使用这份分析" },
    ]), "本次任务无法使用所填分析编号。请引用本次已完成或精确选定稿件附带的真实研究；只有一份时可省略编号由服务端关联，不重新检索。");
    return { analysisCallId: requested, explanation };
  }
  if (candidates.length !== 1) throw new DraftArgumentsError(new z.ZodError([
    { code: "custom", path: ["researchApplication", "analysisCallId"], message: "需要可唯一确定的已完成研究" },
  ]), "尚无可唯一确定的研究。已有多份时请明确analysisCallId；没有完成研究时先分析已有材料或说明材料不足，不重新检索。");
  return { analysisCallId: candidates[0]!.id, explanation };
}
export async function localCall(
  tx: Tx,
  turn: Record<string, any>,
  step: Record<string, any>,
  call: Record<string, any>,
) {
  if (!Object.hasOwn(step.request_snapshot.tools, call.name)) throw conflict("模型调用未公开工具");
  if (call.name === "load_skill") {
    if (turn.snapshot.model.tokenizer !== "cl100k_base" || !turn.snapshot.model.capabilities.includes("text-tools"))
      throw conflict("模型能力不兼容");
    const parsed = z.object({ skillId: z.string(), moduleId: z.string() }).strict().safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请使用冻结目录中的skillId和moduleId修正加载参数；无需询问用户是否允许加载模块。");
    const i = parsed.data;
    const { candidate, skill, module } = await resolveCandidate(turn.snapshot.candidates, i.skillId, i.moduleId),
      hash = creditHash(candidate);
    const [a] =
      await tx`INSERT INTO assistant_activations(id,turn_id,model_step_id,identity_hash,candidate) VALUES (${randomUUID()},${turn.id},${step.id},${hash},${tx.json(candidate as never)}) ON CONFLICT(turn_id,identity_hash) DO UPDATE SET identity_hash=EXCLUDED.identity_hash RETURNING id`;
    return {
      activationId: a!.id,
      ...candidate,
      entry: skill.texts.get(module.entryResource),
      resources: module.resources,
      tools: module.tools,
      outputKinds: module.outputKinds,
    };
  }
  if (call.name === "read_skill_reference") {
    const parsed = z.object({ activationId: z.string().uuid(), resourceId: z.string() }).strict().safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请使用已加载模块返回的activationId和resourceId修正读取参数；不要重新检索。");
    const i = parsed.data;
    const { skill, module } = await activation(tx, turn, i.activationId);
    if (!module.resources.includes(i.resourceId)) throw conflict("资源不属于当前模块");
    const resource = skill.manifest.resources.find((r) => r.resourceId === i.resourceId)!;
    return { text: skill.texts.get(i.resourceId), type: resource.type, hash: resource.sha256 };
  }
  if (call.name === "ask_question") {
    const parsed = z.object({ text: z.string().min(1).max(2000) }).strict().safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请将需要用户回答的问题放入text字段，长度为1至2000字符；不要重新检索。");
    const input = parsed.data;
    return { question: input.text };
  }
  if (call.name === "analyze_xhs_research" || call.name === "analyze_wechat_research") {
    assertBusinessTool(turn, call.name);
    const parsed = (call.name === "analyze_wechat_research" ? WechatAnalysis : ResearchAnalysis).safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请修正规律分析字段，只引用实际研究样本；没有样本时提问暂停，不保存材料稿。");
    const input = parsed.data;
    const { module } = await activation(tx, turn, input.activationId);
    if (!module.tools.includes(call.name)) throw conflict("当前模块不能分析研究");
    return call.name === "analyze_wechat_research" ? analyzeWechatResearch(tx, turn, call.id, input) : analyzeResearch(tx, turn, call.id, input);
  }
  if(call.name === "save_xhs_cover_plan") {
    assertBusinessTool(turn,call.name);
    const parsed=SaveCoverPlan.safeParse(call.input);if(!parsed.success)throw new DraftArgumentsError(parsed.error,"请提供三套封面方案的名称和提示词；构图、配色缺失可省略，不补造观察，来源只使用实际成功观察的图片；方案编号和本任务后续动作由服务端补齐");
    const {a,module}=await activation(tx,turn,parsed.data.activationId);
    if(module.deliveryContract!==COVER_DELIVERY_CONTRACT||!module.tools.includes(call.name)||!module.outputKinds.includes("xhs-cover-plan"))throw conflict("模块不允许保存封面方案");
    return persistCoverPlan(tx,turn,a.id,parsed.data);
  }
  if (call.name === "save_draft") {
    assertBusinessTool(turn, "save_draft");
    const identity = z.object({ activationId: z.string().uuid() }).passthrough().safeParse(call.input);
    if (!identity.success) throw new DraftArgumentsError(identity.error);
    const { a, module } = await activation(tx, turn, identity.data.activationId);
    const parsed = (module.tools.some(t => t === "analyze_xhs_research" || t === "analyze_wechat_research") ? ResearchDraftInput : SaveDraftInput).safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error);
    const i = parsed.data;
    if (!module.tools.includes("save_draft") || !module.outputKinds.includes(i.kind))
      throw conflict("当前模块不能交付此作品类型");
    const allActivations = await tx`SELECT candidate FROM assistant_activations WHERE turn_id=${turn.id}`;
    for (const row of allActivations) {
      const required = await resolveCandidate(turn.snapshot.candidates, row.candidate.skillId, row.candidate.moduleId);
      if(required.module.deliveryContract===COVER_DELIVERY_CONTRACT)throw conflict("已激活封面研究，不能用普通稿件绕过方案交付");
      const researchTool = required.module.tools.find(tool => tool === "analyze_xhs_research" || tool === "analyze_wechat_research");
      if (researchTool && (!module.tools.includes(researchTool) || module.deliveryContract !== required.module.deliveryContract))
        throw conflict("本回合已选择研究创作，不能静默降级为其他交付；更换任务须新建请求");
    }
    let sourceSnapshot = await sourceCandidates(tx, turn);
    const permitted = new Set(sourceSnapshot.map((source) => source.id));
    if (i.content.sources.some((source) => !permitted.has(source)) &&
        !module.tools.some((tool) => tool === "analyze_wechat_research" || tool === "analyze_xhs_research"))
      throw new DraftArgumentsError(new z.ZodError([{ code: "custom", path: ["content", "sources"], message: "引用编号不在可用来源中" }]),
        "稿件sources只能使用工具列出的真实来源ID；本次用户原文可用current-message。请修正来源编号，不编造来源或重新检索。");
    i.content.sources = i.content.sources.filter((source) => permitted.has(source));
    if (module.tools.includes("analyze_wechat_research")) {
      const application = await researchApplication(tx, turn, a.id, "analyze_wechat_research", i.researchApplication, i);
      const verified = await verifyWechatDelivery(tx, turn, a.id, i.content, sourceSnapshot, application, { artifactId:i.artifactId, baseVersion:i.baseVersion }, Number(module.version) >= 5);
      sourceSnapshot = verified.sources; i.content = verified.content;
    } else if (module.tools.includes("analyze_xhs_research")) {
      const application = await researchApplication(tx, turn, a.id, "analyze_xhs_research", i.researchApplication, i);
      const verified = await verifyResearchDelivery(tx, turn, a.id, i.content, sourceSnapshot, application, { artifactId: i.artifactId, baseVersion: i.baseVersion }, Number(module.version) >= 9);
      sourceSnapshot = verified.sources;
      i.content = verified.content;
    } else if (module.tools.includes("search_xhs_notes")) {
      // Previously accepted v2 turns retain their frozen delivery contract; new turns only select v3.
      const cited = sourceSnapshot.filter((source) => i.content.sources.includes(source.id) && source.kind === "research" && source.url);
      if (!cited.length) i.content = { ...i.content, partial: true, scope: "未取得可引用的研究资料，仅依据已确认的用户材料创作" };
    }
    const [before] =
      await tx`SELECT artifact_id,version,kind,content FROM assistant_artifact_versions WHERE turn_id=${turn.id} AND activation_id=${a.id} AND content=${tx.json(i.content)}`;
    if (before) return { artifactId: before.artifact_id, version: before.version, kind: before.kind };
    return saveArtifact(tx, { sessionId: turn.session_id, turnId: turn.id, sourceSnapshot, ...i });
  }
  throw conflict("工具需要单独批准");
}
async function proposalQuote(turn:Record<string,any>,intent:import("@aihot/contracts/credits").ToolCreditIntent) {
 if (!turn.snapshot.taskScope) return quoteTool(turn.owner_user_id,intent);
 const charge=await chargeForRun(sql,turn.parent_operation_run_id);
 if(!charge?.pricing_snapshot.task || charge.state!=="reserved")throw conflict("本次任务授权不可执行");
 const [quote]=await sql`SELECT expires_at FROM member_tool_quotes WHERE id=${charge.quote_id}`;
 return {quoteId:charge.quote_id,amount:0,available:0,affordable:true,priceId:null,priceVersion:1,expiresAt:quote!.expires_at.toISOString(),recoveryOfRunId:null};
}
export async function prepareCall(turn: Record<string, any>, call: Record<string, any>) {
  if(call.name === "analyze_xhs_covers") {
    assertBusinessTool(turn,call.name);
    const parsed=CoverVisionProposal.safeParse(call.input);if(!parsed.success)throw new DraftArgumentsError(parsed.error,"仅选择本回合封面查询返回的sourceId，并填写选样理由");
    await sql.begin(async tx=>{const {module}=await activation(tx,turn,parsed.data.activationId);if(!module.tools.includes(call.name))throw conflict("模块不允许视觉分析");});
    const input=await prepareCoverVisionInput(turn,parsed.data),intent=coverVisionIntent(input);
    await assertMemberCostEligible(intent);await checkBudget(sql,"assistant.vision");await checkBudget(sql,"assistant.vision","member");
    return {normalized:{intent,commandInput:input as unknown as Record<string,unknown>},quote:await proposalQuote(turn,intent)};
  }
  if (call.name !== "generate_image") return prepareSearch(turn, call);
  assertBusinessTool(turn, call.name);
  const parsed = ImageProposal.safeParse(call.input);
  if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请按图片工具 schema 修正参数，保留原提示词。");
  const i = parsed.data;
  const size = await sql.begin(async tx => { const { skill, module } = await activation(tx, turn, i.activationId);
    if (!module.tools.includes(call.name) || !module.outputKinds.includes("image")) throw conflict("当前模块不允许生成图片");
    const activations=await tx`SELECT candidate FROM assistant_activations WHERE turn_id=${turn.id}`;
    for(const row of activations){const selected=await resolveCandidate(turn.snapshot.candidates,row.candidate.skillId,row.candidate.moduleId);if(selected.module.deliveryContract===COVER_DELIVERY_CONTRACT&&module.deliveryContract!==COVER_DELIVERY_CONTRACT)throw conflict("封面任务不能切换独立图片模块绕过方案研究");}
    if(module.deliveryContract===COVER_DELIVERY_CONTRACT&&!i.planReference&&turn.snapshot.coverChoice){
      const {artifactId,version,schemeId}=turn.snapshot.coverChoice;
      i.planReference=CoverPlanReference.parse({artifactId,version,schemeId});
    }
    if(module.deliveryContract===COVER_DELIVERY_CONTRACT&&!i.planReference)throw new DraftArgumentsError(CoverPlanReference.safeParse(undefined).error!,"先保存封面方案并等待用户明确选择；不能替用户选择或直接生图。");
    if(i.planReference&&turn.snapshot.coverChoice){
      const selected=turn.snapshot.coverChoice;
      if(i.planReference.artifactId!==selected.artifactId||i.planReference.version!==selected.version||i.planReference.schemeId!==selected.schemeId)
        throw new DraftArgumentsError(new z.ZodError([{code:"custom",path:["planReference"],message:"方案引用与本轮已选方案不一致"}]),"请使用用户本轮已选方案的引用；也可省略planReference由服务端补齐。不要要求用户再次选择、改用其他方案或重新检索。");
    }
    if(i.planReference){const chosen=await resolveCoverImage(tx,turn,i.planReference);i.prompt=chosen.prompt;i.title=chosen.title;i.size=chosen.size;return chosen.size;}
    return resolveImageSize(i.prompt, i.size, module.resources.includes("platform-specs") ? skill.texts.get("platform-specs") : undefined);
  });
  const normalized = await normalizeToolInput(`user:${turn.owner_user_id}`, "images", {model:"gptImage2",prompt:i.prompt,size,resolution:"1k",n:1,fileKeys:[]});
  await assertMemberCostEligible(normalized.intent);
  return { normalized, quote: await proposalQuote(turn,normalized.intent), ...(i.planReference ? {correctedInput:i} : {}) };
}
export async function prepareSearch(turn: Record<string, any>, call: Record<string, any>) {
  const wechat = call.name === "search_wechat_articles", cover = call.name === "search_xhs_covers";
  assertBusinessTool(turn, call.name);
  const parsed = (cover ? CoverSearchInput : wechat ? WechatSearchInput : SearchInput).safeParse(call.input);
  if (!parsed.success) throw new DraftArgumentsError(parsed.error, searchCorrection);
  const i = parsed.data;
  if ("endDate" in i && typeof i.endDate === "string" && i.startDate > i.endDate) throw dateArgumentsError("开始日期不得晚于结束日期");
  await sql.begin(async (tx) => {
    const { module } = await activation(tx, turn, i.activationId);
    if (!module.tools.includes(call.name)) throw conflict("当前模块不允许检索");
    await validateResearchSearch(tx,turn,call,i);
    if (cover) {
      const clock = turn.snapshot.researchClock;
      if (!clock) throw conflict("缺少可信日期，请重新发起任务");
      if (i.startDate < clock.earliestDate || i.startDate > clock.latestDate) throw dateArgumentsError(`封面查询起始日期须在${clock.earliestDate}至${clock.latestDate}内（供应商T+1更新）；不得静默改期`);
    }
    if (wechat && "endDate" in i && typeof i.endDate === "string") {
      const clock = turn.snapshot.researchClock;
      if (!clock) throw conflict("缺少可信日期，请重新发起任务");
      if (i.startDate < clock.earliestDate || i.endDate > clock.today) throw dateArgumentsError("公众号日期须处于冻结业务日期前30天至当天；不得静默改期");
    }
    if (module.tools.includes("analyze_xhs_research") && "endDate" in i && typeof i.endDate === "string") {
      if (!turn.snapshot.researchClock) throw conflict("缺少可信日期，请重新发起任务");
      const clock = turn.snapshot.researchClock;
      if (i.startDate < clock.earliestDate || i.endDate > clock.latestDate)
        throw dateArgumentsError(`检索日期须在${clock.earliestDate}至${clock.latestDate}内；不得静默改期`);
    }
  });
  if (cover) {
    const prior = await sql`SELECT id FROM assistant_tool_calls WHERE turn_id=${turn.id} AND name='search_xhs_covers' AND child_run_id IS NOT NULL`;
    if (prior.length) throw conflict("本回合封面查询仅一次，请核对原查询结果");
  }
  if (wechat) {
    const prior = await sql`SELECT r.status FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id WHERE c.turn_id=${turn.id} AND c.name='search_wechat_articles'`;
    if (prior.length >= 2) throw conflict("本回合公众号查询最多两次");
    if (prior.some(r => r.status !== "completed")) throw conflict("先核对原公众号查询，不能重新发起");
  }
  const normalized = await normalizeToolInput(`user:${turn.owner_user_id}`, "query", {
    provider: "redfox",
    operationId: cover ? XHS_COVER_OPERATION : wechat ? WECHAT_HOT_OPERATION : "3X8FGEEM",
    parameters: { keyword: i.keyword, startDate: i.startDate, ...("endDate" in i ? {endDate:i.endDate} : {}), ...(wechat || cover ? {} : { pageNum: 1, pageSize: 50 }) },
  }, { assistantSearch: true });
  await assertMemberCostEligible(normalized.intent);
  return { normalized, quote: await proposalQuote(turn,normalized.intent), ...(researchTaskPolicy(turn.snapshot)?{correctedInput:i}:{}) };
}
export async function decideCall(
  userId: number,
  sessionId: string,
  callId: string,
  approve: boolean,
  raw: unknown,
  key: unknown,
) {
  const input = z.object({ proposalRevision: z.number().int().positive() }).strict().parse(raw);
  z.string().min(8).max(160).parse(key);
  return sql.begin(async (tx) => {
    const [lookup] = await tx`SELECT turn_id FROM assistant_tool_calls WHERE id=${z.string().uuid().parse(callId)}`;
    if (!lookup) throw conflict("建议不存在");
    const { t } = await ownedTurn(tx, userId, sessionId, lookup.turn_id);
    const [call] = await tx`SELECT * FROM assistant_tool_calls WHERE id=${callId} FOR UPDATE`;
    const hash = creditHash({ approve, ...input });
    if (call!.command_hash) {
      if (call!.command_hash !== hash) throw conflict("建议已收到不同决定");
      return { callId, childRunId: call!.child_run_id };
    }
    if (
      t.status !== "waiting" ||
      t.phase !== "waiting_approval" ||
      call!.state !== "proposed" ||
      call!.proposal_revision !== input.proposalRevision
    )
      throw conflict("建议状态已变化");
    assertBusinessTool(t, call!.name);
    const { module } = await activation(tx, t, call!.input.activationId);
    if (!module.tools.includes(call!.name)) throw conflict("工具不在模块范围");
    if (!approve) {
      await tx`UPDATE assistant_tool_calls SET state='rejected',result=${tx.json({ rejected: true })},command_hash=${hash} WHERE id=${callId}`;
    } else {
      await startSearch(tx,userId,t,call!);
    }
    await tx`UPDATE assistant_turns SET phase='executing' WHERE id=${t.id}`;
    await resumeRun(tx, { runId: t.parent_operation_run_id, stepVersion: t.step_version, generation: t.generation });
    await queueOperationStep(tx, t.parent_operation_run_id);
    await event(tx, sessionId, "call", callId);
    return { callId };
  });
}

export async function refreshCallQuote(userId: number, sessionId: string, callId: string) {
  const [lookup] = await sql`SELECT turn_id FROM assistant_tool_calls WHERE id=${z.string().uuid().parse(callId)}`;
  if (!lookup) throw conflict("建议不存在");
  const proposal = await sql.begin(async (tx) => {
    const { t } = await ownedTurn(tx, userId, sessionId, lookup.turn_id);
    const [call] = await tx`SELECT * FROM assistant_tool_calls WHERE id=${callId} FOR UPDATE`;
    if (t.status !== "waiting" || t.phase !== "waiting_approval" || call!.state !== "proposed")
      throw conflict("当前建议不能重新报价");
    return { t, call: call! };
  });
  const priced = await prepareCall({ ...proposal.t, owner_user_id: userId }, proposal.call);
  return sql.begin(async (tx) => {
    const { t } = await ownedTurn(tx, userId, sessionId, lookup.turn_id);
    const [call] = await tx`SELECT * FROM assistant_tool_calls WHERE id=${callId} FOR UPDATE`;
    if (
      t.status !== "waiting" ||
      t.phase !== "waiting_approval" ||
      call!.state !== "proposed" ||
      call!.proposal_revision !== proposal.call.proposal_revision
    )
      throw conflict("建议已变化");
    const [count] = await tx`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${t.id} AND child_run_id IS NOT NULL`;
    const blocked = count!.n >= t.snapshot.limits.childCalls || t.child_calls >= t.snapshot.limits.childCalls ? "本回合检索次数已达上限" : !priced.quote.affordable ? "可用积分不足，请补充后重新报价" : null;
    const previous =
      call!.result && typeof call!.result === "object" && !Array.isArray(call!.result)
        ? call!.result as Record<string, unknown>
        : {};
    const result = {
      ...Object.fromEntries(
        Object.entries(previous).filter(
          ([key]) => key !== "normalized" && key !== "approvalBlockedReason",
        ),
      ),
      normalized: priced.normalized,
      ...(blocked ? { approvalBlockedReason: blocked } : {}),
    };
    await tx`UPDATE assistant_tool_calls SET result=${tx.json(result as never)},quote=${tx.json(priced.quote as never)},proposal_revision=proposal_revision+1 WHERE id=${callId}`;
    await event(tx, sessionId, "call", callId);
    return { quote: priced.quote, proposalRevision: call!.proposal_revision + 1 };
  });
}

async function startSearch(tx:Tx,userId:number,t:Record<string,any>,call:Record<string,any>,authorizationId?:string){
 if (authorizationId && call.name !== "search_xhs_notes") throw conflict("本次查询需要人工确认");
 const { a } = await activation(tx, t, call.input.activationId);
 const researchInput={...call.input};
 if(await validateResearchSearch(tx,t,call,researchInput)) {
  const parameters=call.result.normalized.commandInput.parameters;
  if(parameters.keyword!==researchInput.keyword||parameters.startDate!==researchInput.startDate||parameters.endDate!==researchInput.endDate)
   throw conflict("查询参数与冻结研究范围不一致");
 }
 const [parent] = await tx`SELECT generation FROM operation_runs WHERE id=${t.parent_operation_run_id}`;
 const allocation=t.snapshot.taskScope ? {parentRunId:t.parent_operation_run_id,generation:parent!.generation,callId:call.id} : undefined;
 const authorization=(intent:import("@aihot/contracts/credits").ToolCreditIntent)=>({quoteId:call.quote.quoteId,intent,...(allocation?{taskAllocation:allocation}:{})});
 const [count]=await tx`SELECT child_calls, (SELECT count(*)::int FROM assistant_tool_calls WHERE turn_id=${t.id} AND child_run_id IS NOT NULL) AS n FROM assistant_turns WHERE id=${t.id}`;
 if(count!.n>=t.snapshot.limits.childCalls||count!.child_calls>=t.snapshot.limits.childCalls)throw conflict("本回合检索次数已达上限");
 if(call.name === "search_xhs_covers") {
  const prior = await tx`SELECT id FROM assistant_tool_calls WHERE turn_id=${t.id} AND name='search_xhs_covers' AND child_run_id IS NOT NULL`;
  if(prior.length) throw conflict("本回合封面查询仅一次，请核对原查询结果");
 }
 if(call.name === "search_wechat_articles") {
  const prior = await tx`SELECT r.status FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id WHERE c.turn_id=${t.id} AND c.name='search_wechat_articles'`;
  if(prior.length>=2 || prior.some(r=>r.status!=="completed")) throw conflict("公众号查询最多两次；未完成查询须先核对");
 }
 if(call.name === "analyze_xhs_covers") {
  const frozen=CoverVisionInput.parse(call.result.normalized.commandInput),intent=coverVisionIntent(frozen);
  if(frozen.assistantParentTurnId!==t.id||frozen.activationId!==a.id)throw conflict("视觉报价归属不匹配");
  const child=await createCoverVisionTx(tx,frozen,`user:${userId}`,`assistant-child:${call.id}`,authorization(intent));
  const hash=creditHash({approve:true,proposalRevision:call.proposal_revision});
  await tx`UPDATE assistant_tool_calls SET state='running',child_run_id=${child.id},activation_id=${a.id},command_hash=${hash} WHERE id=${call.id}`;
  return child;
 }
 if(call.name === "generate_image" && call.input.planReference){
  const selected=await resolveCoverImage(tx,t,call.input.planReference);
  if(call.result.normalized.commandInput.prompt!==selected.prompt||call.result.normalized.commandInput.size!=="3:4")throw conflict("封面方案与图片报价已变化");
 }
 const normalized=await normalizeToolInput(`user:${userId}`,call.name === "generate_image" ? "images" : "query",call.result.normalized.commandInput,{ assistantSearch: true });
 await assertMemberCostEligible(normalized.intent);
 if(authorizationId)await checkAuto(tx,userId,t.session_id,authorizationId,call.quote.quoteId,"search",t.id);
 const {provider,...body}=normalized.commandInput;
 const child=call.name === "generate_image" ? await createImageGenerationTx(tx,body,`user:${userId}`,`assistant-child:${call.id}`,authorization(normalized.intent)) : await createSynchronousQueryTx(tx,body,`user:${userId}`,`assistant-child:${call.id}`,authorization(normalized.intent));
 if(authorizationId)await linkAuto(tx,child.id,authorizationId,t.id,"search",call.quote.quoteId);
 const hash=creditHash({approve:true,proposalRevision:call.proposal_revision});
 await tx`UPDATE assistant_tool_calls SET state='running',child_run_id=${child.id},activation_id=${a.id},command_hash=${hash} WHERE id=${call.id}`;
 await tx`UPDATE operation_runs SET input=input || ${tx.json({assistantParentTurnId:t.id})} WHERE id=${child.id}`;
 return child;
}
/** Only newly prepared proposals enter here; existing waiting proposals require manual approval. */
export async function autoApproveSearch(tx:Tx,turn:Record<string,any>,call:Record<string,any>,proposal:Pick<Awaited<ReturnType<typeof prepareSearch>>, 'normalized'|'quote'>) {
 if(turn.snapshot.taskScope){
   await startSearch(tx,turn.owner_user_id,turn,{...call,quote:proposal.quote,result:{normalized:proposal.normalized}});
   return true;
 }
 if(call.name !== "search_xhs_notes") return false;
 const authorizationId=turn.snapshot.autoAuthorizationId;
 if(!authorizationId)return false;
 // Savepoint keeps a rejected automated admission from partially reserving or enqueuing a child.
 try {
 await tx.savepoint(async nested=>startSearch(nested as Tx,turn.owner_user_id,turn,{...call,quote:proposal.quote,result:{normalized:proposal.normalized}},authorizationId));
 return true;
 }catch(error){
 if(error instanceof AccountError){
   if(!["auto_confirmation_required","quote_expired","price_changed"].includes(error.code))
     await tx`UPDATE assistant_tool_calls SET result=result || ${tx.json({approvalBlockedReason:error.message})} WHERE id=${call.id}`;
   return false;
 }
 throw error;
 }
}

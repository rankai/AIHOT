import { ResearchAnalysis, ResearchApplication, analyzeResearch, verifyResearchDelivery, validateResearchWindow } from "./xhs-research.ts";
import { checkAuto, linkAuto } from "./fees.ts";
import { AccountError } from "../users/accounts.ts";
import { assertMemberCostEligible } from "../users/member-pricing.ts";
import { projectToolResult } from "../users/tool-results.ts";
import type { AssistantSource } from "@aihot/contracts/assistant";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Tx } from "../db.ts";
import { creditHash } from "../users/credits-core.ts";
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
  researchApplication: ResearchApplication.optional(),
}).strict();
// Research scope is computed from verified server evidence; other writing contracts stay unchanged.
const ResearchDraftInput = SaveDraftInput.extend({
  content: Content.extend({ partial: Content.shape.partial.default(false), scope: Content.shape.scope.default("研究范围由服务端生成") }),
});
/** Only schema errors before any draft write are safe for a model correction. */
export class DraftArgumentsError extends Error {
  readonly result: { error: string; fields: string[]; message: string };
  constructor(error: z.ZodError, correction?: string) {
    super("Invalid save_draft arguments");
    this.result = {
      error: "invalid_tool_arguments",
      fields: [...new Set(error.issues.map((issue) => issue.path.map(String).join(".") || "input"))].slice(0, 10),
      message: correction ?? "请按工具schema修正字段。新建稿件省略artifactId并使用baseVersion=0；修改仅使用已提供的稿件UUID与版本。不得重新检索。",
    };
  }
}
export const businessTools = {
  analyze_xhs_research: {
    description: "基于当前激活已完成关键词检索的实际样本，保存可观察的标题、内容结构、标签、互动规律及应用计划。只引用search:ID；逐条说明主题关联，推荐回退不算样本。缺少互动数据明确未知。有可用主题样本即可完整创作；样本不足50条或正文截断只需如实披露，不另行询问范围确认。",
    schema: z.toJSONSchema(ResearchAnalysis),
  },
  save_draft: {
    description: "保存并交付符合已激活模块合同的完整稿件。交付前核对已加载模块和用户的段落/格式要求，标题承诺的数量须与正文一致；没有真实个人素材不得写成亲身体验。M1必须先完成真实检索和analyze_xhs_research，提供researchApplication说明规律在本稿标题/正文/标签的实际应用；没有分析不能用partial交付材料稿。M1的爆款公式来源由服务端依据已保存分析自动附在正文末尾；body只提交笔记正文，勿重复公式板块。来源不足以推导规律时明确说明不足，不编造结论。M2保持原文段落数量与结构，将至少5种不同emoji放进原有段落，不另增总结或互动收尾段。新建不传artifactId且baseVersion为0；修改仅使用已给定稿件ID和版本。sources使用输入消息ID或真实取得的引用，不编造来源。",
    schema: z.toJSONSchema(SaveDraftInput),
  },
  search_xhs_notes: {
    description: "自主创建单关键词检索的独立报价与待批准建议，这是本地准备，无需先询问能否取报价，不会立即外发。只有服务端已确认的本会话自动授权或用户专用批准入口才可执行真实检索，聊天同意不算批准。不自动翻页或扩期。沿用用户已明确的关键词和日期，缺业务参数才询问。",
    schema: object(
      { activationId: text, keyword: { type: "string", minLength: 1, maxLength: 200 }, startDate: text, endDate: text },
      ["activationId", "keyword", "startDate", "endDate"],
    ),
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
    await tx`SELECT z.id,z.kind,z.data FROM operation_results z JOIN assistant_tool_calls c ON c.child_run_id=z.run_id JOIN operation_runs r ON r.id=z.run_id WHERE c.turn_id=${turn.id} AND c.state='completed' AND r.status='completed'`;
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
  let inheritedTargets: string[] | null = null;
  if (tools.save_draft && activations.length && activations.some((a) => a.candidate.skillId === "xiaohongshu-creator" && a.candidate.moduleId === "M1" && a.candidate.version === "3")) {
    const analyses = await tx`SELECT id,result FROM assistant_tool_calls WHERE turn_id=${turn.id} AND name='analyze_xhs_research' AND state='completed'`;
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
    const researchDraft = activations.some((a) => a.candidate.skillId === "xiaohongshu-creator" && a.candidate.moduleId === "M1" && a.candidate.version === "3");
    const schema: any = researchDraft ? z.toJSONSchema(ResearchDraftInput, { io: "input" }) : structuredClone(tools.save_draft.schema);
    if (researchDraft) schema.required.push("researchApplication");
    const allArtifacts = await tx`SELECT artifact_id AS "artifactId",max(version)::int AS version FROM assistant_artifact_versions WHERE session_id=${turn.session_id} GROUP BY artifact_id ORDER BY artifact_id`;
    const artifacts = inheritedTargets ? allArtifacts.filter((a) => inheritedTargets.includes(a.artifactId)) : allArtifacts;
    if (inheritedTargets) schema.required.push("artifactId");
    if (artifacts.length) schema.properties.artifactId.enum = artifacts.map((artifact) => artifact.artifactId);
    else delete schema.properties.artifactId;
    schema.properties.content.properties.sources.items.enum = sources.map((source) => source.id);
    tools.save_draft = {
      ...tools.save_draft,
      schema,
      description: tools.save_draft.description + (inheritedTargets ? " 当前仅可修改以下已选稿件并复用其确切版本研究；新建或修改其他稿件必须本回合重新研究。" : "") + " 可修改稿件：" + JSON.stringify(artifacts) + " 可用来源（ID只引用这张表；链接直接使用url，不得由ID拼接）：" + JSON.stringify(sources),
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
    const i = z.object({ skillId: z.string(), moduleId: z.string() }).strict().parse(call.input);
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
    const i = z.object({ activationId: z.string().uuid(), resourceId: z.string() }).strict().parse(call.input);
    const { skill, module } = await activation(tx, turn, i.activationId);
    if (!module.resources.includes(i.resourceId)) throw conflict("资源不属于当前模块");
    const resource = skill.manifest.resources.find((r) => r.resourceId === i.resourceId)!;
    return { text: skill.texts.get(i.resourceId), type: resource.type, hash: resource.sha256 };
  }
  if (call.name === "ask_question") {
    const input = z.object({ text: z.string().min(1).max(2000) }).strict().parse(call.input);
    return { question: input.text };
  }
  if (call.name === "analyze_xhs_research") {
    assertBusinessTool(turn, call.name);
    const parsed = ResearchAnalysis.safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error, "请修正规律分析字段，只引用实际研究样本；没有样本时提问暂停，不保存材料稿。");
    const input = parsed.data;
    const { module } = await activation(tx, turn, input.activationId);
    if (!module.tools.includes(call.name)) throw conflict("当前模块不能分析研究");
    return analyzeResearch(tx, turn, call.id, input);
  }
  if (call.name === "save_draft") {
    assertBusinessTool(turn, "save_draft");
    const identity = z.object({ activationId: z.string().uuid() }).passthrough().safeParse(call.input);
    if (!identity.success) throw new DraftArgumentsError(identity.error);
    const { a, module } = await activation(tx, turn, identity.data.activationId);
    const parsed = (module.tools.includes("analyze_xhs_research") ? ResearchDraftInput : SaveDraftInput).safeParse(call.input);
    if (!parsed.success) throw new DraftArgumentsError(parsed.error);
    const i = parsed.data;
    const [requiredResearch] = await tx`SELECT id FROM assistant_activations WHERE turn_id=${turn.id}
      AND candidate->>'skillId'='xiaohongshu-creator' AND candidate->>'moduleId'='M1' AND candidate->>'version'='3' LIMIT 1`;
    if (requiredResearch && !module.tools.includes("analyze_xhs_research"))
      throw conflict("本回合已选择M1研究创作，不能改用其他模块静默降级；更换任务须新建请求");
    if (!module.tools.includes("save_draft") || !module.outputKinds.includes(i.kind))
      throw conflict("当前模块不能交付此作品类型");
    let sourceSnapshot = await sourceCandidates(tx, turn);
    const permitted = new Set(sourceSnapshot.map((source) => source.id));
    if (i.content.sources.some((source) => !permitted.has(source)))
      throw conflict("稿件引用不属于已确认材料或已完成检索");
    if (module.tools.includes("analyze_xhs_research")) {
      const application = ResearchApplication.safeParse(i.researchApplication);
      if (!application.success) throw new DraftArgumentsError(application.error, "请填写researchApplication的analysisCallId及explanation，说明已完成分析如何用于本稿；不重新检索。");
      const verified = await verifyResearchDelivery(tx, turn, a.id, i.content, sourceSnapshot, i.researchApplication, { artifactId: i.artifactId, baseVersion: i.baseVersion });
      sourceSnapshot = verified.sources;
      i.content = verified.content;
    } else if (module.tools.includes("search_xhs_notes")) {
      // Previously accepted v2 turns retain their frozen delivery contract; new turns only select v3.
      if (!i.content.sources.some((source) => source.startsWith("search:")) && !i.content.partial)
        throw conflict("未取得研究引用的材料稿必须标记partial");
      const cited = sourceSnapshot.filter((source) => i.content.sources.includes(source.id) && source.kind === "research" && source.url);
      if (!i.content.partial && (cited.length < 2 || i.content.titles.length < 3 || i.content.tags.length < 5))
        throw conflict("完整研究稿需要至少2条有效参考、3个标题和5个标签");
    }
    const [before] =
      await tx`SELECT artifact_id,version,kind,content FROM assistant_artifact_versions WHERE turn_id=${turn.id} AND activation_id=${a.id} AND content=${tx.json(i.content)}`;
    if (before) return { artifactId: before.artifact_id, version: before.version, kind: before.kind };
    return saveArtifact(tx, { sessionId: turn.session_id, turnId: turn.id, sourceSnapshot, ...i });
  }
  throw conflict("工具需要单独批准");
}
export async function prepareSearch(turn: Record<string, any>, call: Record<string, any>) {
  assertBusinessTool(turn, "search_xhs_notes");
  const i = z
    .object({
      activationId: z.string().uuid(),
      keyword: z.string().trim().min(1).max(200),
      startDate: z.iso.date(),
      endDate: z.iso.date(),
    })
    .strict()
    .parse(call.input);
  await sql.begin(async (tx) => {
    const { module } = await activation(tx, turn, i.activationId);
    if (!module.tools.includes("search_xhs_notes")) throw conflict("当前模块不允许检索");
    if (module.tools.includes("analyze_xhs_research")) {
      if (!turn.snapshot.researchClock) throw conflict("缺少可信日期，请重新发起任务");
      validateResearchWindow(turn.snapshot.researchClock, i.startDate, i.endDate);
    }
  });
  if (i.startDate > i.endDate) throw conflict("日期范围无效");
  const normalized = await normalizeToolInput(`user:${turn.owner_user_id}`, "query", {
    provider: "redfox",
    operationId: "3X8FGEEM",
    parameters: { keyword: i.keyword, startDate: i.startDate, endDate: i.endDate, pageNum: 1, pageSize: 50 },
  });
  await assertMemberCostEligible(normalized.intent);
  return { normalized, quote: await quoteTool(turn.owner_user_id, normalized.intent) };
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
    assertBusinessTool(t, "search_xhs_notes");
    const { module } = await activation(tx, t, call!.input.activationId);
    if (!module.tools.includes("search_xhs_notes")) throw conflict("工具不在模块范围");
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
  const priced = await prepareSearch({ ...proposal.t, owner_user_id: userId }, proposal.call);
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
    await tx`UPDATE assistant_tool_calls SET result=(result-'approvalBlockedReason') || ${tx.json(blocked ? {approvalBlockedReason:blocked} : {})},quote=${tx.json(priced.quote as never)},proposal_revision=proposal_revision+1 WHERE id=${callId}`;
    await event(tx, sessionId, "call", callId);
    return { quote: priced.quote, proposalRevision: call!.proposal_revision + 1 };
  });
}

async function startSearch(tx:Tx,userId:number,t:Record<string,any>,call:Record<string,any>,authorizationId?:string){
 const { a } = await activation(tx, t, call.input.activationId);
 const [count]=await tx`SELECT child_calls, (SELECT count(*)::int FROM assistant_tool_calls WHERE turn_id=${t.id} AND child_run_id IS NOT NULL) AS n FROM assistant_turns WHERE id=${t.id}`;
 if(count!.n>=t.snapshot.limits.childCalls||count!.child_calls>=t.snapshot.limits.childCalls)throw conflict("本回合检索次数已达上限");
 const normalized=await normalizeToolInput(`user:${userId}`,"query",call.result.normalized.commandInput);
 await assertMemberCostEligible(normalized.intent);
 if(authorizationId)await checkAuto(tx,userId,t.session_id,authorizationId,call.quote.quoteId,"search",t.id);
 const {provider,...body}=normalized.commandInput;
 const child=await createSynchronousQueryTx(tx,body,`user:${userId}`,`assistant-child:${call.id}`,{quoteId:call.quote.quoteId,intent:normalized.intent});
 if(authorizationId)await linkAuto(tx,child.id,authorizationId,t.id,"search",call.quote.quoteId);
 const hash=creditHash({approve:true,proposalRevision:call.proposal_revision});
 await tx`UPDATE assistant_tool_calls SET state='running',child_run_id=${child.id},activation_id=${a.id},command_hash=${hash} WHERE id=${call.id}`;
 await tx`UPDATE operation_runs SET input=input || ${tx.json({assistantParentTurnId:t.id})} WHERE id=${child.id}`;
 return child;
}
/** Only newly prepared proposals enter here; existing waiting proposals require manual approval. */
export async function autoApproveSearch(tx:Tx,turn:Record<string,any>,call:Record<string,any>,proposal:Awaited<ReturnType<typeof prepareSearch>>) {
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

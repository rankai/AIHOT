import { bindings, currentSkillVersions } from "./bindings.ts";
import { Size } from "../providers/redfox/image-models.ts";
import { prepareTaskChoice, taskPriceDefinition, applyTaskChoice, taskChoices } from "./task-pricing.ts";
import { selectedArtifactVersions, coverPlanImageAvailability, hasSavedCoverResearch, COVER_DELIVERY_CONTRACT } from "./cover-plan.ts";
import { researchClock } from "./xhs-research.ts";
import { contextTokens } from "./context.ts";
import { readAssistantAttachment } from "./attachments.ts";
import { lockAssetInputs } from "../operations/assets.ts";
import { assertSessionReceiptsReviewed, checkAuto, linkAuto, readFeeAuthorization } from "./fees.ts";
import { readActivities } from "./activities.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Tx } from "../db.ts";
import { quoteTool } from "../users/credits.ts";
import { creditHash, requireCreditUser } from "../users/credits-core.ts";
import { createRun, lockMemberAdmission } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { profile, profiles, profileActions, taskHint, additionalFeeKinds, resolveCandidate, skillNames } from "./catalog.ts";
import { skillAdmission, queuedSkillAdmission, readSkillPolicies, skillHealth } from "./skill-policy.ts";
import { accepting, requireAvailable, modelPolicy, TurnInput } from "./config.ts";
import { command, ownedSession, event, message, conflict, saveArtifact, Content } from "./store.ts";
import type {
  AssistantImageParameters,
  AssistantSession,
  AssistantOptions,
  AssistantTurnQuote,
} from "@aihot/contracts/assistant";
import type { ToolCreditIntent } from "@aihot/contracts/credits";
import { selectToolPrice } from "../users/credits-prices.ts";
export async function assistantOptions(userId: number, raw:unknown={}): Promise<AssistantOptions> {
  const input=z.object({sessionId:z.string().uuid().optional(),artifactVersions:z.preprocess(value=>{
    if(typeof value!=="string")return value;
    try{return JSON.parse(value);}catch{return null;}
  },TurnInput.shape.artifactVersions)}).strict().refine(value=>!value.artifactVersions?.length||!!value.sessionId,"选定稿件需要所属会话").parse(raw);
  await requireCreditUser(sql,userId,true);
  if(input.sessionId)await ownedSession(sql,userId,input.sessionId);
  const selected=input.sessionId?await selectedArtifactVersions(sql,input.sessionId,input.artifactVersions):[];
  const policies = await readSkillPolicies(), health = await skillHealth(sql,selected);
  const availability = (action: ReturnType<typeof profileActions>[number]) => {
    const { skillId, actionId } = action;
    const policy = policies.find(p => p.skillId === skillId)!;
    const reason = policy.reason ?? (!policy.acceptingNew ? "已暂停新任务；已开始的任务可继续" : health.get(actionId)?.[0] ?? null);
    return { available: !reason, reason };
  };
  return {
    inputCapabilities: { fileTypes: [".txt", ".md"], maxAttachments: 10, maxFileBytes: 2097152 },
    assistants: Object.values(profiles).map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      welcome: p.welcome,
      available: profileActions(p.id).some(a => availability(a).available),
      reason: profileActions(p.id).some(a => availability(a).available) ? null : profileActions(p.id).map(a => availability(a).reason).find(Boolean) ?? "暂无可用技能",
      taskOptions: bindings.filter(b=>b.version===currentSkillVersions[b.skillId]).flatMap(b=>b.modules.filter(m=>m.profiles.includes(p.id)&&availability({actionId:m.actionId,skillId:b.skillId} as never).available).flatMap(m=>(m.tasks??[]).map(task=>({choice:{skillId:b.skillId,moduleId:m.moduleId,delivery:task.delivery},label:`${b.name} · ${task.label}`,sizes:task.delivery==='image'?(m.deliveryContract==='xhs-cover-delivery@1'?['3:4']:[...Size.options]):[]})))),
      actions: [
        ...profileActions(p.id).filter(a => policies.find(policy => policy.skillId === a.skillId)?.acceptingNew).map(a => ({ actionId: a.actionId, skillId: a.skillId, skillName: skillNames[a.skillId]!, label: a.label, ...availability(a) })),
      ],
    })),
    limits: { modelCalls: 8, activeTurns: 2, inputCharacters: 30000 },
  };
}
export async function createSession(userId: number, raw: unknown, key: unknown) {
  const input = z
      .object({
        assistantId: z.enum(["creative", "xiaohongshu"]),
        title: z.string().trim().min(1).max(160).default("新创作"),
        brief: z.string().max(10000).default(""),
        initialRequest: z.object({
          message: z.string().trim().min(1).max(30000),
          skillSelection: TurnInput.shape.skillSelection,
          taskHint: TurnInput.shape.taskHint,
          taskChoice: TurnInput.shape.taskChoice,
          attachments: z.array(z.object({ assetKey: z.string().min(1).max(300) }).strict()).max(10).default([]),
        }).strict().optional(),
      })
      .strict()
      .parse(raw),
    c = command(key, input);
  const p = profile(input.assistantId);
  const created = await sql.begin(async (tx) => {
    await lockMemberAdmission(tx, `user:${userId}`);
    await requireCreditUser(tx, userId, true);
    const [old] =
      await tx`SELECT id,command_hash,deleted_at,initial_request FROM assistant_sessions WHERE owner_user_id=${userId} AND command_key=${c.key}`;
    if (old) {
      if (old.command_hash !== c.hash) throw conflict("幂等标识已用于其他请求");
      if (old.deleted_at) throw conflict("会话已删除");
      return { sessionId: old.id, initialRequest: old.initial_request };
    }
    accepting();
    if (input.initialRequest) {
      await skillAdmission(tx, p.id, input.initialRequest.skillSelection, true);
      await requireAvailable(tx);
    }
    const [count] =
      await tx`SELECT count(*)::int n FROM assistant_sessions WHERE owner_user_id=${userId} AND deleted_at IS NULL`;
    if (count!.n >= 100) throw conflict("会话数量已达100个，请清理旧会话");
    const id = randomUUID();
    await tx`INSERT INTO assistant_sessions(id,owner_user_id,assistant_id,assistant_name,profile_version,title,brief,command_key,command_hash) VALUES (${id},${userId},${p.id},${p.name},${p.version},${input.title},${input.brief},${c.key},${c.hash})`;
    await event(tx, id, "session", id);
    let initialRequest = null;
    if (input.initialRequest) {
      await lockAssetInputs(tx, input.initialRequest.attachments.map(attachment => attachment.assetKey));
      const inputIds: string[] = [];
      for (const attachment of input.initialRequest.attachments) {
        const bound = await attachInputTx(tx, userId, id, attachment, randomUUID());
        inputIds.push(bound.inputId);
      }
      const session = await ownedSession(tx, userId, id);
      const turnInput = { message: input.initialRequest.message, skillSelection: input.initialRequest.skillSelection ?? null,
        ...(input.initialRequest.taskHint !== undefined ? { taskHint: input.initialRequest.taskHint } : {}),
        ...(input.initialRequest.taskChoice ? {taskChoice:input.initialRequest.taskChoice} : {}),
        expectedRevision: session.revision, inputIds, artifactVersions: [] };
      initialRequest = { commandKey: randomUUID(), input: turnInput, quote: null };
      await tx`UPDATE assistant_sessions SET initial_request=${tx.json(initialRequest as never)} WHERE id=${id}`;
    }
    return { sessionId: id, initialRequest };
  });
  if (created.initialRequest && !created.initialRequest.quote) {
    try {
      await requireAvailable();
      const initial = created.initialRequest;
      const prepared = await snapshotInput(sql, userId, created.sessionId, initial.input);
      if (taskChoices(prepared.snapshot.candidates).length && !initial.input.taskChoice) {
        const choice = await prepareTaskChoice(userId, prepared.snapshot);
        // Persist recognition before pricing: a temporarily unavailable service must
        // not force a second classification when the same create command is replayed.
        const [saved] = await sql`UPDATE assistant_sessions SET initial_request=jsonb_set(initial_request,'{input,taskChoice}',
          coalesce(initial_request#>'{input,taskChoice}',${sql.json(choice)}::jsonb))
          WHERE id=${created.sessionId} AND active_turn_id IS NULL AND revision=${prepared.snapshot.revision}
          AND initial_request->>'commandKey'=${initial.commandKey} RETURNING initial_request`;
        if (!saved) throw conflict("首条需求已变化，请刷新");
        initial.input.taskChoice = saved.initial_request.input.taskChoice;
        Object.assign(prepared.snapshot,{taskChoice:initial.input.taskChoice});
      }
      // Persist the quote and its session pointer together. A replay that races this
      // transaction returns the same quote. Recognition above never holds a DB lock.
      created.initialRequest = await sql.begin(async tx => {
        await lockMemberAdmission(tx,`user:${userId}`);
        const current = await ownedSession(tx,userId,created.sessionId,true);
        if (current.active_turn_id || current.revision !== prepared.snapshot.revision ||
            current.initial_request?.commandKey !== initial.commandKey) throw conflict("首条需求已变化，请刷新");
        if (current.initial_request.quote) return current.initial_request;
        const result = {...initial,quote:await quoteAssistantTurn(userId,prepared,tx)};
        await tx`UPDATE assistant_sessions SET initial_request=${tx.json(result as never)} WHERE id=${created.sessionId}`;
        return result;
      });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'assistant_task_selection_required')) throw error;
    }
  }
  return created;
}
export async function snapshotInput(db: Tx | typeof sql, userId: number, sessionId: string, raw: unknown, queueEntryId?: string, lockPolicy = false) {
  const input = TurnInput.parse(raw),
    session = await ownedSession(db, userId, sessionId);
  if (input.expectedRevision !== session.revision) throw conflict("会话已变化，请重新报价");
  await assertSessionReceiptsReviewed(db, sessionId);
  const hint = taskHint(session.assistant_id, input.taskHint),
    p = profile(session.assistant_id),
    model = await modelPolicy(),
    selected = await selectedArtifactVersions(db,sessionId,input.artifactVersions),
    admission = queueEntryId
      ? await queuedSkillAdmission(db as Tx, sessionId, queueEntryId, p.id, selected)
      : await skillAdmission(db, p.id, input.skillSelection as never, lockPolicy, selected),
    allowed = admission.candidates;
  const history =
    await db`SELECT role,text FROM assistant_messages WHERE session_id=${sessionId} AND role IN ('user','assistant') AND text<>'' ORDER BY seq`;
  const previousArtifacts =
    await db`SELECT DISTINCT ON (artifact_id) artifact_id,version,kind,content,source_snapshot FROM assistant_artifact_versions WHERE session_id=${sessionId} AND kind IN ('text-draft','xhs-note') ORDER BY artifact_id,version DESC`;
  const explicitArtifacts = new Set((input.artifactVersions ?? []).map((a) => a.artifactId));
  if (input.artifactVersions === undefined) selected.push(...previousArtifacts.filter((a) => !explicitArtifacts.has(a.artifact_id)));
  if (input.inputIds === undefined)
    selected.push(
      ...(await db`SELECT id,text,hash,source FROM assistant_session_inputs WHERE session_id=${sessionId}`),
    );
  for (const id of input.inputIds ?? []) {
    const [row] =
      await db`SELECT id,text,hash,source FROM assistant_session_inputs WHERE id=${id} AND session_id=${sessionId}`;
    if (!row) throw conflict("选定输入不存在");
    selected.push(row);
  }
  for (const item of selected as Record<string, any>[]) {
    if (item.source?.assetKey) {
      if (db !== sql) await lockAssetInputs(db as Tx, [item.source.assetKey]);
      const attachment = await readAssistantAttachment(`user:${userId}`, item.source.assetKey, db);
      if (attachment.source.sha256 !== item.source.sha256 || attachment.text !== item.text) throw conflict("材料内容已变化，请重新添加");
    }
  }
  const snapshot = {
    sessionId,
    researchClock: researchClock(),
    revision: session.revision,
    assistantId: p.id,
    profileVersion: p.version,
    profileHash: creditHash(p),
    allowedTools: [...p.tools],
    candidates: allowed,
    skillPolicy: admission.policies,
    unavailableSkills: admission.unavailableSkills,
    catalogHash: creditHash(allowed),
    model,
    limits: { modelCalls: 8, childCalls: 20 },
    taskHint: hint,
    ...(input.taskChoice ? {taskChoice:input.taskChoice} : {}),
    skillSelection: input.skillSelection ?? null,
    autoAuthorizationId: input.autoAuthorizationId ?? null,
    brief: session.brief,
    history,
    message: input.message,
    inputIds: input.inputIds,
    artifactVersions: input.artifactVersions,
    selected,
  };
  if (JSON.stringify(snapshot).length > 85000) throw conflict("选定材料过多，请缩小范围");
  // Reserve space before charging for two bounded article queries, loaded rules,
  // tool schemas and the subsequent analysis/draft exchange. Never trim user material.
  const modules = await Promise.all(allowed.map(candidate => resolveCandidate(allowed, candidate.skillId, candidate.moduleId)));
  // Owned saved plans already contain frozen research; reserve only their remaining execution.
  // Other admitted research contracts still need their original continuation allowance.
  const savedCoverResearch=hasSavedCoverResearch(selected);
  const coverResearch=modules.some(({module})=>module.tools.includes("analyze_xhs_covers")
    && !(module.deliveryContract===COVER_DELIVERY_CONTRACT&&savedCoverResearch));
  const continuationReserve = coverResearch || modules.some(({ module }) => module.tools.includes("search_wechat_articles")) ? 20000 : 4096;
  if (contextTokens(JSON.stringify(snapshot)) + continuationReserve > model.maxInputTokens)
    throw conflict(coverResearch ? "模型上下文超过封面研究材料额度，请减少材料，或选择具体非封面技能后重试" : continuationReserve === 20000 ? "模型上下文超过上限，请减少材料；自动选择包含公众号研究，可明确选择其他不需要研究的技能后重试" : "模型上下文超过上限，请缩小材料");
  const intent: ToolCreditIntent = {
    kind: "assistant-turn",
    provider: "assistant",
    model: model.model,
    input: snapshot,
  };
  return { session, input, snapshot, intent };
}
export async function quoteTurn(userId: number, id: string, raw: unknown) {
  await requireAvailable();
  return quoteAssistantTurn(userId, await snapshotInput(sql, userId, id, raw));
}
export async function quoteAssistantTurn(userId: number, prepared: Pick<Awaited<ReturnType<typeof snapshotInput>>, "intent" | "snapshot">, db?: Tx): Promise<AssistantTurnQuote> {
  // Immutable queued legacy packages keep their original single-tool authorization contract.
  if (!taskChoices(prepared.snapshot.candidates).length) return { ...await quoteTool(userId,prepared.intent,db),additionalFeeKinds:await additionalFeeKinds(prepared.snapshot.candidates) };
  const choice = await prepareTaskChoice(userId, prepared.snapshot, (prepared.snapshot as Record<string,any>).taskChoice, !db);
  const definition = await taskPriceDefinition(prepared.snapshot,choice);
  return { ...await quoteTool(userId, prepared.intent, db, definition), additionalFeeKinds: [] };
}
export async function submitTurn(userId: number, id: string, raw: unknown, key: unknown) {
  return sql.begin(tx => submitTurnTx(tx, userId, id, raw, key));
}
export async function submitTurnTx(tx: Tx, userId: number, id: string, raw: unknown, key: unknown, queueEntryId?: string) {
  const body = z
    .object({
      message: z.unknown(),
      expectedRevision: z.unknown(),
      taskHint: z.unknown().optional(),
      taskChoice: TurnInput.shape.taskChoice,
      skillSelection: z.unknown().optional(),
      autoAuthorizationId: z.string().uuid().optional(),
      inputIds: z.unknown().optional(),
      artifactVersions: z.unknown().optional(),
      quoteId: z.string().uuid(),
    })
    .strict()
    .parse(raw);
  const { quoteId, ...rest } = body,
    c = command(key, TurnInput.parse(rest));
    await lockMemberAdmission(tx, `user:${userId}`);
    const session = await ownedSession(tx, userId, id, true);
    const [old] =
      await tx`SELECT id,parent_operation_run_id,command_hash,snapshot FROM assistant_turns WHERE session_id=${id} AND command_key=${c.key}`;
    if (old) {
      const legacy = !Object.hasOwn(old.snapshot,"skillSelection") && rest.skillSelection === undefined && rest.autoAuthorizationId === undefined
        && old.command_hash === command(key,{...TurnInput.parse(rest),inputIds:rest.inputIds ?? [],artifactVersions:rest.artifactVersions ?? []}).hash;
      if (old.command_hash !== c.hash && !legacy) throw conflict("同一提交标识不能用于不同内容");
      return { turnId: old.id, runId: old.parent_operation_run_id };
    }
    const [queued] = await tx`SELECT id FROM assistant_message_queue WHERE session_id=${id} AND state IN ('pending','quoted') ORDER BY position LIMIT 1`;
    if (queued && queued.id !== queueEntryId) throw conflict("会话有排队需求，请按顺序处理");
    if (session.archived_at) throw conflict("会话已归档");
    await requireAvailable(tx);
    const [active] =
      await tx`SELECT id FROM operation_runs WHERE id=(SELECT parent_operation_run_id FROM assistant_turns WHERE id=${session.active_turn_id}) AND status IN ('active','waiting','needs_review')`;
    if (active) throw conflict("请先处理或停止当前回合");
    const [count] =
      await tx`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${userId}`} AND provider='assistant' AND operation_key='assistant.turn' AND status IN ('active','waiting')`;
    if (count!.n >= 2) throw conflict("同时最多执行2个助手回合");
    const [usage] = await tx`SELECT count(*)::int n FROM assistant_turns WHERE session_id=${id}`;
    if (usage!.n >= 100) throw conflict("单会话最多100个回合，请新建会话");
    const { input, snapshot, intent } = await snapshotInput(tx, userId, id, rest, queueEntryId, true);
    const [frozenQuote] = await tx`SELECT pricing_snapshot FROM member_tool_quotes WHERE id=${quoteId} AND user_id=${userId}`;
    if (frozenQuote?.pricing_snapshot.task) {
      if (input.autoAuthorizationId) throw conflict("本次任务需要一次明确费用确认，不能使用旧会话自动授权");
      await taskPriceDefinition(snapshot, JSON.parse(frozenQuote.pricing_snapshot.task.scope));
    }
    const turnId = randomUUID();
    if(input.autoAuthorizationId) await checkAuto(tx,userId,id,input.autoAuthorizationId,quoteId,"turn");
    const run = await createRun(tx, {
      actor: `user:${userId}`,
      commandKey: `assistant:${c.key}`,
      provider: "assistant",
      operationKey: "assistant.turn",
      contractVersion: 1,
      input: { turnId, sessionId: id },
      stepKey: "assistant.model",
      limits: { retries: 0, modelCalls: 8 },
      authorization: { quoteId, intent },
    });
    await tx`INSERT INTO assistant_turns(id,session_id,parent_operation_run_id,command_key,command_hash,snapshot) VALUES (${turnId},${id},${run.id},${c.key},${c.hash},${tx.json((queueEntryId ? { ...snapshot, queuePreviousTurnId: session.active_turn_id } : snapshot) as never)})`;
    if(input.autoAuthorizationId) await linkAuto(tx,run.id,input.autoAuthorizationId,turnId,"turn",quoteId);
    await tx`UPDATE assistant_sessions SET active_turn_id=${turnId},revision=revision+1 WHERE id=${id}`;
    await message(tx, id, turnId, "user", input.message, { role: "user", content: input.message });
    await event(tx, id, "turn", turnId);
    await queueOperationStep(tx, run.id);
    return { turnId, runId: run.id };
}
export async function sessionSnapshot(userId: number, id: string): Promise<AssistantSession> {
  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const s = await ownedSession(tx, userId, id);
    const inputs = await tx`SELECT id,text,source FROM assistant_session_inputs WHERE session_id=${id}`;
    const messages =
      await tx`SELECT id,seq,role,text,turn_id FROM assistant_messages WHERE session_id=${id} ORDER BY seq`;
    const artifacts =
      await tx`SELECT DISTINCT ON (artifact_id) * FROM assistant_artifact_versions WHERE session_id=${id} ORDER BY artifact_id,version DESC`;
    const [turn] = s.active_turn_id
      ? await tx`SELECT t.id,t.snapshot,t.parent_operation_run_id,t.phase,t.pending_question,r.status,r.generation,r.step_key,r.step_version FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=${s.active_turn_id}`
      : [];
    if(turn?.pending_question?.coverPlan){
      const context=turn.pending_question.coverPlan;
      const [plan]=await tx`SELECT activation_id FROM assistant_artifact_versions WHERE session_id=${id} AND artifact_id=${context.artifactId} AND version=${context.version} AND kind='xhs-cover-plan'`;
      const image=await coverPlanImageAvailability(tx,turn,plan?.activation_id??"");
      turn.pending_question={...turn.pending_question,coverPlan:{...context,imageAvailable:image.available,imageUnavailableReason:image.reason}};
    }
    const calls = turn
      ? await tx`SELECT c.*, CASE WHEN c.name='generate_image' THEN r.input ELSE NULL END AS child_input
          FROM assistant_tool_calls c
          JOIN assistant_model_steps m ON m.id=c.model_step_id
          LEFT JOIN operation_runs r ON r.id=c.child_run_id
          WHERE c.turn_id=${turn.id} AND c.name IN ('analyze_xhs_covers','search_xhs_covers','search_xhs_notes','search_wechat_articles','generate_image')
          ORDER BY m.model_ordinal,c.ordinal`
      : [];
    const [water] =
      await tx`SELECT coalesce(max(seq),0)::int seq FROM assistant_events WHERE session_id=${id}`;
    const activitySnapshot = turn ? await readActivities(tx, turn as Parameters<typeof readActivities>[1]) : null;
    const queued = await tx`SELECT id,position,input,state,quote,error,prepared_input,submitted_turn_id,command_key FROM (SELECT * FROM assistant_message_queue WHERE session_id=${id} AND (state IN ('pending','quoted') OR id IN (SELECT id FROM assistant_message_queue WHERE session_id=${id} ORDER BY position DESC LIMIT 50))) q ORDER BY position`;
    return {
      queue: { paused: s.queue_paused, entries: queued.map(q => ({ id: q.id, position: Number(q.position), message: q.input.message, taskSelectionRequired: q.prepared_input?.taskSelectionRequired === true, skillSelection:q.input.skillSelection??null, state: q.state, quote: q.quote, error: q.error, turnId: q.submitted_turn_id, commandKey: q.command_key })) },
      sessionId: s.id,
      initialRequest: !s.active_turn_id && !messages.length ? s.initial_request : null,
      feeAuthorization: await readFeeAuthorization(tx,id),
      assistantId: s.assistant_id,
      assistantName: s.assistant_name,
      title: s.title,
      brief: s.brief,
      revision: s.revision,
      archived: !!s.archived_at,
      inputs: inputs.map((i) => ({ id: i.id, text: i.text, source: i.source })),
      messages: messages.map((m) => ({
        id: m.id,
        seq: m.seq,
        role: m.role,
        text: m.text,
        turnId: m.turn_id,
      })),
      artifacts: artifacts.map((a) => ({
        artifactId: a.artifact_id,
        version: a.version,
        kind: a.kind,
        schemaVersion: a.schema_version,
        content: a.content,
        sources: a.source_snapshot,
      })),
      turn: turn
        ? {
            credits: (await tx`SELECT amount,consumed,released,state FROM member_credit_charges WHERE root_run_id=${turn.parent_operation_run_id} AND pricing_snapshot ? 'task'`)[0] ?? null,
            turnId: turn.id,
            runId: turn.parent_operation_run_id,
            phase: ["stopped", "needs_review", "completed"].includes(turn.status) ? turn.status : turn.phase,
            status: turn.status,
            generation: turn.generation,
            question: turn.pending_question,
            ...activitySnapshot!,
            calls: calls.map((c) => ({
              callId: c.id,
              name: c.name,
              input: c.input,
              proposalRevision: c.proposal_revision,
              state: c.state,
              quote: c.quote,
              approvalBlockedReason: c.result?.approvalBlockedReason ?? null,
              childRunId: c.child_run_id,
              imageParameters: imageParameters(c),
              result: publicCallResult(c.name, c.result),
            })),
            canResume:
              !turn.snapshot.taskScope && turn.status === "stopped" &&
              !(await tx`SELECT id FROM assistant_model_steps m WHERE m.turn_id=${turn.id}
                AND m.operation_step_version=${turn.step_version} AND m.decision IS NOT NULL
                AND NOT EXISTS(SELECT 1 FROM assistant_tool_calls c WHERE c.model_step_id=m.id)`)[0] &&
              !!(
                await tx`SELECT c.id FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id=c.id WHERE l.run_id=${turn.parent_operation_run_id} AND c.state IN ('reserved','review') AND NOT EXISTS(SELECT 1 FROM receipts p WHERE p.id=(SELECT current_receipt_id FROM operation_runs WHERE id=${turn.parent_operation_run_id}) AND p.status IN ('pending','unknown')) AND NOT EXISTS(SELECT 1 FROM assistant_tool_calls ac JOIN operation_runs cr ON cr.id=ac.child_run_id JOIN receipts cp ON cp.id=cr.current_receipt_id WHERE ac.turn_id=${turn.id} AND cp.status IN ('pending','unknown'))
                  AND NOT EXISTS(SELECT 1 FROM assistant_tool_calls ac JOIN operation_runs cr ON cr.id=ac.child_run_id
                    LEFT JOIN member_credit_run_links cl ON cl.run_id=cr.id LEFT JOIN member_credit_charges cc ON cc.id=cl.charge_id
                    WHERE ac.turn_id=${turn.id} AND cr.status='stopped' AND (cc.id IS NULL OR cc.state NOT IN ('reserved','review')))`
              )[0],
          }
        : null,
      eventSeq: water!.seq,
    } as AssistantSession;
  });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Only these display fields leave the session read model for image calls. */
function imageParameters(call: Record<string, any>): AssistantImageParameters | null {
  if (call.name !== "generate_image") return null;
  const childInput = objectValue(call.child_input)?.parameters;
  const normalized = objectValue(call.result)?.normalized;
  const source =
    objectValue(childInput) ??
    objectValue(objectValue(normalized)?.commandInput);
  if (
    typeof source?.prompt !== "string" ||
    typeof source.size !== "string" ||
    typeof source.resolution !== "string" ||
    !Number.isSafeInteger(source.n) ||
    Number(source.n) < 1
  )
    return null;
  return {
    prompt: source.prompt,
    size: source.size,
    resolution: source.resolution,
    count: Number(source.n),
  };
}

function publicCallResult(name: string, value: unknown): unknown {
  if (name !== "generate_image" && name !== "analyze_xhs_covers") return value;
  const result = objectValue(value);
  if (!result) return value;
  const {
    normalized: _normalized,
    approvalBlockedReason: _approvalBlockedReason,
    ...publicResult
  } = result;
  if(name === "analyze_xhs_covers") {
    const selected=objectValue(objectValue(_normalized)?.commandInput)?.selections;
    return {...(Array.isArray(selected)?{selectedCount:selected.length,maxImages:20,batchImages:5,maxBatches:4}:{}),...publicResult};
  }
  return publicResult;
}

export async function listSessions(userId: number, raw: unknown) {
  const q = z
    .object({
      assistantId: z.enum(["creative", "xiaohongshu"]).optional(),
      before: z.iso.datetime().optional(),
    })
    .parse(raw);
  return {
    sessions:
      await sql`SELECT id AS "sessionId",assistant_id AS "assistantId",assistant_name AS "assistantName",title,created_at AS "createdAt" FROM assistant_sessions WHERE owner_user_id=${userId} AND deleted_at IS NULL AND archived_at IS NULL AND (${q.assistantId ?? null}::text IS NULL OR assistant_id=${q.assistantId ?? null}) AND (${q.before ?? null}::timestamptz IS NULL OR created_at<${q.before ?? null}::timestamptz) ORDER BY created_at DESC LIMIT 50`,
  };
}
export async function sessionEvents(userId: number, id: string, raw: unknown) {
  const q = z.object({ after: z.coerce.number().int().min(0).default(0) }).parse(raw);
  await ownedSession(sql, userId, id);
  const events =
    await sql`SELECT seq,type,entity_id AS "entityId" FROM assistant_events WHERE session_id=${id} AND seq>${q.after} ORDER BY seq LIMIT 200`;
  return { events };
}
export async function editArtifact(userId: number, id: string, artifactId: string, raw: unknown) {
  const i = z
    .object({
      baseVersion: z.number().int().positive(),
      kind: z.enum(["text-draft", "xhs-note"]),
      content: Content,
    })
    .strict()
    .parse(raw);
  return sql.begin(async (tx) => {
    const s = await ownedSession(tx, userId, id, true);
    const [active] =
      await tx`SELECT r.id FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=${s.active_turn_id} AND r.status IN ('active','waiting','needs_review')`;
    if (active) throw conflict("请先停止当前回合再编辑稿件");
    return saveArtifact(tx, { sessionId: id, artifactId, ...i });
  });
}

export async function artifactVersions(userId: number, id: string, artifactId: string) {
  await ownedSession(sql, userId, id);
  z.string().uuid().parse(artifactId);
  return {
    versions: (
      await sql`SELECT * FROM assistant_artifact_versions WHERE session_id=${id} AND artifact_id=${artifactId} ORDER BY version DESC LIMIT 100`
    ).map((a) => ({
      artifactId: a.artifact_id,
      version: a.version,
      kind: a.kind,
      schemaVersion: a.schema_version,
      content: a.content,
      sources: a.source_snapshot,
    })),
  };
}

export async function attachInput(userId:number,id:string,raw:unknown,key:unknown) {
 return sql.begin(tx => attachInputTx(tx,userId,id,raw,key));
}
async function attachInputTx(tx: Tx,userId:number,id:string,raw:unknown,key:unknown) {
 const input=z.object({assetKey:z.string().min(1).max(300)}).strict().parse(raw),c=command(key,input);
 await lockMemberAdmission(tx,`user:${userId}`);
 const session=await ownedSession(tx,userId,id,true);
 const [old]=await tx`SELECT * FROM assistant_session_inputs WHERE session_id=${id} AND command_key=${c.key}`;
 if(old){if(old.command_hash!==c.hash)throw conflict("材料关联标识已被使用");return {inputId:old.id,text:old.text,source:old.source,revision:session.revision};}
 await lockAssetInputs(tx,[input.assetKey]);
 const attachment=await readAssistantAttachment(`user:${userId}`,input.assetKey,tx);
 const inputId=randomUUID();
 await tx`INSERT INTO assistant_session_inputs(id,session_id,text,hash,source,command_key,command_hash) VALUES (${inputId},${id},${attachment.text},${creditHash(attachment.text)},${tx.json(attachment.source)},${c.key},${c.hash})`;
 await tx`UPDATE assistant_sessions SET revision=revision+1 WHERE id=${id}`;
 await event(tx,id,"input",inputId);
 return {inputId,...attachment,revision:session.revision+1};
}

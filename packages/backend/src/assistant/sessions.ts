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
import { profile, profiles, profileActions, taskHint } from "./catalog.ts";
import { skillAdmission, queuedSkillAdmission, readSkillPolicies, skillHealth } from "./skill-policy.ts";
import { accepting, requireAvailable, modelPolicy, TurnInput } from "./config.ts";
import { command, ownedSession, event, message, conflict, saveArtifact, Content } from "./store.ts";
import type { AssistantSession, AssistantOptions } from "@aihot/contracts/assistant";
import type { ToolCreditIntent } from "@aihot/contracts/credits";
import { selectToolPrice } from "../users/credits-prices.ts";
export async function assistantOptions(userId: number): Promise<AssistantOptions> {
  const policies = await readSkillPolicies(), health = await skillHealth();
  const availability = (action: ReturnType<typeof profileActions>[number]) => {
    const { skillId, actionId } = action;
    const policy = policies.find(p => p.skillId === skillId)!;
    const reason = policy.reason ?? (!policy.acceptingNew ? "已暂停新任务；已开始的任务可继续" : health.get(actionId)?.[0] ?? null);
    return { available: !reason, reason };
  };
  await requireCreditUser(sql, userId, true);
  return {
    inputCapabilities: { fileTypes: [".txt", ".md"], maxAttachments: 10, maxFileBytes: 2097152 },
    assistants: Object.values(profiles).map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      welcome: p.welcome,
      available: profileActions(p.id).some(a => availability(a).available),
      reason: profileActions(p.id).some(a => availability(a).available) ? null : profileActions(p.id).map(a => availability(a).reason).find(Boolean) ?? "暂无可用技能",
      actions: [
        ...profileActions(p.id).map(a => ({ actionId: a.actionId, label: a.label, ...availability(a) })),
        { actionId: "wechat", label: "公众号创作", available: false, reason: "未开放" },
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
      })
      .strict()
      .parse(raw),
    c = command(key, input);
  accepting();
  const p = profile(input.assistantId);
  return sql.begin(async (tx) => {
    await lockMemberAdmission(tx, `user:${userId}`);
    await requireCreditUser(tx, userId, true);
    const [old] =
      await tx`SELECT id,command_hash,deleted_at FROM assistant_sessions WHERE owner_user_id=${userId} AND command_key=${c.key}`;
    if (old) {
      if (old.command_hash !== c.hash) throw conflict("幂等标识已用于其他请求");
      if (old.deleted_at) throw conflict("会话已删除");
      return { sessionId: old.id };
    }
    const [count] =
      await tx`SELECT count(*)::int n FROM assistant_sessions WHERE owner_user_id=${userId} AND deleted_at IS NULL`;
    if (count!.n >= 100) throw conflict("会话数量已达100个，请清理旧会话");
    const id = randomUUID();
    await tx`INSERT INTO assistant_sessions(id,owner_user_id,assistant_id,assistant_name,profile_version,title,brief,command_key,command_hash) VALUES (${id},${userId},${p.id},${p.name},${p.version},${input.title},${input.brief},${c.key},${c.hash})`;
    await event(tx, id, "session", id);
    return { sessionId: id };
  });
}
export async function snapshotInput(db: Tx | typeof sql, userId: number, sessionId: string, raw: unknown, queueEntryId?: string, lockPolicy = false) {
  const input = TurnInput.parse(raw),
    session = await ownedSession(db, userId, sessionId);
  if (input.expectedRevision !== session.revision) throw conflict("会话已变化，请重新报价");
  await assertSessionReceiptsReviewed(db, sessionId);
  const hint = taskHint(session.assistant_id, input.taskHint),
    p = profile(session.assistant_id),
    model = await modelPolicy(),
    admission = queueEntryId
      ? await queuedSkillAdmission(db as Tx, sessionId, queueEntryId, p.id)
      : await skillAdmission(db, p.id, input.skillSelection as never, lockPolicy),
    allowed = admission.candidates;
  const selected: unknown[] = [];
  const history =
    await db`SELECT role,text FROM assistant_messages WHERE session_id=${sessionId} AND role IN ('user','assistant') AND text<>'' ORDER BY seq`;
  const previousArtifacts =
    await db`SELECT DISTINCT ON (artifact_id) artifact_id,version,kind,content,source_snapshot FROM assistant_artifact_versions WHERE session_id=${sessionId} ORDER BY artifact_id,version DESC`;
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
  const selectedVersions = new Set<string>();
  for (const a of input.artifactVersions ?? []) {
    const key = `${a.artifactId}:${a.version}`;
    if (selectedVersions.has(key)) continue;
    const [row] =
      await db`SELECT artifact_id,version,kind,content,source_snapshot FROM assistant_artifact_versions WHERE session_id=${sessionId} AND artifact_id=${a.artifactId} AND version=${a.version}`;
    if (!row) throw conflict("选定稿件不存在");
    selected.push(row);
    selectedVersions.add(key);
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
  if (contextTokens(JSON.stringify(snapshot)) + 4096 > model.maxInputTokens) throw conflict("模型上下文超过上限，请缩小材料");
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
  return quoteTool(userId, (await snapshotInput(sql, userId, id, raw)).intent);
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
      await tx`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${userId}`} AND provider='assistant' AND status IN ('active','waiting')`;
    if (count!.n >= 2) throw conflict("同时最多执行2个助手回合");
    const [usage] = await tx`SELECT count(*)::int n FROM assistant_turns WHERE session_id=${id}`;
    if (usage!.n >= 100) throw conflict("单会话最多100个回合，请新建会话");
    const { input, snapshot, intent } = await snapshotInput(tx, userId, id, rest, queueEntryId, true);
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
      ? await tx`SELECT t.id,t.parent_operation_run_id,t.phase,t.pending_question,r.status,r.generation,r.step_key,r.step_version FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=${s.active_turn_id}`
      : [];
    const calls = turn
      ? await tx`SELECT c.* FROM assistant_tool_calls c JOIN assistant_model_steps m ON m.id=c.model_step_id WHERE c.turn_id=${turn.id} AND c.name='search_xhs_notes' ORDER BY m.model_ordinal,c.ordinal`
      : [];
    const [water] =
      await tx`SELECT coalesce(max(seq),0)::int seq FROM assistant_events WHERE session_id=${id}`;
    const activitySnapshot = turn ? await readActivities(tx, turn as Parameters<typeof readActivities>[1]) : null;
    const queued = await tx`SELECT id,position,input,state,quote,error,submitted_turn_id,command_key FROM (SELECT * FROM assistant_message_queue WHERE session_id=${id} AND (state IN ('pending','quoted') OR id IN (SELECT id FROM assistant_message_queue WHERE session_id=${id} ORDER BY position DESC LIMIT 50))) q ORDER BY position`;
    return {
      queue: { paused: s.queue_paused, entries: queued.map(q => ({ id: q.id, position: Number(q.position), message: q.input.message, state: q.state, quote: q.quote, error: q.error, turnId: q.submitted_turn_id, commandKey: q.command_key })) },
      sessionId: s.id,
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
              result: c.result,
            })),
            canResume:
              turn.status === "stopped" &&
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
 const input=z.object({assetKey:z.string().min(1).max(300)}).strict().parse(raw),c=command(key,input);
 return sql.begin(async tx=>{
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
 });
}

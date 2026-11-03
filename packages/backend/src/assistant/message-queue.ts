import { selectedArtifactVersions } from "./cover-plan.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Tx } from "../db.ts";
import { AccountError } from "../users/accounts.ts";
import { requireCreditUser } from "../users/credits-core.ts";
import { lockMemberAdmission, StaleOperationError } from "../providers/operations/store.ts";
import { taskChoices } from "./task-pricing.ts";
import { TaskChoice } from "./task-contract.ts";
import { TurnInput, accepting } from "./config.ts";
import { taskHint } from "./catalog.ts";
import { skillAdmission } from "./skill-policy.ts";
import { assertSessionReceiptsReviewed } from "./fees.ts";
import { snapshotInput, submitTurnTx, quoteAssistantTurn } from "./sessions.ts";
import { command, ownedSession, conflict, event } from "./store.ts";

export async function enqueueMessage(userId: number, sessionId: string, raw: unknown, key: unknown) {
  const input = TurnInput.parse(raw), c = command(key, input);
  const result = await sql.begin(async tx => {
    await lockMemberAdmission(tx, `user:${userId}`);
    const s = await ownedSession(tx, userId, sessionId, true);
    const [old] = await tx`SELECT id,command_hash,state,submitted_turn_id FROM assistant_message_queue WHERE session_id=${sessionId} AND command_key=${c.key}`;
    if (old) {
      if (old.command_hash !== c.hash) throw conflict("排队标识已用于不同需求");
      return { entryId: old.id, state: old.state, turnId: old.submitted_turn_id };
    }
    accepting(); await requireCreditUser(tx, userId, true);
    if (s.archived_at) throw conflict("会话已归档");
    if (s.revision !== input.expectedRevision) throw conflict("会话已变化，请核对后重新排队");
    const [count] = await tx`SELECT count(*)::int n FROM assistant_message_queue WHERE session_id=${sessionId} AND state IN ('pending','quoted')`;
    if (count!.n >= 10) throw conflict("最多等待10条需求，请先处理或取消");
    taskHint(s.assistant_id, input.taskHint);
    const inputs = await tx`SELECT id FROM assistant_session_inputs WHERE session_id=${sessionId}`;
    const inputIds = input.inputIds ?? inputs.map(row => row.id);
    if (inputIds.some(id => !inputs.some(row => row.id === id))) throw conflict("选定材料不可访问");
    const versions = input.artifactVersions ?? (await tx<{ artifactId: string; version: number }[]>`SELECT artifact_id AS "artifactId",max(version)::int AS version FROM assistant_artifact_versions WHERE session_id=${sessionId} AND kind IN ('text-draft','xhs-note') GROUP BY artifact_id`);
    const selected=await selectedArtifactVersions(tx,sessionId,versions);
    const admission = await skillAdmission(tx, s.assistant_id, input.skillSelection as never, true,selected);
    if (input.autoAuthorizationId && !(await tx`SELECT id FROM assistant_fee_authorizations WHERE id=${input.autoAuthorizationId} AND session_id=${sessionId}`)[0]) throw conflict("费用授权不属于本会话");
    const id = randomUUID(), frozen = { ...input, inputIds, artifactVersions: versions };
    await tx`INSERT INTO assistant_message_queue(id,session_id,command_key,command_hash,input,admission_snapshot) VALUES (${id},${sessionId},${c.key},${c.hash},${tx.json(frozen as never)},${tx.json(admission as never)})`;
    await event(tx, sessionId, "queue", id);
    return { entryId: id, state: "pending", turnId: null };
  });
  await advanceMessageQueue(userId, sessionId);
  return result;
}
async function head(tx: Tx, sessionId: string) {
  return (await tx`SELECT * FROM assistant_message_queue WHERE session_id=${sessionId} AND state IN ('pending','quoted') ORDER BY position LIMIT 1 FOR UPDATE`)[0];
}
async function ready(tx: Tx, s: Record<string, any>) {
  if (s.deleted_at || s.archived_at || s.queue_paused) return false;
  const [run] = await tx`SELECT r.status FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=${s.active_turn_id}`;
  if (run && ['active','waiting'].includes(run.status)) return false;
  if (run && run.status !== 'completed' && (s.queue_resume_turn_id !== s.active_turn_id || run.status === 'needs_review')) {
    await tx`UPDATE assistant_sessions SET queue_paused=true WHERE id=${s.id}`;
    await event(tx, s.id, "queue", s.id); return false;
  }
  await assertSessionReceiptsReviewed(tx, s.id);
  const [review] = await tx`WITH runs AS (SELECT parent_operation_run_id id FROM assistant_turns WHERE session_id=${s.id} UNION SELECT c.child_run_id FROM assistant_tool_calls c JOIN assistant_turns t ON t.id=c.turn_id WHERE t.session_id=${s.id} AND c.child_run_id IS NOT NULL) SELECT c.id FROM member_credit_charges c JOIN member_credit_authorized_runs l ON l.charge_id=c.id WHERE l.run_id IN (SELECT id FROM runs) AND c.state='review' LIMIT 1`;
  if (review) throw conflict("原任务积分仍待核对，请处理后继续排队消息");
  return true;
}
/** Preparation may call one bounded model: never hold a transaction open across that call. */
async function prepareQueued(userId:number,sessionId:string,entryId?:string,choice?:unknown) {
  const capture=await sql.begin(async tx=>{
    await lockMemberAdmission(tx,`user:${userId}`);
    const s=await ownedSession(tx,userId,sessionId,true),entry=await head(tx,sessionId);
    if(!entry || (entryId&&entry.id!==entryId) || !await ready(tx,s))return null;
    const raw={...entry.input,expectedRevision:s.revision,...(choice?{taskChoice:TaskChoice.parse(choice)}:{})};
    // A new task always requires explicit confirmation; old quoted/queued records keep their mode.
    return {s,entry,raw};
  });
  if(!capture)return null;
  const prepared=await snapshotInput(sql,userId,sessionId,capture.raw,capture.entry.id);
  if(taskChoices(prepared.snapshot.candidates).length){delete capture.raw.autoAuthorizationId;prepared.snapshot.autoAuthorizationId=null;}
  const quote=await quoteAssistantTurn(userId,prepared);
  if(quote.task)delete capture.raw.autoAuthorizationId;
  return sql.begin(async tx=>{
    await lockMemberAdmission(tx,`user:${userId}`);
    const s=await ownedSession(tx,userId,sessionId,true),entry=await head(tx,sessionId);
    if(!entry||entry.id!==capture.entry.id||s.revision!==capture.s.revision||!await ready(tx,s))throw conflict("排队内容已变化，请重新报价");
    await tx`UPDATE assistant_message_queue SET state='quoted',quote=${tx.json(quote as never)},prepared_input=${tx.json(capture.raw)},error=NULL WHERE id=${entry.id}`;
    await event(tx,s.id,"queue",entry.id);
    return {...entry,quote,prepared_input:capture.raw,state:'quoted'};
  });
}
async function submit(tx: Tx, userId: number, s: Record<string, any>, entry: Record<string, any>, manual: boolean) {
  // A manual confirmation does not replace the authorization bound at enqueue for subsequent searches.
  const input = { ...entry.prepared_input };
  if (manual) delete input.autoAuthorizationId;
  const result = await submitTurnTx(tx, userId, s.id, { ...input, quoteId: entry.quote.quoteId }, `queued:${entry.id}`, entry.id);
  await tx`UPDATE assistant_message_queue SET state='submitted',submitted_turn_id=${result.turnId},error=NULL WHERE id=${entry.id}`;
  await event(tx, s.id, "queue", entry.id);
  return result;
}
export async function advanceMessageQueue(userId:number,sessionId:string) {
 const [entry]=await sql`SELECT id,state,error FROM assistant_message_queue WHERE session_id=${sessionId} AND state IN ('pending','quoted') ORDER BY position LIMIT 1`;
 if(!entry||entry.state==='quoted'||entry.error)return;
 try {
  const quoted=await prepareQueued(userId,sessionId,entry.id);
  if(!quoted||quoted.quote.task||!quoted.prepared_input.autoAuthorizationId)return;
  await sql.begin(async tx=>{await lockMemberAdmission(tx,`user:${userId}`);const s=await ownedSession(tx,userId,sessionId,true);if((await head(tx,sessionId))?.id===entry.id&&await ready(tx,s))await submit(tx,userId,s,quoted,false);});
 }catch(error){
  if(!(error instanceof AccountError)&&!(error instanceof StaleOperationError))throw error;
  await sql.begin(async tx=>{await ownedSession(tx,userId,sessionId,true);await tx`UPDATE assistant_message_queue SET error=${error.message},prepared_input=CASE WHEN ${error instanceof AccountError && error.code==='assistant_task_selection_required'} THEN jsonb_build_object('taskSelectionRequired',true) ELSE prepared_input END WHERE id=${entry.id} AND state IN ('pending','quoted')`;await event(tx,sessionId,'queue',entry.id);});
 }
}
export async function approveQueuedMessage(userId: number, sessionId: string, entryId: string, raw: unknown) {
  const input = z.object({ quoteId: z.string().uuid() }).strict().parse(raw);
  return sql.begin(async tx => {
    await lockMemberAdmission(tx, `user:${userId}`);
    const s = await ownedSession(tx, userId, sessionId, true);
    const [entry] = await tx`SELECT * FROM assistant_message_queue WHERE id=${z.string().uuid().parse(entryId)} AND session_id=${sessionId}`;
    if (!entry) throw conflict("排队需求不存在");
    if (entry.state === 'submitted') return { turnId: entry.submitted_turn_id };
    if (!await ready(tx, s) || (await head(tx, sessionId))?.id !== entryId || entry.state !== 'quoted') throw conflict("请按队列顺序继续");
    if (entry.quote?.quoteId !== input.quoteId) throw conflict("报价已变化，请核对当前费用");
    try { return await tx.savepoint(inner => submit(inner, userId, s, entry, true)); }
    catch (error) {
      if (!(error instanceof AccountError) && !(error instanceof StaleOperationError)) throw error;
      await tx`UPDATE assistant_message_queue SET error=${error.message} WHERE id=${entry.id}`;
      return { requote: true, quote: entry.quote };
    }
  });
}
export async function refreshQueuedQuote(userId:number,sessionId:string,entryId:string,raw?:unknown) {
 const input=z.object({taskChoice:TaskChoice.optional()}).strict().parse(raw??{});
 const result=await prepareQueued(userId,sessionId,z.string().uuid().parse(entryId),input.taskChoice);
 if(!result)throw conflict("当前需求不能报价");
 return {quote:result.quote};
}
export async function cancelQueuedMessage(userId: number, sessionId: string, entryId: string) {
  const result = await sql.begin(async tx => {
    await lockMemberAdmission(tx, `user:${userId}`); await ownedSession(tx, userId, sessionId, true);
    const [entry] = await tx`SELECT state FROM assistant_message_queue WHERE id=${z.string().uuid().parse(entryId)} AND session_id=${sessionId}`;
    if (!entry) throw conflict("排队需求不存在");
    if (entry.state === 'submitted') throw conflict("需求已执行，请停止对应任务");
    if (entry.state !== 'cancelled') {
      await tx`UPDATE assistant_message_queue SET state='cancelled',quote=NULL,prepared_input=NULL WHERE id=${entryId}`;
      await event(tx, sessionId, "queue", entryId);
    }
    return { entryId, state: 'cancelled' };
  });
  await advanceMessageQueue(userId, sessionId);
  return result;
}
export async function resumeMessageQueue(userId: number, sessionId: string) {
  await sql.begin(async tx => {
    await lockMemberAdmission(tx, `user:${userId}`);
    const s = await ownedSession(tx, userId, sessionId, true);
    if (s.archived_at) throw conflict("会话已归档");
    await requireCreditUser(tx, userId, true); await assertSessionReceiptsReviewed(tx, sessionId);
    const candidate = { ...s, queue_paused: false, queue_resume_turn_id: s.active_turn_id };
    if (!await ready(tx, candidate)) throw conflict("请先处理当前任务，再继续排队消息");
    await tx`UPDATE assistant_sessions SET queue_paused=false,queue_resume_turn_id=active_turn_id WHERE id=${sessionId}`;
    await tx`UPDATE assistant_message_queue SET error=NULL WHERE session_id=${sessionId} AND state='pending'`;
    await event(tx, sessionId, "queue", sessionId);
  });
  await advanceMessageQueue(userId, sessionId);
  return { sessionId };
}
/** Existing Worker recovery backs up command-triggered admission; reads never dispatch requests. */
export async function recoverMessageQueues(relatedRunId?: number) {
  const rows = await sql`SELECT s.id,s.owner_user_id FROM assistant_sessions s WHERE s.deleted_at IS NULL AND s.archived_at IS NULL AND NOT s.queue_paused
    AND (SELECT q.state='pending' AND q.error IS NULL FROM assistant_message_queue q WHERE q.session_id=s.id AND q.state IN ('pending','quoted') ORDER BY q.position LIMIT 1)
    AND NOT EXISTS(SELECT 1 FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=s.active_turn_id AND r.status IN ('active','waiting'))
    AND (${relatedRunId ?? null}::bigint IS NULL OR s.active_turn_id IN (SELECT id FROM assistant_turns WHERE parent_operation_run_id=${relatedRunId ?? null})) ORDER BY s.id LIMIT 100`;
  for (const s of rows) await advanceMessageQueue(s.owner_user_id, s.id);
}

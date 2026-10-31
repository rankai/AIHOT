import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Tx } from "../db.ts";
import { AccountError } from "../users/accounts.ts";
import { assertRunCredit, settleForRun } from "../users/credits.ts";
import { creditHash, requireCreditUser } from "../users/credits-core.ts";
import { audit } from "../admin/auth.ts";
import { lockMemberAdmission, resumeRun, type Execution } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { ownedSession, command, conflict, event, message } from "./store.ts";
import { accepting } from "./config.ts";
import { profile } from "./catalog.ts";
export async function ownedTurn(tx: Tx, userId: number, id: string, turnId: string) {
  await lockMemberAdmission(tx, `user:${userId}`);
  const s = await ownedSession(tx, userId, id, true);
  const [t] =
    await tx`SELECT t.*,r.status,r.generation,r.step_version,r.current_receipt_id FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=${turnId} AND t.session_id=${id} FOR UPDATE OF r,t`;
  if (!t) throw new AccountError(404, "not_found", "回合不存在");
  return { s, t };
}
export async function answerTurn(userId: number, id: string, turnId: string, raw: unknown) {
  const input = z
    .object({
      questionId: z.string().uuid(),
      expectedRevision: z.number().int(),
      answer: z.string().trim().min(1).max(10000),
    })
    .strict()
    .parse(raw);
  return sql.begin(async (tx) => {
    const { s, t } = await ownedTurn(tx, userId, id, turnId);
    const hash = creditHash(input);
    if (t.snapshot.answers?.[input.questionId]) {
      if (t.snapshot.answers[input.questionId] !== hash) throw conflict("问题已经收到不同答案");
      return { turnId };
    }
    if (
      s.revision !== input.expectedRevision ||
      t.phase !== "waiting_question" ||
      t.status !== "waiting" ||
      t.pending_question?.questionId !== input.questionId
    )
      throw conflict("问题已变化，请刷新");
    await requireCreditUser(tx, userId, true);
    await assertRunCredit(tx, t.parent_operation_run_id);
    await message(tx, id, turnId, "user", input.answer, { role: "user", content: input.answer });
    await tx`UPDATE assistant_turns SET phase='executing',pending_question=NULL,snapshot=${tx.json({ ...t.snapshot, answers: { ...t.snapshot.answers, [input.questionId]: hash } })} WHERE id=${turnId}`;
    await tx`UPDATE assistant_sessions SET revision=revision+1 WHERE id=${id}`;
    await resumeRun(tx, {
      runId: t.parent_operation_run_id,
      stepVersion: t.step_version,
      generation: t.generation,
    });
    await queueOperationStep(tx, t.parent_operation_run_id);
    return { turnId };
  });
}
async function stopTx(tx: Tx, t: Record<string, any>, reason = "Stopped by owner") {
  const runs =
    await tx`SELECT r.* FROM operation_runs r WHERE r.id=${t.parent_operation_run_id} OR r.id IN (SELECT child_run_id FROM assistant_tool_calls WHERE turn_id=${t.id}) ORDER BY id FOR UPDATE`;
  for (const r of runs)
    if (["active", "waiting", "needs_review"].includes(r.status)) {
      await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,next_attempt_at=NULL,job_id=NULL,wait_reason=${reason},updated_at=now() WHERE id=${r.id}`;
      await settleForRun(tx, { runId: r.id, outcome: "stopped" });
    }
  await event(tx, t.session_id, "turn", t.id);
}
async function resumeTurnTx(tx: Tx, s: Record<string, any>, t: Record<string, any>) {
  if (s.active_turn_id !== t.id) throw conflict("会话已有新回合，不能恢复旧回合");
  if (!["stopped", "needs_review"].includes(t.status)) throw conflict("当前回合不可继续");
  const [committedWithoutTools] = await tx`SELECT id FROM assistant_model_steps m WHERE m.turn_id=${t.id}
    AND m.operation_step_version=${t.step_version} AND m.decision IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM assistant_tool_calls c WHERE c.model_step_id=m.id)`;
  if (committedWithoutTools) throw conflict("本次回复未提供可执行工具或稿件，无法继续，请先核对交付结果");
  // Admission is already locked; authentication before this transaction may have raced account disablement.
  await requireCreditUser(tx, s.owner_user_id, true);
  await assertRunCredit(tx, t.parent_operation_run_id);
  const receipts =
    await tx`SELECT p.status FROM receipts p WHERE p.id=${t.current_receipt_id} OR p.id IN (SELECT r.current_receipt_id FROM operation_runs r JOIN assistant_tool_calls c ON c.child_run_id=r.id WHERE c.turn_id=${t.id})`;
  if (receipts.some((r) => ["pending", "unknown"].includes(r.status)))
    throw conflict("存在未知或在途请求，需要先核对");
  const [count] =
    await tx`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${s.owner_user_id}`} AND provider='assistant' AND status IN ('active','waiting')`;
  if (count!.n >= 2) throw conflict("同时最多执行2个助手回合");
  // Admit every phase through the shared member limit; child failures roll this whole transaction back.
  await resumeRun(tx, {
    runId: t.parent_operation_run_id,
    stepVersion: t.step_version,
    generation: t.generation,
  });
  if (["waiting_question", "waiting_approval", "waiting_child"].includes(t.phase)) {
    await tx`UPDATE operation_runs SET status='waiting',wait_reason=${`assistant:${t.phase}`} WHERE id=${t.parent_operation_run_id}`;
  } else {
    await queueOperationStep(tx, t.parent_operation_run_id);
  }
  const children =
    await tx`SELECT r.* FROM operation_runs r JOIN assistant_tool_calls c ON c.child_run_id=r.id WHERE c.turn_id=${t.id} AND r.status IN ('stopped','needs_review') ORDER BY r.id`;
  for (const child of children) {
    await resumeRun(tx, { runId: child.id, stepVersion: child.step_version, generation: child.generation });
    await queueOperationStep(tx, child.id);
  }
  await event(tx, s.id, "turn", t.id);
}
export async function controlTurn(
  userId: number,
  id: string,
  turnId: string,
  action: "stop" | "resume",
  raw: unknown,
) {
  const input = z
    .object({ generation: z.number().int().min(0) })
    .strict()
    .parse(raw);
  return sql.begin(async (tx) => {
    const { s, t } = await ownedTurn(tx, userId, id, turnId);
    if (t.generation !== input.generation) throw conflict("回合状态已变化");
    if (action === "stop") await stopTx(tx, t);
    else {
      if (t.status !== "stopped") throw conflict("当前回合不可继续");
      await resumeTurnTx(tx, s, t);
    }
    return { turnId };
  });
}
/** Existing administrator operation controls keep the owner's actor and act on the whole assistant turn. */
export async function controlAssistantOperation(
  tx: Tx,
  expected: Execution,
  action: "stop" | "resume" | "abandon",
  actor: string,
  reason: string,
) {
  if (!actor.startsWith("admin:") && !actor.startsWith("dev:"))
    throw new AccountError(403, "forbidden", "请从助手会话控制此任务");
  const [owner] =
    await tx`SELECT t.id,t.session_id,s.owner_user_id FROM assistant_turns t JOIN assistant_sessions s ON s.id=t.session_id WHERE t.parent_operation_run_id=${expected.runId}`;
  if (!owner) throw conflict("助手子任务须通过关联的父回合控制");
  if (action === "abandon") throw conflict("助手回合不支持通用放弃，请停止后核对积分");
  await lockMemberAdmission(tx, `user:${owner.owner_user_id}`);
  const [s] = await tx`SELECT * FROM assistant_sessions WHERE id=${owner.session_id} FOR UPDATE`;
  const [t] =
    await tx`SELECT t.*,r.status,r.generation,r.step_version,r.current_receipt_id FROM assistant_turns t JOIN operation_runs r ON r.id=t.parent_operation_run_id WHERE t.id=${owner.id} FOR UPDATE OF r,t`;
  if (!s || !t || t.generation !== expected.generation || t.step_version !== expected.stepVersion)
    throw conflict("回合状态已变化");
  if (action === "resume") {
    if (s.deleted_at) throw conflict("会话已删除，不能恢复");
    try {
      await resumeTurnTx(tx, s, t);
    } catch (error) {
      // The existing administrator handler exposes state conflicts; member routes retain their specific codes.
      if (error instanceof AccountError && [403, 409].includes(error.statusCode))
        throw conflict(error.message);
      throw error;
    }
  } else {
    if (["completed", "failed"].includes(t.status)) throw conflict("回合已结束");
    await stopTx(tx, t, reason);
  }
  await audit(
    actor,
    `operation.${action}`,
    `operation:${expected.runId}`,
    reason,
    { status: t.status, generation: t.generation },
    { turnId: t.id, ownerUserId: s.owner_user_id },
    undefined,
    tx,
  );
}
export async function archiveSession(userId: number, id: string, remove: boolean) {
  return sql.begin(async (tx) => {
    await lockMemberAdmission(tx, `user:${userId}`);
    const s = await ownedSession(tx, userId, id, true);
    if (remove) {
      if (s.active_turn_id) {
        const { t } = await ownedTurn(tx, userId, id, s.active_turn_id);
        await stopTx(tx, t);
      }
      await tx`UPDATE assistant_handoffs SET target_deleted=true WHERE target_session_id=${id} AND owner_user_id=${userId}`;
      await tx`UPDATE assistant_sessions SET deleted_at=now(),brief='' WHERE id=${id}`;
      // Financial snapshots stay governed by their own retention; delete visible private copies.
      await tx`DELETE FROM assistant_session_inputs WHERE session_id=${id}`;
      await tx`DELETE FROM assistant_artifact_versions WHERE session_id=${id}`;
    } else await tx`UPDATE assistant_sessions SET archived_at=now() WHERE id=${id}`;
    return { sessionId: id };
  });
}
export async function handoff(userId: number, id: string, raw: unknown, key: unknown) {
  const input = z
      .object({
        targetAssistantId: z.enum(["creative", "xiaohongshu"]),
        artifactId: z.string().uuid(),
        version: z.number().int().positive(),
        brief: z.string().max(10000).default(""),
      })
      .strict()
      .parse(raw),
    c = command(key, { sourceSessionId: id, ...input });
  return sql.begin(async (tx) => {
    await lockMemberAdmission(tx, `user:${userId}`);
    const [old] =
      await tx`SELECT * FROM assistant_handoffs WHERE owner_user_id=${userId} AND command_key=${c.key}`;
    if (old) {
      if (old.request_hash !== c.hash) throw conflict("转交标识已用于不同材料");
      if (old.target_deleted) throw new AccountError(410, "deleted", "目标会话已删除，不能重建副本");
      await ownedSession(tx, userId, old.target_session_id);
      return { targetSessionId: old.target_session_id };
    }
    accepting();
    await ownedSession(tx, userId, id, true);
    const p = profile(input.targetAssistantId);
    const [a] =
      await tx`SELECT content FROM assistant_artifact_versions WHERE session_id=${id} AND artifact_id=${input.artifactId} AND version=${input.version}`;
    if (!a) throw new AccountError(404, "not_found", "稿件版本不存在");
    const [count] =
      await tx`SELECT count(*)::int n FROM assistant_sessions WHERE owner_user_id=${userId} AND deleted_at IS NULL`;
    if (count!.n >= 100) throw conflict("会话数量已达上限");
    const target = randomUUID(),
      text = JSON.stringify(a.content);
    await tx`INSERT INTO assistant_sessions(id,owner_user_id,assistant_id,assistant_name,profile_version,title,brief,command_key,command_hash) VALUES (${target},${userId},${p.id},${p.name},${p.version},${"继续创作：" + String(a.content.title).slice(0, 120)},${input.brief},${`handoff:${c.key}`},${c.hash})`;
    await tx`INSERT INTO assistant_session_inputs(id,session_id,text,hash,source) VALUES (${randomUUID()},${target},${text},${creditHash(text)},${tx.json({ sourceSessionId: id, artifactId: input.artifactId, version: input.version })})`;
    await tx`INSERT INTO assistant_handoffs(owner_user_id,command_key,request_hash,source_session_id,target_session_id) VALUES (${userId},${c.key},${c.hash},${id},${target})`;
    await event(tx, target, "session", target);
    return { targetSessionId: target };
  });
}

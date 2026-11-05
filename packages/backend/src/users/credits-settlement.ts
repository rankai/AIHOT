import { z } from "zod";
import type { CreditCharge } from "@aihot/contracts/credits";
import { sql, type Tx } from "../db.ts";
import { audit } from "../admin/auth.ts";
import { AccountError } from "./accounts.ts";
import { CommandKey, Credits, Reason, appendCreditEntry, chargeForRun, creditHash, creditUserId, lockCreditWallet, type ChargeRow, type CreditRunRow } from "./credits-core.ts";
import { readCreditCharge } from "./credits-read.ts";

type Outcome = "completed" | "failed" | "needs_review" | "stopped";
interface DeliveryFacts {
  visionReports: number; assistantDeliveries: number; images: number; videos: number; answers: number; transcriptions: number; commentCompletions: number; uploads: number; genericResults: number;
  successTasks: number; failedTasks: number; unavailableVisionReports: number; undeliveredModelResponses: number; incompleteVideo: boolean; pendingReceipts: number; unknownReceipts: number; receivedReceipts: number;
  otherExecutableRuns: number;
}

/** Only persisted normalized result metadata is inspected, never provider raw responses. */
async function deliveryFacts(tx: Tx, charge: ChargeRow, currentRunId: number, itemRuns?: number[]): Promise<DeliveryFacts> {
  const [facts] = await tx`SELECT
      count(*) FILTER (WHERE r.kind='assistant_vision_report' AND r.data->>'complete'='true' AND (r.data->>'observedCount')::integer>0) AS vision_reports,
      count(*) FILTER (WHERE r.kind = 'assistant_delivery' AND EXISTS (SELECT 1 FROM assistant_artifact_versions a WHERE a.turn_id::text = r.data->>'turnId' AND a.artifact_id::text = r.data->>'artifactId' AND a.version = (r.data->>'version')::integer)) AS assistant_deliveries,
      count(DISTINCT r.file_key) FILTER (WHERE r.kind = 'image' AND f.status = 'available' AND f.content_type LIKE 'image/%') AS images,
      count(DISTINCT r.file_key) FILTER (WHERE r.kind = 'video' AND f.status = 'available' AND f.content_type LIKE 'video/%') AS videos,
      count(*) FILTER (WHERE r.kind = 'ai_search_answer') AS answers,
      count(*) FILTER (WHERE r.kind = 'transcription') AS transcriptions,
      count(*) FILTER (WHERE r.kind = 'xhs_comment_task' AND r.data->>'status' = 'completed') AS comment_completions,
      count(*) FILTER (WHERE r.kind = 'media_upload' AND r.data->>'resourceUrl' IS NOT NULL) AS uploads,
      count(*) FILTER (WHERE r.kind NOT IN ('image_reference','video_reference','image_task','video_task','ai_search_task','transcription_task','xhs_comment_task')) AS generic_results,
      count(*) FILTER (WHERE r.kind IN ('image_task','video_task','ai_search_task','transcription_task') AND r.data->>'status' IN ('succeeded','completed')) AS success_tasks,
      count(*) FILTER (WHERE (r.kind IN ('image_task','video_task','ai_search_task','transcription_task','xhs_comment_task')
        AND (r.data->>'status' = 'failed' OR (r.kind = 'ai_search_task' AND length(trim(coalesce(r.data->>'failReason', ''))) > 0)))
        OR (r.kind='assistant_vision_report' AND r.data->>'complete'='false' AND r.data->>'status'='failed' AND r.data->>'reason'='no_readable_covers')
        OR (r.kind='assistant_model' AND r.data->>'deliveryStatus'='missing')) AS failed_tasks,
      count(*) FILTER (WHERE r.kind='assistant_vision_report' AND r.data->>'complete'='false' AND r.data->>'status'='failed' AND r.data->>'reason'='no_readable_covers') AS unavailable_vision_reports,
      count(*) FILTER (WHERE r.kind='assistant_model' AND r.data->>'deliveryStatus'='missing') AS undelivered_model_responses,
      coalesce(bool_or(r.data->>'lastFrameMissing' = 'true'), false) AS incomplete_video
    FROM member_credit_authorized_runs l JOIN operation_results r ON r.run_id = l.run_id LEFT JOIN stored_files f ON f.key = r.file_key WHERE l.charge_id = ${charge.id} AND (${!itemRuns} OR l.run_id = ANY(${itemRuns ?? []}::bigint[]))`;
  const [receipts] = await tx`WITH linked AS (SELECT run_id FROM member_credit_authorized_runs WHERE charge_id = ${charge.id} AND (${!itemRuns} OR run_id = ANY(${itemRuns ?? []}::bigint[]))), ids AS (
      SELECT current_receipt_id AS id FROM operation_runs WHERE id IN (SELECT run_id FROM linked) AND current_receipt_id IS NOT NULL
      UNION SELECT receipt_id AS id FROM operation_results WHERE run_id IN (SELECT run_id FROM linked) AND receipt_id IS NOT NULL
      UNION SELECT jsonb_array_elements_text(coalesce(progress->'retainedReceiptIds', '[]'))::bigint AS id FROM operation_runs WHERE id IN (SELECT run_id FROM linked)
    ) SELECT count(*) FILTER (WHERE status = 'pending') AS pending, count(*) FILTER (WHERE status = 'unknown') AS unknown,
      count(*) FILTER (WHERE status IN ('received','completed') AND NOT (
        ${!!itemRuns} AND status='completed'
        AND NOT EXISTS (SELECT 1 FROM operation_runs o WHERE o.id IN (SELECT run_id FROM linked)
          AND (o.current_receipt_id=receipts.id OR coalesce(o.progress->'retainedReceiptIds','[]') @> to_jsonb(ARRAY[receipts.id])))
        AND EXISTS (SELECT 1 FROM operation_results z JOIN assistant_model_steps s ON s.id::text=z.data->>'stepId'
          JOIN assistant_turns t ON t.id=s.turn_id AND t.parent_operation_run_id=z.run_id
          WHERE z.run_id IN (SELECT run_id FROM linked) AND z.receipt_id=receipts.id AND z.kind='assistant_model'
            AND s.receipt_id=receipts.id AND s.decision IS NOT NULL
            AND EXISTS (SELECT 1 FROM assistant_tool_calls c WHERE c.model_step_id=s.id)
            AND NOT EXISTS (SELECT 1 FROM assistant_tool_calls c WHERE c.model_step_id=s.id AND c.state NOT IN ('completed','rejected','failed')))
      )) AS received FROM receipts WHERE id IN (SELECT id FROM ids)`;
  const [other] = await tx`SELECT count(*) AS n FROM member_credit_authorized_runs l JOIN operation_runs r ON r.id = l.run_id
    WHERE l.charge_id = ${charge.id} AND l.run_id <> ${currentRunId} AND r.status IN ('active','waiting') AND (${!itemRuns} OR l.run_id = ANY(${itemRuns ?? []}::bigint[]))`;
  return { visionReports:Number(facts!.vision_reports), assistantDeliveries: Number(facts!.assistant_deliveries), images: Number(facts!.images), videos: Number(facts!.videos), answers: Number(facts!.answers), transcriptions: Number(facts!.transcriptions),
    commentCompletions: Number(facts!.comment_completions), uploads: Number(facts!.uploads), genericResults: Number(facts!.generic_results),
    successTasks: Number(facts!.success_tasks), failedTasks: Number(facts!.failed_tasks), unavailableVisionReports: Number(facts!.unavailable_vision_reports), undeliveredModelResponses: Number(facts!.undelivered_model_responses), incompleteVideo: facts!.incomplete_video,
    pendingReceipts: Number(receipts!.pending), unknownReceipts: Number(receipts!.unknown), receivedReceipts: Number(receipts!.received), otherExecutableRuns: Number(other!.n) };
}

function delivered(charge: ChargeRow, facts: DeliveryFacts): boolean {
  switch (charge.pricing_snapshot.kind) {
    case "assistant-vision": return facts.visionReports >= 1;
    case "assistant-turn": return facts.assistantDeliveries >= 1;
    case "images": return facts.images >= Math.max(1, charge.pricing_snapshot.imageCount);
    case "videos": return facts.videos >= 1 && !facts.incompleteVideo;
    case "ai-search": return facts.answers >= 1;
    case "transcriptions": return facts.transcriptions >= 1;
    case "xhs-comments": return facts.commentCompletions >= 1;
    case "media-upload": return facts.uploads >= 1;
    default: return facts.genericResults >= 1; // A validated query_summary with zero hits is a completed query.
  }
}
function anyDelivery(facts: DeliveryFacts): boolean {
  return facts.images + facts.videos + facts.answers + facts.transcriptions + facts.commentCompletions + facts.uploads + facts.genericResults > 0;
}

async function markReview(tx: Tx, charge: ChargeRow, reason: string, evidence: Record<string, unknown>) {
  await tx`UPDATE member_credit_charges SET state = 'review', review_reason = ${reason.slice(0, 500)}, evidence = ${tx.json(evidence as never)}, updated_at = now() WHERE id = ${charge.id}`;
}

/** Charge is locked by caller. Ledger entries and task delivery share this exact transaction. */
async function finalizeCharge(tx: Tx, charge: ChargeRow, consume: number, actor: string, reason: string, evidence: Record<string, unknown>): Promise<void> {
  if (["settled", "released"].includes(charge.state)) return;
  if (!Number.isSafeInteger(consume) || consume < 0 || consume > charge.amount) throw new AccountError(400, "invalid_request", "结算积分不能超过本次占用");
  const release = charge.amount - consume;
  let wallet = await lockCreditWallet(tx, charge.user_id);
  const inputHash = creditHash({ chargeId: charge.id, consume, release });
  if (consume > 0 || charge.amount === 0) {
    wallet = await appendCreditEntry(tx, wallet, { kind: "consume", amount: consume, availableDelta: 0, reservedDelta: -consume,
      actor, commandKey: `consume:${charge.id}`, inputHash, reason, chargeId: charge.id, runId: charge.root_run_id });
  }
  if (release > 0) {
    await appendCreditEntry(tx, wallet, { kind: "release", amount: release, availableDelta: release, reservedDelta: -release,
      actor, commandKey: `release:${charge.id}`, inputHash, reason, chargeId: charge.id, runId: charge.root_run_id });
  }
  const state = consume === 0 && charge.amount > 0 ? "released" : "settled";
  await tx`UPDATE member_credit_charges SET consumed = ${consume}, released = ${release}, state = ${state}, review_reason = NULL,
    evidence = ${tx.json({ ...evidence, actor } as never)}, updated_at = now() WHERE id = ${charge.id}`;
}

export async function settleForRun(tx: Tx, input: { runId: number; outcome: Outcome; evidence?: string }): Promise<void> {
  const [run] = await tx<CreditRunRow[]>`SELECT * FROM operation_runs WHERE id = ${input.runId}`;
  if (!run || creditUserId(run.actor) === null) return;
  const charge = await chargeForRun(tx, run.id, true);
  if (!charge) throw new AccountError(403, "quote_required", "用户任务缺少积分授权");
  if (["settled", "released"].includes(charge.state)) return;
  if (charge.pricing_snapshot.task) {
    await settleTask(tx, charge, input);
    return;
  }
  const facts = await deliveryFacts(tx, charge, run.id);
  const evidence = { runId: run.id, outcome: input.outcome, facts };
  if (input.outcome === "completed" && delivered(charge, facts) && !facts.pendingReceipts && !facts.unknownReceipts && !facts.otherExecutableRuns) {
    await finalizeCharge(tx, charge, charge.amount, "system:member-credits", "任务已完成并保存交付结果", evidence);
    return;
  }
  // A completed provider receipt without a saved delivery can mean a parse or local save failure.
  // Never release that reservation merely because the operation's status says failed.
  if (input.outcome === "failed" && !facts.successTasks && !facts.pendingReceipts && !facts.unknownReceipts && !facts.otherExecutableRuns
      && ((!anyDelivery(facts) && (facts.failedTasks > 0 || facts.receivedReceipts === 0)) ||
        (["assistant-vision", "assistant-turn"].includes(charge.pricing_snapshot.kind) && !delivered(charge, facts) && facts.unavailableVisionReports > 0) ||
        (charge.pricing_snapshot.kind === "assistant-turn" && !delivered(charge, facts) && facts.undeliveredModelResponses > 0))) {
    await finalizeCharge(tx, charge, 0, "system:member-credits", "已确认失败且没有交付，退回占用积分", evidence);
    return;
  }
  const reason = input.outcome === "stopped" ? "任务已停止，积分保留占用，等待核对实际结果"
    : input.outcome === "completed" ? "交付不完整或仍有结果待核对，暂不结算"
    : facts.unknownReceipts || facts.pendingReceipts ? "供应商结果未知或请求仍在处理中，保留积分占用"
    : anyDelivery(facts) || facts.successTasks || facts.receivedReceipts ? "存在部分结果或供应商成功证据，需要核对交付"
    : "任务需要人工核对，保留积分占用";
  await markReview(tx, charge, reason, evidence);
}

/** Child completion records item evidence only; the root coordinates one final ledger mutation. */
async function settleTask(tx: Tx, charge: ChargeRow, input: { runId: number; outcome: Outcome }) {
  const items = await tx`SELECT * FROM member_credit_task_items WHERE charge_id=${charge.id} ORDER BY item_key,unit FOR UPDATE`;
  let consumed = 0, unresolved = false;
  for (const item of items) {
    const ids = [item.run_id,item.recovery_run_id].filter((id): id is number => id !== null);
    if (!ids.length) continue;
    const facts = await deliveryFacts(tx, charge, -1, ids);
    const complete = delivered({ ...charge, pricing_snapshot: item.pricing_snapshot }, facts);
    // A receipt without delivery may require saving its response; never turn that into an automatic refund.
    const uncertain = facts.pendingReceipts > 0 || facts.unknownReceipts > 0 || facts.otherExecutableRuns > 0
      || (!complete && (facts.successTasks > 0 || (facts.receivedReceipts > 0 && facts.failedTasks === 0)));
    const amount = complete && !uncertain ? Number(item.amount) : 0;
    unresolved ||= uncertain;
    consumed += amount;
    await tx`UPDATE member_credit_task_items SET consumed=${uncertain ? null : amount},evidence=${tx.json({ facts, delivered: complete } as never)}
      WHERE charge_id=${charge.id} AND item_key=${item.item_key} AND unit=${item.unit}`;
  }
  const [root] = await tx`SELECT status FROM operation_runs WHERE id=${charge.root_run_id}`;
  if (["active","waiting"].includes(root!.status)) return;
  const facts = await deliveryFacts(tx, charge, -1);
  if (unresolved || facts.pendingReceipts || facts.unknownReceipts || facts.otherExecutableRuns || root!.status === "needs_review") {
    await markReview(tx, charge, root!.status === "stopped" ? "已停止后续执行，费用核对中" : "任务已暂停，费用核对中", { task: true, ...input, facts });
    return;
  }
  await finalizeCharge(tx, charge, consumed, "system:member-credits", "按任务实际交付项目结算，释放未执行额度", { task: true, ...input, facts });
}

/** Manual review never edits historical entries; it appends one final consumption/release. */
export async function reconcileCreditCharge(id: string, raw: unknown, actor: string, rawKey: unknown): Promise<CreditCharge> {
  z.string().uuid().parse(id);
  const input = z.object({ consume: Credits, reason: Reason }).strict().parse(raw);
  const key = CommandKey.parse(rawKey), hash = creditHash({ id, ...input });
  return await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`member-credit-reconcile:${actor}:${key}`}))`;
    const [prior] = await tx`SELECT input_hash, charge_id FROM member_credit_reconciliations WHERE actor = ${actor} AND command_key = ${key}`;
    if (prior) {
      if (prior.input_hash !== hash) throw new AccountError(409, "conflict", "同一幂等标识不能用于不同的核对操作");
      return readCreditCharge(prior.charge_id, tx);
    }
    const [snapshot] = await tx<ChargeRow[]>`SELECT * FROM member_credit_charges WHERE id = ${id}`;
    if (!snapshot) throw new AccountError(404, "not_found", "积分任务不存在");
    // Match the operation lock order. Locking the original also prevents a new recovery link.
    await tx`SELECT id FROM operation_runs WHERE id = ${snapshot.root_run_id} FOR UPDATE`;
    const runs = await tx<CreditRunRow[]>`SELECT r.* FROM operation_runs r JOIN member_credit_authorized_runs l ON l.run_id = r.id WHERE l.charge_id = ${id} ORDER BY r.id FOR UPDATE OF r`;
    const [charge] = await tx<ChargeRow[]>`SELECT * FROM member_credit_charges WHERE id = ${id} FOR UPDATE`;
    if (["settled", "released"].includes(charge!.state)) throw new AccountError(409, "credits_finalized", "该任务已经结算；如需纠错请新增积分调整记录");
    if (input.consume > charge!.amount) throw new AccountError(400, "invalid_request", "结算积分不能超过本次占用");
    if (runs.some(run => ["active", "waiting"].includes(run.status))) throw new AccountError(409, "task_running", "任务仍可执行，请先停止任务并核对在途请求");
    const facts = await deliveryFacts(tx, charge!, snapshot.root_run_id);
    if (facts.pendingReceipts) throw new AccountError(409, "request_pending", "供应商请求仍在处理中，请等待结果确认后再核对");
    await finalizeCharge(tx, charge!, input.consume, actor, input.reason, { manual: true, facts, runIds: runs.map(run => run.id) });
    await tx`INSERT INTO member_credit_reconciliations(actor, command_key, input_hash, charge_id, consumed, released, reason)
      VALUES (${actor}, ${key}, ${hash}, ${id}, ${input.consume}, ${charge!.amount - input.consume}, ${input.reason})`;
    await audit(actor, "credits.reconcile", `credit-charge:${id}`, input.reason, { state: charge!.state, amount: charge!.amount },
      { consumed: input.consume, released: charge!.amount - input.consume, runIds: runs.map(run => run.id) }, undefined, tx);
    return readCreditCharge(id, tx);
  });
}

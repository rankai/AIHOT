import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolAuthorization, ToolCreditIntent } from "@aihot/contracts/credits";
import { sql, type Tx } from "../db.ts";
import { audit } from "../admin/auth.ts";
import { AccountError, UserId } from "./accounts.ts";
import {
  CommandKey, Credits, MAX_CREDITS, QuoteId, Reason, appendCreditEntry, balanceDto, chargeForRun, creditHash, creditUserId,
  lockCreditWallet, parseCreditIntent, requireCreditUser, type CreditRunRow, type QuoteRow,
} from "./credits-core.ts";
import { selectToolPrice } from "./credits-prices.ts";

export type { ToolAuthorization, ToolCreditIntent } from "@aihot/contracts/credits";
export { quoteTool, listToolPrices, saveToolPrice } from "./credits-prices.ts";
export { getCreditPage, listCreditCharges, readRunCredits, readCreditCharge } from "./credits-read.ts";
export { settleForRun, reconcileCreditCharge } from "./credits-settlement.ts";

/** Called inside the existing createRun + queue transaction. Never opens a second transaction. */
export async function reserveForRun(tx: Tx, command: { actor: string; runId: number; authorization?: ToolAuthorization }): Promise<void> {
  const userId = creditUserId(command.actor);
  if (userId === null) return;
  if (!command.authorization) throw new AccountError(403, "quote_required", "请先确认本次任务的积分报价");
  const intent = parseCreditIntent(command.authorization.intent);
  if (command.authorization.taskAllocation) {
    await allocateTaskItem(tx, command.actor, command.runId, command.authorization);
    return;
  }
  const quoteId = QuoteId.parse(command.authorization.quoteId);
  await requireCreditUser(tx, userId, true);
  const [run] = await tx<CreditRunRow[]>`SELECT * FROM operation_runs WHERE id = ${command.runId} AND actor = ${command.actor}`;
  if (!run) throw new AccountError(404, "not_found", "用户任务不存在");
  const [quote] = await tx<QuoteRow[]>`SELECT * FROM member_tool_quotes WHERE id = ${quoteId} AND user_id = ${userId} FOR UPDATE`;
  if (!quote) throw new AccountError(404, "not_found", "积分报价不存在");
  if (quote.input_hash !== creditHash(intent)) throw new AccountError(409, "quote_changed", "工具参数已变化，请重新确认报价");
  if (quote.consumed_run_id !== null) {
    if (quote.consumed_run_id === run.id) return;
    throw new AccountError(409, "quote_used", "该报价已用于另一任务，请查看已提交记录或重新报价");
  }
  if (quote.expires_at.getTime() <= Date.now()) throw new AccountError(409, "quote_expired", "积分报价已过期，请重新确认");
  if (run.provider !== intent.provider) throw new AccountError(409, "quote_changed", "供应商与确认报价不一致");

  if (intent.recoveryRunId !== undefined) {
    if (quote.recovery_run_id !== intent.recoveryRunId) throw new AccountError(409, "conflict", "恢复任务与报价不一致");
    const [original] = await tx<CreditRunRow[]>`SELECT * FROM operation_runs WHERE id = ${intent.recoveryRunId} AND actor = ${command.actor} FOR UPDATE`;
    const charge = original ? await chargeForRun(tx, original.id, true) : null;
    if (!charge || charge.user_id !== userId || charge.root_run_id !== intent.recoveryRunId) throw new AccountError(404, "not_found", "原计费任务不存在");
    if (["settled", "released"].includes(charge.state)) throw new AccountError(409, "credits_finalized", "原任务积分已结算，不能再次执行");
    if (original!.status !== "stopped" && original!.status !== "needs_review") throw new AccountError(409, "conflict", "原任务尚未停止，不能建立恢复任务");
    if (`${charge.pricing_snapshot.kind}/query` !== intent.kind || charge.pricing_snapshot.provider !== intent.provider || charge.pricing_snapshot.model !== (intent.model ?? "")) throw new AccountError(409, "conflict", "恢复任务与原计费任务不匹配");
    const [existing] = await tx`SELECT run_id FROM member_credit_run_links WHERE charge_id = ${charge.id} AND recovery`;
    if (existing) throw new AccountError(409, "conflict", "已经建立恢复任务，请查看已有记录");
    await tx`INSERT INTO member_credit_run_links(run_id, charge_id, recovery) VALUES (${run.id}, ${charge.id}, true)`;
    await tx`UPDATE member_tool_quotes SET consumed_run_id = ${run.id} WHERE id = ${quote.id}`;
    return;
  }

  if (quote.recovery_run_id !== null) throw new AccountError(409, "conflict", "此报价只能用于恢复原任务");
  if (quote.pricing_snapshot.task) {
    for (const item of quote.pricing_snapshot.task.items) {
      const price = await selectToolPrice(tx, item.intent);
      if (price.id !== item.pricing.price.id || price.version !== item.pricing.price.version) throw new AccountError(409, "price_changed", "任务价格已变化，请重新确认报价");
    }
  } else {
    const currentPrice = await selectToolPrice(tx, intent);
    if (currentPrice.id !== quote.price_id || currentPrice.version !== quote.price_version) throw new AccountError(409, "price_changed", "积分价格已变化，请重新确认报价");
  }
  Credits.parse(quote.amount);
  const wallet = await lockCreditWallet(tx, userId);
  if (wallet.available < quote.amount) throw new AccountError(409, "insufficient_credits", "可用积分不足，请联系管理员补充");
  const chargeId = randomUUID();
  await tx`INSERT INTO member_credit_charges(id, user_id, root_run_id, quote_id, amount, pricing_snapshot)
    VALUES (${chargeId}, ${userId}, ${run.id}, ${quote.id}, ${quote.amount}, ${tx.json(quote.pricing_snapshot as never)})`;
  await tx`INSERT INTO member_credit_run_links(run_id, charge_id) VALUES (${run.id}, ${chargeId})`;
  for (const item of quote.pricing_snapshot.task?.items ?? []) {
    for (let unit = 1; unit <= item.units; unit++) await tx`INSERT INTO member_credit_task_items(charge_id,item_key,unit,pricing_snapshot,intent,amount,run_id)
      VALUES (${chargeId},${item.key},${unit},${tx.json(item.pricing as never)},${tx.json(item.intent as never)},${item.amount},${item.intent.kind === "assistant-turn" ? run.id : null})`;
  }
  await appendCreditEntry(tx, wallet, { kind: "reserve", amount: quote.amount, availableDelta: -quote.amount, reservedDelta: quote.amount,
    actor: command.actor, commandKey: `reserve:${run.id}`, inputHash: quote.input_hash, reason: "确认任务报价，预占积分", chargeId, runId: run.id });
  await tx`UPDATE member_tool_quotes SET consumed_run_id = ${run.id} WHERE id = ${quote.id}`;
}


/** An allocation is server-created from a persisted proposal under the parent's execution lock. */
async function allocateTaskItem(tx: Tx, actor: string, runId: number, authorization: ToolAuthorization) {
  const allocation = authorization.taskAllocation!;
  const [parent] = await tx`SELECT r.*,t.id AS turn_id FROM operation_runs r JOIN assistant_turns t ON t.parent_operation_run_id=r.id
    WHERE r.id=${allocation.parentRunId} AND r.actor=${actor} FOR UPDATE OF r`;
  if (!parent || !["active","waiting"].includes(parent.status) || parent.generation !== allocation.generation) throw new AccountError(409,"task_stopped","原任务已停止或授权已变化");
  const charge = await chargeForRun(tx, parent.id, true);
  if (!charge?.pricing_snapshot.task || charge.state !== "reserved" || charge.quote_id !== authorization.quoteId) throw new AccountError(409,"credits_finalized","任务授权不可执行");
  const [call] = await tx`SELECT * FROM assistant_tool_calls WHERE id=${allocation.callId} AND turn_id=${parent.turn_id} FOR UPDATE`;
  const intent = parseCreditIntent(authorization.intent);
  const [child] = await tx`SELECT actor,provider FROM operation_runs WHERE id=${runId}`;
  if (!child || child.actor !== actor || child.provider !== intent.provider) throw new AccountError(409,"task_scope_changed","子任务身份或供应商与授权不一致");
  if (!call || call.child_run_id !== null || !["pending","proposed"].includes(call.state) || creditHash(call.result?.normalized?.intent) !== creditHash(intent)) throw new AccountError(409,"task_scope_changed","子任务不属于本次授权建议");
  const items = await tx`SELECT * FROM member_credit_task_items WHERE charge_id=${charge.id} AND run_id IS NULL ORDER BY item_key,unit FOR UPDATE`;
  const item = items.find(item => {
    const frozen = item.intent as ToolCreditIntent;
    return frozen.kind === intent.kind && frozen.provider === intent.provider && (frozen.model ?? "") === (intent.model ?? "") && (frozen.tier ?? "") === (intent.tier ?? "")
      && (frozen.imageCount ?? 0) === (intent.imageCount ?? 0) && (frozen.videoSeconds ?? 0) === (intent.videoSeconds ?? 0) && (frozen.referenceCount ?? 0) === (intent.referenceCount ?? 0)
      && Object.entries(item.pricing_snapshot.price.parameterMatch).every(([path,value]) => path.split(".").reduce((v:any,k) => v?.[k], intent.input) === value)
      && Object.entries(frozen.input).every(([key,value]) => creditHash(intent.input[key]) === creditHash(value));
  });
  if (!item) throw new AccountError(409,"task_scope_exceeded","该能力、次数或规格不在本次任务冻结范围内，请结束当前任务后重新报价");
  await tx`UPDATE member_credit_task_items SET run_id=${runId} WHERE charge_id=${charge.id} AND item_key=${item.item_key} AND unit=${item.unit}`;
}

/** Shared execution guard: refunded/finalized runs and superseded originals cannot call providers. */
export async function assertRunCredit(tx: Tx, runId: number): Promise<void> {
  const [run] = await tx<{ actor: string }[]>`SELECT actor FROM operation_runs WHERE id = ${runId}`;
  if (!run || creditUserId(run.actor) === null) return;
  const charge = await chargeForRun(tx, runId);
  if (!charge) throw new AccountError(403, "quote_required", "用户任务缺少积分授权");
  if (["settled", "released"].includes(charge.state)) throw new AccountError(409, "credits_finalized", "任务积分已结算或释放，不能继续执行");
  if (charge.root_run_id === runId) {
    const [recovery] = await tx`SELECT run_id FROM member_credit_run_links WHERE charge_id = ${charge.id} AND recovery`;
    if (recovery) throw new AccountError(409, "recovery_active", "原任务已有恢复记录，请从恢复任务继续");
  }
}

/** Explicit manual credits are independently idempotent; negative corrections cannot spend reservations. */
export async function grantCredits(userId: number, raw: unknown, actor: string, rawKey: unknown): Promise<void> {
  UserId.parse(userId);
  const input = z.object({ amount: z.number().int().safe().min(-MAX_CREDITS).max(MAX_CREDITS).refine(n => n !== 0, "调整数额不能为零"),
    kind: z.enum(["grant", "adjustment"]).default("grant"), reason: Reason }).strict()
    .refine(value => value.kind === "adjustment" || value.amount > 0, "发放积分必须为正整数").parse(raw);
  const key = CommandKey.parse(rawKey), hash = creditHash({ userId, ...input });
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`member-credit-command:${actor}:${key}`}))`;
    const [prior] = await tx`SELECT input_hash FROM member_credit_entries WHERE actor = ${actor} AND command_key = ${key}`;
    if (prior) {
      if (prior.input_hash !== hash) throw new AccountError(409, "conflict", "同一幂等标识不能用于不同的积分操作");
      return;
    }
    await requireCreditUser(tx, userId);
    const before = await lockCreditWallet(tx, userId);
    const after = await appendCreditEntry(tx, before, { kind: input.kind, amount: input.amount, availableDelta: input.amount, reservedDelta: 0,
      actor, commandKey: key, inputHash: hash, reason: input.reason });
    await audit(actor, `credits.${input.kind}`, `user:${userId}`, input.reason, balanceDto(before), balanceDto(after), undefined, tx);
  });
}

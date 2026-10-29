import { z } from "zod";
import type { CreditBalance, CreditChargeState, CreditEntryKind, ToolCreditIntent, ToolCreditKind, ToolPrice } from "@aihot/contracts/credits";
import type { Db, Tx } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { AccountError, UserId } from "./accounts.ts";

export const MAX_BALANCE = 1_000_000_000_000;
export const MAX_CREDITS = 1_000_000_000;
export const ToolKinds = ["query", "x-account", "x-tweet", "images", "videos", "ai-search", "transcriptions", "xhs-comments", "media-upload", "images/query", "videos/query", "ai-search/query", "transcriptions/query", "xhs-comments/query"] as const;
export const Kind = z.enum(ToolKinds);
export const Credits = z.number().int().safe().min(0).max(MAX_CREDITS);
export const Reason = z.string().trim().min(2, "请填写操作理由").max(500, "理由最多 500 字");
export const CommandKey = z.string().min(8, "请提供幂等标识").max(160).regex(/^[A-Za-z0-9:._-]+$/, "幂等标识格式不正确");
export const QuoteId = z.string().uuid();

const Intent = z.object({
  kind: Kind, provider: z.string().trim().min(1).max(80), model: z.string().trim().max(160).optional(), tier: z.string().trim().max(160).optional(),
  input: z.record(z.string(), z.unknown()), imageCount: z.number().int().min(0).max(100).optional(),
  videoSeconds: z.number().int().min(0).max(3600).optional(), referenceCount: z.number().int().min(0).max(100).optional(),
  recoveryRunId: UserId.optional(),
}).strict();
export function parseCreditIntent(raw: ToolCreditIntent): ToolCreditIntent {
  const intent = Intent.parse(raw);
  if (stableJson(intent).length > 100_000) throw new AccountError(400, "invalid_request", "工具输入过长");
  return intent;
}
export const creditHash = (input: unknown) => sha256(stableJson(input));
export const isRecoveryKind = (kind: string) => kind.endsWith("/query");
export function creditUserId(actor: string): number | null {
  if (!actor.startsWith("user:")) return null;
  const id = Number(actor.slice(5));
  if (!/^user:[1-9][0-9]*$/.test(actor) || !Number.isSafeInteger(id)) throw new AccountError(403, "forbidden", "用户身份无效");
  return id;
}

export interface CreditWallet { user_id: number; available: number; reserved: number }
export const balanceDto = (wallet: CreditWallet): CreditBalance => ({ userId: wallet.user_id, available: wallet.available, reserved: wallet.reserved });
export async function requireCreditUser(db: Db, userId: number, active = false): Promise<void> {
  const [user] = await db`SELECT status FROM site_users WHERE id = ${UserId.parse(userId)} FOR SHARE`;
  if (!user) throw new AccountError(404, "not_found", "用户不存在");
  if (active && user.status !== "active") throw new AccountError(403, "forbidden", "账号已停用");
}
export async function lockCreditWallet(tx: Tx, userId: number): Promise<CreditWallet> {
  await tx`INSERT INTO member_credit_accounts(user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  const [row] = await tx<CreditWallet[]>`SELECT user_id, available, reserved FROM member_credit_accounts WHERE user_id = ${userId} FOR UPDATE`;
  return row!;
}
export async function appendCreditEntry(tx: Tx, wallet: CreditWallet, entry: {
  kind: CreditEntryKind; amount: number; availableDelta: number; reservedDelta: number;
  actor: string; commandKey: string; inputHash: string; reason: string; chargeId?: string; runId?: number;
}): Promise<CreditWallet> {
  const available = wallet.available + entry.availableDelta, reserved = wallet.reserved + entry.reservedDelta;
  if (![available, reserved].every(value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_BALANCE)) {
    throw new AccountError(409, "insufficient_credits", available < 0 ? "可用积分不足，请联系管理员补充" : "积分余额超出允许范围");
  }
  await tx`UPDATE member_credit_accounts SET available = ${available}, reserved = ${reserved}, updated_at = now() WHERE user_id = ${wallet.user_id}`;
  await tx`INSERT INTO member_credit_entries(user_id, kind, amount, available_delta, reserved_delta, available_after, reserved_after,
    charge_id, run_id, actor, command_key, input_hash, reason)
    VALUES (${wallet.user_id}, ${entry.kind}, ${entry.amount}, ${entry.availableDelta}, ${entry.reservedDelta}, ${available}, ${reserved},
      ${entry.chargeId ?? null}, ${entry.runId ?? null}, ${entry.actor}, ${entry.commandKey}, ${entry.inputHash}, ${entry.reason})`;
  return { user_id: wallet.user_id, available, reserved };
}

export interface PricingSnapshot {
  kind: ToolCreditKind; provider: string; model: string; tier: string;
  imageCount: number; videoSeconds: number; referenceCount: number; price: ToolPrice;
}
export interface ChargeRow {
  id: string; user_id: number; root_run_id: number; quote_id: string; amount: number; consumed: number; released: number;
  state: CreditChargeState; pricing_snapshot: PricingSnapshot; review_reason: string | null; evidence: Record<string, unknown>;
  created_at: Date; updated_at: Date;
}
export interface QuoteRow {
  id: string; user_id: number; price_id: string | null; price_version: number; input_hash: string; amount: number;
  pricing_snapshot: PricingSnapshot; recovery_run_id: number | null; consumed_run_id: number | null; created_at: Date; expires_at: Date;
}
export interface CreditRunRow {
  id: number; actor: string; provider: string; status: string; current_receipt_id: number | null; step_key: string;
  input: Record<string, unknown>; progress: Record<string, unknown>;
}
export async function chargeForRun(db: Db, runId: number, lock = false): Promise<ChargeRow | null> {
  const rows = lock
    ? await db<ChargeRow[]>`SELECT c.* FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id = c.id WHERE l.run_id = ${runId} FOR UPDATE OF c`
    : await db<ChargeRow[]>`SELECT c.* FROM member_credit_charges c JOIN member_credit_run_links l ON l.charge_id = c.id WHERE l.run_id = ${runId}`;
  return rows[0] ?? null;
}

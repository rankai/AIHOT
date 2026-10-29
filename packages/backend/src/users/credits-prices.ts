import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolCreditIntent, ToolPrice, ToolQuote } from "@aihot/contracts/credits";
import { sql, type Db } from "../db.ts";
import { audit } from "../admin/auth.ts";
import { AccountError, UserId } from "./accounts.ts";
import { Credits, Kind, Reason, chargeForRun, creditHash, isRecoveryKind, parseCreditIntent, requireCreditUser, type PricingSnapshot, type CreditRunRow } from "./credits-core.ts";

interface PriceRow {
  id: string; kind: ToolPrice["kind"]; provider: string; model: string; tier: string; parameter_match: ToolPrice["parameterMatch"];
  base_credits: number; image_credits: number; video_second_credits: number; reference_credits: number; enabled: boolean; version: number; updated_at: Date;
}
const ParameterMatch = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,3}$/), z.union([z.string().max(160), z.number().finite(), z.boolean()]))
  .refine(value => Object.keys(value).length <= 12 && !Object.keys(value).some(key => key.split(".").some(segment => ["__proto__", "prototype", "constructor"].includes(segment))), "参数条件最多 12 项，且不能使用保留字段");
const PriceInput = z.object({
  id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(), kind: Kind.refine(kind => !isRecoveryKind(kind), "恢复任务沿用原计费任务，无需单独定价"),
  provider: z.string().trim().min(1).max(80), model: z.string().trim().max(160).default(""), tier: z.string().trim().max(160).default(""),
  parameterMatch: ParameterMatch.default({}), baseCredits: Credits, imageCredits: Credits.default(0), videoSecondCredits: Credits.default(0), referenceCredits: Credits.default(0),
  enabled: z.boolean(), reason: Reason,
}).strict().refine(input => !input.id || input.expectedVersion !== undefined, "修改价格时需要版本号");

export function toolPriceDto(row: PriceRow): ToolPrice {
  return { id: row.id, kind: row.kind, provider: row.provider, model: row.model, tier: row.tier, parameterMatch: row.parameter_match,
    baseCredits: row.base_credits, imageCredits: row.image_credits, videoSecondCredits: row.video_second_credits, referenceCredits: row.reference_credits,
    enabled: row.enabled, version: row.version, updatedAt: row.updated_at.toISOString() };
}

export async function listToolPrices(raw: unknown = {}): Promise<{ prices: ToolPrice[] }> {
  const query = z.object({ kind: Kind.optional(), provider: z.string().max(80).optional() }).parse(raw);
  const rows = await sql<PriceRow[]>`SELECT * FROM member_tool_prices
    WHERE (${query.kind ?? null}::text IS NULL OR kind = ${query.kind ?? null})
      AND (${query.provider ?? null}::text IS NULL OR provider = ${query.provider ?? null}) ORDER BY kind, provider, model, tier, id LIMIT 1000`;
  return { prices: rows.map(toolPriceDto) };
}

export async function saveToolPrice(raw: unknown, actor: string): Promise<ToolPrice> {
  const input = PriceInput.parse(raw);
  try {
    return await sql.begin(async tx => {
      let before: PriceRow | undefined;
      if (input.id) {
        [before] = await tx<PriceRow[]>`SELECT * FROM member_tool_prices WHERE id = ${input.id} FOR UPDATE`;
        if (!before) throw new AccountError(404, "not_found", "积分价格不存在");
        if (before.version !== input.expectedVersion) throw new AccountError(409, "conflict", "价格已被修改，请刷新后重试");
      }
      const id = input.id ?? randomUUID();
      const [row] = before
        ? await tx<PriceRow[]>`UPDATE member_tool_prices SET kind = ${input.kind}, provider = ${input.provider}, model = ${input.model}, tier = ${input.tier},
            parameter_match = ${tx.json(input.parameterMatch)}, base_credits = ${input.baseCredits}, image_credits = ${input.imageCredits},
            video_second_credits = ${input.videoSecondCredits}, reference_credits = ${input.referenceCredits}, enabled = ${input.enabled}, version = version + 1, updated_at = now()
          WHERE id = ${id} RETURNING *`
        : await tx<PriceRow[]>`INSERT INTO member_tool_prices(id, kind, provider, model, tier, parameter_match, base_credits, image_credits, video_second_credits, reference_credits, enabled)
          VALUES (${id}, ${input.kind}, ${input.provider}, ${input.model}, ${input.tier}, ${tx.json(input.parameterMatch)}, ${input.baseCredits}, ${input.imageCredits}, ${input.videoSecondCredits}, ${input.referenceCredits}, ${input.enabled}) RETURNING *`;
      const price = toolPriceDto(row!);
      await audit(actor, "credits.price.update", `tool-price:${id}`, input.reason, before ? toolPriceDto(before) : null, price, undefined, tx);
      return price;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new AccountError(409, "conflict", "该工具和参数条件已有价格，请编辑现有条目");
    throw error;
  }
}

export function priceMatches(price: ToolPrice, input: Record<string, unknown>): boolean {
  return Object.entries(price.parameterMatch).every(([path, expected]) => {
    let current: unknown = input;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return false;
      current = (current as Record<string, unknown>)[part];
    }
    return current === expected;
  });
}

export async function selectToolPrice(db: Db, intent: ToolCreditIntent): Promise<ToolPrice> {
  const rows = await db<PriceRow[]>`SELECT * FROM member_tool_prices WHERE enabled AND kind = ${intent.kind}
    AND provider = ${intent.provider} AND model = ${intent.model ?? ""} AND tier = ${intent.tier ?? ""} FOR SHARE`;
  const matches = rows.map(toolPriceDto).filter(price => priceMatches(price, intent.input)).sort((a, b) => Object.keys(b.parameterMatch).length - Object.keys(a.parameterMatch).length);
  if (!matches.length) throw new AccountError(409, "tool_unpriced", "该工具参数尚未设置积分价格，请联系管理员");
  if (matches[1] && Object.keys(matches[0]!.parameterMatch).length === Object.keys(matches[1].parameterMatch).length) throw new AccountError(409, "price_ambiguous", "该工具的积分档位有冲突，请联系管理员核对");
  return matches[0]!;
}

/** Pricing receives the same validated/normalized server intent used for submission. */
export async function quoteTool(userId: number, raw: ToolCreditIntent): Promise<ToolQuote> {
  UserId.parse(userId);
  const intent = parseCreditIntent(raw);
  return await sql.begin(async tx => {
    await requireCreditUser(tx, userId, true);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`member-credit-quotes:${userId}`}))`;
    await tx`DELETE FROM member_tool_quotes WHERE user_id = ${userId} AND consumed_run_id IS NULL AND expires_at <= now()`;
    // Quotes have no financial side effects, but a member must not accumulate unlimited pending rows.
    const [counts] = await tx`SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute') AS recent,
      count(*) FILTER (WHERE consumed_run_id IS NULL) AS pending FROM member_tool_quotes WHERE user_id = ${userId}`;
    if (Number(counts!.recent) >= 30 || Number(counts!.pending) >= 100) throw new AccountError(429, "quote_rate_limited", "报价请求较多，请稍后再试");
    let snapshot: PricingSnapshot;
    let amount: number;
    let priceId: string | null;
    let priceVersion: number;
    if (intent.recoveryRunId !== undefined) {
      if (!isRecoveryKind(intent.kind)) throw new AccountError(400, "invalid_request", "恢复任务类型不正确");
      const [run] = await tx<CreditRunRow[]>`SELECT * FROM operation_runs WHERE id = ${intent.recoveryRunId} AND actor = ${`user:${userId}`}`;
      const charge = run ? await chargeForRun(tx, run.id) : null;
      if (!run || !charge || charge.user_id !== userId || charge.root_run_id !== run.id) throw new AccountError(404, "not_found", "原计费任务不存在");
      if (["settled", "released"].includes(charge.state)) throw new AccountError(409, "credits_finalized", "原任务积分已结算或释放，不能再次执行");
      if (charge.pricing_snapshot.kind !== intent.kind.slice(0, -6) || charge.pricing_snapshot.provider !== intent.provider || charge.pricing_snapshot.model !== (intent.model ?? "")) throw new AccountError(409, "conflict", "恢复任务与原计费任务不匹配");
      const [recovery] = await tx`SELECT run_id FROM member_credit_run_links WHERE charge_id = ${charge.id} AND recovery`;
      if (recovery) throw new AccountError(409, "conflict", "该任务已建立恢复记录，请查看已有恢复任务");
      snapshot = charge.pricing_snapshot; amount = 0; priceId = null; priceVersion = snapshot.price.version;
    } else {
      if (isRecoveryKind(intent.kind)) throw new AccountError(400, "invalid_request", "查询已有任务必须提供原任务");
      const price = await selectToolPrice(tx, intent);
      const imageCount = intent.imageCount ?? 0, videoSeconds = intent.videoSeconds ?? 0, referenceCount = intent.referenceCount ?? 0;
      amount = Credits.parse(price.baseCredits + imageCount * price.imageCredits + videoSeconds * price.videoSecondCredits + referenceCount * price.referenceCredits);
      snapshot = { kind: intent.kind, provider: intent.provider, model: intent.model ?? "", tier: intent.tier ?? "", imageCount, videoSeconds, referenceCount, price };
      priceId = price.id; priceVersion = price.version;
    }
    const quoteId = randomUUID(), expiresAt = new Date(Date.now() + 10 * 60_000);
    await tx`INSERT INTO member_tool_quotes(id, user_id, price_id, price_version, input_hash, amount, pricing_snapshot, recovery_run_id, expires_at)
      VALUES (${quoteId}, ${userId}, ${priceId}, ${priceVersion}, ${creditHash(intent)}, ${amount}, ${tx.json(snapshot as never)}, ${intent.recoveryRunId ?? null}, ${expiresAt})`;
    const [wallet] = await tx`SELECT available FROM member_credit_accounts WHERE user_id = ${userId}`;
    const available = Number(wallet?.available ?? 0);
    return { quoteId, amount, expiresAt: expiresAt.toISOString(), priceVersion, priceId, available, affordable: available >= amount, recoveryOfRunId: intent.recoveryRunId ?? null };
  });
}

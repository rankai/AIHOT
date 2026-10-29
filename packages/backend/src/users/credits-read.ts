import { z } from "zod";
import type { CreditCharge, CreditChargePage, CreditEntry, CreditPage } from "@aihot/contracts/credits";
import { sql, type Db } from "../db.ts";
import { AccountError, UserId } from "./accounts.ts";
import { balanceDto, requireCreditUser, type ChargeRow, type CreditWallet } from "./credits-core.ts";

const PageQuery = z.object({ before: z.coerce.number().int().safe().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
export async function getCreditPage(userId: number, raw: unknown = {}): Promise<CreditPage> {
  const query = PageQuery.parse(raw);
  return await sql.begin("isolation level repeatable read read only", async tx => {
    // A read-only snapshot keeps the balance and its ledger page from describing different commits.
    const [user] = await tx`SELECT id FROM site_users WHERE id = ${UserId.parse(userId)}`;
    if (!user) throw new AccountError(404, "not_found", "用户不存在");
    const [wallet] = await tx<CreditWallet[]>`SELECT user_id, available, reserved FROM member_credit_accounts WHERE user_id = ${userId}`;
    const rows = await tx`SELECT id, kind, amount, available_delta, reserved_delta, available_after, reserved_after, run_id, reason, created_at
      FROM member_credit_entries WHERE user_id = ${userId} AND (${query.before ?? null}::bigint IS NULL OR id < ${query.before ?? null}) ORDER BY id DESC LIMIT ${query.limit + 1}`;
    const entries = rows.slice(0, query.limit).map(row => ({ id: row.id, kind: row.kind, amount: row.amount, availableDelta: row.available_delta,
      reservedDelta: row.reserved_delta, availableAfter: row.available_after, reservedAfter: row.reserved_after, runId: row.run_id,
      reason: row.reason, createdAt: row.created_at.toISOString() } as CreditEntry));
    return { balance: balanceDto(wallet ?? { user_id: userId, available: 0, reserved: 0 }), entries, nextCursor: rows.length > query.limit ? entries.at(-1)!.id : null };
  });
}

interface ChargeView extends ChargeRow { username: string; display_name: string; run_status: string; recovery_run_id: number | null; run_wait_reason: string | null }
function chargeDto(row: ChargeView): CreditCharge {
  return { id: row.id, userId: row.user_id, username: row.username, displayName: row.display_name, runId: row.root_run_id, recoveryRunId: row.recovery_run_id,
    kind: row.pricing_snapshot.kind, provider: row.pricing_snapshot.provider, model: row.pricing_snapshot.model, tier: row.pricing_snapshot.tier,
    amount: row.amount, consumed: row.consumed, released: row.released, state: row.state, reviewReason: row.review_reason ?? row.run_wait_reason,
    runStatus: row.run_status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

export async function readCreditCharge(id: string, db: Db = sql): Promise<CreditCharge> {
  z.string().uuid().parse(id);
  const [row] = await db<ChargeView[]>`SELECT c.*, u.username, u.display_name, r.status AS run_status, r.wait_reason AS run_wait_reason,
      (SELECT run_id FROM member_credit_run_links l WHERE l.charge_id = c.id AND l.recovery) AS recovery_run_id
    FROM member_credit_charges c JOIN site_users u ON u.id = c.user_id JOIN operation_runs r ON r.id = c.root_run_id WHERE c.id = ${id}`;
  if (!row) throw new AccountError(404, "not_found", "积分任务不存在");
  return chargeDto(row);
}

export async function listCreditCharges(raw: unknown = {}): Promise<CreditChargePage> {
  const query = z.object({ state: z.enum(["reserved", "review", "settled", "released", "pending"]).default("review"),
    before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(20),
    userId: z.coerce.number().int().safe().positive().optional() }).parse(raw);
  const rows = await sql<ChargeView[]>`SELECT c.*, u.username, u.display_name, r.status AS run_status, r.wait_reason AS run_wait_reason,
      (SELECT run_id FROM member_credit_run_links l WHERE l.charge_id = c.id AND l.recovery) AS recovery_run_id
    FROM member_credit_charges c JOIN site_users u ON u.id = c.user_id JOIN operation_runs r ON r.id = c.root_run_id
    WHERE (${query.userId ?? null}::bigint IS NULL OR c.user_id = ${query.userId ?? null})
      AND (${query.before ?? null}::uuid IS NULL OR (c.created_at, c.id) < (SELECT created_at, id FROM member_credit_charges WHERE id = ${query.before ?? null}))
      AND (c.state = ${query.state}
        OR (${query.state} = 'pending' AND c.state IN ('reserved','review'))
        OR (${query.state} = 'review' AND c.state = 'reserved' AND (c.created_at < now() - interval '24 hours' OR EXISTS (
          SELECT 1 FROM member_credit_run_links l JOIN operation_runs review_run ON review_run.id = l.run_id WHERE l.charge_id = c.id AND review_run.status IN ('needs_review','stopped','failed')
        ))))
    ORDER BY c.created_at DESC, c.id DESC LIMIT ${query.limit + 1}`;
  const charges = rows.slice(0, query.limit).map(chargeDto);
  return { charges, nextCursor: rows.length > query.limit ? charges.at(-1)!.id : null };
}

/** Small owner-scoped projection for the user's task details. */
export async function readRunCredits(userId: number, runId: number): Promise<Pick<CreditCharge, "amount" | "state" | "consumed" | "released"> | null> {
  UserId.parse(userId); UserId.parse(runId);
  const [row] = await sql`SELECT c.amount, c.state, c.consumed, c.released FROM member_credit_charges c
    JOIN member_credit_run_links l ON l.charge_id = c.id JOIN operation_runs r ON r.id = l.run_id
    WHERE l.run_id = ${runId} AND c.user_id = ${userId} AND r.actor = ${`user:${userId}`}`;
  return row ? { amount: row.amount, state: row.state, consumed: row.consumed, released: row.released } : null;
}

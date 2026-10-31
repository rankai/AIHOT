import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MembershipPage, MembershipPayment, MembershipPlan } from '@aihot/contracts/membership';
import { sql, type Db } from '../db.ts';
import { audit } from '../admin/auth.ts';
import { AccountError, UserId } from './accounts.ts';
import { CommandKey, Reason, appendCreditEntry, creditHash, lockCreditWallet, requireCreditUser } from './credits-core.ts';

export const membershipPlans: MembershipPlan[] = [
 { id: 'basic', name: '基础', amountFen: 9900, credits: 10000 },
 { id: 'creator', name: '创作', amountFen: 29900, credits: 33000 },
 { id: 'studio', name: '工作室', amountFen: 69900, credits: 80000 },
];
/** A calendar month in the site's Asia/Shanghai timezone, clamped at month end. */
export function nextMembershipMonth(date: Date): Date {
 const local = new Date(date.getTime() + 8 * 3600000);
 const day = local.getUTCDate();
 local.setUTCDate(1); local.setUTCMonth(local.getUTCMonth() + 1);
 const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
 local.setUTCDate(Math.min(day, last));
 return new Date(local.getTime() - 8 * 3600000);
}
function paymentDto(row: Record<string, any>): MembershipPayment {
 return { id: row.id, planId: row.plan_id, amountFen: row.amount_fen, credits: row.credits, receiptReference: row.receipt_reference,
 reason: row.reason, periodStart: row.period_start.toISOString(), periodEnd: row.period_end.toISOString(), createdAt: row.created_at.toISOString() };
}
export async function getMembership(userId: number, db: Db = sql): Promise<MembershipPage> {
 UserId.parse(userId);
 const [row] = await db`SELECT *, expires_at > now() AS active FROM member_memberships WHERE user_id=${userId}`;
 const payments = await db`SELECT * FROM member_membership_payments WHERE user_id=${userId} ORDER BY created_at DESC,id DESC LIMIT 100`;
 return { plans: membershipPlans, membership: row ? { planId: row.plan_id, startsAt: row.starts_at.toISOString(), expiresAt: row.expires_at.toISOString(), status: row.active ? 'active' : 'expired' } : null, payments: payments.map(paymentDto) };
}
export async function confirmMembershipPayment(userId: number, raw: unknown, actor: string, rawKey: unknown): Promise<MembershipPayment> {
 UserId.parse(userId);
 const input = z.object({ planId: z.enum(['basic','creator','studio']), received: z.literal(true), receiptReference: z.string().trim().min(3).max(160), reason: Reason }).strict().parse(raw);
 const key = CommandKey.parse(rawKey), hash = creditHash({ userId, ...input });
 const plan = membershipPlans.find(plan => plan.id === input.planId)!;
 return sql.begin(async tx => {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`membership-command:${actor}:${key}`}))`;
  const [prior] = await tx`SELECT * FROM member_membership_payments WHERE actor=${actor} AND command_key=${key}`;
  if (prior) {
   if (prior.input_hash !== hash) throw new AccountError(409,'conflict','同一幂等标识不能用于不同收款操作');
   return paymentDto(prior);
  }
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`membership-receipt:${input.receiptReference}`}))`;
  const [duplicate] = await tx`SELECT id FROM member_membership_payments WHERE receipt_reference=${input.receiptReference}`;
  if (duplicate) throw new AccountError(409,'conflict','该收款编号已确认，不可重复发放');
  await requireCreditUser(tx,userId,true);
  const wallet = await lockCreditWallet(tx,userId);
  const [current] = await tx`SELECT * FROM member_memberships WHERE user_id=${userId} FOR UPDATE`;
  const [clock] = await tx`SELECT clock_timestamp() AS now`;
  const now: Date = clock!.now;
  const active = current && current.expires_at > now;
  if (active && current.plan_id !== plan.id) throw new AccountError(409,'conflict','会员有效期内只能续费原套餐，换档请在到期后办理');
  const start: Date = active ? current.expires_at : now, end = nextMembershipMonth(start), id = randomUUID();
  const [payment] = await tx`INSERT INTO member_membership_payments(id,user_id,plan_id,amount_fen,credits,receipt_reference,reason,period_start,period_end,actor,command_key,input_hash)
   VALUES (${id},${userId},${plan.id},${plan.amountFen},${plan.credits},${input.receiptReference},${input.reason},${start},${end},${actor},${key},${hash}) RETURNING *`;
  await tx`INSERT INTO member_memberships(user_id,plan_id,starts_at,expires_at) VALUES (${userId},${plan.id},${now},${end})
   ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id, starts_at=${active ? current.starts_at : now},expires_at=EXCLUDED.expires_at`;
  await appendCreditEntry(tx,wallet,{ kind:'grant',amount:plan.credits,availableDelta:plan.credits,reservedDelta:0,actor,commandKey:`membership:${id}`,inputHash:hash,reason:`${plan.name}月费套餐：${input.reason}` });
  const result = paymentDto(payment!);
  await audit(actor,'membership.payment.confirm',`user:${userId}`,input.reason,null,result,undefined,tx);
  return result;
 });
}

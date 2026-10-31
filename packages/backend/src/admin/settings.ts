import { z } from 'zod';
import type { BudgetScope } from '../providers/receipts.ts';
// Operator settings: about-page QR codes (replaced without a release), notification targets
// (switching a group on records enabled_at so older content is never back-filled) and per-service
// request budgets (the circuit breaker paid calls check before sending).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { loadContact, type ContactSettings } from "../site/contact.ts";
import { audit } from "./auth.ts";

const MAX_QR_BYTES = 2 * 1024 * 1024;

export async function replaceContactQr(input: { slot: keyof ContactSettings; data: Buffer }, actor: string) {
  if (input.slot !== "wechatQr" && input.slot !== "feishuQr") throw new Error("unknown slot");
  if (input.data.length > MAX_QR_BYTES) throw new Error("二维码图片最大 2MB");
  const meta = await sharp(input.data).metadata().catch(() => null);
  if (!meta || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new Error("需要 PNG、JPG 或 WebP 图片");
  if ((meta.width ?? 0) < 120 || (meta.height ?? 0) < 120) throw new Error("图片太小，二维码可能扫不出来");
  const ext = meta.format === "jpeg" ? "jpg" : meta.format!;
  const name = `qr-${input.slot === "wechatQr" ? "wechat" : "feishu"}-${sha256(input.data).slice(0, 8)}.${ext}`;
  const dir = path.join(config.dataDir, "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), input.data);
  const before = await loadContact();
  const next = { ...before, [input.slot]: `/contact/${name}` };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('contact_qr', ${sql.json(next)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.contact_qr", "settings:contact_qr", null, { [input.slot]: before[input.slot] }, { [input.slot]: next[input.slot] });
  return next;
}

export async function listTargets() {
  return sql`
    SELECT t.key, t.purpose, t.kind, t.enabled, t.enabled_at, t.config_ref, t.note, t.updated_at,
           (SELECT count(*)::int FROM deliveries d WHERE d.target_key = t.key AND d.created_at > now() - interval '7 days') AS deliveries_7d,
           (SELECT max(d.sent_at) FROM deliveries d WHERE d.target_key = t.key) AS last_sent_at
    FROM notify_targets t ORDER BY t.purpose, t.key`;
}

export async function setTargetEnabled(key: string, enabled: boolean, reason: string, actor: string) {
  if (!reason?.trim()) throw new Error("reason is required");
  const [before] = await sql`SELECT enabled, enabled_at FROM notify_targets WHERE key = ${key}`;
  if (!before) return null;
  const [after] = await sql`
    UPDATE notify_targets SET enabled = ${enabled}, enabled_at = CASE WHEN ${enabled} AND NOT enabled THEN now() ELSE enabled_at END, updated_at = now()
    WHERE key = ${key} RETURNING key, enabled, enabled_at`;
  await audit(actor, enabled ? "notify.enable" : "notify.disable", `notify-target:${key}`, reason, before, after);
  return { ...after, pushEnabledHere: config.feishuContentPushEnabled };
}

export async function listBudgets() {
  return sql`
    SELECT b.service, b.per_minute, b.per_hour, b.per_day, b.note, b.updated_at,
           (SELECT count(*)::int FROM receipt_attempts a WHERE a.service = b.service AND a.origin = 'live' AND a.started_at > now() - interval '1 day') AS used_day,
           (SELECT count(*)::int FROM receipt_attempts a WHERE a.service = b.service AND a.origin = 'live' AND a.started_at > now() - interval '1 hour') AS used_hour
    FROM budgets b ORDER BY b.service`;
}

const BudgetInput=z.object({perMinute:z.number().int().min(0).max(2147483647),perHour:z.number().int().min(0).max(2147483647),perDay:z.number().int().min(0).max(2147483647),reason:z.string().trim().min(2).max(500)}).strict();
const BudgetService=z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/);
export async function listBudgetScopes() {
 return sql`SELECT b.service,s.scope,COALESCE(c.per_minute,0) AS per_minute,COALESCE(c.per_hour,0) AS per_hour,COALESCE(c.per_day,0) AS per_day,
  c.note,COALESCE(c.updated_at,b.updated_at) AS updated_at,
  (SELECT count(*)::int FROM receipt_attempts a WHERE a.service=b.service AND a.budget_scope=s.scope AND a.origin='live' AND a.started_at>now()-interval '1 hour') AS used_hour,
  (SELECT count(*)::int FROM receipt_attempts a WHERE a.service=b.service AND a.budget_scope=s.scope AND a.origin='live' AND a.started_at>now()-interval '1 day') AS used_day
 FROM budgets b CROSS JOIN (VALUES ('member'),('admin')) AS s(scope) LEFT JOIN budget_scopes c ON c.service=b.service AND c.scope=s.scope
 WHERE b.service LIKE 'redfox.%' OR b.service LIKE 'agentkey.%' OR b.service LIKE 'aliyun.wan.%' ORDER BY b.service,s.scope`;
}
export async function updateBudget(service: string, raw: unknown, actor: string) {
 return saveBudget(service,raw,actor,null);
}
export async function updateBudgetScope(service: string, scope: unknown, raw: unknown, actor: string) {
 return saveBudget(service,raw,actor,z.enum(['member','admin']).parse(scope));
}
async function saveBudget(service: string, raw: unknown, actor: string, scope: BudgetScope | null) {
 BudgetService.parse(service);const input=BudgetInput.parse(raw);
 return sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${"budget:"+service}))`;
  if(scope){
   const [parent]=await tx`SELECT service FROM budgets WHERE service=${service}`;
   if(!parent)throw Object.assign(new Error('请先配置服务的全站预算'),{code:'conflict'});
   const [before]=await tx`SELECT per_minute,per_hour,per_day FROM budget_scopes WHERE service=${service} AND scope=${scope}`;
   const [after]=await tx`INSERT INTO budget_scopes(service,scope,per_minute,per_hour,per_day,note) VALUES (${service},${scope},${input.perMinute},${input.perHour},${input.perDay},${input.reason})
    ON CONFLICT(service,scope) DO UPDATE SET per_minute=EXCLUDED.per_minute,per_hour=EXCLUDED.per_hour,per_day=EXCLUDED.per_day,note=EXCLUDED.note,updated_at=now() RETURNING service,scope,per_minute,per_hour,per_day`;
   await audit(actor,'budget.scope.update',`budget:${service}:${scope}`,input.reason,before??null,after,undefined,tx);return after;
  }
  const [before]=await tx`SELECT per_minute,per_hour,per_day FROM budgets WHERE service=${service}`;
  const [after]=await tx`INSERT INTO budgets(service,per_minute,per_hour,per_day,note) VALUES (${service},${input.perMinute},${input.perHour},${input.perDay},${input.reason})
   ON CONFLICT(service) DO UPDATE SET per_minute=EXCLUDED.per_minute,per_hour=EXCLUDED.per_hour,per_day=EXCLUDED.per_day,note=EXCLUDED.note,updated_at=now() RETURNING service,per_minute,per_hour,per_day`;
  await audit(actor,'budget.update',`budget:${service}`,input.reason,before??null,after,undefined,tx);return after;
 });
}

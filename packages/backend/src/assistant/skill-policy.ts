import { z } from "zod";
import { sql, type Db, type Tx } from "../db.ts";
import { audit } from "../admin/auth.ts";
import { AccountError } from "../users/accounts.ts";
import { selectToolPrice } from "../users/credits-prices.ts";
import { assertMemberCostEligible } from "../users/member-pricing.ts";
import { checkBudget, BudgetExceededError } from "../providers/receipts.ts";
import { assertRedfoxAvailable, redfoxBaseUrl, RedfoxDisabledError } from "../providers/redfox/client.ts";
import { parseSynchronousQuery } from "../providers/redfox/synchronous.ts";
import { requireAvailable } from "./config.ts";
import { actions, candidates, catalog, currentSkillVersions, skillNames, profile, registeredSkillIds, resolveCandidate, type Candidate } from "./catalog.ts";
import type { AssistantId, AssistantTaskHint, AssistantSkillAdminRow } from "@aihot/contracts/assistant";

const Policy = z.object({ acceptingNew: z.boolean(), revision: z.number().int().safe().nonnegative() }).strict();
const keyOf = (id: string) => `assistant.skills.${id}`;
const unavailable = (message: string) => new AccountError(409, "skill_unavailable", message);
function registered(id: string) {
  if (!registeredSkillIds.includes(id)) throw new AccountError(404, "not_found", "技能不存在");
}
/** Every writer and admission takes these locks in the same order, including absent settings. */
export async function lockSkillPolicies(tx: Tx, ids: readonly string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return;
  for (const id of sorted) {
    registered(id);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`assistant-skill:${id}`}))`;
  }
  await tx`SELECT key FROM settings WHERE key IN ${tx(sorted.map(keyOf))} ORDER BY key FOR UPDATE`;
}
export async function readSkillPolicies(db: Db = sql) {
  const rows = await db`SELECT key,value,updated_at,updated_by FROM settings WHERE key IN ${db(registeredSkillIds.map(keyOf))}`;
  return registeredSkillIds.map(skillId => {
    const row = rows.find(r => r.key === keyOf(skillId));
    const parsed = Policy.safeParse(row?.value ?? { acceptingNew: false, revision: 0 });
    return { skillId, acceptingNew: parsed.success && parsed.data.acceptingNew,
      revision: parsed.success ? parsed.data.revision : 0,
      reason: parsed.success ? null : "技能运营配置无效，请管理员核对",
      updatedAt: row?.updated_at?.toISOString() ?? null, updatedBy: row?.updated_by ?? null };
  });
}
export interface SkillAdmission {
  version: 1;
  candidates: Candidate[];
  policies: { skillId: string; acceptingNew: boolean; revision: number }[];
  unavailableSkills: { skillId: string; actions: string[]; reason: string }[];
}
/** Snapshot policy only: transient budget/model health must not change quote identity. */
export async function skillAdmission(db: Db, id: AssistantId, selection?: AssistantTaskHint | null, lock = false): Promise<SkillAdmission> {
  const selected = selection ? actions.find(a => a.actionId === selection.actionId) : null;
  const ids = selected ? profile(id).skills.filter(skillId => skillId === selected.skillId) : profile(id).skills;
  if (lock) await lockSkillPolicies(db as Tx, ids);
  const policies = (await readSkillPolicies(db)).filter(p => (ids as readonly string[]).includes(p.skillId));
  const allowed = (await candidates(id, selection)).filter(c => policies.some(p => p.skillId === c.skillId && p.acceptingNew && !p.reason));
  if (!allowed.length) throw unavailable("所选技能已暂停新任务或配置无效；已开始的任务可继续");
  return { version: 1, candidates: allowed,
    policies: policies.map(({ skillId, acceptingNew, revision }) => ({ skillId, acceptingNew, revision })),
    unavailableSkills: policies.filter(p => !p.acceptingNew || p.reason).map(p => ({ skillId: p.skillId,
      actions: actions.filter(a => a.skillId === p.skillId).map(a => a.label), reason: p.reason ?? "已暂停新任务" })) };
}
const CandidateSchema = z.object({ skillId: z.string(), version: z.string(), packageHash: z.string(), moduleId: z.string(), moduleVersion: z.string(), moduleHash: z.string(), description: z.string() }).strict();
const Admission = z.object({ version: z.literal(1), candidates: z.array(CandidateSchema).min(1),
  policies: z.array(z.object({ skillId: z.string(), acceptingNew: z.boolean(), revision: z.number().int().nonnegative() }).strict()),
  unavailableSkills: z.array(z.object({ skillId: z.string(), actions: z.array(z.string()), reason: z.string() }).strict()),
}).strict();
/** Only an owned, locked persisted queue row can supply grandfathered scope. */
export async function queuedSkillAdmission(tx: Tx, sessionId: string, entryId: string, id: AssistantId): Promise<SkillAdmission> {
  const [row] = await tx`SELECT input,admission_snapshot FROM assistant_message_queue WHERE id=${entryId} AND session_id=${sessionId} AND state IN ('pending','quoted') FOR UPDATE`;
  if (!row) throw unavailable("排队需求不存在或已结束");
  let raw = row.admission_snapshot;
  if (raw?.legacy === "0093") {
    // This marker is written only by migration to already accepted rows. Never follow future latest versions.
    raw = { version: 1, candidates: await candidates(id, row.input.skillSelection, { "general-writing": "2", "xiaohongshu-creator": "3" }), policies: [], unavailableSkills: [] };
    await tx`UPDATE assistant_message_queue SET admission_snapshot=${tx.json(raw)} WHERE id=${entryId}`;
  }
  const parsed = Admission.safeParse(raw);
  if (!parsed.success) throw unavailable("排队需求缺少有效的受理范围，请管理员核对");
  for (const c of parsed.data.candidates) {
    if (!(profile(id).skills as readonly string[]).includes(c.skillId)) throw unavailable("排队技能范围无效");
    await resolveCandidate(parsed.data.candidates, c.skillId, c.moduleId);
  }
  return parsed.data;
}
function safeReason(error: unknown) {
  if (error instanceof BudgetExceededError) return `${error.service === "assistant.text" ? "助手模型" : error.service === "redfox.query" ? "笔记检索" : "服务"}${error.scope === "member" ? "会员" : "全站"}预算暂不可用`;
  if (error instanceof RedfoxDisabledError) return error.message === "REDFOX_API_KEY is not configured" ? "笔记检索服务凭据未配置" : "笔记检索服务尚未开启";
  if (error instanceof AccountError) return error.message;
  return "依赖配置或技能包无效，请管理员核对";
}
/** One shared health read per request, independent of operator intent. No probes or receipt writes. */
export async function skillHealth(db: Db = sql): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(actions.map(a => [a.actionId, []]));
  const common: string[] = [];
  try {
    const model = await requireAvailable(db);
    await selectToolPrice(db, { kind: "assistant-turn", provider: "assistant", model: model.model, input: {} });
    await checkBudget(db, "assistant.text"); await checkBudget(db, "assistant.text", "member");
  } catch (error) { common.push(safeReason(error)); }
  try {
    const packages = await catalog();
    for (const id of registeredSkillIds) {
      const skill = packages.find(p => p.manifest.skillId === id && p.manifest.version === currentSkillVersions[id]);
      if (!skill || actions.filter(a => a.skillId === id).some(a => !skill.manifest.modules.some(m => m.moduleId === a.moduleId)))
        for (const a of actions.filter(a => a.skillId === id)) result.get(a.actionId)!.push("已注册模块或技能包不可用");
    }
  } catch { common.push("技能包或资源完整性校验失败"); }
  try {
    redfoxBaseUrl();
    assertRedfoxAvailable("3X8FGEEM", "query");
    const parsed = parseSynchronousQuery({ operationId: "3X8FGEEM", parameters: { keyword: "配置校验", startDate: "2026-01-01", endDate: "2026-01-01", pageNum: 1, pageSize: 50 } });
    const intent = { kind: "query" as const, provider: "redfox", model: "3X8FGEEM", input: { operationId: "3X8FGEEM", parameters: parsed.parameters } };
    await assertMemberCostEligible(intent);
    await selectToolPrice(db, intent);
    await checkBudget(db, "redfox.query"); await checkBudget(db, "redfox.query", "member");
  } catch (error) { result.get("xiaohongshu-write")!.push(safeReason(error)); }
  for (const reasons of result.values()) reasons.unshift(...common);
  return result;
}
export async function listAssistantSkills(): Promise<{ skills: AssistantSkillAdminRow[] }> {
  const policies = await readSkillPolicies(), health = await skillHealth();
  const packages = await catalog().catch(() => []);
  return { skills: policies.map(p => {
    const manifest = packages.find(s => s.manifest.skillId === p.skillId && s.manifest.version === currentSkillVersions[p.skillId])?.manifest;
    const reasons = [...(p.reason ? [p.reason] : []), ...actions.filter(a => a.skillId === p.skillId).flatMap(a => (health.get(a.actionId) ?? []).map(reason => `${a.label}：${reason}`))];
    return { ...p, policyValid: p.reason === null, name: skillNames[p.skillId] ?? p.skillId, version: currentSkillVersions[p.skillId]!,
      modules: actions.filter(a => a.skillId === p.skillId).map(a => ({ id: a.moduleId, name: a.label })),
      available: p.acceptingNew && !p.reason && actions.some(a => a.skillId === p.skillId && !health.get(a.actionId)?.length), reasons: [...(!p.acceptingNew ? ["已暂停新任务"] : []), ...reasons],
      source: manifest?.source ?? null, packageHash: manifest?.packageHash ?? null,
      dependencies: p.skillId === "xiaohongshu-creator" ? ["assistant.text", "redfox.query / 3X8FGEEM", "会员积分价目、全站与会员预算"] : ["assistant.text", "会员积分价目、全站与会员预算"] };
  }) };
}
export async function updateAssistantSkill(id: string, raw: unknown, actor: string) {
  registered(id);
  const input = z.object({ acceptingNew: z.boolean(), expectedRevision: z.number().int().safe().nonnegative(), reason: z.string().trim().min(2).max(500) }).strict().parse(raw);
  return sql.begin(async tx => {
    await lockSkillPolicies(tx, [id]);
    const before = (await readSkillPolicies(tx)).find(p => p.skillId === id)!;
    if (before.reason && input.acceptingNew) throw unavailable(before.reason);
    const [stored] = await tx`SELECT value FROM settings WHERE key=${keyOf(id)}`;
    if (before.revision !== input.expectedRevision) throw new AccountError(409, "conflict", "技能设置已变化，请刷新后重试");
    if (input.acceptingNew) {
      const health = await skillHealth(tx);
      const reasons = actions.filter(a => a.skillId === id).flatMap(a => (health.get(a.actionId) ?? []).map(reason => `${a.label}：${reason}`));
      if (reasons.length) throw unavailable(reasons.join("；"));
    }
    const after = { acceptingNew: input.acceptingNew, revision: before.revision + 1 };
    await tx`INSERT INTO settings(key,value,updated_by) VALUES (${keyOf(id)},${tx.json(after)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`;
    await audit(actor, "assistant.skill.update", `assistant-skill:${id}`, input.reason,
      before.reason ? { invalid: true, value: stored?.value ?? null } : { acceptingNew: before.acceptingNew, revision: before.revision }, after, undefined, tx);
    return after;
  });
}

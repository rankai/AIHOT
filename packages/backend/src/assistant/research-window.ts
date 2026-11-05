import { z } from "zod";
import { addDays } from "@aihot/contracts/time";
import { bindings } from "./bindings.ts";
import { AccountError } from "../users/accounts.ts";
import { conflict } from "./store.ts";
import { researchResults, researchClock } from "./xhs-research.ts";
import { wechatResearchResults } from "./wechat-research.ts";
import type { Tx } from "../db.ts";
import { DraftArgumentsError } from "./tool-arguments.ts";

export const ResearchPolicy = z.enum(["xhs-empty-window@1", "wechat-low-raw-window@1"]);
export const ResearchScope = z.object({ policy: ResearchPolicy, maximumQueries: z.union([z.literal(1), z.literal(2)]),
  fixedDates: z.boolean(), startDate: z.iso.date(), endDate: z.iso.date(),
  clock: z.object({ timeZone: z.literal("Asia/Shanghai"), today: z.iso.date(), earliestDate: z.iso.date(), latestDate: z.iso.date(), defaultStartDate: z.iso.date() }).strict(),
}).strict();
export type ResearchScopeValue = z.infer<typeof ResearchScope>;
export function researchTaskPolicy(snapshot: Record<string, any>) {
  const scope = snapshot.taskScope;
  if (scope?.delivery !== "writing") return null;
  const candidate = snapshot.candidates.find((c: any) => c.skillId === scope.skillId && c.moduleId === scope.moduleId);
  return bindings.find(b => b.skillId === candidate?.skillId && b.version === candidate.version)?.modules
    .find(m => m.moduleId === candidate.moduleId)?.researchPolicy ?? null;
}
const queryArguments = (message: string, instruction="不要再次查询、换词、翻页或静默扩大范围；使用已完成结果继续分析，确实无法确定用户日期时先提问澄清。") => new DraftArgumentsError(new z.ZodError([
  {code:'custom',path:['startDate'],message},
]), `${message}。${instruction}`);
const dayNumber = (raw: string) => {
  if (/^\d+$/.test(raw)) return Number(raw);
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (raw === "十") return 10;
  if (raw.includes("十")) { const [a, b] = raw.split("十"); return (a ? digits[a]! : 1) * 10 + (b ? digits[b]! : 0); }
  return digits[raw] ?? NaN;
};
/** Only explicit query-time phrases are recognized; durations inside the writing topic are not date limits. */
export function researchDateRange(message: string, clock: ReturnType<typeof researchClock>, latestDate = clock.today) {
  const clarifyDate = () => new AccountError(409, "assistant_research_date_required", `请写明查询的起止日期，可选 ${clock.earliestDate} 至 ${latestDate}。`);
  // Quoted titles and independent writing clauses do not constrain research dates.
  const queryText = message.replace(/[“「『《][^”」』》]*[”」』》]|"[^"\n]*"/g, "");
  const once = /(?:只|仅)(?:查询|检索|搜索|查|搜)(?:一|1)次|(?:不要|不再|禁止|不)(?:自动)?扩(?:期|大时间范围)/.test(queryText);
  const clauses = queryText.split(/[，,。；;\n]/);
  const queryTime = /(?:查询|检索|搜索|只看|只查|只搜|查找|查|搜|参考|时间范围|日期范围)/;
  const dataAfter = /^(?:以内|内|之内)?(?:的)?(?:相关)?(?:热门|爆款|笔记|文章|数据)/;
  const queryClauses = clauses.filter(clause => queryTime.test(clause) || /(?:上周|昨天|昨日|今天|今日)(?:的)?(?:相关)?(?:热门|爆款|笔记|文章|数据)/.test(clause));
  const datePattern = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b|(20\d{2})年(\d{1,2})月(\d{1,2})[日号]|(?<!\d)(\d{1,2})月(\d{1,2})[日号]/g;
  if(queryClauses.filter(clause=>[...clause.matchAll(datePattern)].length).length>1)throw clarifyDate();
  for (const clause of queryClauses) {
    const dates = [...clause.matchAll(datePattern)].map(m => ({ index: m.index!, raw: m[0], date: `${m[1] ?? m[4] ?? clock.today.slice(0, 4)}-${String(m[2] ?? m[5] ?? m[7]).padStart(2, "0")}-${String(m[3] ?? m[6] ?? m[8]).padStart(2, "0")}` }));
    if (!dates.length) continue;
    if (dates.length > 2 || dates.some(d => !z.iso.date().safeParse(d.date).success)) throw clarifyDate();
    const first = dates[0]!, second = dates[1];
    if (second) {
      if (!/^\s*(?:至|到|[-~～—–])\s*$/.test(clause.slice(first.index + first.raw.length, second.index))) throw clarifyDate();
      return { startDate: first.date, endDate: second.date, maximumQueries: 1 as const, fixedDates: true };
    }
    const before = clause.slice(Math.max(0, first.index - 12), first.index), after = clause.slice(first.index + first.raw.length, first.index + first.raw.length + 8);
    if (/(?:截止|截至|到|至)\s*$/.test(before)) return { startDate: clock.defaultStartDate, endDate: first.date, maximumQueries: 1 as const, fixedDates: true };
    if (/(?:从|自|起始(?:日期)?[：:]?|开始(?:日期)?[：:]?)\s*$/.test(before) || /^(?:起|开始|以后|之后)/.test(after))
      return { startDate: first.date, maximumQueries: 1 as const, fixedDates: true };
    return { startDate: first.date, endDate: first.date, maximumQueries: 1 as const, fixedDates: true };
  }
  for (const clause of clauses) {
    const relative = /(?:近|最近|过去)([\d一二两三四五六七八九十]+)(?:个)?天/.exec(clause);
    if (!relative || !(queryTime.test(clause.slice(Math.max(0, relative.index - 12), relative.index)) || dataAfter.test(clause.slice(relative.index + relative[0].length)))) continue;
    const days = dayNumber(relative[1]!);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw clarifyDate();
    return { startDate: addDays(clock.today, -days), maximumQueries: 1 as const, fixedDates: true };
  }
  for (const clause of queryClauses) {
    if (/昨天|昨日/.test(clause)) return { startDate: clock.latestDate, endDate: clock.latestDate, maximumQueries: 1 as const, fixedDates: true };
    if (/今天|今日/.test(clause)) return { startDate: clock.today, endDate: clock.today, maximumQueries: 1 as const, fixedDates: true };
    if (/上周/.test(clause)) {
      const weekday = (new Date(`${clock.today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { startDate: addDays(clock.today, -weekday - 7), endDate: addDays(clock.today, -weekday - 1), maximumQueries: 1 as const, fixedDates: true };
    }
    // “近期” alone is the normal default; explicit unsupported limits require clarification.
    if (/(?:本周|这周|上个?月|本月|前天|最近一个月|去年|今年|指定日期)|(?:仅|只|限定)[^。\n]{0,6}(?:近期|最近|过去|时间|日期)|(?:近|最近|过去)[\d一二两三四五六七八九十半]+(?:个)?(?:周|月|年)/.test(clause)) throw clarifyDate();
  }
  return { maximumQueries: once ? 1 as const : 2 as const, fixedDates: false };
}
export function freezeResearchScope(snapshot: Record<string, any>, frozen?: unknown) {
  const policy = researchTaskPolicy(snapshot);
  if (!policy) return null;
  if (frozen) {
    const scope = ResearchScope.parse(frozen);
    if (scope.policy !== policy) throw conflict("研究查询合同与报价不一致");
    snapshot.researchClock = scope.clock;
    return scope;
  }
  const clock = snapshot.researchClock;
  const latestDate = policy === "xhs-empty-window@1" ? clock.latestDate : clock.today;
  const range = researchDateRange(snapshot.message, clock, latestDate);
  const scope = ResearchScope.parse({ policy, ...range, startDate: "startDate" in range ? range.startDate : clock.defaultStartDate,
    endDate: "endDate" in range ? range.endDate : latestDate, clock });
  if (scope.startDate < clock.earliestDate || scope.startDate > scope.endDate || scope.endDate > latestDate)
    throw new AccountError(409, "assistant_research_date_required", `查询日期超出可用范围，请选择${clock.earliestDate}至${latestDate}内的日期。`);
  return scope;
}
type ResultRow = { id: number; kind: string; data: any };
/** A missing/invalid summary is not an empty successful query. */
export function researchQueryOutcome(name: string, rows: ResultRow[]) {
  if (name === "search_wechat_articles") {
    const summary = rows.find(r => r.kind === "wechat_hot_research")?.data;
    if (!summary || !Number.isInteger(summary.rawCount) || summary.rawCount < 0) throw conflict("公众号查询结果尚未核清");
    const usable = rows.filter(r => r.kind === "wechat_hot_article" && (r.data.text?.trim() || r.data.title?.trim() && r.data.title !== "未提供标题")).length;
    return { rawCount: summary.rawCount, usableCount: usable, expand: summary.rawCount < 10 };
  }
  const summary = rows.find(r => r.kind === "xiaohongshu_research")?.data;
  if (!summary || !Number.isInteger(summary.matchedCount) || summary.matchedCount < 0) throw conflict("小红书查询结果尚未核清");
  const usable = researchResults(rows).validSampleIds.length;
  return { rawCount: summary.matchedCount, usableCount: usable, expand: usable === 0 };
}
export async function assertKnownResearchQuery(tx: Tx, childRunId: number) {
  const [run] = await tx`SELECT status,current_receipt_id,progress FROM operation_runs WHERE id=${childRunId}`;
  const [uncertain] = await tx`SELECT id FROM receipts WHERE status IN ('pending','unknown') AND id IN (
    SELECT receipt_id FROM operation_results WHERE run_id=${childRunId} AND receipt_id IS NOT NULL
    UNION SELECT current_receipt_id FROM operation_runs WHERE id=${childRunId} AND current_receipt_id IS NOT NULL
    UNION SELECT jsonb_array_elements_text(coalesce(progress->'retainedReceiptIds','[]'))::bigint FROM operation_runs WHERE id=${childRunId}) LIMIT 1`;
  const [saved] = await tx`SELECT 1 FROM operation_results z JOIN receipts p ON p.id=z.receipt_id
    WHERE z.run_id=${childRunId} AND p.status IN ('received','completed') LIMIT 1`;
  if (run?.status !== "completed" || uncertain || !saved) throw conflict("查询仍有未知或在途结果，需要核对");
}
/** Admission is checked again in the child-creation transaction. Only the server-linked expansion may follow the first query. */
export async function validateResearchSearch(tx: Tx, turn: Record<string, any>, call: Record<string, any>, input: { activationId: string; keyword: string; startDate: string; endDate?: string }) {
  const policy = researchTaskPolicy(turn.snapshot);
  if (!policy || !["search_xhs_notes", "search_wechat_articles"].includes(call.name)) return false;
  const scope = ResearchScope.parse(turn.snapshot.taskScope.research);
  const prior = await tx`SELECT c.*,r.status FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id
    WHERE c.turn_id=${turn.id} AND c.name=${call.name} ORDER BY c.ordinal`;
  if (!prior.length) {
    if(scope.fixedDates) { input.startDate = scope.startDate; input.endDate = scope.endDate; }
    else if(input.startDate !== scope.startDate || input.endDate !== scope.endDate)
      throw queryArguments(`首查须使用已冻结的${scope.startDate}至${scope.endDate}`,"原调用尚未外发。用户未限定日期时按原冻结窗口修正工具参数；若用户实际限定了尚未识别的日期，先提问澄清且不查询，不得静默放宽用户范围。");
    return true;
  }
  const first = prior[0]!;
  if (prior.length !== 1 || first.state !== "completed" || typeof first.result?.researchExpansionCallId !== 'string' || !call.id || first.result.researchExpansionCallId !== call.id || scope.maximumQueries !== 2 || scope.fixedDates)
    throw queryArguments("本次查询范围已冻结；不能换词、翻页或重复查询");
  await assertKnownResearchQuery(tx, first.child_run_id);
  const rows = await tx<ResultRow[]>`SELECT id,kind,data FROM operation_results WHERE run_id=${first.child_run_id}`;
  if (!researchQueryOutcome(call.name, rows).expand || first.input.startDate <= scope.clock.earliestDate ||
      input.activationId !== first.input.activationId || input.keyword !== first.input.keyword || input.startDate !== scope.clock.earliestDate || input.endDate !== first.input.endDate)
    throw queryArguments("扩期须沿用已完成首查的关键词和截止日，且最多一次");
  return true;
}

/** Dispatchers are already stopped. Close only proved unsent or fully saved query calls, so settlement can distinguish creation from query fees. */
export async function closeResearchCallsForStop(tx: Tx, turn: Record<string, any>) {
  if(!researchTaskPolicy(turn.snapshot))return;
  await tx`UPDATE assistant_tool_calls SET state='failed',result=${tx.json({error:'stopped_before_dispatch',message:'用户停止，尚未外发的调用未执行'})}
    WHERE turn_id=${turn.id} AND child_run_id IS NULL AND state IN ('pending','proposed')`;
  const calls=await tx`SELECT c.*,r.status FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id
    WHERE c.turn_id=${turn.id} AND c.state='running' AND c.name IN ('search_xhs_notes','search_wechat_articles')`;
  for(const call of calls) {
    if(call.status==='completed') {
      try {
        await assertKnownResearchQuery(tx,call.child_run_id);
        const rows=await tx<ResultRow[]>`SELECT id,kind,data FROM operation_results WHERE run_id=${call.child_run_id} ORDER BY id`;
        researchQueryOutcome(call.name,rows);
        const result=call.name==='search_wechat_articles'?wechatResearchResults(rows):researchResults(rows);
        await tx`UPDATE assistant_tool_calls SET state='completed',result=${tx.json(result as never)} WHERE id=${call.id}`;
      }catch(error){if(!(error instanceof AccountError))throw error;}
    } else if(call.status==='stopped') {
      const [sent]=await tx`SELECT 1 FROM operation_runs r WHERE r.id=${call.child_run_id} AND (
        r.current_receipt_id IS NOT NULL OR jsonb_array_length(coalesce(r.progress->'retainedReceiptIds','[]'))>0
        OR EXISTS(SELECT 1 FROM operation_results z WHERE z.run_id=r.id)
        OR EXISTS(SELECT 1 FROM receipt_attempts a WHERE a.operation_run_id=r.id))`;
      if(!sent)await tx`UPDATE assistant_tool_calls SET state='failed',result=${tx.json({error:'stopped_before_dispatch',message:'查询子任务尚未外发'})} WHERE id=${call.id}`;
    }
  }
}

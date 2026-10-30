import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { ToolRunDetail, ToolRunRow, ToolRunAction } from "@aihot/contracts/user-tools";
import { sql } from "../db.ts";
import type { AssetRow } from "../operations/assets.ts";
import { recoveryKeys } from "./tool-input.ts";
import { readRunCredits } from "./credits.ts";
import { memberRunDto, memberRunPresentation, ownedMemberRun } from "./tool-history.ts";
import { projectToolResult, toolBusinessResultSql } from "./tool-results.ts";

type ResultRow = { id: number; kind: string; data: unknown; file: AssetRow | null };
const project = (result: ResultRow) => projectToolResult({ ...result, file: result.file ? { ...result.file, created_at: new Date(result.file.created_at!) } : null });
function resultRows(actor: string, id: number) {
  return sql`SELECT z.id,z.kind,z.data,CASE WHEN f.key IS NULL THEN NULL ELSE row_to_json(f) END AS file
    FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN stored_files f ON f.key=z.file_key
    WHERE z.run_id=${id} AND r.actor=${actor}`;
}

export async function userToolDetail(userId: number, id: number, raw: unknown = {}): Promise<ToolRunDetail> {
  const { after, section } = z.object({ after: z.coerce.number().int().nonnegative().safe().default(0), section: z.enum(["results","process"]).default("results") }).strict().parse(raw);
  const actor = `user:${userId}`, row = await ownedMemberRun(actor, id), business = toolBusinessResultSql();
  const [results, process, counts, charge] = await Promise.all([
    section === "results" ? sql<ResultRow[]>`${resultRows(actor, id)} AND ${business} AND z.id>${after} ORDER BY z.id LIMIT 51` : Promise.resolve([]),
    sql<ResultRow[]>`${resultRows(actor, id)} AND NOT ${business} AND z.id>${section === "process" ? after : 0} ORDER BY z.id LIMIT 51`,
    sql<{ result_count: number; process_count: number }[]>`SELECT count(*) FILTER (WHERE ${business})::int AS result_count,
      count(*) FILTER (WHERE NOT ${business})::int AS process_count FROM operation_results z WHERE z.run_id=${id}`,
    readRunCredits(userId, id),
  ]);
  const ended = ["completed", "failed"].includes(row.status), actions: ToolRunAction[] = [], child = row.continuation_run_id;
  if (!ended && charge && !["released", "settled"].includes(charge.state) && !child) {
    if (["needs_review", "stopped"].includes(row.status) && row.receipt_status !== "unknown") actions.push("resume");
    if (row.status !== "stopped") actions.push("stop");
    actions.push("abandon");
  }
  const recoveryKind = !child && charge && !["released", "settled"].includes(charge.state) && ["needs_review", "stopped"].includes(row.status) && row.step_key.endsWith(".poll") && !["pending", "unknown"].includes(row.receipt_status ?? "")
    ? (Object.entries(recoveryKeys).find(([, operationKey]) => operationKey === row.operation_key || operationKey === "redfox.video.generate" && row.operation_key === "aliyun.wan.animate-mix.generate")?.[0] as ToolRunDetail["recoveryKind"] ?? null) : null;
  const messages: Record<ToolRunRow["status"], string> = {
    active: "任务已受理，正在处理。可在此查看进度与结果。", waiting: "任务正在等待供应商结果、执行条件或站点预算；已有积分占用保留。",
    needs_review: row.receipt_status === "unknown" ? "供应商请求结果未知，请联系管理员核对；请勿重新提交相同任务。" : "任务暂未完成，需要核对或恢复。已保存的结果仍可查看。",
    stopped: child ? `已通过后续执行 #${child} 继续查询，原任务不会重复执行。` : "已停止本地后续处理；这不会撤销供应商已接受的请求或自动退回积分。",
    completed: "本轮处理已完成，请查看结果与积分结算状态。", failed: "本轮已结束。已有结果保留；积分结算以交付证据与核对结果为准。",
  };
  return { ...memberRunDto(row), message: messages[row.status], actions, canResume: actions.includes("resume"), charge, recoveryKind,
    results: results.slice(0, 50).map(project), nextResultCursor: results.length > 50 ? results[49].id : null, resultCount: counts[0].result_count,
    process: process.slice(0, 50).map(project), nextProcessCursor: process.length > 50 ? process[49].id : null, processCount: counts[0].process_count,
    originRunId: row.origin_run_id, continuationRunId: child };
}

/** Export all delivered results visible when the repeatable-read transaction starts.
 * A cursor and stream backpressure bound memory; pipeline closes the cursor and transaction on disconnect.
 * Results saved after this snapshot are intentionally available in the next export.
 */
export async function exportUserToolResults(userId: number, id: number, raw: unknown = {}): Promise<PassThrough> {
  z.object({}).strict().parse(raw);
  // Load catalog metadata before reserving the transaction connection, including for a one-connection pool.
  const presentation = await memberRunPresentation();
  const actor = `user:${userId}`, stream = new PassThrough();
  const ready = Promise.withResolvers<PassThrough>();
  let started = false;
  void sql.begin("isolation level repeatable read read only", async tx => {
    const row = await ownedMemberRun(actor, id, tx, presentation);
    const [snapshot] = await tx<{ at: Date; result_count: number; last_result_id: number | null }[]>`SELECT transaction_timestamp() AS at,
      count(*)::int AS result_count,max(z.id) AS last_result_id FROM operation_results z WHERE z.run_id=${id} AND ${toolBusinessResultSql()}`;
    async function* json() {
      const metadata = { runId: id, title: row.title, summary: row.summary, scope: "all-saved-results", snapshotAt: snapshot.at.toISOString(),
        lastResultId: snapshot.last_result_id, resultCount: snapshot.result_count, nextCursor: null };
      yield `${JSON.stringify(metadata).slice(0, -1)},"results":[`;
      let first = true;
      for await (const batch of tx<ResultRow[]>`${resultRows(actor, id)} AND ${toolBusinessResultSql()} ORDER BY z.id`.cursor(100)) {
        for (const result of batch) { yield `${first ? "" : ","}${JSON.stringify(project(result))}`; first = false; }
      }
      yield "]}";
    }
    started = true;
    ready.resolve(stream);
    await pipeline(Readable.from(json()), stream);
  }).catch(error => {
    if (!started) { ready.reject(error); stream.destroy(); }
    else stream.destroy(error as Error);
  });
  return ready.promise;
}

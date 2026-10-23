import { sql, type Tx } from "../../db.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { advanceRun, receiptOptions, requireExecution, saveResult, setRunState, type Execution, type OperationProgress, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { AiSearchInput, AiSearchFamily } from "./ai-search-contract.ts";
import { pollAiSearch, submitAiSearch, aiSearchLimits } from "./ai-search.ts";

function paidOptions(execution: Execution): PaidRequestOptions {
  const base = receiptOptions(execution);
  return { ...base, onReceipt: async (tx, id, info) => {
    await base.onReceipt?.(tx, id, info);
    if (info.kind !== "call") return;
    const run = await requireExecution(tx, execution), limits = aiSearchLimits(run);
    if (Date.now() - Date.parse(String(run.input.startedAt)) > limits.pollDeadlineSeconds * 1000) throw new Error("AI search request deadline exhausted");
    const count = Number(run.progress.externalAttempts ?? 0);
    if (count >= limits.externalAttempts) throw new Error("AI search external attempt limit exhausted");
    await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{externalAttempts}',${tx.json(count + 1)}) WHERE id=${run.id}`;
  } };
}
async function nextPoll(tx: Tx, execution: Execution, progress: OperationProgress, delay: number) {
  const run = await requireExecution(tx, execution);
  await advanceRun(tx, execution, { stepKey: "redfox.ai_search.poll", progress: { ...progress, externalAttempts: run.progress.externalAttempts ?? 0 } });
  await tx`UPDATE operation_runs SET status='waiting',wait_reason='Waiting for AI search',next_attempt_at=${new Date(Date.now() + delay * 1000)} WHERE id=${run.id}`;
  await queueOperationStep(tx, run.id);
}
export async function executeAiSearchStep(execution: Execution, run: RunRow) {
  const limits = aiSearchLimits(run), family = AiSearchFamily.parse(run.input.family), identity = `run:${run.id}`;
  if (run.step_version > limits.steps) throw new Error("AI search step limit exhausted");
  if (run.step_key === "redfox.ai_search.submit") {
    const input = AiSearchInput.parse(run.input.parameters);
    const result = await submitAiSearch(input, `${identity}:submit`, paidOptions(execution));
    await sql.begin(async tx => {
      await requireExecution(tx, execution);
      await saveResult(tx, execution, { itemKey: "submission", kind: "ai_search_task", data: { family, engine:input.engine, ...result.data }, receiptId: result.receiptId });
      await nextPoll(tx, execution, { ...run.progress, taskId: result.data.taskId, pollSequence: 0 }, limits.pollIntervalSeconds);
    }); return;
  }
  if (run.step_key !== "redfox.ai_search.poll") throw new Error("Unsupported AI search step");
  const sequence = Number(run.progress.pollSequence), taskId = String(run.progress.taskId);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= limits.polls) throw new Error("AI search polling limit exhausted");
  const result = await pollAiSearch(family, taskId, `${identity}:poll:${sequence}`, paidOptions(execution));
  await sql.begin(async tx => {
    const current = await requireExecution(tx, execution);
    await saveResult(tx,execution,{itemKey:`poll:${sequence}`,kind:result.data.state==="succeeded"?"ai_search_answer":"ai_search_task",
      data:{family,requestedTaskId:taskId,...result.data.facts,citationCount:result.data.citations.length},receiptId:result.receiptId});
    for(const [index,citation] of result.data.citations.entries())await saveResult(tx,execution,{itemKey:`poll:${sequence}:citation:${index}`,kind:"ai_search_citation",data:{family,requestedTaskId:taskId,...citation},receiptId:result.receiptId});
    const progress = { ...current.progress, pollSequence: sequence + 1 };
    if (result.data.state === "succeeded") { await advanceRun(tx, execution, null); return; }
    if (result.data.state === "failed") {
      await advanceRun(tx, execution, { stepKey: "redfox.ai_search.poll", progress });
      const [updated] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${run.id}`;
      await setRunState(tx, { ...execution, stepVersion: updated!.step_version }, "failed", result.data.facts.failReason ?? "AI search failed"); return;
    }
    await nextPoll(tx, execution, progress, Math.min(limits.maxPollIntervalSeconds, limits.pollIntervalSeconds + sequence * 2));
  });
}

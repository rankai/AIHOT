import { sql, type Tx } from "../../db.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { advanceRun, receiptOptions, requireExecution, saveResult, setRunState, type Execution, type OperationProgress, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { TranscriptionInput, TranscriptionPlatform } from "./transcription-contract.ts";
import { pollTranscription, submitTranscription, transcriptionLimits } from "./transcription.ts";

function paidOptions(execution: Execution): PaidRequestOptions {
  const base = receiptOptions(execution);
  return { ...base, onReceipt: async (tx, id, info) => {
    await base.onReceipt?.(tx, id, info);
    if (info.kind !== "call") return;
    const run = await requireExecution(tx, execution), limits = transcriptionLimits(run);
    if (Date.now() - Date.parse(String(run.input.startedAt)) > limits.pollDeadlineSeconds * 1000) throw new Error("Transcription request deadline exhausted");
    const count = Number(run.progress.externalAttempts ?? 0);
    if (count >= limits.externalAttempts) throw new Error("Transcription external attempt limit exhausted");
    await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{externalAttempts}',${tx.json(count + 1)}) WHERE id=${run.id}`;
  } };
}
async function nextPoll(tx: Tx, execution: Execution, progress: OperationProgress, delay: number) {
  const run = await requireExecution(tx, execution);
  await advanceRun(tx, execution, { stepKey: "redfox.transcript.poll", progress: { ...progress, externalAttempts: run.progress.externalAttempts ?? 0 } });
  await tx`UPDATE operation_runs SET status='waiting',wait_reason='Waiting for transcription',next_attempt_at=${new Date(Date.now() + delay * 1000)} WHERE id=${run.id}`;
  await queueOperationStep(tx, run.id);
}
export async function executeTranscriptionStep(execution: Execution, run: RunRow) {
  const limits = transcriptionLimits(run), platform = TranscriptionPlatform.parse(run.input.platform), identity = `run:${run.id}`;
  if (run.step_version > limits.steps) throw new Error("Transcription step limit exhausted");
  if (run.step_key === "redfox.transcript.submit") {
    const input = TranscriptionInput.parse(run.input.parameters);
    const result = await submitTranscription(platform, input.url, `${identity}:submit`, paidOptions(execution));
    await sql.begin(async tx => {
      await requireExecution(tx, execution);
      await saveResult(tx, execution, { itemKey: "submission", kind: "transcription_task", data: { platform, ...result.data, sourceUrl: input.url }, receiptId: result.receiptId });
      await nextPoll(tx, execution, { ...run.progress, taskId: result.data.taskId, pollSequence: 0 }, limits.pollIntervalSeconds);
    }); return;
  }
  if (run.step_key !== "redfox.transcript.poll") throw new Error("Unsupported transcription step");
  const sequence = Number(run.progress.pollSequence), taskId = String(run.progress.taskId);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= limits.polls) throw new Error("Transcription polling limit exhausted");
  const result = await pollTranscription(platform, taskId, `${identity}:poll:${sequence}`, paidOptions(execution));
  await sql.begin(async tx => {
    const current = await requireExecution(tx, execution);
    const parameters = run.input.parameters as { url?: string };
    await saveResult(tx, execution, { itemKey: `poll:${sequence}`, kind: result.data.status === "succeeded" ? "transcription" : "transcription_task",
      data: { platform, requestedTaskId: taskId, ...result.data, ...(parameters.url === undefined ? {} : { sourceUrl: parameters.url }), timestampUnit: "milliseconds" }, receiptId: result.receiptId });
    const progress = { ...current.progress, pollSequence: sequence + 1 };
    if (result.data.status === "succeeded") { await advanceRun(tx, execution, null); return; }
    if (result.data.status === "failed") {
      await advanceRun(tx, execution, { stepKey: "redfox.transcript.poll", progress });
      const [updated] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${run.id}`;
      await setRunState(tx, { ...execution, stepVersion: updated!.step_version }, "failed", result.data.failReason ?? "Transcription failed"); return;
    }
    await nextPoll(tx, execution, progress, Math.min(limits.maxPollIntervalSeconds, limits.pollIntervalSeconds + sequence * 2));
  });
}

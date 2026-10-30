import { sql, type Tx } from "../../db.ts";
import { credential } from "../../config.ts";
import { guardedDownload } from "../../lib/http-fetch.ts";
import { assetPath, describeGeneratedVideoFile, hasCompleteLocalFile, videoOutputKey, VIDEO_BYTES, prepareUpload, publishUpload } from "../../operations/assets.ts";
import { probeVideo } from "../../operations/video-probe.ts";
import { advanceRun, claimRun, receiptOptions, requireExecution, saveResult, setRunState, StaleOperationError, type Execution, type RunRow, type OperationProgress } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { settleUnknownReceipt } from "../operations/recovery.ts";
import { BudgetExceededError, ReceiptBusyError, retryReceivedRejection, type PaidRequestOptions } from "../receipts.ts";
import { WanInput, WAN_LIMITS, WAN_MODEL, parseWanResponse } from "./wan-contract.ts";
import { assertWanOutbound, WanDisabledError, type WanConfig } from "./wan-config.ts";
import { assertWanConfig, wanRequest, WanTemporaryError } from "./wan-client.ts";
import { uploadWanObject, wanObjectUrl, type WanObject } from "./wan-oss.ts";
import { recordWanUsage } from "./wan-costs.ts";
function limits(run: RunRow) { for (const key of Object.keys(WAN_LIMITS)) if (!Number.isSafeInteger(run.limits[key]) || run.limits[key]! < 0) throw new Error("Invalid frozen Wan limits"); return run.limits as typeof WAN_LIMITS; }
function paidOptions(execution: Execution): PaidRequestOptions {
  const base = receiptOptions(execution);
  return { ...base, onReceipt: async (tx, id, info) => {
    await base.onReceipt?.(tx, id, info); if (info.kind !== "call") return;
    const run = await requireExecution(tx, execution), l = limits(run); assertWanOutbound(); assertWanConfig(run.input.configIdentity as WanConfig);
    const keys = run.step_key === "aliyun.wan.poll" ? [["models", "DASHSCOPE_API_KEY"]] : [["models", "DASHSCOPE_API_KEY"], ["integrations", "ALIYUN_WAN_OSS_ACCESS_KEY_ID"], ["integrations", "ALIYUN_WAN_OSS_ACCESS_KEY_SECRET"]];
    for (const [group, name] of keys) if (!credential(group as "models" | "integrations", name!)) throw new WanDisabledError(`Missing ${name}`);
    const attempts = Number(run.progress.externalAttempts ?? 0), polls = Number(run.progress.pollAttempts ?? 0);
    if (Date.now() - Date.parse(String(run.input.startedAt)) > l.pollDeadlineSeconds * 1000 || attempts >= l.externalAttempts || run.step_key === "aliyun.wan.poll" && polls >= l.polls) throw new Error("Wan total request window or limit exhausted");
    await tx`UPDATE operation_runs SET progress=progress||${tx.json({ externalAttempts: attempts + 1, pollAttempts: polls + Number(run.step_key === "aliyun.wan.poll") })} WHERE id=${run.id}`;
  } };
}
async function advance(tx: Tx, execution: Execution, stepKey: string, progress: OperationProgress, delay = 0) {
  const current = await requireExecution(tx, execution);
  await advanceRun(tx, execution, { stepKey, progress: { ...progress, externalAttempts: current.progress.externalAttempts ?? 0, pollAttempts: current.progress.pollAttempts ?? 0 } });
  if (delay) await tx`UPDATE operation_runs SET status='waiting',wait_reason='等待万相生成',next_attempt_at=${new Date(Date.now() + delay * 1000)} WHERE id=${execution.runId}`;
  await queueOperationStep(tx, execution.runId);
}
async function step(execution: Execution, run: RunRow) {
  const p = run.progress, l = limits(run), config = run.input.configIdentity as WanConfig, identity = { runId: run.id, rootRunId: p.rootRunId ?? run.input.rootRunId ?? run.id };
  if (run.step_version > l.steps) throw new Error("Wan step limit exhausted");
  if (run.step_key === "aliyun.wan.upload") {
    const index = Number(p.uploadIndex), media = run.input.media as { portraitHash: string; videoHash: string }, input = WanInput.parse(run.input.parameters);
    if (![0, 1].includes(index)) throw new Error("Invalid Wan upload index");
    const result = await uploadWanObject(config, run.id, index === 0 ? "portrait" : "reference", index === 0 ? input.portraitFileKey : input.referenceVideoFileKey, index === 0 ? media.portraitHash : media.videoHash, paidOptions(execution));
    await sql.begin(async tx => { await requireExecution(tx, execution); await saveResult(tx, execution, { itemKey: `reference:${index}`, kind: "video_reference", fileKey: result.object.fileKey, receiptId: result.receiptId, data: { fileKey: result.object.fileKey, role: index === 0 ? "portrait" : "reference", uploaded: true } }); await advance(tx, execution, index === 0 ? "aliyun.wan.upload" : "aliyun.wan.submit", { ...p, uploadIndex: index + 1, objects: [...p.objects as WanObject[], result.object] }); }); return;
  }
  if (run.step_key === "aliyun.wan.submit") {
    const input = WanInput.parse(run.input.parameters), objects = p.objects as WanObject[];
    const result = await wanRequest(config, { ...identity, phase: "submit", parameters: input, objects: objects.map(o => ({ fileKey: o.fileKey, hash: o.hash, objectKey: o.objectKey })) }, paidOptions(execution), async () => ({ model: WAN_MODEL, input: { image_url: await wanObjectUrl(config, objects[0]!), video_url: await wanObjectUrl(config, objects[1]!), watermark: true }, parameters: { mode: input.mode, check_image: true } }));
    const data = parseWanResponse(result.data);
    await sql.begin(async tx => { await requireExecution(tx, execution); await saveResult(tx, execution, { itemKey: "submission", kind: "video_task", receiptId: result.receiptId, data: { taskId: data.output.task_id, status: data.output.task_status.toLowerCase() } }); await advance(tx, execution, "aliyun.wan.poll", { ...p, taskId: data.output.task_id, submissionReceiptId: result.receiptId, submissionAttempt: result.attempt, pollSequence: 0 }, 15); }); return;
  }
  if (run.step_key === "aliyun.wan.save") {
    const key = String(p.expectedFileKey); if (key !== videoOutputKey(run.id, 0)) throw new Error("Missing frozen Wan output");
    let temp: Awaited<ReturnType<typeof prepareUpload>> | undefined;
    try {
      let file = assetPath(key);
      if (!await hasCompleteLocalFile(key)) {
        assertWanOutbound(); assertWanConfig(config);
        await sql.begin(async tx => { const current = await requireExecution(tx, execution), attempts = Number(current.progress.saveAttempts ?? 0); if (attempts >= l.saveAttempts) throw new Error("Wan save limit exhausted"); await tx`UPDATE operation_runs SET progress=jsonb_set(progress,'{saveAttempts}',${tx.json(attempts + 1)}) WHERE id=${run.id}`; });
        temp = await prepareUpload(VIDEO_BYTES); file = temp.file;
        try { await guardedDownload(String(p.outputUrl), file, { timeoutMs: l.downloadTimeoutMs, maxBytes: VIDEO_BYTES }); } catch { throw new Error("万相结果下载未完成，请恢复保存；不会再次生成"); }
      }
      const prepared = await describeGeneratedVideoFile(file), facts = await probeVideo(file);
      if (prepared.mime !== "video/mp4") throw new Error("Wan output is not MP4");
      await sql.begin(async tx => { await requireExecution(tx, execution); await publishUpload({ actor: `operation:${run.id}`, key, ...prepared }, tx); await saveResult(tx, execution, { itemKey: "output:0", kind: "video", fileKey: key, data: { title: "视频复刻结果", role: "video", taskId: p.taskId, model: WAN_MODEL, mode: (run.input.parameters as { mode: string }).mode, ...facts } }); await advanceRun(tx, execution, null); });
    } finally { await temp?.release(); } return;
  }
  if (run.step_key !== "aliyun.wan.poll") throw new Error("Unsupported Wan step");
  const sequence = Number(p.pollSequence);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= l.polls) throw new Error("Wan poll limit exhausted");
  const result = await wanRequest(config, { ...identity, phase: "poll", sequence, taskId: p.taskId, submissionReceiptId: p.submissionReceiptId, submissionAttempt: p.submissionAttempt }, paidOptions(execution), undefined, String(p.taskId));
  const data = parseWanResponse(result.data, String(p.taskId)), status = data.output.task_status;
  await sql.begin(async tx => {
    const current = await requireExecution(tx, execution); await recordWanUsage(tx, current, result, data);
    await saveResult(tx, execution, { itemKey: `poll:${sequence}`, kind: "video_task", receiptId: result.receiptId, data: { taskId: p.taskId, status: status === "SUCCEEDED" ? "completed" : status === "FAILED" || status === "CANCELED" ? "failed" : status.toLowerCase(), providerStatus: status, outputSeconds: data.usage?.video_duration ?? null } });
    const next = { ...p, pollSequence: sequence + 1 };
    if (status === "SUCCEEDED") await advance(tx, execution, "aliyun.wan.save", { ...next, outputUrl: data.output.results!.video_url, expectedFileKey: videoOutputKey(run.id, 0) });
    else if (["FAILED", "CANCELED", "UNKNOWN"].includes(status)) {
      await advanceRun(tx, execution, { stepKey: "aliyun.wan.poll", progress: { ...current.progress, ...next } });
      await setRunState(tx, { ...execution, stepVersion: execution.stepVersion + 1 }, status === "UNKNOWN" ? "needs_review" : "failed", `Wan task ${status}; retain original task`);
    } else await advance(tx, execution, "aliyun.wan.poll", next, sequence === 0 ? 15 : sequence === 1 ? 30 : 60);
  });
}
export async function executeWanStep(runId: number, stepVersion: number, jobId: string) {
  const [run] = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${runId}`;
  if (!run || run.status !== "active" || run.step_version !== stepVersion) return { skipped: true };
  let execution: Execution;
  try { execution = await sql.begin(tx => claimRun(tx, { runId, stepVersion, generation: run.generation }, jobId)); } catch (error) { if (error instanceof StaleOperationError) return { skipped: true }; throw error; }
  try { await step(execution, run); return { runId }; }
  catch (error) {
    if (error instanceof StaleOperationError) return { skipped: true };
    await sql.begin(async tx => {
      let current: RunRow; try { current = await requireExecution(tx, execution); } catch (e) { if (e instanceof StaleOperationError) return; throw e; }
      if (await settleUnknownReceipt(tx, execution, current)) return;
      if (error instanceof WanTemporaryError) {
        if (Number(current.progress.pollAttempts ?? 0) >= limits(current).polls || Number(current.progress.externalAttempts ?? 0) >= limits(current).externalAttempts) { await setRunState(tx, execution, "needs_review", "Wan poll retry limit exhausted"); return; }
        await retryReceivedRejection(tx, error.receiptId, error.attempt, error.response, error.message);
        await setRunState(tx, execution, "waiting", error.message, new Date(Date.now() + 60_000)); return;
      }
      const waiting = error instanceof BudgetExceededError || error instanceof ReceiptBusyError || error instanceof WanDisabledError;
      const reason = error instanceof SyntaxError ? "Wan response is not valid JSON" : String(error).slice(0, 300);
      await setRunState(tx, execution, waiting ? "waiting" : "needs_review", reason, waiting ? new Date(Date.now() + (error instanceof BudgetExceededError ? error.retryAfterSeconds : 60) * 1000) : null);
    }); return { runId, error: "Wan task requires attention" };
  }
}

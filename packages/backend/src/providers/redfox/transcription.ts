import type { ToolAuthorization } from "../../users/credits.ts";
import { z } from "zod";
import { sql } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { createRun, StaleOperationError, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { redfoxRequest, RedfoxResponseError } from "./client.ts";
import { TRANSCRIPTION_LIMITS, TranscriptionInput, TranscriptionQuery, TranscriptionTaskId, transcriptionPairs, type TranscriptionPlatform } from "./transcription-contract.ts";

export function transcriptionLimits(run: RunRow): typeof TRANSCRIPTION_LIMITS {
  const result = {} as typeof TRANSCRIPTION_LIMITS;
  for (const key of Object.keys(TRANSCRIPTION_LIMITS) as Array<keyof typeof TRANSCRIPTION_LIMITS>) {
    const value = run.limits[key];
    if (!Number.isSafeInteger(value) || value! < 0) throw new Error("Transcription run lacks valid frozen limits");
    result[key] = value!;
  }
  return result;
}
export function createTranscription(raw: unknown, actor: string, key: unknown, authorization?: ToolAuthorization) { return command(TranscriptionInput.parse(raw), actor, key, false, authorization); }
export function createTranscriptionQuery(raw: unknown, actor: string, key: unknown, authorization?: ToolAuthorization) { return command(TranscriptionQuery.parse(raw), actor, key, true, authorization); }
async function command(parameters: z.infer<typeof TranscriptionInput> | z.infer<typeof TranscriptionQuery>, actor: string, key: unknown, query: boolean, authorization?: ToolAuthorization) {
  const commandKey = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const operation = query ? "redfox.transcript.query" : "redfox.transcript.submit", intent = { operation, parameters };
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
    if (existing) { if (stableJson(existing.input.commandIntent) !== stableJson(intent)) throw new StaleOperationError("Command key reused with different input"); return existing; }
    const run = await createRun(tx, { actor, authorization, commandKey, provider: "redfox", operationKey: operation, contractVersion: 1,
      input: { commandIntent: intent, parameters, platform: parameters.platform, mode: query ? "transcript-query" : "transcript", startedAt: new Date().toISOString() },
      stepKey: query ? "redfox.transcript.poll" : "redfox.transcript.submit", limits: { ...TRANSCRIPTION_LIMITS } });
    await tx`UPDATE operation_runs SET progress=${tx.json({ pollSequence: 0, ...("taskId" in parameters ? { taskId: parameters.taskId } : {}) })} WHERE id=${run.id}`;
    await queueOperationStep(tx, run.id); return run;
  });
}
const Milliseconds = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d+$/)]);
const Segment = z.object({ textSeg: z.string(), start: Milliseconds, end: Milliseconds }).refine(s => BigInt(s.end) >= BigInt(s.start), "Segment end precedes start");
const Poll = z.object({ status: z.enum(["processing", "succeeded", "failed"]), taskId: TranscriptionTaskId.optional(), text: z.string().nullable().optional(), stampSents: z.array(Segment).nullable().optional(), failReason: z.string().nullable().optional() });
export function parseTranscriptionPoll(raw: unknown, requestedTaskId: string) {
  const data = Poll.parse(raw);
  if (data.taskId !== undefined && data.taskId !== requestedTaskId) throw new RedfoxResponseError("Transcription task ID mismatch");
  if (data.status === "succeeded" && !data.text?.trim()) throw new RedfoxResponseError("Successful transcription lacks complete text");
  return data;
}
export async function submitTranscription(platform: z.infer<typeof TranscriptionPlatform>, url: string, identity: string, paid: PaidRequestOptions) {
  const result = await redfoxRequest(transcriptionPairs[platform].submit, { url }, identity, "transcript", paid);
  return { ...result, data: z.object({ taskId: TranscriptionTaskId }).parse(result.data) };
}
export async function pollTranscription(platform: z.infer<typeof TranscriptionPlatform>, taskId: string, identity: string, paid: PaidRequestOptions) {
  const result = await redfoxRequest(transcriptionPairs[platform].poll, { taskId }, identity, "poll", paid);
  return { ...result, data: parseTranscriptionPoll(result.data, taskId) };
}
export function transcriptionOptions() {
  return { platforms: Object.entries(transcriptionPairs).map(([platform, pair]) => ({ platform, ...pair, submitEstimatedCny: platform === "videoUrl" ? 0.06 : 0.6, pollEstimatedCny: 0 })),
    limits: { ...TRANSCRIPTION_LIMITS }, services: { submission: "redfox.transcript", poll: "redfox.poll" }, timestampUnit: "milliseconds",
    inputHint: "支持所选平台链接或分享文案；直链交由供应商解析，本地不访问。", resultPurpose: "本地研究结果，不自动写入材料" };
}

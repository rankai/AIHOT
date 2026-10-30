import { z } from "zod";
import { sql } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { lockAssetInputs } from "../../operations/assets.ts";
import { createRun, lockMemberAdmission, StaleOperationError, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import type { ToolAuthorization } from "../../users/credits.ts";
import { WanInput, WAN_GENERATE, WAN_QUERY, WAN_LIMITS } from "./wan-contract.ts";
import { wanConfig } from "./wan-config.ts";
import { wanMedia } from "./wan-media.ts";

export async function createWanGeneration(raw: unknown, actor: string, key: unknown, authorization?: ToolAuthorization) {
  const parameters = WanInput.parse(raw), commandKey = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const commandIntent = { operation: WAN_GENERATE, parameters };
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
    if (existing) { if (stableJson(existing.input.commandIntent) !== stableJson(commandIntent)) throw new StaleOperationError("Command key reused with different input"); return existing; }
    await lockMemberAdmission(tx, actor);
    const fileKeys = [parameters.portraitFileKey, parameters.referenceVideoFileKey];
    await lockAssetInputs(tx, fileKeys);
    const media = await wanMedia(parameters, actor, tx);
    if (authorization && (authorization.intent.videoSeconds !== media.videoSeconds || stableJson(authorization.intent.input) !== stableJson({ ...parameters, media: { facts: media.facts, portraitHash: media.portraitHash, videoHash: media.videoHash } }))) throw new StaleOperationError("素材事实已变化，请重新报价");
    const run = await createRun(tx, { actor, commandKey, authorization, provider: "aliyun", operationKey: WAN_GENERATE, contractVersion: 1, input: { mode: "video", commandIntent, parameters, fileKeys, media, configIdentity: wanConfig(), priceSnapshot: { perSecondCny: parameters.mode === "wan-std" ? "0.6" : "0.9", currency: "CNY", basis: "documented-estimate", date: "2026-10-29" }, startedAt: new Date().toISOString() }, stepKey: "aliyun.wan.upload", limits: WAN_LIMITS });
    await tx`UPDATE operation_runs SET progress=${tx.json({ uploadIndex: 0, objects: [], pollSequence: 0 })} WHERE id=${run.id}`;
    await queueOperationStep(tx, run.id); return run;
  });
}
/** Member continuation inherits the original charge, task and all cumulative limits. Admin resumes the original run. */
export async function createWanQuery(raw: unknown, actor: string, key: unknown, authorization?: ToolAuthorization) {
  const { provider, runId } = z.object({ provider: z.literal("aliyun"), runId: z.number().int().positive().safe() }).strict().parse(raw);
  if (!authorization || authorization.intent.recoveryRunId !== runId) throw new StaleOperationError("Continue the original owned task");
  const commandKey = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key), commandIntent = { operation: WAN_QUERY, runId };
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
    if (existing) { if (stableJson(existing.input.commandIntent) !== stableJson(commandIntent)) throw new StaleOperationError("Command key reused with different input"); return existing; }
    await lockMemberAdmission(tx, actor);
    const [parent] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${runId} AND actor=${actor} AND operation_key=${WAN_GENERATE} FOR UPDATE`;
    if (!parent || !parent.progress.taskId || !parent.progress.submissionReceiptId) throw new StaleOperationError("原任务缺少供应商任务证据");
    const run = await createRun(tx, { actor, commandKey, authorization, provider, operationKey: WAN_QUERY, contractVersion: 1, input: { ...parent.input, mode: "video-query", commandIntent, rootRunId: parent.id }, stepKey: "aliyun.wan.poll", limits: parent.limits });
    await tx`UPDATE operation_runs SET progress=${tx.json({ ...parent.progress, rootRunId: parent.id, pollSequence: 0, pollAttempts: 0, externalAttempts: 0 } as never)} WHERE id=${run.id}`;
    await queueOperationStep(tx, run.id); return run;
  });
}

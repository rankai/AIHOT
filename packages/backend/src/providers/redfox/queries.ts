import {lockOriginResult} from "../../operations/result-retention.ts";
import {xDetailOrigin} from "./x-detail-origin.ts";
import { z } from "zod";
import { sql } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { createRun, StaleOperationError, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import { AccountInput } from "./x.ts";

export function createAccountQuery(raw: unknown, actor: string, key: unknown) {return createQuery("redfox.x.account",AccountInput.parse(raw),actor,key);}
export function createTweetQuery(raw: unknown, actor: string, key: unknown) {const {sourceResultId,...input}=z.object({tweetId:z.string().regex(/^\d+$/).max(30),sourceResultId:z.number().int().positive().safe().optional()}).strict().parse(raw);return createQuery("redfox.x.detail",input,actor,key,sourceResultId);}
async function createQuery(operation:"redfox.x.account"|"redfox.x.detail",input:Record<string,unknown>,actor:string,key:unknown,sourceResultId?:number) {
  const commandKey = z.string({ error: "Idempotency-Key is required" }).regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const intent = { operation, input,...(sourceResultId!==undefined?{sourceResultId}:{}) };
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor = ${actor} AND command_key = ${commandKey}`;
    if (existing) {
      if (stableJson(existing.input.commandIntent) !== stableJson(intent)) throw new StaleOperationError("Command key reused with different input");
      return existing;
    }
    if(sourceResultId!==undefined)await lockOriginResult(tx,sourceResultId);
    const origin=sourceResultId===undefined?undefined:await xDetailOrigin(tx,sourceResultId,String(input.tweetId));
    // Local half-hour X snapshot reuse policy, not a provider-wide TTL.
    const window = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000).toISOString();
    const run = await createRun(tx, { actor, commandKey, provider: "redfox", operationKey: operation, contractVersion: 1,
      stepKey: operation, input: { ...(origin?{origin}:{}),commandIntent: intent, parameters: input, window, mode: "query" }, limits: { steps: 1, retries: 3 } });
    await queueOperationStep(tx, run.id);
    return run;
  });
}

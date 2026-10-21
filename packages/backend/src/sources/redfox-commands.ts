import { sql } from "../db.ts";
import { stableJson } from "../lib/ids.ts";
import { createRun,StaleOperationError,type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { preflightXReplacement,UnsupportedReplacement } from "./x-replacement.ts";

export async function createRedfoxCollection(sourceId:string,command:{actor:string;key:string;reason:"manual"|"schedule";force?:boolean;preview?:boolean}) {
  const intent=command.preview?{sourceId,kind:"saved-preview"}:{sourceId,reason:command.reason,force:command.force??false};
  return sql.begin(async(tx)=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${command.actor}:${command.key}`}))`;
    const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${command.actor} AND command_key=${command.key}`;
    if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
    const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE control_source_id=${sourceId} FOR UPDATE`;
    const [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR SHARE`;
    if(!sub || !source || sub.provider!=="redfox")throw new StaleOperationError("Redfox subscription changed");
    // Run creation can occur without credentials for local replay; dispatch enforces valves and budgets.
    const check=await preflightXReplacement(sourceId,"redfox",tx);
    const bad=check!.checks.filter(c=>c.key!=="credentials" && c.key!=="incremental" && c.conclusion==="unsupported");
    if(bad.length)throw new UnsupportedReplacement(bad.map(c=>c.evidence).join("; "));
    const continuation=command.preview?null:sub.progress.continuation;
    const window=continuation?.window??new Date(Math.floor(Date.now()/1_800_000)*1_800_000).toISOString();
    const run=await createRun(tx,{actor:command.actor,commandKey:command.key,provider:"redfox",operationKey:"redfox.x.timeline",contractVersion:1,
      subscriptionIds:command.preview?[]:[sub.id],...(command.force && !command.preview && command.reason==="manual"?{forceSourceId:sourceId}:{}),
      stepKey:"redfox.x.page",input:{commandIntent:intent,mode:command.preview?"preview":"collection",source:{id:sourceId,config:sub.config,cursor:sub.progress},
        restId:sub.config.restId,window,startedAt:continuation?.startedAt??new Date().toISOString(),continuation},limits:{steps:120,retries:3,pages:10,items:100,details:100}});
    await queueOperationStep(tx,run.id);return run;
  });
}

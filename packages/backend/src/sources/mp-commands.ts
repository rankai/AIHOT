import { sql } from "../db.ts";
import { stableJson } from "../lib/ids.ts";
import { createRun,StaleOperationError,type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { preflightMpReplacement } from "./mp-replacement.ts";
import { UnsupportedReplacement } from "./x-replacement.ts";
export async function createRedfoxMpCollection(sourceId:string,command:{actor:string;key:string;reason:"manual"|"schedule";force?:boolean;preview?:boolean}){
  const intent=command.preview?{sourceId,kind:"saved-preview"}:{sourceId,reason:command.reason,force:command.force??false};
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${command.actor}:${command.key}`}))`;
    const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${command.actor} AND command_key=${command.key}`;
    if(existing){if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
    const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE control_source_id=${sourceId} FOR UPDATE`;
    const [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR SHARE`;
    if(!sub||!source||source.kind!=="mp_account"||sub.provider!=="redfox"||sub.operation_key!=="redfox.wechat.collection")throw new StaleOperationError("Redfox MP subscription changed");
    const check=await preflightMpReplacement(sourceId,"redfox",sub.config.redfoxLibrary,tx);
    const bad=check!.checks.filter(c=>c.key!=="credentials"&&["unsupported","unavailable"].includes(c.conclusion));
    if(bad.length)throw new UnsupportedReplacement(bad.map(c=>c.evidence).join("; "));
    const now=Date.now();
    const run=await createRun(tx,{actor:command.actor,commandKey:command.key,provider:"redfox",operationKey:"redfox.wechat.collection",contractVersion:1,
      subscriptionIds:command.preview?[]:[sub.id],...(command.force&&!command.preview&&command.reason==="manual"?{forceSourceId:sourceId}:{}),stepKey:"redfox.wechat.page",
      input:{commandIntent:intent,mode:command.preview?"preview":"collection",source:{id:sourceId,config:sub.config,cursor:sub.progress,interval_minutes:sub.interval_minutes},mapping:check!.mapping,library:sub.config.redfoxLibrary,
        window:`${command.reason==="schedule"?"s":"m"}:${Math.floor(now/600_000)}`,startedAt:new Date(now).toISOString()},limits:{steps:12,items:8,details:8,retries:3}});
    await queueOperationStep(tx,run.id);return run;
  });
}

import {z} from "zod";
import {sql} from "../../db.ts";
import {createRun} from "../operations/store.ts";
import {queueOperationStep} from "../operations/queue.ts";
import {douyinKeywordInput,douyinSearchRoute} from "./douyin-contract.ts";
export async function createAgentKeyQuery(raw:unknown,actor:string,key:unknown){
  const request=z.strictObject({provider:z.literal("agentkey"),operationId:z.literal("OWIBYU1V"),parameters:douyinKeywordInput}).parse(raw);
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  return sql.begin(async tx=>{
    const run=await createRun(tx,{actor,commandKey,provider:"agentkey",operationKey:douyinSearchRoute.operationKey,stepKey:douyinSearchRoute.stepKey,contractVersion:1,input:{...request,mode:"query",platform:"douyin",tool:douyinSearchRoute.tool,upstream:"TikHub"},limits:{pages:1,retries:3}});
    await queueOperationStep(tx,run.id);return run;
  });
}

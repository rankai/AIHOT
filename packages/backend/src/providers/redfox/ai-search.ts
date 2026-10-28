import { z } from "zod";
import { sql } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { createRun, StaleOperationError, type RunRow } from "../operations/store.ts";
import { queueOperationStep } from "../operations/queue.ts";
import type { PaidRequestOptions } from "../receipts.ts";
import { redfoxRequest, RedfoxResponseError } from "./client.ts";
import { AI_SEARCH_LIMITS, AiSearchInput, AiSearchQuery, AiSearchTaskId, aiSearchEngines, aiSearchPolls, AiSearchFamily } from "./ai-search-contract.ts";

export function aiSearchLimits(run: RunRow): typeof AI_SEARCH_LIMITS {
  const result = {} as typeof AI_SEARCH_LIMITS;
  for (const key of Object.keys(AI_SEARCH_LIMITS) as Array<keyof typeof AI_SEARCH_LIMITS>) {
    const value = run.limits[key];
    if (!Number.isSafeInteger(value) || value! < 0) throw new Error("AI search run lacks valid frozen limits");
    result[key] = value!;
  }
  return result;
}
export function createAiSearch(raw: unknown, actor: string, key: unknown) { return command(AiSearchInput.parse(raw), actor, key, false); }
export function createAiSearchQuery(raw: unknown, actor: string, key: unknown) { return command(AiSearchQuery.parse(raw), actor, key, true); }
async function command(parameters: z.infer<typeof AiSearchInput> | z.infer<typeof AiSearchQuery>, actor: string, key: unknown, query: boolean) {
  const commandKey = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const operation = query ? "redfox.ai_search.query" : "redfox.ai_search.submit", intent = { operation, parameters };
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
    const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;
    if (existing) { if (stableJson(existing.input.commandIntent) !== stableJson(intent)) throw new StaleOperationError("Command key reused with different input"); return existing; }
    const run = await createRun(tx, { actor, commandKey, provider: "redfox", operationKey: operation, contractVersion: 1,
      input: { commandIntent: intent, parameters, family: "engine" in parameters ? aiSearchEngines[parameters.engine].family : parameters.family, mode: query ? "ai-search-query" : "ai-search", startedAt: new Date().toISOString() },
      stepKey: query ? "redfox.ai_search.poll" : "redfox.ai_search.submit", limits: { ...AI_SEARCH_LIMITS } });
    await tx`UPDATE operation_runs SET progress=${tx.json({ pollSequence: 0, ...("taskId" in parameters ? { taskId: parameters.taskId } : {}) })} WHERE id=${run.id}`;
    await queueOperationStep(tx, run.id); return run;
  });
}
const Citation=z.record(z.string(),z.unknown());
const Result=z.object({content:z.string().nullable().optional(),webPages:z.array(Citation).nullable().optional(),search_result:z.array(Citation).nullable().optional()}).passthrough();
const CardText=z.string().nullable().optional();
const ProductCard=z.object({title:z.string().min(1),price:CardText,originPrice:CardText,url:CardText,image:CardText,shopName:CardText,sales:CardText,sourceSeq:CardText,itemId:CardText,productId:CardText,shortTitle:CardText,pos:z.number().int().nonnegative().nullable().optional()}).passthrough();
const ProductResult=Result.extend({cardData:z.array(ProductCard).max(1000).nullable().optional(),searchGuid:z.array(Citation).nullable().optional()});
const Poll=z.object({taskId:AiSearchTaskId.optional(),status:z.string().min(1),completed:z.boolean().optional(),failReason:z.string().nullable().optional(),result:Result.nullable().optional()}).passthrough();
export function parseAiSearchPoll(family:z.infer<typeof AiSearchFamily>,raw:unknown,taskId:string){
 const products=family==="qianwenProducts"||family==="doubaoProducts";
 const data=(products?Poll.extend({result:ProductResult.nullable().optional()}):Poll).parse(raw);
 if(data.taskId!==undefined&&data.taskId!==taskId)throw new RedfoxResponseError("AI search task ID mismatch");
 if(family!=="kimi"&&data.taskId===undefined)throw new RedfoxResponseError("AI search response lacks task ID");
 const success=["completed",...(family==="doubao"||family==="deepseek"?["succeeded"]:[])].includes(data.status);
 const failure=data.status==="failed"||!!data.failReason?.trim();
 let state:"pending"|"succeeded"|"failed";
 if(success&&failure)throw new RedfoxResponseError("AI search completion conflicts with failure");
 if(family==="kimi"){
  if(data.completed===undefined)throw new RedfoxResponseError("Kimi response lacks completion flag");
  if(success!==data.completed&&!failure)throw new RedfoxResponseError("Kimi completion flag conflicts with status");
  state=failure?"failed":data.completed?"succeeded":"pending";
 }else{
  const pending=family==="doubao"||family==="deepseek"?["queued","running"]:["processing"];
  if(!success&&data.status!=="failed"&&!pending.includes(data.status))throw new RedfoxResponseError("Unknown AI search status");
  state=failure?"failed":success?"succeeded":"pending";
 }
 if(state==="succeeded"&&!data.result?.content?.trim())throw new RedfoxResponseError("Successful AI search lacks answer content");
 const {webPages,search_result,...otherResult}=data.result??{};
 const records=family==="kimi"?webPages??[]:family==="doubao"||family==="deepseek"?search_result??[]:[];
 const citations=records.map(record=>{
  let url:string|null=null;
  if(typeof record.url==="string"){try{const u=new URL(record.url);if(["https:","http:"].includes(u.protocol)&&!u.username&&!u.password)url=record.url;}catch{/* Retain the original record without an actionable URL. */}}
  return {record,url};
 });
 const facts={...data,result:data.result===null?null:data.result===undefined?undefined:otherResult};
 return {state,facts,content:data.result?.content,citations};
}
export async function submitAiSearch(parameters:z.infer<typeof AiSearchInput>,identity:string,paid:PaidRequestOptions){
 const result=await redfoxRequest(aiSearchEngines[parameters.engine].submit,{inquiryText:parameters.inquiryText},identity,"ai_search",paid);
 return {...result,data:z.object({taskId:AiSearchTaskId}).passthrough().parse(result.data)};
}
export async function pollAiSearch(family:z.infer<typeof AiSearchFamily>,taskId:string,identity:string,paid:PaidRequestOptions){
 const result=await redfoxRequest(aiSearchPolls[family],{taskId},identity,"poll",paid);
 return {...result,data:parseAiSearchPoll(family,result.data,taskId)};
}
export function aiSearchOptions(){return {currency:"CNY",priceBasis:"estimated",pollEstimatedCny:0,engines:Object.entries(aiSearchEngines).map(([engine,value])=>({engine,...value})),queries:Object.entries(aiSearchPolls).map(([family,poll])=>({family,poll})),limits:{...AI_SEARCH_LIMITS},inquiryMaxCharacters:10000,inputHint:"本地上限 10,000 个 JavaScript 字符；原文与空白原样提交。",services:{submission:"redfox.ai_search",poll:"redfox.poll"},resultPurpose:"本地研究答案和来源，不自动写入材料"};}

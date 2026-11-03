import { XHS_COVER_OPERATION } from "../providers/redfox/xhs-cover-contract.ts";
import { z } from "zod";
import sharp from "sharp";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql,type Tx } from "../db.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { sha256,stableJson } from "../lib/ids.ts";
import { assetPath,prepareUpload,writeUpload,publishUpload,getAsset,IMAGE_PIXELS } from "../operations/assets.ts";
import { createRun,claimRun,requireExecution,receiptOptions,saveResult,advanceRun,setRunState,StaleOperationError,type Execution,type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { settleUnknownReceipt } from "../providers/operations/recovery.ts";
import { paidRequest,checkBudget,estimatedCatalogCost,BudgetExceededError,ReceiptBusyError } from "../providers/receipts.ts";
import { modelBillingProvider } from "../providers/llm.ts";
import { resolveDeepSeekPriceSnapshot } from "../providers/deepseek-pricing.ts";
import { responseUsage } from "./model.ts";
import { contextTokens } from "./context.ts";
import { coverVisionModel,coverVisionOutbound } from "./cover-vision-model.ts";
import { COVER_VISION_OPERATION,COVER_PREPROCESS_VERSION,CoverVisionProposal,CoverVisionInput,CoverObservation,type VisionInput,type Observation } from "./cover-vision-contract.ts";
import { conflict } from "./store.ts";
import type { ToolAuthorization } from "../users/credits.ts";
import { assertMemberCostEligible } from "../users/member-pricing.ts";

type Reference={sourceId:string;status:"ready"|"download_failed";fileKey?:string;sha256?:string;mime?:string;bytes?:number;error?:string};
type Progress={references:Reference[];batches:string[][];nextBatch:number;observations:Observation[]};
const progressOf=(run:RunRow):Progress=>({references:[],batches:[],nextBatch:0,observations:[],...run.progress} as Progress);
export const coverVisionIntent=(input:VisionInput)=>({kind:"assistant-vision" as const,provider:"assistant",model:input.model.model,input:input as unknown as Record<string,unknown>});
export async function prepareCoverVisionInput(turn:Record<string,any>,raw:unknown):Promise<VisionInput> {
 const proposal=CoverVisionProposal.parse(raw);
 const rows=await sql`SELECT z.id,z.run_id,z.data FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN assistant_tool_calls c ON c.child_run_id=r.id
 WHERE r.operation_key='redfox.sync.query' AND r.input->>'operationId'=${XHS_COVER_OPERATION} AND c.turn_id=${turn.id} AND c.name='search_xhs_covers' AND c.state='completed' AND r.status='completed' AND r.actor=${`user:${turn.owner_user_id}`} AND z.kind='xhs_cover_candidate'`;
 const selections=proposal.samples.map(sample=>{const row=rows.find(r=>r.data.sourceId===sample.sourceId);if(!row)throw conflict("只能选择本回合已完成封面查询的来源");return {resultId:row.id,sourceId:sample.sourceId,reason:sample.reason,coverUrl:row.data.coverUrl};});
 const runIds=new Set(rows.filter(r=>selections.some(s=>s.resultId===r.id)).map(r=>r.run_id));if(runIds.size!==1)throw conflict("封面样本必须来自同一次查询");
 return CoverVisionInput.parse({assistantParentTurnId:turn.id,activationId:proposal.activationId,queryRunId:[...runIds][0],selections,model:await coverVisionModel(),preprocessVersion:COVER_PREPROCESS_VERSION});
}
export async function createCoverVisionTx(tx:Tx,raw:unknown,actor:string,key:string,authorization:ToolAuthorization) {
 const input=CoverVisionInput.parse(raw);
 if(new Set(input.selections.map(s=>s.sourceId)).size!==input.selections.length)throw conflict("重复封面来源");
 const rows=await tx`SELECT z.id,z.data FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN assistant_tool_calls c ON c.child_run_id=r.id
 WHERE r.operation_key='redfox.sync.query' AND r.input->>'operationId'=${XHS_COVER_OPERATION} AND r.id=${input.queryRunId} AND r.actor=${actor} AND r.status='completed' AND c.turn_id=${input.assistantParentTurnId} AND c.name='search_xhs_covers' AND c.state='completed' AND z.kind='xhs_cover_candidate' FOR SHARE OF z`;
 if(input.selections.some(s=>!rows.some(r=>r.id===s.resultId&&r.data.sourceId===s.sourceId&&r.data.coverUrl===s.coverUrl)))throw conflict("封面来源已失效或归属不匹配");
 if(stableJson(authorization.intent)!==stableJson(coverVisionIntent(input)))throw conflict("视觉报价与冻结输入不匹配");
 await assertMemberCostEligible(authorization.intent);coverVisionOutbound(input.model);await checkBudget(tx,"assistant.vision");await checkBudget(tx,"assistant.vision","member");
 const run=await createRun(tx,{actor,commandKey:key,provider:"assistant",operationKey:COVER_VISION_OPERATION,contractVersion:1,stepKey:"assistant.coverVision.prepare",input,limits:{steps:9,retries:0,externalAttempts:4},authorization});
 await queueOperationStep(tx,run.id);return run;
}
async function downloadReference(url:string) {
 const response=await guardedFetch(url,{timeoutMs:20000,maxBytes:15*1024*1024,headers:{accept:"image/jpeg,image/png,image/webp"}});
 if(response.status!==200)throw new Error("封面图片下载失败");
 const metadata=await sharp(response.body,{limitInputPixels:IMAGE_PIXELS,failOn:"error"}).metadata();
 if(!["jpeg","png","webp"].includes(metadata.format??"")||(metadata.pages??1)!==1||!metadata.width||!metadata.height)throw new Error("仅支持静态JPEG/PNG/WebP封面");
 const bytes=await sharp(response.body,{limitInputPixels:IMAGE_PIXELS,failOn:"error"}).rotate().resize({width:1200,height:1200,fit:"inside",withoutEnlargement:true}).webp({quality:88}).toBuffer();
 if(bytes.length>1048576)throw new Error("封面预处理后超过1MiB，未降低尺寸或静默重试");
 return bytes;
}
async function prepareReferences(execution:Execution,run:RunRow,input:VisionInput) {
 const progress=progressOf(run);
 for(const selected of input.selections.filter(s=>!progress.references.some(r=>r.sourceId===s.sourceId)).slice(0,5)) {
  if(progress.references.some(r=>r.sourceId===selected.sourceId))continue;
  await sql.begin(tx=>requireExecution(tx,execution));coverVisionOutbound(input.model);
  let bytes:Buffer;
  try{bytes=await downloadReference(selected.coverUrl);}catch{
   progress.references.push({sourceId:selected.sourceId,status:"download_failed",error:"图片下载或静态图片校验失败"});
   await sql.begin(async tx=>{await requireExecution(tx,execution);await tx`UPDATE operation_runs SET progress=${tx.json(progress)} WHERE id=${run.id}`;});continue;
  }
  const temporary=await prepareUpload(1048576);
  try {
   const written=await writeUpload(Readable.from(bytes),temporary.file,AbortSignal.timeout(20000),1048576);
   const key=`uploads/redfox/${sha256(`${run.id}:${selected.sourceId}:${input.preprocessVersion}`)}`;
   await sql.begin(async tx=>{
    await requireExecution(tx,execution);
    const asset=await publishUpload({actor:`operation:${run.id}`,key,file:temporary.file,filename:"cover.webp",mime:"image/webp",...written,purpose:"operation-output",origin:"assistant-cover-reference"},tx);
    const reference:Reference={sourceId:selected.sourceId,status:"ready",fileKey:asset.key,sha256:asset.sha256,mime:asset.content_type,bytes:asset.bytes};
    await saveResult(tx,execution,{itemKey:`reference:${selected.sourceId}`,kind:"assistant_cover_reference",fileKey:asset.key,data:{...reference,resultId:selected.resultId,queryRunId:input.queryRunId,preprocessVersion:input.preprocessVersion}});
    progress.references.push(reference);await tx`UPDATE operation_runs SET progress=${tx.json(progress)} WHERE id=${run.id}`;
   });
  } finally {await temporary.release();}
 }
 if(progress.references.length<input.selections.length){await sql.begin(async tx=>{await advanceRun(tx,execution,{stepKey:"assistant.coverVision.prepare",progress});await queueOperationStep(tx,run.id);});return;}
 const ready=progress.references.filter(r=>r.status==="ready");if(!ready.length)throw new Error("没有可分析的封面图片，不能交付视觉报告");
 progress.batches=[];for(let i=0;i<ready.length;i+=5)progress.batches.push(ready.slice(i,i+5).map(r=>r.sourceId));
 await sql.begin(async tx=>{await advanceRun(tx,execution,{stepKey:"assistant.coverVision.batch",progress});await queueOperationStep(tx,run.id);});
}
const instruction="逐图观察输入的真实图片，严格按sourceId返回JSON对象observations数组。每张status为observed或unreadable；字段text(可读原文)、subject(主体)、colors(色调)、layout(构图排版)、uncertainties(不可判定项数组)。不要用标题猜图，不补字。每图简洁，所有图片合计输出不超过4096 tokens。看不清应标unreadable并说明，不能假装成功。";
async function analyzeBatch(execution:Execution,run:RunRow,input:VisionInput) {
 const progress=progressOf(run),ids=progress.batches[progress.nextBatch];
 if(!ids?.length||ids.length>5||progress.batches.length>4||progress.nextBatch>=4)throw new Error("无效视觉批次");
 const references=ids.map(id=>progress.references.find(r=>r.sourceId===id&&r.status==="ready")!);
 if(references.some(r=>!r))throw new Error("视觉批次引用缺失");
 const textInput={instruction,samples:ids.map(sourceId=>({sourceId,reason:input.selections.find(s=>s.sourceId===sourceId)!.reason}))};
 if(contextTokens(JSON.stringify(textInput))>4096)throw new Error("视觉文字输入超过4096 tokens");
 let totalBytes=0;const content:Record<string,unknown>[]=[{type:"text",text:JSON.stringify(textInput)}];
 for(const reference of references){
  const asset=await getAsset(reference.fileKey!);if(asset.status!=="available"||asset.sha256!==reference.sha256)throw new Error("冻结封面素材已变化");
  const bytes=await readFile(assetPath(asset.key));totalBytes+=bytes.length;
  if(bytes.length>1048576||createHash("sha256").update(bytes).digest("hex")!==reference.sha256)throw new Error("冻结图片字节校验失败");
  content.push({type:"text",text:`sourceId: ${reference.sourceId}`},{type:"image_url",image_url:{url:`data:${reference.mime};base64,${bytes.toString("base64")}`}});
 }
 if(totalBytes>5242880)throw new Error("视觉批次超过5MiB");
 const body=JSON.stringify({model:input.model.model,messages:[{role:"user",content}],max_tokens:4096,...(input.model.jsonMode?{response_format:{type:"json_object"}}:{}),...input.model.extra});
 const base=receiptOptions(execution);
 const receipt=await paidRequest({service:"assistant.vision",purpose:COVER_VISION_OPERATION,model:input.model.model,pricingKey:{service:input.model.service,model:input.model.model},costIdentity:{billingProvider:modelBillingProvider(input.model.baseURL),operation:"chat.completions",model:input.model.model},subject:`${run.id}:${progress.nextBatch}`,identity:{runId:run.id,batch:progress.nextBatch,requestHash:sha256(body)},requestSummary:{runId:run.id,batch:progress.nextBatch,sourceIds:ids,images:references.length,imageBytes:totalBytes,textTokens:contextTokens(JSON.stringify(textInput))}},async({priceSnapshot})=>{
  const response=await fetch(`${input.model.baseURL.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{authorization:`Bearer ${coverVisionOutbound(input.model)}`,"content-type":"application/json"},body,redirect:"error",signal:AbortSignal.timeout(90000)});
  const text=await response.text();if(Buffer.byteLength(text)>2097152)throw new Error("视觉响应超过上限");
  return {response:{status:response.status,body:text},usage:responseUsage(text),cost:response.ok?estimatedCatalogCost(priceSnapshot,responseUsage(text)):null,requestId:response.headers.get("x-request-id")};
 },{...base,resolvePriceSnapshot:resolveDeepSeekPriceSnapshot,onReceipt:async(tx,id,info)=>{
  if(info.kind==="call"){
   coverVisionOutbound(input.model);
   const [attempt]=await tx`SELECT attempts FROM receipts WHERE id=${id}`;if(attempt!.attempts>1)throw new Error("视觉请求已尝试，不能自动重新外发");
   const [cost]=await tx`SELECT 1 FROM service_prices WHERE service=${input.model.service} AND model=${input.model.model} AND input_per_mtok>=0 AND output_per_mtok>=0 AND source_url IS NOT NULL`;if(!cost)throw new Error("视觉模型精确成本尚未核定");
  }
  await base.onReceipt!(tx,id,info);
 }});
 const raw=receipt.response as {status:number;body:string};if(raw.status!==200)throw new Error("视觉模型响应失败，回执已保留");
 const response=JSON.parse(raw.body),choice=response.choices?.[0];if(choice?.finish_reason!=="stop")throw new Error("视觉响应未完整结束，不能交付");
 const observations=z.object({observations:z.array(CoverObservation).min(1).max(5)}).strict().parse(JSON.parse(choice.message?.content)).observations;
 if(observations.length!==ids.length||new Set(observations.map(o=>o.sourceId)).size!==ids.length||observations.some(o=>!ids.includes(o.sourceId)))throw new Error("视觉结果缺图或来源ID不匹配");
 progress.observations.push(...observations);progress.nextBatch++;
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  await saveResult(tx,execution,{itemKey:`batch:${progress.nextBatch-1}`,kind:"assistant_vision_batch",receiptId:receipt.receiptId,data:{sourceIds:ids,observations}});
  if(progress.nextBatch<progress.batches.length){await advanceRun(tx,execution,{stepKey:"assistant.coverVision.batch",progress});await queueOperationStep(tx,run.id);return;}
  const observedCount=progress.observations.filter(o=>o.status==="observed").length;
  if(!observedCount)throw new Error("视觉模型未成功观察任何图片，不能结算报告");
  await saveResult(tx,execution,{itemKey:"report",kind:"assistant_vision_report",receiptId:receipt.receiptId,data:{complete:true,observedCount,selectedCount:input.selections.length,analyzedCount:progress.observations.length,failed:progress.references.filter(r=>r.status!=="ready"),observations:progress.observations,references:progress.references,queryRunId:input.queryRunId,activationId:input.activationId,preprocessVersion:input.preprocessVersion}});
  await advanceRun(tx,execution,null);
 });
}
export async function executeCoverVisionStep(runId:number,stepVersion:number,jobId:string) {
 const [run]=await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${runId}`;if(!run||run.operation_key!==COVER_VISION_OPERATION)return {skipped:true};
 let execution:Execution;try{execution=await sql.begin(tx=>claimRun(tx,{runId,stepVersion,generation:run.generation},jobId));}catch(error){if(error instanceof StaleOperationError)return {skipped:true};throw error;}
 try{const {members,forceSourceId,...frozen}=run.input;const input=CoverVisionInput.parse(frozen);if(run.step_key==="assistant.coverVision.prepare")await prepareReferences(execution,run,input);else await analyzeBatch(execution,run,input);return {runId};}
 catch(error){if(error instanceof StaleOperationError)return {skipped:true};await sql.begin(async tx=>{
  let current:RunRow;try{current=await requireExecution(tx,execution);}catch(e){if(e instanceof StaleOperationError)return;throw e;}
  if(await settleUnknownReceipt(tx,execution,current))return;
  const waiting=error instanceof BudgetExceededError||error instanceof ReceiptBusyError;
  await setRunState(tx,execution,waiting?"waiting":"needs_review",String(error).slice(0,500),waiting?new Date(Date.now()+60000):null);
 });return {runId,error:String(error)};}
}
export function coverVisionResults(rows:{id:number;kind:string;data:Record<string,any>}[]) {
 const report=rows.find(r=>r.kind==="assistant_vision_report");if(!report||report.data.complete!==true||report.data.observedCount<1)throw conflict("视觉报告尚未完成");
 let limit=300;
 for(;;){
  const observations=(report.data.observations as Observation[]).map(o=>({sourceId:o.sourceId,status:o.status,...Object.fromEntries((["text","subject","colors","layout"] as const).filter(key=>o[key].length&&limit>0).map(key=>[key,o[key].trim().slice(0,limit)])),...(limit>0&&o.uncertainties.length?{uncertainties:o.uncertainties.slice(0,3).map(s=>s.trim().slice(0,limit))}:{}),truncated:[o.text,o.subject,o.colors,o.layout,...o.uncertainties].some(s=>s.length>limit)||o.uncertainties.length>3}));
  const result={reportId:report.id,observedCount:report.data.observedCount,selectedCount:report.data.selectedCount,analyzedCount:report.data.analyzedCount,failed:report.data.failed.map((r:Reference)=>({sourceId:r.sourceId,status:r.status})),observations};
  if(limit===0)throw conflict("视觉来源记录超过上下文容量，无法同时保留全部来源与实际观察要点");
  if(JSON.stringify(result).length<=6000)return result;
  limit=Math.floor(limit/2);
 }
}

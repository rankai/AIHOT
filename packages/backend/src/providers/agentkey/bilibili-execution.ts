import {sql,type Tx} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {advanceRun,requireExecution,saveResult,retainCurrentReceipt,type Execution,type RunRow} from '../operations/store.ts';
import {queueOperationStep} from '../operations/queue.ts';
import {agentKeyRouteFor,agentKeyRouteInput} from './routes.ts';
import {parseAgentKeyBilibili} from './bilibili-parser.ts';
import {agentKeyBilibiliOperations,bilibiliDetailRoute,bilibiliEnrichmentIds,type AgentKeyBilibiliRoute} from './bilibili-contract.ts';
import {bilibiliResultSnapshot,bilibiliResultEvidence,bilibiliDetailParameters} from './bilibili-evidence.ts';
import {importBilibiliResult} from '../redfox/import-bilibili.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {requestAgentKey,retryAgentKeyRateLimit} from './request.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
async function finish(tx:Tx,e:Execution,run:RunRow,progress:Record<string,unknown>){
 await tx`UPDATE collection_subscriptions SET progress=${tx.json(progress as never)},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
 await advanceRun(tx,e,null);
}
export async function executeAgentKeyBilibili(execution:Execution){
 const run=await sql.begin(tx=>requireExecution(tx,execution)),route=agentKeyRouteFor(run) as AgentKeyBilibiliRoute|undefined;
 const base=agentKeyBilibiliOperations.find(o=>o.operationId===run.input.operationId),op=agentKeyBilibiliOperations.find(o=>o.route===route);
 if(!route||!base||!op||!['query','collection'].includes(String(run.input.mode)))throw new AgentKeyPayloadError('Unsupported Bilibili execution');
 const collection=run.input.mode==='collection',detail=collection&&route===bilibiliDetailRoute,service=collection?'agentkey.collect':'agentkey.query';
 const params=agentKeyRouteInput(route,detail?run.progress.parameters:run.input.parameters);
 const detailItems=Array.isArray(run.progress.detailItems)?run.progress.detailItems as number[]:[],index=Number(run.progress.detailIndex??0);
 let originResultId:number|undefined;
 if(detail){
  if(!Number.isSafeInteger(index)||index<0||index>=detailItems.length||new Set(detailItems).size!==detailItems.length||detailItems.length>Math.min(run.limits.items??100,run.limits.details??0))throw new AgentKeyPayloadError('Bilibili detail progress exceeds frozen limits');
  originResultId=detailItems[index];const source=await bilibiliResultSnapshot(sql,originResultId!);
  if(!source||source.run_id!==run.id||source.step_version>=run.step_version||source.data.operationId!==base.operationId)throw new AgentKeyPayloadError('Missing frozen Bilibili discovery');
  const original=await bilibiliResultEvidence(sql,source);
  if(stableJson(params)!==stableJson(bilibiliDetailParameters(original.parsed)))throw new AgentKeyPayloadError('Bilibili detail parameters differ from received discovery');
 }
 const [local]=run.current_receipt_id?await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id} AND status='received'`:[];
 if(local){
  const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,stepVersion:run.step_version,endpoint:local.request?.endpoint,contractVersion:1,tool:route.tool,params}});
  if(local.logical_key!==logicalKey||local.model!==route.tool||local.service!==service||local.purpose!==route.operationKey||local.subject!==`operation:${run.id}`||local.request?.tool!==route.tool||stableJson(local.request?.params)!==stableJson(params))throw new AgentKeyPayloadError('Bilibili receipt differs from frozen query');
  await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
 }
 const receipt=local?{receiptId:local.id,attempt:local.attempts,response:local.response}:await requestAgentKey(execution,run,route,params);
 const page=parseAgentKeyBilibili(receipt.response,route,params);
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  const [current]=await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
  if(!current)throw new AgentKeyPayloadError('Bilibili receipt superseded');
  const selected=collection&&!detail?page.candidates.slice(0,run.limits.items??100):page.candidates;
  const summaryId=await saveResult(tx,execution,{itemKey:'query_summary',kind:'query_summary',receiptId:receipt.receiptId,data:{...page.summary,platform:'bilibili',provider:'agentkey',operationId:op.operationId,tool:route.tool,contractVersion:1,...(originResultId?{originResultId}:{}),...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}:{})}});
  const resultIds:number[]=[];
  for(const item of selected){
   const id=await saveResult(tx,execution,{...item,data:{...item.data,querySummaryId:summaryId},receiptId:receipt.receiptId});
   if(item.kind==='bilibili_work'&&item.data.role==='native_video')resultIds.push(id);
   if(detail){
    // Alias/author contradictions must retain the receipt for review. Missing MID is a pending item.
    await bilibiliResultEvidence(tx,(await bilibiliResultSnapshot(tx,id))!);
    try{await tx.savepoint(async nested=>{await importBilibiliResult(id,{reason:'AgentKey B站订阅详情采集'},'collector',`agentkey-import:${id}`,nested);});}
    catch(error){if(!(error instanceof UnsupportedReplacement))throw error;await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${id}`;}
   }
  }
  if(!collection){await advanceRun(tx,execution,null);return;}
  if(detail){
   const next=index+1,progress={...run.progress,details:Number(run.progress.details??0)+1,detailIndex:next};
   if(next<detailItems.length){const source=await bilibiliResultSnapshot(tx,detailItems[next]!);const original=await bilibiliResultEvidence(tx,source);await advanceRun(tx,execution,{stepKey:bilibiliDetailRoute.stepKey,progress:{...progress,parameters:bilibiliDetailParameters(original.parsed)}});await queueOperationStep(tx,run.id);}
   else await finish(tx,execution,run,{pages:1,items:run.progress.items,details:progress.details,stopReason:'single-request',nextParameters:null});
   return;
  }
  const progress={pages:1,items:selected.length,details:0,stopReason:'single-request',nextParameters:null};
  const details=run.input.enrichDetails===true&&(bilibiliEnrichmentIds as readonly string[]).includes(base.operationId)?resultIds.slice(0,run.limits.details??0):[];
  if(details.length){
   const source=await bilibiliResultSnapshot(tx,details[0]!),original=await bilibiliResultEvidence(tx,source);
   await retainCurrentReceipt(tx,execution,{});const retained=await requireExecution(tx,execution);
   await advanceRun(tx,execution,{stepKey:bilibiliDetailRoute.stepKey,progress:{...progress,retainedReceiptIds:retained.progress.retainedReceiptIds,detailItems:details,detailIndex:0,parameters:bilibiliDetailParameters(original.parsed)}});await queueOperationStep(tx,run.id);
  }else await finish(tx,execution,run,progress);
 });
}

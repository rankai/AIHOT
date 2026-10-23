import {sql,type Tx} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {advanceRun,requireExecution,saveResult,retainCurrentReceipt,type Execution,type RunRow} from '../operations/store.ts';
import {queueOperationStep} from '../operations/queue.ts';
import {agentKeyRouteFor,agentKeyRouteInput} from './routes.ts';
import {parseAgentKeyWeibo} from './weibo-parser.ts';
import {agentKeyWeiboOperations,weiboDetailRoute,weiboEnrichmentIds,type AgentKeyWeiboRoute} from './weibo-contract.ts';
import {weiboResultSnapshot,weiboResultEvidence,weiboDetailParameters} from './weibo-evidence.ts';
import {importWeiboResult} from '../redfox/import-weibo.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {requestAgentKey,retryAgentKeyRateLimit} from './request.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
async function finish(tx:Tx,e:Execution,run:RunRow,progress:Record<string,unknown>){
 await tx`UPDATE collection_subscriptions SET progress=${tx.json(progress as never)},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
 await advanceRun(tx,e,null);
}
export async function executeAgentKeyWeibo(execution:Execution){
 const run=await sql.begin(tx=>requireExecution(tx,execution)),route=agentKeyRouteFor(run) as AgentKeyWeiboRoute|undefined;
 const base=agentKeyWeiboOperations.find(o=>o.operationId===run.input.operationId),op=agentKeyWeiboOperations.find(o=>o.route===route);
 if(!route||!base||!op||!['query','collection'].includes(String(run.input.mode)))throw new AgentKeyPayloadError('Unsupported Weibo execution');
 const collection=run.input.mode==='collection',detail=collection&&route===weiboDetailRoute,service=collection?'agentkey.collect':'agentkey.query';
 const params=agentKeyRouteInput(route,detail?run.progress.parameters:run.input.parameters);
 const detailItems=Array.isArray(run.progress.detailItems)?run.progress.detailItems as number[]:[],index=Number(run.progress.detailIndex??0);
 let originResultId:number|undefined;
 if(detail){
  if(!Number.isSafeInteger(index)||index<0||index>=detailItems.length||new Set(detailItems).size!==detailItems.length||detailItems.length>Math.min(run.limits.items??100,run.limits.details??0))throw new AgentKeyPayloadError('Weibo detail progress exceeds frozen limits');
  originResultId=detailItems[index];const source=await weiboResultSnapshot(sql,originResultId!);
  if(!source||source.run_id!==run.id||source.step_version>=run.step_version||source.data.operationId!==base.operationId)throw new AgentKeyPayloadError('Missing frozen Weibo discovery');
  const original=await weiboResultEvidence(sql,source);
  if(stableJson(params)!==stableJson(weiboDetailParameters(original.parsed)))throw new AgentKeyPayloadError('Weibo detail parameters differ from received discovery');
 }
 const [local]=run.current_receipt_id?await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id} AND status='received'`:[];
 if(local){
  const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,stepVersion:run.step_version,endpoint:local.request?.endpoint,contractVersion:1,tool:route.tool,params}});
  if(local.logical_key!==logicalKey||local.model!==route.tool||local.service!==service||local.purpose!==route.operationKey||local.subject!==`operation:${run.id}`||local.request?.tool!==route.tool||stableJson(local.request?.params)!==stableJson(params))throw new AgentKeyPayloadError('Weibo receipt differs from frozen query');
  await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
 }
 const receipt=local?{receiptId:local.id,attempt:local.attempts,response:local.response}:await requestAgentKey(execution,run,route,params);
 const page=parseAgentKeyWeibo(receipt.response,route,params);
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  const [current]=await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
  if(!current)throw new AgentKeyPayloadError('Weibo receipt superseded');
  const selected=collection&&!detail?page.candidates.slice(0,run.limits.items??100):page.candidates;
  const summaryId=await saveResult(tx,execution,{itemKey:'query_summary',kind:'query_summary',receiptId:receipt.receiptId,data:{...page.summary,platform:'weibo',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool,contractVersion:1,...(originResultId?{originResultId}:{}),...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}:{})}});
  const resultIds:number[]=[];
  for(const item of selected){
   const id=await saveResult(tx,execution,{...item,data:{...item.data,querySummaryId:summaryId},receiptId:receipt.receiptId});
   if(item.kind==='weibo_work'&&item.data.role==='status'&&typeof item.data.opusId==='string')resultIds.push(id);
   if(collection&&item.kind==='weibo_work'){
    // Alias/author contradictions must retain the receipt for review. Missing MID is a pending item.
    if(detail)await weiboResultEvidence(tx,(await weiboResultSnapshot(tx,id))!);
    try{await tx.savepoint(async nested=>{await importWeiboResult(id,{reason:'AgentKey 微博订阅采集'},'collector',`agentkey-import:${id}`,nested);});}
    catch(error){if(!(error instanceof UnsupportedReplacement))throw error;await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${id}`;}
   }
  }
  if(!collection){await advanceRun(tx,execution,null);return;}
  if(detail){
   const next=index+1,progress={...run.progress,details:Number(run.progress.details??0)+1,detailIndex:next};
   if(next<detailItems.length){const source=await weiboResultSnapshot(tx,detailItems[next]!);const original=await weiboResultEvidence(tx,source);await advanceRun(tx,execution,{stepKey:weiboDetailRoute.stepKey,progress:{...progress,parameters:weiboDetailParameters(original.parsed)}});await queueOperationStep(tx,run.id);}
   else await finish(tx,execution,run,{pages:1,items:run.progress.items,details:progress.details,stopReason:'single-request',nextParameters:null});
   return;
  }
  const progress={pages:1,items:selected.length,details:0,stopReason:'single-request',nextParameters:null};
  const details=run.input.enrichDetails===true&&(weiboEnrichmentIds as readonly string[]).includes(base.operationId)?resultIds.slice(0,run.limits.details??0):[];
  if(details.length){
   const source=await weiboResultSnapshot(tx,details[0]!),original=await weiboResultEvidence(tx,source);
   await retainCurrentReceipt(tx,execution,{});const retained=await requireExecution(tx,execution);
   await advanceRun(tx,execution,{stepKey:weiboDetailRoute.stepKey,progress:{...progress,retainedReceiptIds:retained.progress.retainedReceiptIds,detailItems:details,detailIndex:0,parameters:weiboDetailParameters(original.parsed)}});await queueOperationStep(tx,run.id);
  }else await finish(tx,execution,run,progress);
 });
}

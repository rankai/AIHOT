import {logicalKeyFor} from '../receipts.ts';
import {stableJson} from '../../lib/ids.ts';
import {sql,type Tx} from '../../db.ts';
import {advanceRun,requireExecution,saveResult,retainCurrentReceipt,type Execution,type RunRow} from '../operations/store.ts';
import {queueOperationStep} from '../operations/queue.ts';
import {agentKeyRouteFor,agentKeyRouteInput} from './routes.ts';
import {parseAgentKeyXiaohongshu} from './xiaohongshu-parser.ts';
import {agentKeyXiaohongshuOperations,xiaohongshuDetailRoute,type AgentKeyXiaohongshuRoute} from './xiaohongshu-contract.ts';
import {agentKeyXiaohongshuEvidence,xiaohongshuResultSnapshot} from './xiaohongshu-evidence.ts';
import {importXiaohongshuResult} from '../redfox/import-xiaohongshu.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {requestAgentKey,retryAgentKeyRateLimit} from './request.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
async function finish(tx:Tx,e:Execution,run:RunRow,progress:Record<string,unknown>){
 if(run.input.mode==='collection')await tx`UPDATE collection_subscriptions SET progress=${tx.json(progress as never)},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
 await advanceRun(tx,e,null);
}
export async function executeAgentKeyXiaohongshu(execution:Execution){
 const run=await sql.begin(tx=>requireExecution(tx,execution)),route=agentKeyRouteFor(run) as AgentKeyXiaohongshuRoute|undefined;
 const base=agentKeyXiaohongshuOperations.find(o=>o.operationId===run.input.operationId),op=agentKeyXiaohongshuOperations.find(o=>o.route===route);
 if(!route||!base||!op||run.input.platform!=='xiaohongshu'||run.input.tool!==base.route.tool||run.input.upstream!=='TikHub')throw new AgentKeyPayloadError('Unsupported Xiaohongshu execution');
 const collection=run.input.mode==='collection',detail=collection&&route===xiaohongshuDetailRoute,service=collection?'agentkey.collect':'agentkey.query';
 const params=agentKeyRouteInput(route,detail?run.progress.parameters:run.input.parameters);
 const detailItems=Array.isArray(run.progress.detailItems)?run.progress.detailItems as number[]:[],index=Number(run.progress.detailIndex??0);
 let originResultId:number|undefined;
 if(detail){
  if(!Number.isSafeInteger(index)||index<0||index>=detailItems.length||detailItems.length>Math.min(run.limits.items??100,run.limits.details??0))throw new AgentKeyPayloadError('Detail progress exceeds frozen limit');
  originResultId=detailItems[index];const source=await xiaohongshuResultSnapshot(sql,originResultId!);
  if(!source||source.run_id!==run.id||source.step_version>=run.step_version||source.data.operationId!==base.operationId)throw new AgentKeyPayloadError('Missing frozen list item');
  const original=await agentKeyXiaohongshuEvidence(sql,source);
  if(params.note_id!==original.parsed.data.workId)throw new AgentKeyPayloadError('Detail request differs from discovery');
 }
 const [current]=run.current_receipt_id?await sql`SELECT id,attempts,status,response,logical_key,request,subject FROM receipts WHERE id=${run.current_receipt_id} AND model=${route.tool} AND purpose=${route.operationKey} AND service=${service}`:[];
 const matches=!!current&&current.subject===`operation:${run.id}`&&stableJson(current.request?.params)===stableJson(params)&&current.request?.tool===route.tool
   &&current.logical_key===logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,stepVersion:run.step_version,endpoint:current.request?.endpoint,contractVersion:1,tool:route.tool,params}});
 if(run.current_receipt_id&&(!matches||!['received','failed'].includes(current!.status)))throw new AgentKeyPayloadError('Receipt does not prove a reusable Xiaohongshu query');
 const local=current?.status==='received'?current:undefined;
 if(local)await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
 const receipt=local?{receiptId:local.id,attempt:local.attempts,response:local.response}:await requestAgentKey(execution,run,route,params);
 const page=parseAgentKeyXiaohongshu(receipt.response,route,params);
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  const [current]=await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
  if(!current)throw new AgentKeyPayloadError('Xiaohongshu receipt superseded');
  const selected=collection&&!detail?page.candidates.slice(0,run.limits.items??100):page.candidates;
  const summaryId=await saveResult(tx,execution,{itemKey:'query_summary',kind:'query_summary',receiptId:receipt.receiptId,data:{...page.summary,platform:'xiaohongshu',provider:'agentkey',operationId:op.operationId,tool:route.tool,contractVersion:1,...(originResultId?{originResultId}:{}),...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}: {})}});
  const resultIds:number[]=[];
  for(const item of selected){
   const id=await saveResult(tx,execution,{...item,data:{...item.data,querySummaryId:summaryId},receiptId:receipt.receiptId});
   if(item.kind==='xiaohongshu_work'&&item.data.role!=='provider_recommendation')resultIds.push(id);
   if(collection&&item.kind==='xiaohongshu_work'&&item.data.role!=='provider_recommendation'){
    // Verify detail parent before any write, including a missing-body result kept pending.
    if(detail)await agentKeyXiaohongshuEvidence(tx,(await xiaohongshuResultSnapshot(tx,id))!);
    try{await tx.savepoint(async nested=>{await importXiaohongshuResult(id,{reason:'AgentKey 小红书订阅采集'},'collector',`agentkey-import:${id}`,nested);});}
    catch(error){if(!(error instanceof UnsupportedReplacement))throw error;await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${id}`;}
   }
  }
  if(!collection){await advanceRun(tx,execution,null);return;}
  if(detail){
   const next=index+1,progress={...run.progress,details:Number(run.progress.details??0)+1,detailIndex:next};
   if(next<detailItems.length){const source=await xiaohongshuResultSnapshot(tx,detailItems[next]!);if(!source)throw new AgentKeyPayloadError('Missing next retained item');await advanceRun(tx,execution,{stepKey:xiaohongshuDetailRoute.stepKey,progress:{...progress,parameters:{note_id:source.data.workId}}});await queueOperationStep(tx,run.id);}
   else await finish(tx,execution,run,{pages:1,items:run.progress.items,details:progress.details,stopReason:'single-request',nextParameters:null});
   return;
  }
  const progress={pages:1,items:selected.length,details:0,stopReason:'single-request',nextParameters:null};
  const details=run.input.enrichDetails===true&&['384C6W6B','XN3ULENA'].includes(base.operationId)?resultIds.slice(0,run.limits.details??0):[];
  if(details.length){
   const first=await xiaohongshuResultSnapshot(tx,details[0]!);await retainCurrentReceipt(tx,execution,{});const retained=await requireExecution(tx,execution);
   await advanceRun(tx,execution,{stepKey:xiaohongshuDetailRoute.stepKey,progress:{...progress,retainedReceiptIds:retained.progress.retainedReceiptIds,detailItems:details,detailIndex:0,parameters:{note_id:first!.data.workId}}});await queueOperationStep(tx,run.id);
  }else await finish(tx,execution,run,progress);
 });
}

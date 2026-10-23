import {sql} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {advanceRun,requireExecution,saveResult,type Execution} from '../operations/store.ts';
import {agentKeyRouteFor,agentKeyRouteInput} from './routes.ts';
import {parseAgentKeyX} from './x-parser.ts';
import {agentKeyXWork,agentKeyXAccount,requireXCollectionAccountScope} from './x-evidence.ts';
import {agentKeyXOperations,xCollectionSearchInput,xSearchRoute,xPostsRoute,type AgentKeyXRoute} from './x-contract.ts';
import {requestAgentKey,retryAgentKeyRateLimit} from './request.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {importXSearchResult} from '../redfox/import-x-search.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
export async function executeAgentKeyX(execution:Execution){
 const run=await sql.begin(tx=>requireExecution(tx,execution)),route=agentKeyRouteFor(run) as AgentKeyXRoute|undefined;
 if(!route||!['query','collection'].includes(String(run.input.mode))||!agentKeyXOperations.some(o=>o.route===route))throw new AgentKeyPayloadError('Unsupported X execution');
 const collection=run.input.mode==='collection',params=collection&&route===xSearchRoute?xCollectionSearchInput.parse(run.input.parameters):agentKeyRouteInput(route,run.input.parameters),service=collection?'agentkey.collect':'agentkey.query';
 if(collection&&(run.limits.pages!==1||run.limits.details!==0||!Number.isInteger(run.limits.items)||run.limits.items! < 1||run.limits.items! > 500||run.input.enrichDetails===true||run.input.detailOperationId!==undefined||run.input.detailPage!==undefined))throw new AgentKeyPayloadError('X collection exceeds frozen homepage limits');
 const [local]=run.current_receipt_id?await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id} AND status='received'`:[];
 if(local){
  const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,stepVersion:run.step_version,endpoint:local.request?.endpoint,contractVersion:1,tool:route.tool,params}});
  if(local.logical_key!==logicalKey||local.model!==route.tool||local.service!==service||local.purpose!==route.operationKey||local.subject!==`operation:${run.id}`||local.request?.tool!==route.tool||stableJson(local.request?.params)!==stableJson(params))throw new AgentKeyPayloadError('X receipt differs from frozen query');
  await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
 }
 const receipt=local?{receiptId:local.id,attempt:local.attempts,response:local.response}:await requestAgentKey(execution,run,route,params);
 const page=parseAgentKeyX(receipt.response,route,params);
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  const [current]=await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
  if(!current)throw new AgentKeyPayloadError('X receipt superseded');
  const selected=collection?page.candidates.slice(0,run.limits.items):page.candidates;
  const summaryId=await saveResult(tx,execution,{itemKey:'query_summary',kind:'query_summary',receiptId:receipt.receiptId,data:{...page.summary,platform:'x-research',provider:'agentkey',upstream:'TikHub',operationId:run.input.operationId,tool:route.tool,contractVersion:1,...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}:{})}});
  for(const item of selected){
   let importable=false;
   try{if(collection&&route===xPostsRoute)requireXCollectionAccountScope(page.summary,params,item);if(item.kind==='account')agentKeyXAccount(item);else agentKeyXWork(item);importable=true;}catch(error){if(error instanceof AgentKeyPayloadError)throw error;/* Partial or unsupported roles remain research results. */}
   const missing=importable?(item.kind==='account'
    ?['仅可绑定已有完全匹配的单账号 X 信源；不创建新闻，不自动切换供应商']
    :['实收文字不证明完整长文；导入正文保持待确认，不自动补购详情或 Article；直接回复关系与后续分页可能未知']):item.data.missing;
   const id=await saveResult(tx,execution,{...item,data:{...item.data,importable,missing,querySummaryId:summaryId},receiptId:receipt.receiptId});
   if(collection&&item.kind==='x_research_work'){
    try{await tx.savepoint(async nested=>{await importXSearchResult(id,{reason:'AgentKey X 首页订阅采集'},'collector',`agentkey-import:${id}`,nested);});}
    catch(error){if(!(error instanceof UnsupportedReplacement))throw error;await tx`UPDATE operation_results SET data=data||${tx.json({pendingReason:error.message})} WHERE id=${id}`;}
   }
  }
  if(collection)await tx`UPDATE collection_subscriptions SET progress=${tx.json({pages:1,items:selected.length,details:0,stopReason:'single-request',nextParameters:null})},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
  await advanceRun(tx,execution,null);
 });
}

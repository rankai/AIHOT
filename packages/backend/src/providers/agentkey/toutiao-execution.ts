import {sql} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {advanceRun,requireExecution,saveResult,type Execution} from '../operations/store.ts';
import {agentKeyRouteFor,agentKeyRouteInput} from './routes.ts';
import {parseAgentKeyToutiao} from './toutiao-parser.ts';
import {agentKeyToutiaoOperations,type AgentKeyToutiaoRoute} from './toutiao-contract.ts';
import {requestAgentKey,retryAgentKeyRateLimit} from './request.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
export async function executeAgentKeyToutiao(execution:Execution){
 const run=await sql.begin(tx=>requireExecution(tx,execution)),route=agentKeyRouteFor(run) as AgentKeyToutiaoRoute|undefined;
 if(!route||!agentKeyToutiaoOperations.some(o=>o.route===route))throw new AgentKeyPayloadError('Unsupported Toutiao execution');
 const params=agentKeyRouteInput(route,run.input.parameters),collection=run.input.mode==='collection';
 const service=collection?'agentkey.collect':'agentkey.query';
 const [local]=run.current_receipt_id?await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id} AND status='received'`:[];
 if(local){
  const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,stepVersion:run.step_version,endpoint:local.request?.endpoint,contractVersion:route.contractVersion,tool:route.tool,params}});
  if(local.logical_key!==logicalKey||local.model!==route.tool||local.service!==service||local.purpose!==route.operationKey
    ||local.subject!==`operation:${run.id}`||local.request?.tool!==route.tool||stableJson(local.request?.params)!==stableJson(params))
   throw new AgentKeyPayloadError('Toutiao receipt differs from the frozen query');
  await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
 }
 const receipt=local?{receiptId:local.id,attempt:local.attempts,response:local.response}:await requestAgentKey(execution,run,route,params);
 const page=parseAgentKeyToutiao(receipt.response,route,params);
 await sql.begin(async tx=>{
  await requireExecution(tx,execution);
  const [current]=await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
  if(!current)throw new AgentKeyPayloadError('Toutiao receipt superseded');
  const selected=collection?page.candidates.slice(0,run.limits.items??100):page.candidates;
  const summaryId=await saveResult(tx,execution,{itemKey:'query_summary',kind:'query_summary',receiptId:receipt.receiptId,data:{...page.summary,platform:'toutiao',provider:'agentkey',operationId:run.input.operationId,tool:route.tool,contractVersion:1,...(collection?{returnedPage:page.summary.pagination,selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}: {})}});
  for(const item of selected)await saveResult(tx,execution,{...item,data:{...item.data,querySummaryId:summaryId},receiptId:receipt.receiptId});
  if(collection)await tx`UPDATE collection_subscriptions SET progress=${tx.json({pages:1,items:selected.length,details:0,stopReason:'single-request',nextParameters:null})},next_run_at=now()+interval_minutes*interval '1 minute',updated_at=now() WHERE active_run_id=${run.id}`;
  await advanceRun(tx,execution,null);
 });
}

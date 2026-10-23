import {checkWechatSource,startWechatDetails,consumeWechatDetail} from "./wechat-collection.ts";
import {wechatDetailRoute} from "./wechat-contract.ts";
import {sql} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {advanceRun,requireExecution,saveResult,setRunState,type Execution} from '../operations/store.ts';
import {agentKeyRouteFor,agentKeyRouteInput} from './routes.ts';
import {parseAgentKeyWechat} from './wechat-parser.ts';
import type {AgentKeyWechatRoute} from './wechat-contract.ts';
import {requestAgentKey,retryAgentKeyRateLimit} from './request.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
export async function executeAgentKeyWechat(execution:Execution){
  const run=await sql.begin(tx=>requireExecution(tx,execution));
  const route=agentKeyRouteFor(run) as AgentKeyWechatRoute|undefined;
  if(!route)throw new AgentKeyPayloadError('Unsupported WeChat execution');
  const collection=['collection','preview'].includes(String(run.input.mode));
  if(collection){if(execution.stepVersion>Math.min(12,run.limits.steps??12))throw new AgentKeyPayloadError('MP step bound exhausted');await sql.begin(tx=>checkWechatSource(tx,run));}
  const params=agentKeyRouteInput(route,run.progress.parameters??run.input.parameters);
  const service=collection?'agentkey.collect':'agentkey.query';
  const [local]=run.current_receipt_id?await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id} AND status='received'`:[];
  if(local){
    const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:run.id,stepVersion:run.step_version,endpoint:local.request?.endpoint,contractVersion:route.contractVersion,tool:route.tool,params}});
    if(local.logical_key!==logicalKey||local.model!==route.tool||local.service!==service||local.purpose!==route.operationKey
      ||local.subject!==`operation:${run.id}`||local.request?.tool!==route.tool||stableJson(local.request?.params)!==stableJson(params))
      throw new AgentKeyPayloadError('WeChat receipt differs from the frozen query');
    await retryAgentKeyRateLimit(execution,{receiptId:local.id,attempt:local.attempts,response:local.response});
  }
  const receipt=local?{receiptId:local.id,attempt:local.attempts,response:local.response}:await requestAgentKey(execution,run,route,params);
  let page:ReturnType<typeof parseAgentKeyWechat>;
  try{page=parseAgentKeyWechat(receipt.response,route,params);}catch(error){await sql.begin(tx=>setRunState(tx,execution,'needs_review','WeChat payload requires review; original receipt retained'));throw error;}
  await sql.begin(async tx=>{
    await requireExecution(tx,execution);
    const [current]=await tx`SELECT id FROM receipts WHERE id=${receipt.receiptId} AND attempts=${receipt.attempt} AND status='received' FOR UPDATE`;
    if(!current)throw new AgentKeyPayloadError('WeChat receipt superseded');
    const summaryId=await saveResult(tx,execution,{itemKey:'query_summary',kind:'query_summary',receiptId:receipt.receiptId,data:{...page.summary,platform:'wechat',provider:'agentkey',operationId:route===wechatDetailRoute?'I3CIBRI2':run.input.operationId,...(collection&&route===wechatDetailRoute?{originResultId:(run.progress.detailItems as number[])[Number(run.progress.detailIndex)]}:{}),tool:route.tool,contractVersion:1}});
    const items=[];
    for(const item of page.candidates){const id=await saveResult(tx,execution,{...item,data:{...item.data,querySummaryId:summaryId},receiptId:receipt.receiptId});items.push({id,item});}
    if(collection){if(route===wechatDetailRoute){if(!items[0])throw new AgentKeyPayloadError('MP detail missing');await consumeWechatDetail(tx,execution,run,items[0].id,items[0].item);}else await startWechatDetails(tx,execution,run,items);}
    else await advanceRun(tx,execution,null);
  });
}

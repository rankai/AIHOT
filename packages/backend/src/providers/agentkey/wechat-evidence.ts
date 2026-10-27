import type {Db} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {requireLiveResult} from '../../operations/result-retention.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {agentKeyRouteFor} from './routes.ts';
import {agentKeyWechatOperations,wechatDetailRoute,wechatArticlesRoute} from './wechat-contract.ts';
import {parseAgentKeyWechat,type WechatCandidate} from './wechat-parser.ts';
export async function agentKeyWechatEvidence(db:Db,snapshot:any):Promise<{parsed:WechatCandidate;sourceDiscoveredAt:Date;origin?:{discoveredAt:string}}>{
  requireLiveResult(snapshot);
  if(!['wechat_work','wechat_account'].includes(snapshot.kind))throw new UnsupportedReplacement('Research results cannot be imported');
  const [summary]=await db`SELECT * FROM operation_results WHERE id=${Number(snapshot.data.querySummaryId)||0} AND run_id=${snapshot.run_id} AND step_version=${snapshot.step_version} AND receipt_id=${snapshot.receipt_id} AND kind='query_summary'`;
  requireLiveResult(summary,'query_summary');
  const op=agentKeyWechatOperations.find(o=>o.operationId===summary?.data.operationId),route=op?.route;
  if(!route||snapshot.contract_version!==1||summary.data.provider!=='agentkey'||summary.data.tool!==route.tool||snapshot.receipt_model!==route.tool||!['received','completed'].includes(snapshot.receipt_status)||!agentKeyRouteFor({...snapshot,step_key:route.stepKey}))throw new UnsupportedReplacement('Missing original WeChat receipt evidence');
  const query=op!.schema.parse(summary.data.query),service=['collection','preview'].includes(snapshot.input.mode)?'agentkey.collect':'agentkey.query';
  const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:snapshot.run_id,stepVersion:snapshot.step_version,endpoint:snapshot.receipt_request?.endpoint,contractVersion:1,tool:route.tool,params:query}});
  if(snapshot.receipt_logical_key!==logicalKey||snapshot.receipt_purpose!==route.operationKey||snapshot.receipt_subject!==`operation:${snapshot.run_id}`||snapshot.receipt_service!==service||snapshot.receipt_request?.tool!==route.tool||stableJson(snapshot.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement('Receipt does not prove original WeChat query');
  const parsed=parseAgentKeyWechat(snapshot.receipt_response,route,query).candidates.find(c=>c.itemKey===snapshot.item_key);
  if(!parsed||parsed.kind!==snapshot.kind||stableJson({...snapshot.data,querySummaryId:undefined,pendingReason:undefined})!==stableJson(parsed.data))throw new UnsupportedReplacement('WeChat result differs from original response');
  if(route===wechatDetailRoute&&parsed.data.requestedUrl!==parsed.data.url&&parsed.data.aliasConfirmed!==true)throw new UnsupportedReplacement('H5 original article correspondence requires same-response proof');
  let origin:{discoveredAt:string}|undefined;
  if(route===wechatDetailRoute&&snapshot.operation_key===wechatArticlesRoute.operationKey){
    const [source]=await db`SELECT z.*,r.provider,r.operation_key,r.contract_version,r.input,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${Number(summary.data.originResultId)||0} AND z.run_id=${snapshot.run_id} AND z.step_version<${snapshot.step_version}`;
    if(!source||source.data.operationId!=='8IQD0BJC')throw new UnsupportedReplacement('Missing retained WeChat source page');
    const original=await agentKeyWechatEvidence(db,source);
    if(parsed.data.requestedUrl!==original.parsed.data.url)throw new UnsupportedReplacement('H5 request differs from retained source page');
    const a=original.parsed.data.identity as Record<string,string>,b=parsed.data.identity as Record<string,string>;
    for(const k of ['wxId','bizInfo'])if(a[k]&&b[k]&&a[k]!==b[k])throw new UnsupportedReplacement('H5 author differs from retained source page');
    origin={discoveredAt:original.sourceDiscoveredAt.toISOString()};
  }
  return {parsed,origin,sourceDiscoveredAt:new Date(snapshot.input.source?snapshot.input.startedAt:snapshot.received_at??snapshot.created_at)};
}

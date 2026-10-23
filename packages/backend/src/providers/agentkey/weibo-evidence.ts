import type {Db} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {requireLiveResult} from '../../operations/result-retention.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {agentKeyWeiboOperations,weiboCollectionIds,weiboEnrichmentIds,weiboSearchRoute,weiboPostsRoute,weiboDetailRoute,weiboProfileRoute,weiboPostsInput} from './weibo-contract.ts';
import {parseAgentKeyWeibo,type WeiboCandidate} from './weibo-parser.ts';
export async function weiboResultSnapshot(db:Db,id:number){
 const [s]=await db`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,r.limits,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;return s;
}
export function weiboDetailParameters(item:WeiboCandidate){
 if(item.kind!=='weibo_work'||item.data.role!=='status'||typeof item.data.opusId!=='string'||!/^\d+$/.test(item.data.opusId))throw new UnsupportedReplacement('No received native numeric Weibo status for detail');
 return {status_id:item.data.opusId};
}
/** Revalidate query or selected collection evidence independently of import eligibility. */
export async function weiboResultEvidence(db:Db,s:any):Promise<{parsed:WeiboCandidate;sourceDiscoveredAt:Date;detail:boolean}>{
 requireLiveResult(s);
 const base=agentKeyWeiboOperations.find(o=>o.operationId===s.input?.operationId),op=agentKeyWeiboOperations.find(o=>o.operationId===s.data?.operationId);
 if(!base||!op||s.provider!=='agentkey'||s.contract_version!==1||s.operation_key!==base.route.operationKey||s.input.platform!=='weibo'||s.input.upstream!=='TikHub'||s.input.tool!==base.route.tool||s.input.origin!==undefined||s.receipt_model!==op.route.tool||!['received','completed'].includes(s.receipt_status))throw new UnsupportedReplacement('Missing original Weibo query evidence');
 const collection=s.input.mode==='collection',detail=collection&&op.route===weiboDetailRoute&&op!==base;
 const enrichment=collection&&(weiboEnrichmentIds as readonly string[]).includes(base.operationId)&&s.input.enrichDetails===true&&s.input.detailOperationId==='API_1789098514899';
 if((!collection&&s.input.mode!=='query')||(!collection&&(op!==base||s.step_key!==op.route.stepKey))||(collection&&!(weiboCollectionIds as readonly string[]).includes(base.operationId))||(!detail&&op!==base)||(detail&&!enrichment)||(collection&&s.step_key!==base.route.stepKey&&!(enrichment&&s.step_key===weiboDetailRoute.stepKey)))throw new UnsupportedReplacement('Unsupported Weibo run/step combination');
 const route=op.route,service=collection?'agentkey.collect':'agentkey.query';
 const [summary]=await db`SELECT * FROM operation_results WHERE id=${Number(s.data.querySummaryId)||0} AND run_id=${s.run_id} AND step_version=${s.step_version} AND receipt_id=${s.receipt_id} AND kind='query_summary' AND item_key='query_summary'`;
 requireLiveResult(summary,'query_summary');
 const query=op.schema.parse(summary.data.query);
 if(!detail&&stableJson(query)!==stableJson(base.schema.parse(s.input.parameters)))throw new UnsupportedReplacement('Weibo summary differs from frozen query');
 const endpoint=s.receipt_request?.endpoint;
 if(typeof endpoint!=='string'||!endpoint)throw new UnsupportedReplacement('Missing Weibo receipt endpoint identity');
 const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:s.run_id,stepVersion:s.step_version,endpoint,contractVersion:1,tool:route.tool,params:query}});
 if(s.receipt_logical_key!==logicalKey||s.receipt_service!==service||s.receipt_purpose!==route.operationKey||s.receipt_subject!==`operation:${s.run_id}`||s.receipt_request?.tool!==route.tool||stableJson(s.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement('Receipt does not prove original Weibo query');
 const page=parseAgentKeyWeibo(s.receipt_response,route,query);
 const selected=collection&&!detail?page.candidates.slice(0,s.limits.items??100):page.candidates;
 const expectedSummary={...page.summary,platform:'weibo',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool,contractVersion:1,...(detail?{originResultId:summary.data.originResultId}:{}),...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}:{})};
 if(stableJson(summary.data)!==stableJson(expectedSummary))throw new UnsupportedReplacement('Weibo summary differs from received response');
 const parsed=selected.find(c=>c.itemKey===s.item_key);
 // Capability hints changed after Q. They do not authorize import and are not content evidence.
 const projection=(data:Record<string,unknown>)=>({...data,querySummaryId:undefined,importable:undefined,missing:undefined,pendingReason:undefined});
 if(!parsed||parsed.kind!==s.kind||stableJson(projection(s.data))!==stableJson(projection(parsed.data)))throw new UnsupportedReplacement('Weibo result differs from received response');
 let sourceDiscoveredAt=new Date(s.received_at??s.created_at);
 if(detail){
  const parentId=summary.data.originResultId;
  if(!Number.isSafeInteger(parentId)||parentId<=0)throw new UnsupportedReplacement('Missing Weibo detail discovery');
  const source=await weiboResultSnapshot(db,parentId);
  if(!source||source.run_id!==s.run_id||source.step_version>=s.step_version||source.data.operationId!==base.operationId)throw new UnsupportedReplacement('Weibo detail discovery belongs to another run/step');
  const original=await weiboResultEvidence(db,source);
  if(stableJson(query)!==stableJson(weiboDetailParameters(original.parsed)))throw new UnsupportedReplacement('Weibo detail request differs from received discovery');
  for(const key of ['opusId','uid','mblogid'])if(original.parsed.data[key]!==undefined&&parsed.data[key]!==undefined&&original.parsed.data[key]!==parsed.data[key])throw new UnsupportedReplacement('Weibo detail identity contradicts original discovery');
  if(base.route===weiboPostsRoute&&parsed.data.uid!==undefined&&parsed.data.uid!==weiboPostsInput.parse(s.input.parameters).uid)throw new UnsupportedReplacement('Weibo detail author contradicts frozen account UID');
  sourceDiscoveredAt=original.sourceDiscoveredAt;
 }
 return {parsed,sourceDiscoveredAt,detail};
}
/** Only original status/profile identity, never display hints, authorizes the shared writer. */
export async function agentKeyWeiboEvidence(db:Db,s:any){
 const verified=await weiboResultEvidence(db,s),{parsed}=verified;
 const op=agentKeyWeiboOperations.find(o=>o.operationId===parsed.data.operationId)!;
 if(![weiboSearchRoute,weiboPostsRoute,weiboDetailRoute,weiboProfileRoute].some(r=>r===op.route))throw new UnsupportedReplacement('Weibo research is not importable');
 const uid=parsed.data.uid;
 if(typeof uid!=='string'||!/^\d+$/.test(uid))throw new UnsupportedReplacement('A received Weibo author UID is required');
 if(op.route===weiboProfileRoute){
  if(parsed.kind!=='weibo_account'||uid!==s.input.parameters.uid)throw new UnsupportedReplacement('Weibo profile does not prove the requested UID');
 }else if(parsed.kind!=='weibo_work'||parsed.data.role!=='status'||typeof parsed.data.opusId!=='string'||!/^\d+$/.test(parsed.data.opusId)||parsed.data.opusUrl!==`https://weibo.com/${uid}/${parsed.data.opusId}`||parsed.data.urlSource!=='derived-canonical-permalink')throw new UnsupportedReplacement('Received native Weibo status and author identity are required; retweets remain research-only');
 return verified;
}

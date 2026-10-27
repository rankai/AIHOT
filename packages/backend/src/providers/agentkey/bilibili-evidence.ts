import type {Db} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {bilibiliVideoId} from '../../lib/url.ts';
import {logicalKeyFor} from '../receipts.ts';
import {requireLiveResult} from '../../operations/result-retention.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {agentKeyBilibiliOperations,bilibiliDetailRoute,bilibiliProfileRoute,bilibiliCollectionIds,bilibiliEnrichmentIds} from './bilibili-contract.ts';
import {parseAgentKeyBilibili,type BilibiliCandidate} from './bilibili-parser.ts';
export async function bilibiliResultSnapshot(db:Db,id:number){
 const [s]=await db`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,r.limits,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;return s;
}
/** A request can use only a native ID actually received in the retained list. Never convert AV/BV. */
export function bilibiliDetailParameters(item:BilibiliCandidate):Record<string,string>{
 if(item.kind!=='bilibili_work'||item.data.role!=='native_video')throw new UnsupportedReplacement('Not a Bilibili native video discovery');
 if(typeof item.data.workId==='string'&&/^BV[A-Za-z0-9]{10}$/.test(item.data.workId))return {bv_id:item.data.workId};
 if(typeof item.data.avId==='string'&&/^\d+$/.test(item.data.avId))return {av_id:item.data.avId};
 throw new UnsupportedReplacement('No received AV or BV for Bilibili detail');
}
/** Verify retained query/list/detail evidence without treating Q completeness as import eligibility. */
export async function bilibiliResultEvidence(db:Db,s:any):Promise<{parsed:BilibiliCandidate;sourceDiscoveredAt:Date}>{
 requireLiveResult(s);
 const base=agentKeyBilibiliOperations.find(o=>o.operationId===s.input?.operationId),op=agentKeyBilibiliOperations.find(o=>o.operationId===s.data?.operationId);
 if(!base||!op||s.provider!=='agentkey'||s.contract_version!==1||s.operation_key!==base.route.operationKey||s.input.platform!=='bilibili'||s.input.upstream!=='TikHub'||s.input.tool!==base.route.tool||s.input.origin!==undefined||s.receipt_model!==op.route.tool||!['received','completed'].includes(s.receipt_status))throw new UnsupportedReplacement('Missing original Bilibili query evidence');
 const collection=s.input.mode==='collection',detail=collection&&op.route===bilibiliDetailRoute&&op!==base;
 if((!collection&&s.input.mode!=='query')||(!collection&&(base!==op||s.step_key!==op.route.stepKey))||(collection&&!(bilibiliCollectionIds as readonly string[]).includes(base.operationId))||(!detail&&op!==base)||(detail&&(!(bilibiliEnrichmentIds as readonly string[]).includes(base.operationId)||s.input.enrichDetails!==true||s.input.detailOperationId!=='TIN1NMTZ')))throw new UnsupportedReplacement('Unsupported Bilibili run/step combination');
 if(collection&&s.step_key!==base.route.stepKey&&!(s.input.enrichDetails===true&&s.input.detailOperationId==='TIN1NMTZ'&&(bilibiliEnrichmentIds as readonly string[]).includes(base.operationId)&&s.step_key===bilibiliDetailRoute.stepKey))throw new UnsupportedReplacement('Unsupported Bilibili collection step');
 const route=op.route,service=collection?'agentkey.collect':'agentkey.query';
 const [summary]=await db`SELECT * FROM operation_results WHERE id=${Number(s.data.querySummaryId)||0} AND run_id=${s.run_id} AND step_version=${s.step_version} AND receipt_id=${s.receipt_id} AND kind='query_summary' AND item_key='query_summary'`;
 requireLiveResult(summary,'query_summary');
 const query=op.schema.parse(summary.data.query);
 if(!detail&&stableJson(query)!==stableJson(base.schema.parse(s.input.parameters)))throw new UnsupportedReplacement('Bilibili summary differs from frozen query');
 const endpoint=s.receipt_request?.endpoint;
 if(typeof endpoint!=='string'||!endpoint)throw new UnsupportedReplacement('Missing Bilibili receipt endpoint identity');
 const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:s.run_id,stepVersion:s.step_version,endpoint,contractVersion:1,tool:route.tool,params:query}});
 if(s.receipt_logical_key!==logicalKey||s.receipt_service!==service||s.receipt_purpose!==route.operationKey||s.receipt_subject!==`operation:${s.run_id}`||s.receipt_request?.tool!==route.tool||stableJson(s.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement('Receipt does not prove original Bilibili query');
 const page=parseAgentKeyBilibili(s.receipt_response,route,query),selected=collection&&!detail?page.candidates.slice(0,s.limits.items??100):page.candidates,parsed=selected.find(c=>c.itemKey===s.item_key);
 const expectedSummary={...page.summary,platform:'bilibili',provider:'agentkey',operationId:op.operationId,tool:route.tool,contractVersion:1,...(detail?{originResultId:summary.data.originResultId}:{}),...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}:{})};
 if(stableJson(summary.data)!==stableJson(expectedSummary))throw new UnsupportedReplacement('Bilibili summary differs from original received query');
 // Capability/display hints changed after Q; pendingReason records a failed import, never evidence.
 const projection=(data:Record<string,unknown>)=>({...data,querySummaryId:undefined,importable:undefined,missing:undefined,pendingReason:undefined});
 if(!parsed||parsed.kind!==s.kind||stableJson(projection(s.data))!==stableJson(projection(parsed.data)))throw new UnsupportedReplacement('Bilibili result differs from received response');
 let sourceDiscoveredAt=new Date(s.received_at??s.created_at);
 if(detail){
  const parentId=summary.data.originResultId;
  if(!Number.isSafeInteger(parentId)||parentId<=0)throw new UnsupportedReplacement('Missing Bilibili detail discovery');
  const source=await bilibiliResultSnapshot(db,parentId);
  if(!source||source.run_id!==s.run_id||source.step_version>=s.step_version||source.data.operationId!==base.operationId||source.kind!=='bilibili_work')throw new UnsupportedReplacement('Bilibili detail discovery belongs to another run/step');
  const original=await bilibiliResultEvidence(db,source);
  if(stableJson(query)!==stableJson(op.schema.parse(bilibiliDetailParameters(original.parsed))))throw new UnsupportedReplacement('Bilibili detail request differs from discovery');
  for(const key of ['avId','workId'])if(original.parsed.data[key]&&parsed.data[key]!==original.parsed.data[key])throw new UnsupportedReplacement('Bilibili detail AV/BV differs from discovery');
  const actual=(parsed.data.identity as {mid?:string}).mid,author=(original.parsed.data.identity as {mid?:string}).mid;
  if(actual&&((author&&actual!==author)||(base.operationId==='VPA67I98'&&actual!==s.input.parameters.user_id)))throw new UnsupportedReplacement('Bilibili detail author differs from frozen discovery account');
  sourceDiscoveredAt=original.sourceDiscoveredAt;
 }
 return {parsed,sourceDiscoveredAt};
}
/** Only actual detail BV+MID and profile MID authorize the existing material/account writer. */
export async function agentKeyBilibiliEvidence(db:Db,s:any){
 const op=agentKeyBilibiliOperations.find(o=>o.operationId===s.data?.operationId);
 if(!op||![bilibiliDetailRoute,bilibiliProfileRoute].some(r=>r===op.route))throw new UnsupportedReplacement('Only Bilibili detail/profile evidence is importable');
 const verified=await bilibiliResultEvidence(db,s),{parsed}=verified;
 const mid=(parsed.data.identity as {mid?:string}).mid;
 if(op.route===bilibiliProfileRoute&&!mid)throw new UnsupportedReplacement('A received author MID is required for Bilibili import');
 if(op.route===bilibiliDetailRoute&&(parsed.kind!=='bilibili_work'||typeof parsed.data.url!=='string'||!parsed.data.workId||bilibiliVideoId(parsed.data.url)!==parsed.data.workId))throw new UnsupportedReplacement('A received BV and matching native Bilibili URL are required');
 if(op.route===bilibiliProfileRoute&&parsed.kind!=='bilibili_account')throw new UnsupportedReplacement('Bilibili profile does not prove an account');
 return verified;
}

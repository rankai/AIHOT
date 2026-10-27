import type {Db} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {requireLiveResult} from '../../operations/result-retention.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {agentKeyXiaohongshuOperations,xiaohongshuDetailRoute,xiaohongshuCollectionIds} from './xiaohongshu-contract.ts';
import {parseAgentKeyXiaohongshu,type XiaohongshuCandidate} from './xiaohongshu-parser.ts';
export async function xiaohongshuResultSnapshot(db:Db,id:number){
 const [s]=await db`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,r.limits,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;return s;
}
/** Verify original evidence even for historical projections whose importable hint was false. */
export async function agentKeyXiaohongshuEvidence(db:Db,s:any):Promise<{parsed:XiaohongshuCandidate;sourceDiscoveredAt:Date;origin?:{discoveredAt:string}}>{
 requireLiveResult(s);
 if(s.provider!=='agentkey'||!['xiaohongshu_work','xiaohongshu_account'].includes(s.kind)||s.contract_version!==1||s.input.platform!=='xiaohongshu'||s.input.upstream!=='TikHub'||s.input.origin!==undefined)throw new UnsupportedReplacement('Missing original Xiaohongshu run evidence');
 const base=agentKeyXiaohongshuOperations.find(o=>o.operationId===s.input.operationId),op=agentKeyXiaohongshuOperations.find(o=>o.operationId===s.data.operationId);
 const collection=s.input.mode==='collection',detail=collection&&op?.route===xiaohongshuDetailRoute&&base!==op;
 if(!base||!op||s.operation_key!==base.route.operationKey||s.input.tool!==base.route.tool||(!collection&&s.input.mode!=='query')||(collection&&!(xiaohongshuCollectionIds as readonly string[]).includes(base.operationId))||(!detail&&op!==base)||(detail&&(!['384C6W6B','XN3ULENA'].includes(base.operationId)||s.input.enrichDetails!==true||s.input.detailOperationId!=='KR1LPTBF'))||(!collection&&s.step_key!==op.route.stepKey))throw new UnsupportedReplacement('Unsupported Xiaohongshu run/step combination');
 const route=op.route,service=collection?'agentkey.collect':'agentkey.query';
 const [summary]=await db`SELECT * FROM operation_results WHERE id=${Number(s.data.querySummaryId)||0} AND run_id=${s.run_id} AND step_version=${s.step_version} AND receipt_id=${s.receipt_id} AND kind='query_summary' AND item_key='query_summary'`;
 requireLiveResult(summary,'query_summary');
 if(summary.data.provider!=='agentkey'||summary.data.platform!=='xiaohongshu'||summary.data.operationId!==op.operationId||summary.data.tool!==route.tool||summary.data.contractVersion!==1||s.receipt_model!==route.tool||!['received','completed'].includes(s.receipt_status))throw new UnsupportedReplacement('Missing original Xiaohongshu summary evidence');
 const query=op.schema.parse(summary.data.query);
 if(!detail&&stableJson(query)!==stableJson(base.schema.parse(s.input.parameters)))throw new UnsupportedReplacement('Summary differs from frozen query');
 const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:s.run_id,stepVersion:s.step_version,endpoint:s.receipt_request?.endpoint,contractVersion:1,tool:route.tool,params:query}});
 if(s.receipt_logical_key!==logicalKey||s.receipt_service!==service||s.receipt_purpose!==route.operationKey||s.receipt_subject!==`operation:${s.run_id}`||s.receipt_request?.tool!==route.tool||stableJson(s.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement('Receipt does not prove original Xiaohongshu query');
 const page=parseAgentKeyXiaohongshu(s.receipt_response,route,query),parsed=page.candidates.find(c=>c.itemKey===s.item_key);
 const projection=(data:Record<string,unknown>)=>({...data,querySummaryId:undefined,pendingReason:undefined,importable:undefined,missing:undefined});
 if(!parsed||parsed.kind!==s.kind||stableJson(projection(s.data))!==stableJson(projection(parsed.data))||summary.data.count!==page.summary.count)throw new UnsupportedReplacement('Xiaohongshu result differs from received response');
 if(parsed.data.role==='provider_recommendation')throw new UnsupportedReplacement('Recommendations are research only');
 let origin:{discoveredAt:string}|undefined;
 if(detail){
  const source=await xiaohongshuResultSnapshot(db,Number(summary.data.originResultId)||0);
  if(!source||source.run_id!==s.run_id||source.step_version>=s.step_version||source.data.operationId!==base.operationId||source.kind!=='xiaohongshu_work')throw new UnsupportedReplacement('Missing retained Xiaohongshu discovery');
  const original=await agentKeyXiaohongshuEvidence(db,source);
  if(parsed.data.workId!==original.parsed.data.workId)throw new UnsupportedReplacement('Detail note differs from discovery');
  const author=(original.parsed.data.identity as Record<string,string>).userId,actual=(parsed.data.identity as Record<string,string>).userId;
  if(actual&&(author&&actual!==author||base.operationId==='XN3ULENA'&&actual!==s.input.parameters.user_id))throw new UnsupportedReplacement('Detail author differs from discovery');
  origin={discoveredAt:original.sourceDiscoveredAt.toISOString()};
 }
 return {parsed,origin,sourceDiscoveredAt:new Date(s.received_at??s.created_at)};
}

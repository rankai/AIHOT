import type {Db} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {requireLiveResult} from '../../operations/result-retention.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {toutiaoArticleRoute,toutiaoArticleInput} from './toutiao-contract.ts';
import {parseAgentKeyToutiao} from './toutiao-parser.ts';
/** The frozen query, receipt identity and original sanitized response jointly authorize import. */
export async function agentKeyToutiaoEvidence(db:Db,snapshot:any){
 requireLiveResult(snapshot,'toutiao_work');
 const route=toutiaoArticleRoute;
 if(snapshot.provider!=='agentkey'||snapshot.kind!=='toutiao_work'||snapshot.contract_version!==1||snapshot.operation_key!==route.operationKey||snapshot.step_key!==route.stepKey||snapshot.input.mode!=='query'||snapshot.input.operationId!=='PAB6Z75Y'||snapshot.input.platform!=='toutiao'||snapshot.input.tool!==route.tool||snapshot.input.origin!==undefined||snapshot.receipt_model!==route.tool||!['received','completed'].includes(snapshot.receipt_status))throw new UnsupportedReplacement('Missing original Toutiao query evidence');
 const query=toutiaoArticleInput.parse(snapshot.input.parameters);
 const [summary]=await db`SELECT * FROM operation_results WHERE id=${Number(snapshot.data.querySummaryId)||0} AND run_id=${snapshot.run_id} AND step_version=${snapshot.step_version} AND receipt_id=${snapshot.receipt_id} AND kind='query_summary' AND item_key='query_summary'`;
 requireLiveResult(summary,'query_summary');
 if(summary.data.provider!=='agentkey'||summary.data.platform!=='toutiao'||summary.data.operationId!=='PAB6Z75Y'||summary.data.tool!==route.tool||summary.data.contractVersion!==1||stableJson(summary.data.query)!==stableJson(query))throw new UnsupportedReplacement('Toutiao summary differs from frozen query');
 const logicalKey=logicalKeyFor({service:'agentkey.query',purpose:route.operationKey,model:route.tool,identity:{runId:snapshot.run_id,stepVersion:snapshot.step_version,endpoint:snapshot.receipt_request?.endpoint,contractVersion:1,tool:route.tool,params:query}});
 if(snapshot.receipt_logical_key!==logicalKey||snapshot.receipt_service!=='agentkey.query'||snapshot.receipt_purpose!==route.operationKey||snapshot.receipt_subject!==`operation:${snapshot.run_id}`||snapshot.receipt_request?.tool!==route.tool||stableJson(snapshot.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement('Receipt does not prove original Toutiao query');
 const parsed=parseAgentKeyToutiao(snapshot.receipt_response,route,query).candidates.find(c=>c.itemKey===snapshot.item_key);
 if(!parsed||parsed.kind!==snapshot.kind||stableJson({...snapshot.data,querySummaryId:undefined})!==stableJson(parsed.data))throw new UnsupportedReplacement('Toutiao result differs from received response');
 return {parsed,sourceDiscoveredAt:new Date(snapshot.received_at??snapshot.created_at)};
}

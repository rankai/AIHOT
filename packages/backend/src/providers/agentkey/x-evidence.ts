import {z} from 'zod';
import type {Db} from '../../db.ts';
import {stableJson} from '../../lib/ids.ts';
import {logicalKeyFor} from '../receipts.ts';
import {requireLiveResult} from '../../operations/result-retention.ts';
import {UnsupportedReplacement} from '../../sources/x-replacement.ts';
import {agentKeyXOperations,xCollectionIds,xCollectionSearchInput,xSearchRoute,xPostsRoute,xDetailRoute,xProfileRoute,xListPostsRoute,xCommunityPostsRoute} from './x-contract.ts';
import {parseAgentKeyX,type XCandidate} from './x-parser.ts';
import {object} from './response.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';

export async function xResultSnapshot(db:Db,id:number){
 const [s]=await db`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,r.limits,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;return s;
}
/** Imports prove the original query receipt, never client identity or advisory eligibility hints. */
export async function agentKeyXEvidence(db:Db,s:any):Promise<{parsed:XCandidate;sourceDiscoveredAt:Date}>{
 requireLiveResult(s);
 const op=agentKeyXOperations.find(o=>o.operationId===s.input?.operationId),collection=s.input?.mode==='collection';
 if(s.provider!=='agentkey'||s.contract_version!==1||(!collection&&s.input?.mode!=='query'||collection&&!(xCollectionIds as readonly string[]).includes(s.input.operationId))||s.input.platform!=='x-research'||s.input.upstream!=='TikHub'||s.input.origin!==undefined||!op||s.operation_key!==op.route.operationKey||s.step_key!==op.route.stepKey||s.input.tool!==op.route.tool)throw new UnsupportedReplacement('Missing original X query run evidence');
 const route=op.route,query=(collection&&op.route===xSearchRoute?xCollectionSearchInput:op.schema).parse(s.input.parameters),service=collection?'agentkey.collect':'agentkey.query';
 if(collection&&(s.limits?.pages!==1||s.limits?.details!==0||!Number.isInteger(s.limits?.items)||s.limits.items<1||s.limits.items>500||s.input.enrichDetails===true||s.input.detailOperationId!==undefined||s.input.detailPage!==undefined))throw new UnsupportedReplacement('X collection exceeds frozen homepage limits');
 if(stableJson(query)!==stableJson(s.input.parameters))throw new UnsupportedReplacement('X frozen parameters are not canonical');
 const [summary]=await db`SELECT * FROM operation_results WHERE id=${Number(s.data.querySummaryId)||0} AND run_id=${s.run_id} AND step_version=${s.step_version} AND receipt_id=${s.receipt_id} AND kind='query_summary' AND item_key='query_summary'`;
 requireLiveResult(summary,'query_summary');
 const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity:{runId:s.run_id,stepVersion:s.step_version,endpoint:s.receipt_request?.endpoint,contractVersion:1,tool:route.tool,params:query}});
 if(s.receipt_logical_key!==logicalKey||s.receipt_service!==service||s.receipt_purpose!==route.operationKey||s.receipt_subject!==`operation:${s.run_id}`||s.receipt_model!==route.tool||!['received','completed'].includes(s.receipt_status)||s.receipt_request?.tool!==route.tool||stableJson(s.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement('Receipt does not prove original X query');
 const page=parseAgentKeyX(s.receipt_response,route,query),selected=collection?page.candidates.slice(0,s.limits.items):page.candidates,parsed=selected.find(c=>c.itemKey===s.item_key);
 const projection=(data:Record<string,unknown>)=>({...data,querySummaryId:undefined,importable:undefined,missing:undefined,pendingReason:undefined});
 const expectedSummary={...page.summary,platform:'x-research',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool,contractVersion:1,...(collection?{returnedPage:page.summary.pagination??{},selectedCount:selected.length,unprocessedDueToLimit:page.candidates.length-selected.length,nextParameters:null}:{})};
 if(!parsed||parsed.kind!==s.kind||stableJson(projection(s.data))!==stableJson(projection(parsed.data))||stableJson(summary.data)!==stableJson(expectedSummary))throw new UnsupportedReplacement('X result or summary differs from received response');
 if(collection&&route===xPostsRoute)requireXCollectionAccountScope(page.summary,query,parsed);
 const sourceDiscoveredAt=new Date(s.received_at);
 if(!s.received_at||!Number.isFinite(sourceDiscoveredAt.getTime()))throw new UnsupportedReplacement('Missing original X receipt discovery time');
 return {parsed,sourceDiscoveredAt};
}
const stableId=z.string().regex(/^\d+$/).max(30),handle=z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
/** A recurring account snapshot must prove its actual scope, independently of each post author. */
export function requireXCollectionAccountScope(summary:Record<string,unknown>,query:Record<string,unknown>,candidate:XCandidate){
 const scope=object(summary.receivedScope),uid=stableId.safeParse(scope?.rest_id),actualHandle=handle.safeParse(scope?.screen_name);
 if(!uid.success||query.screen_name!==undefined&&!actualHandle.success)throw new UnsupportedReplacement('X account snapshot lacks actual received account scope');
 if(query.screen_name!==undefined&&actualHandle.success&&actualHandle.data.toLowerCase()!==String(query.screen_name).toLowerCase()||query.rest_id!==undefined&&uid.data!==String(query.rest_id))throw new AgentKeyPayloadError('X received account scope contradicts frozen account');
 const record=object(candidate.data.record),author=object(record?.author),authorId=stableId.safeParse(author?.rest_id);
 if(!authorId.success)throw new UnsupportedReplacement('X account snapshot lacks received author identity');
 if(authorId.data!==uid.data)throw new AgentKeyPayloadError('X post author contradicts received account scope');
}

function postFacts(value:unknown){
 const r=object(value);if(!r||r.role!=='post'||r.roleLimitations!==undefined||r.retweeted!==undefined||r.retweeted_tweet!==undefined)throw new UnsupportedReplacement('X role is research only');
 const author=object(r.user_info)??object(r.author),context=object(r.authorContext),ids=z.object({tweetId:stableId,userId:stableId}).safeParse({tweetId:r.tweetId,userId:author?.rest_id});
 if(!ids.success)throw new UnsupportedReplacement('X work lacks received stable post or author identity');
 const {tweetId,userId}=ids.data;
 const actualHandle=author?.screen_name??(context?.source==='received-account-context'&&context.rest_id===userId?context.screen_name:undefined),checkedHandle=handle.safeParse(actualHandle);
 if(!checkedHandle.success)throw new UnsupportedReplacement('X work lacks received legal author handle');
 const username=checkedHandle.data;
 if(r.url!==`https://x.com/${username}/status/${tweetId}`||r.urlSource!=='derived-canonical-permalink'||typeof r.text!=='string'||!r.text.trim())throw new UnsupportedReplacement('X work lacks received text or a consistent native URL');
 return {r,tweetId,text:r.text,user:{userId,username,displayName:typeof author?.name==='string'?author.name:null}};
}
export function agentKeyXWork(parsed:XCandidate){
 const op=agentKeyXOperations.find(o=>o.operationId===parsed.data.operationId);
 if(!op||!(parsed.kind==='x_detail_work'&&op.route===xDetailRoute||parsed.kind==='x_research_work'&&[xSearchRoute,xPostsRoute,xListPostsRoute,xCommunityPostsRoute].some(r=>r===op.route)))throw new UnsupportedReplacement('X query role cannot import material');
 const {r,...post}=postFacts(parsed.data.record);
 let quoted;
 if(r.quoted!==undefined){const q=postFacts(r.quoted);if(q.r.quoted!==undefined)throw new UnsupportedReplacement('Nested X quote remains research');quoted={authorName:q.user.displayName??q.user.username,handle:q.user.username,text:q.text,url:q.r.url as string};}
 return {...post,createdAt:typeof r.created_at==='string'?r.created_at:null,...(Object.hasOwn(r,'lang')&&(typeof r.lang==='string'||r.lang===null)?{lang:r.lang}:{}),...(r.in_reply_to_status_id_str===null?{replyTo:null}:{}),...(quoted?{quoted}:{}),metrics:{favorite:r.favorites??r.likes??null,retweet:r.retweets??null,views:r.views??null}};
}
export function agentKeyXAccount(parsed:XCandidate){
 if(parsed.kind!=='account'||parsed.data.operationId!==agentKeyXOperations.find(o=>o.route===xProfileRoute)!.operationId)throw new UnsupportedReplacement('X query role cannot bind an account');
 const r=object(parsed.data.record);return {userId:stableId.parse(r?.rest_id??r?.id),username:handle.parse(r?.profile)};
}

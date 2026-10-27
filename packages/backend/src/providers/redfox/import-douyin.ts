import {logicalKeyFor} from "../receipts.ts";
import { importSource, lockSubscription } from "../../sources/subscriptions.ts";
import { registerImportedVideo } from "../../sources/subscription-video.ts";
import {parseAgentKeyDouyin,verifyDouyinDetailAuthor,legacyDouyinV4Record} from "../agentkey/douyin-parser.ts";
import {douyinSearchRoute,douyinTopicRoute,agentKeyRouteFor,agentKeyOperation,douyinAccountPostsRoute,douyinDetailRoute,douyinAccountSearchRoute,agentKeyRouteInput} from "../agentkey/douyin-contract.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {applyAccountDetailOrigin} from "./account-detail-origin.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWorkDetailOrigin} from "./work-detail-origin.ts";
import {workDetailOrigin} from "./work-detail-origin.ts";
import {redfoxDouyinHasVideo,agentKeyDouyinV4HasVideo} from "./video-media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { douyinVideoId,normalizeUrl } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseDouyin,type DouyinIdentity } from "./douyin.ts";
import { DouyinOperationId,douyinOperations } from "./douyin-contract.ts";
const Identifier=z.string().min(1).max(500);
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({uid:Identifier.optional(),secUserId:Identifier.optional(),url:z.url().optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  const valid=(v:unknown):v is string=>{if(typeof v!=="string")return false;try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  return [...new Set([...(Array.isArray(record.imageUrlList)?record.imageUrlList:[]),record.coverUrl,record.cover_url].filter(valid))].map(url=>({kind:"image",url}));
}
function publicationTime(operation:string,record:Record<string,unknown>):Date|null{
  if(["WD6UT8DQ","0ZB9S2FW"].includes(operation)&&typeof record.create_time==="number"){
    const date=new Date(record.create_time);return Number.isFinite(date.getTime())?date:null;
  }
  const raw=record.publishTime;if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;
  const date=new Date(raw);return Number.isFinite(date.getTime())?date:null;
}
export async function importDouyinResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    // Acquire the subscription before author/material locks, including manual replay of collected results.
    for(const member of [...(snapshot.input.members??[])].sort((a,b)=>a.subscriptionId-b.subscriptionId))await lockSubscription(tx,member.subscriptionId);
    const {parsed,origin,sourceDiscoveredAt,operationId,hasVideo}=snapshot.provider==="agentkey"?await agentKeyDouyinEvidence(tx,snapshot):await redfoxEvidence(tx,snapshot);
    const account=parsed.kind==="douyin_account",record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as DouyinIdentity,identity:DouyinIdentity={...received};
    if(snapshot.provider==="agentkey"&&(account?!received.uid&&!received.secUserId:!parsed.data.workId))throw new UnsupportedReplacement(account?"A received stable account identity is required":"A received stable work identity is required");
    if(account&&input.supplement)throw new UnsupportedReplacement("Account import requires received stable IDs");
    for(const kind of ["uid","secUserId"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received stable identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=typeof parsed.data.url==="string"?parsed.data.url:null,url=original??input.supplement?.url;
    if(original&&input.supplement?.url&&normalizeUrl(original)!==normalizeUrl(input.supplement.url))throw new StaleOperationError("Received original URL cannot be replaced");
    const nativeId=url?douyinVideoId(url):null;
    if(!account&&(!nativeId||!url))throw new UnsupportedReplacement("A documented native Douyin video permalink is required; short links are not resolved");
    if(!account&&parsed.data.workId&&parsed.data.workId!==nativeId)throw new StaleOperationError("Received work ID differs from its native original URL");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    let sourceId:string,source;
    if(account){
    if(!ids.length)throw new UnsupportedReplacement("A verified author UID or secure ID is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`douyin:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='douyin' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=identity.uid?`uid:${identity.uid}`:`secUserId:${identity.secUserId}`;
    sourceId=input.sourceId??owners[0]??`douyin-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Douyin accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof DouyinIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='douyin' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof DouyinIdentity]&&identity[b.id_kind as keyof DouyinIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    }else{
      if(snapshot.article_id&&snapshot.source_id&&snapshot.provenance?.douyinImport?.key===commandKey){
        const [completed]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
        requireLiveResult(completed,snapshot.kind);
        if(!completed!.article_id||!completed!.source_id||completed!.provenance?.douyinImport?.key!==commandKey||stableJson(completed!.provenance.douyinImport.intent)!==stableJson({sourceId:input.sourceId??null,supplement:input.supplement??null}))throw new StaleOperationError("Completed import command has different input");
        return {resultId,sourceId:completed!.source_id as string,articleId:completed!.article_id as string};
      }
      source=await importSource(tx,snapshot.input.members??[],input.sourceId,snapshot.input.forceSourceId,origin&&"resultId" in origin?{resultId:Number(origin.resultId),provider:snapshot.provider,runId:snapshot.run_id}:undefined);
      if(!source)throw new UnsupportedReplacement("Select an associated source; subscription/source is missing, disabled or changed");
      sourceId=source.id;
    }
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.douyinImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(account&&!source){const primary=identity.uid?`uid:${identity.uid}`:`secUserId:${identity.secUserId}`;const name=String(record.displayName??record.nickname??record.authorName??record.user_nickname??`抖音 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"douyin"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(account)for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"douyin",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const body=record.content??record.aweme_desc??(snapshot.provider==="agentkey"?record.desc:undefined),publishedAt=snapshot.provider==="agentkey"?(typeof parsed.data.publishedAt==="string"?new Date(parsed.data.publishedAt):null):publicationTime(operationId,record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:`${snapshot.provider}-import-unknown-time`;
      const author=record.authorName??record.accountName??record.user_nickname??record.userName;
      const material=await upsertMaterial({bodyUpdate:origin?"fill-missing":undefined,sourceId,url:url!,identityKey:`douyin:aweme_id:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:hasVideo?confirmedVideoMedia(media(record)):media(record),via:"import",raw:{provider:snapshot.provider,resultId,publishTime:record.publishTime??record.create_time??null,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({douyinImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    if(articleId)await registerImportedVideo(tx,resultId,{platform:"douyin",operationId,record,confirmed:hasVideo,singleVideo:true,videoProof:snapshot.provider==="agentkey"?"agentkey-douyin-v4":"verified-current-work-type",workId:nativeId!,originalUrl:url!});
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}

async function redfoxEvidence(tx:Tx,snapshot:any){
  const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=DouyinOperationId.safeParse(executionInput.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="douyin"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Douyin result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"douyin",operation.data);
    const shape=douyinOperations[operation.data].shape;
    if(!["douyin_account","douyin_work"].includes(snapshot.kind))throw new UnsupportedReplacement("Account ranking links require explicit stable identity verification");
    const payload=shape==="accounts"||shape==="works"?{list:[snapshot.data.record]}:shape==="work_rank"||shape==="growth_rank"?[snapshot.data.record]:snapshot.data.record;
    const parsed=parseDouyin(operation.data,payload,executionInput.parameters)[0];
    if(!parsed||parsed.kind!==snapshot.kind)throw new UnsupportedReplacement("Result kind does not match its received operation record");
    const accountOrigin=executionInput.origin?.kind==="account";
    if(accountOrigin)applyAccountDetailOrigin(operation.data,executionInput.parameters,parsed!,executionInput.origin);
    const origin=accountOrigin?undefined:applyWorkDetailOrigin(operation.data,executionInput.parameters,parsed!,executionInput.origin);
    let hasVideo=redfoxDouyinHasVideo(operation.data,parsed.data.record as Record<string,unknown>);
    if(!hasVideo&&origin){
      const checked=await workDetailOrigin(tx,origin.resultId,operation.data,executionInput.parameters);
      if(stableJson(checked)!==stableJson(origin))throw new UnsupportedReplacement("Video source origin differs from frozen work evidence");
      const [source]=await tx`SELECT data FROM operation_results WHERE id=${origin.resultId}`;
      hasVideo=redfoxDouyinHasVideo(origin.sourceOperation,source!.data.record);
    }
    return {parsed,origin,sourceDiscoveredAt,operationId:operation.data,hasVideo};
}

export async function agentKeyDouyinEvidence(tx:Tx,snapshot:any):Promise<{parsed:{kind:string;data:Record<string,unknown>};origin:{discoveredAt:string}|undefined;sourceDiscoveredAt:Date;operationId:string;hasVideo:boolean}>{
  requireLiveResult(snapshot);
  if(!["douyin_work","douyin_account"].includes(snapshot.kind))throw new UnsupportedReplacement("Not an importable AgentKey Douyin result");
  const [summary]=await tx`SELECT * FROM operation_results WHERE id=${Number(snapshot.data.querySummaryId)||0} AND run_id=${snapshot.run_id} AND step_version=${snapshot.step_version} AND receipt_id=${snapshot.receipt_id} AND kind='query_summary'`;
  requireLiveResult(summary,"query_summary");
  const operation=agentKeyOperation(summary?.data.operationId),route=operation?.route;
  if(!route||snapshot.contract_version!==route.contractVersion||summary.data.provider!=="agentkey"||summary.data.tool!==route.tool||snapshot.receipt_model!==route.tool||!["received","completed"].includes(snapshot.receipt_status))throw new UnsupportedReplacement("Missing AgentKey page receipt evidence");
  if(snapshot.kind!==(route===douyinAccountSearchRoute?"douyin_account":"douyin_work"))throw new UnsupportedReplacement("AgentKey result kind does not match its route");
  if(![douyinSearchRoute,douyinAccountPostsRoute,douyinDetailRoute,douyinAccountSearchRoute,douyinTopicRoute].some(r=>r===route))throw new UnsupportedReplacement("Research snapshots cannot import or bind sources");
  // Historical results belong to their original step, not the run's now-current step.
  if(!agentKeyRouteFor({...snapshot,step_key:route.stepKey}))throw new UnsupportedReplacement("Unsupported original AgentKey step");
  const query=agentKeyRouteInput(route,summary.data.query);
  const service=snapshot.input.mode==="collection"?"agentkey.collect":"agentkey.query";
  const identity={runId:snapshot.run_id,stepVersion:snapshot.step_version,endpoint:snapshot.receipt_request?.endpoint,contractVersion:route.contractVersion,tool:route.tool,params:query};
  const logicalKey=logicalKeyFor({service,purpose:route.operationKey,model:route.tool,identity});
  if(snapshot.receipt_logical_key!==logicalKey||snapshot.receipt_purpose!==route.operationKey||snapshot.receipt_subject!==`operation:${snapshot.run_id}`||snapshot.receipt_service!==service||snapshot.receipt_request?.tool!==route.tool||stableJson(snapshot.receipt_request?.params)!==stableJson(query))throw new UnsupportedReplacement("AgentKey receipt does not prove this page query and step");
  const page=parseAgentKeyDouyin(snapshot.receipt_response,route,query);
  const parsed=page.candidates.find(item=>item.itemKey===snapshot.item_key);
  const receivedData={...snapshot.data,pendingReason:undefined,querySummaryId:undefined};
  if(parsed&&route===douyinSearchRoute){
    // Old V4 results retained the entire AwemeInfo. Accept only that exact receipt-derived shape;
    // the material always uses the current safe projection, including when importing history.
    const legacy=legacyDouyinV4Record(snapshot.receipt_response,snapshot.item_key,parsed.data.record as Record<string,unknown>);
    if(legacy&&stableJson(receivedData.record)===stableJson(legacy))receivedData.record=parsed.data.record;
  }
  if(!parsed||parsed.kind!==snapshot.kind||stableJson({...receivedData,importBlockers:undefined})!==stableJson({...parsed.data,importBlockers:undefined}))throw new UnsupportedReplacement("AgentKey result differs from its received page");
  let origin:{discoveredAt:string}|undefined;
  if(route===douyinDetailRoute&&snapshot.operation_key===douyinAccountPostsRoute.operationKey){
    const [source]=await tx`SELECT z.*,r.provider,r.operation_key,r.contract_version,r.input,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${Number(summary.data.originResultId)||0} AND z.run_id=${snapshot.run_id} AND z.step_version<${snapshot.step_version}`;
    if(!source||source.data.operationId!=="QEQLCKD6")throw new UnsupportedReplacement("Missing original account page work evidence");
    const original=await agentKeyDouyinEvidence(tx,source);
    verifyDouyinDetailAuthor(parsed.data,original.parsed.data,source.receipt_response,snapshot.input.parameters);
    origin={discoveredAt:original.sourceDiscoveredAt.toISOString()};
  }
  const hasVideo=route===douyinSearchRoute&&agentKeyDouyinV4HasVideo(snapshot.receipt_response,snapshot.item_key,parsed.data.workId);
  return {parsed,origin,sourceDiscoveredAt:new Date(snapshot.received_at??snapshot.created_at),operationId:operation!.operationId,hasVideo};
}

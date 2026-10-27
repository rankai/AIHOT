import {importSource} from "../../sources/subscriptions.ts";
import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {redfoxXiaohongshuHasVideo} from "./video-media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {agentKeyXiaohongshuEvidence,xiaohongshuResultSnapshot} from "../agentkey/xiaohongshu-evidence.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {applyAccountDetailOrigin} from "./account-detail-origin.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWorkDetailOrigin} from "./work-detail-origin.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { xiaohongshuNoteId,normalizeUrl } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseXiaohongshu } from "./xiaohongshu-parser.ts";
import { XiaohongshuOperationId,xiaohongshuOperations } from "./xiaohongshu-contract.ts";
interface XiaohongshuIdentity { userId?:string }
const Identifier=z.string().min(1).max(500);
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({userId:Identifier.optional(),url:z.url().optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  const result:MediaItem[]=[];
  for(const raw of [record.coverUrl,record.cover,record.thumbnail]){
    if(typeof raw!=="string")continue;
    try{const u=new URL(raw);if(["http:","https:"].includes(u.protocol)&&!u.username&&!u.password&&!result.some(m=>m.url===raw))result.push({kind:"image",url:raw});}catch{/* Invalid media is not fetched. */}
  }
  return result;
}
function publicationTime(record:Record<string,unknown>):Date|null{
  const raw=record.workPublishTime??record.publicTime??record.createTime??record.gmtCreate;
  if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;
  const date=new Date(raw);return Number.isFinite(date.getTime())?date:null;
}
export async function importXiaohongshuResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const snapshot=await xiaohongshuResultSnapshot(tx,resultId);
    if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const {parsed,origin,sourceDiscoveredAt}=snapshot.provider==="agentkey"?await agentKeyXiaohongshuEvidence(tx,snapshot):await redfoxEvidence(tx,snapshot);
    const account=parsed.kind==="xiaohongshu_account",record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as XiaohongshuIdentity,identity:XiaohongshuIdentity={...received};
    if(snapshot.provider==="agentkey"&&(input.supplement||account&&!received.userId||!account&&(!parsed.data.workId||!parsed.data.url)))throw new UnsupportedReplacement("AgentKey import requires received native URL and work identity; manual supplements cannot replace evidence");
    if(account&&input.supplement)throw new UnsupportedReplacement("Account import requires received stable IDs");
    for(const kind of ["userId"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received stable identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=typeof parsed.data.url==="string"?parsed.data.url:null,url=original??input.supplement?.url;
    if(original&&input.supplement?.url&&normalizeUrl(original)!==normalizeUrl(input.supplement.url))throw new StaleOperationError("Received original URL cannot be replaced");
    const nativeId=url?xiaohongshuNoteId(url):null;
    if(!account&&(!nativeId||!url))throw new UnsupportedReplacement("A documented native Xiaohongshu permalink is required; short links are not resolved");
    if(!account&&parsed.data.workId&&parsed.data.workId!==nativeId)throw new StaleOperationError("Received work ID differs from its native original URL");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    const primary=`userId:${identity.userId}`;
    let sourceId:string,source;
    if(account){
    if(!ids.length)throw new UnsupportedReplacement("A verified author userId is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`xiaohongshu:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='xiaohongshu' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    sourceId=input.sourceId??owners[0]??`xiaohongshu-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Xiaohongshu accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof XiaohongshuIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='xiaohongshu' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof XiaohongshuIdentity]&&identity[b.id_kind as keyof XiaohongshuIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    }else{
      if(snapshot.article_id&&snapshot.source_id&&snapshot.provenance?.xiaohongshuImport?.key===commandKey){
        const [completed]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
        requireLiveResult(completed,snapshot.kind);
        if(!completed!.article_id||!completed!.source_id||completed!.provenance?.xiaohongshuImport?.key!==commandKey||stableJson(completed!.provenance.xiaohongshuImport.intent)!==stableJson({sourceId:input.sourceId??null,supplement:input.supplement??null}))throw new StaleOperationError("Completed import command has different input");
        return {resultId,sourceId:completed!.source_id as string,articleId:completed!.article_id as string};
      }
      source=await importSource(tx,snapshot.input.members??[],input.sourceId,snapshot.input.forceSourceId,origin&&"resultId" in origin?{resultId:Number(origin.resultId),provider:snapshot.provider,runId:snapshot.run_id}:undefined);
      if(!source)throw new UnsupportedReplacement("Select an associated source; subscription/source is missing, disabled or changed");
      sourceId=source.id;
    }
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.xiaohongshuImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(account&&!source){const name=String(record.name??record.authorName??record.accountName??record.accountNickname??record.authorNickname??record.userName??`小红书 ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"xiaohongshu"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(account)for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"xiaohongshu",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const body=record.workDesc??record.desc??(snapshot.provider==="agentkey"?record.description:undefined),publishedAt=snapshot.provider==="agentkey"?null:publicationTime(record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:`${snapshot.provider}-import-unknown-time`;
      const author=record.authorName??record.accountNickname??record.authorNickname??record.userName;
      const material=await upsertMaterial({bodyUpdate:origin?"fill-missing":undefined,sourceId,url:url!,identityKey:`xiaohongshu:noteId:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:((snapshot.provider==="agentkey"?record.workType==="video":redfoxXiaohongshuHasVideo(String(parsed.data.operationId),record))?confirmedVideoMedia(media(record)):media(record)),via:"import",raw:{provider:snapshot.provider,resultId,publishTime:record.workPublishTime??record.publicTime??record.createTime??record.gmtCreate??null,role:parsed.data.role??null,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({xiaohongshuImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    if(articleId)await registerImportedVideo(tx,resultId,{platform:"xiaohongshu",operationId:String(parsed.data.operationId),record:record,confirmed:(snapshot.provider==="agentkey"?record.workType==="video":redfoxXiaohongshuHasVideo(String(parsed.data.operationId),record)),singleVideo:true,videoProof:"verified-current-work-type",workId:nativeId!});
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}

async function redfoxEvidence(tx:Tx,snapshot:any){
    const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=XiaohongshuOperationId.safeParse(executionInput.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="xiaohongshu"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Xiaohongshu result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"xiaohongshu",operation.data);
    const shape=xiaohongshuOperations[operation.data].shape;
    if(!["xiaohongshu_account","xiaohongshu_work"].includes(snapshot.kind))throw new UnsupportedReplacement("Account ranking links require explicit stable identity verification");
    let payload:unknown=snapshot.data.record;
    if(["accounts","works","ai_works"].includes(shape))payload={list:[payload]};
    else if(["linked_rank","dark_rank"].includes(shape))payload=[payload];
    else if(shape==="research"){
      const role=String(snapshot.item_key).split(":")[0];
      if(!["keyword_match","provider_recommendation"].includes(role)||snapshot.data.role!==role)throw new UnsupportedReplacement("Research result role does not match its received item");
      payload={articles:role==="keyword_match"?[payload]:[],latestHotArticles:role==="provider_recommendation"?[payload]:[]};
    }
    const parsed=parseXiaohongshu(operation.data,payload,executionInput.parameters).find(r=>r.kind===snapshot.kind);
    if(!parsed||parsed.kind!==snapshot.kind||parsed.data.role!==snapshot.data.role)throw new UnsupportedReplacement("Result kind or role does not match its received operation record");
    const accountOrigin=executionInput.origin?.kind==="account";
    if(accountOrigin)applyAccountDetailOrigin(operation.data,executionInput.parameters,parsed!,executionInput.origin);
    const origin=accountOrigin?undefined:applyWorkDetailOrigin(operation.data,executionInput.parameters,parsed!,executionInput.origin);
    return {parsed,origin,sourceDiscoveredAt};
}

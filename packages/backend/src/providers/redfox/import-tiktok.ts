import {importSource} from "../../sources/subscriptions.ts";
import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {redfoxTiktokHasVideo} from "./video-media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {collectedDetailContext} from "./collection-detail.ts";
import {applyWorkDetailOrigin} from "./work-detail-origin.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { tiktokVideoId,normalizeUrl } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseTiktok } from "./tiktok.ts";
import { TiktokOperationId,tiktokOperations } from "./tiktok-contract.ts";
type TiktokIdentity={userId?:string;secUserId?:string};
const Identifier=z.string().min(1).max(500);
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({userId:Identifier.optional(),secUserId:Identifier.optional(),url:z.url().optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  const video=record.videoData as Record<string,unknown>|null|undefined;
  const valid=(v:unknown):v is string=>{if(typeof v!=="string")return false;try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  if(!video)return [];
  const cover=[video.coverImage,video.originCoverImage,video.dynamicCoverImage].find(valid);
  const address=[video.playAddress,video.downloadNoMarkAddress,video.downloadAddress].find(valid);
  return [...(cover?[{kind:"image" as const,url:cover}]:[]),...(address?[{kind:"video" as const,url:address,...(cover?{poster:cover}:{})}]:[])];
}
function publicationTime(record:Record<string,unknown>):Date|null{
  const raw=record.publishTime;
  if(typeof raw!=="number"&&!(typeof raw==="string"&&/^-?\d+$/.test(raw)))return null;
  const seconds=Number(raw);
  if(!Number.isSafeInteger(seconds))return null;
  const date=new Date(seconds*1000);return Number.isFinite(date.getTime())?date:null;
}
export async function importTiktokResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const collected=await collectedDetailContext(tx,snapshot),executionInput=collected?.input??snapshot.input;
    const operation=TiktokOperationId.safeParse(executionInput.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="tiktok"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Tiktok result");
    const sourceDiscoveredAt=collected?.discoveredAt??await collectionDiscoveredAt(tx,snapshot,"tiktok",operation.data);
    const shape=tiktokOperations[operation.data].shape;
    if(!["tiktok_account","tiktok_work"].includes(snapshot.kind))throw new UnsupportedReplacement("TikTok topics and query summaries are research, not importable accounts or works");
    const payload=shape==="accounts"?{cursor:0,hasMore:0,userList:[snapshot.data.record]}:shape==="paged_works"?{nextCursor:0,hasMore:0,workList:[snapshot.data.record]}:shape==="works"?[snapshot.data.record]:snapshot.data.record;
    const parsed=parseTiktok(operation.data,payload,executionInput.parameters)[0];
    if(!parsed||parsed.kind!==snapshot.kind)throw new UnsupportedReplacement("Result kind does not match its received operation record");
    const origin=applyWorkDetailOrigin(operation.data,executionInput.parameters,parsed!,executionInput.origin);
    const account=parsed.kind==="tiktok_account",record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as TiktokIdentity,identity:TiktokIdentity={...received};
    if(account&&input.supplement)throw new UnsupportedReplacement("Account import requires received stable IDs");
    for(const kind of ["userId","secUserId"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received stable identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=typeof parsed.data.url==="string"?parsed.data.url:null,url=original??input.supplement?.url;
    if(original&&input.supplement?.url&&normalizeUrl(original)!==normalizeUrl(input.supplement.url))throw new StaleOperationError("Received original URL cannot be replaced");
    const nativeId=url?tiktokVideoId(url):null;
    if(!account&&(!nativeId||!url))throw new UnsupportedReplacement("A documented native Tiktok video permalink is required; short links are not resolved");
    if(!account&&parsed.data.workId&&parsed.data.workId!==nativeId)throw new StaleOperationError("Received work ID differs from its native original URL");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    const primary=identity.userId?`userId:${identity.userId}`:`secUserId:${identity.secUserId}`;
    let sourceId:string,source;
    if(account){
    if(!ids.length)throw new UnsupportedReplacement("A verified author UID or secure ID is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='tiktok' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    sourceId=input.sourceId??owners[0]??`tiktok-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Tiktok accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof TiktokIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='tiktok' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof TiktokIdentity]&&identity[b.id_kind as keyof TiktokIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    }else{
      if(snapshot.article_id&&snapshot.source_id&&snapshot.provenance?.tiktokImport?.key===commandKey){
        const [completed]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
        requireLiveResult(completed,snapshot.kind);
        if(!completed!.article_id||!completed!.source_id||completed!.provenance?.tiktokImport?.key!==commandKey||stableJson(completed!.provenance.tiktokImport.intent)!==stableJson({sourceId:input.sourceId??null,supplement:input.supplement??null}))throw new StaleOperationError("Completed import command has different input");
        return {resultId,sourceId:completed!.source_id as string,articleId:completed!.article_id as string};
      }
      source=await importSource(tx,snapshot.input.members??[],input.sourceId,snapshot.input.forceSourceId,origin&&"resultId" in origin?{resultId:Number(origin.resultId),provider:snapshot.provider,runId:snapshot.run_id}:undefined);
      if(!source)throw new UnsupportedReplacement("Select an associated source; subscription/source is missing, disabled or changed");
      sourceId=source.id;
    }
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.tiktokImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(account&&!source){const authorRecord=(account?record:record.authorData??{}) as Record<string,unknown>;const name=String(authorRecord.userName??authorRecord.userHandle??`TikTok ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"tiktok"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(account)for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"tiktok",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const body=record.content,publishedAt=publicationTime(record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=(record.authorData as Record<string,unknown>|null|undefined)?.userName;
      const material=await upsertMaterial({sourceId,url:url!,identityKey:`tiktok:workId:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:"fill-missing",bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:(redfoxTiktokHasVideo(operation.data,record)?confirmedVideoMedia(media(record)):media(record)),via:"import",raw:{provider:"redfox",resultId,publishTime:record.publishTime??null,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({tiktokImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    if(articleId)await registerImportedVideo(tx,resultId,{platform:"tiktok",operationId:String(parsed.data.operationId),record:record,confirmed:(redfoxTiktokHasVideo(String(parsed.data.operationId),record)),singleVideo:true,videoProof:"verified-current-work-type",workId:nativeId!});
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}

import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {redfoxInstagramHasVideo} from "./video-media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { instagramCode } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseInstagram,InstagramOrigin } from "./instagram.ts";
import { InstagramOperationId,instagramOperations } from "./instagram-contract.ts";
type InstagramIdentity={userId?:string};
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({userId:z.string().regex(/^[0-9]+$/).optional(),url:z.url().refine(v=>!!instagramCode(v),"A native Instagram post permalink is required").optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  const safe=(raw:unknown):raw is string=>{if(typeof raw!=="string")return false;try{const u=new URL(raw);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
  const records=[record,...(Array.isArray(record.carouselItems)?record.carouselItems:[])];
  return records.flatMap((item:Record<string,unknown>):MediaItem[]=>{
    if(safe(item.videoUrl))return [{kind:"video" as const,url:item.videoUrl,...(safe(item.thumbnailUrl??item.imageUrl)?{poster:String(item.thumbnailUrl??item.imageUrl)}:{})}];
    const image=item.imageUrl??item.thumbnailUrl;return safe(image)?[{kind:"image" as const,url:image}]:[];
  }).filter((item,index,all)=>all.findIndex(other=>other.url===item.url&&other.kind===item.kind)===index);
}
/** Only explicit seconds and offset ISO are publication evidence; preserve both raw values. */
function publicationTime(record:Record<string,unknown>):Date|null{
  let epoch:Date|null=null,iso:Date|null=null;
  if(typeof record.takenAt==="number"||typeof record.takenAt==="string"){
    const seconds=Number(record.takenAt);
    if(Number.isSafeInteger(seconds)&&Math.abs(seconds)<=8640000000000){const d=new Date(seconds*1000);if(Number.isFinite(d.getTime()))epoch=d;}
  }
  if(typeof record.takenAtDate==="string"&&z.iso.datetime({offset:true}).safeParse(record.takenAtDate).success){const d=new Date(record.takenAtDate);if(Number.isFinite(d.getTime()))iso=d;}
  if(epoch&&iso&&Math.floor(epoch.getTime()/1000)!==Math.floor(iso.getTime()/1000))return null;
  return epoch??iso;
}
export async function importInstagramResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const operation=InstagramOperationId.safeParse(snapshot.input.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="instagram"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Instagram result");
    const sourceDiscoveredAt=await collectionDiscoveredAt(tx,snapshot,"instagram",operation.data);
    if(!["instagram_account","instagram_work"].includes(snapshot.kind))throw new UnsupportedReplacement("Instagram query summaries are not importable accounts or works");
    const parameters=instagramOperations[operation.data].schema.parse(snapshot.input.parameters);
    const origin=snapshot.input.origin===undefined?undefined:InstagramOrigin.parse(snapshot.input.origin);
    const payload=operation.data==="GM0TISWI"?{items:[snapshot.data.record]}:snapshot.data.record;
    const parsed=parseInstagram(operation.data,payload,parameters,origin)[0];
    if(!parsed||parsed.kind!==snapshot.kind)throw new UnsupportedReplacement("Result kind does not match its received operation record");
    const account=parsed.kind==="instagram_account",record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as InstagramIdentity,identity:InstagramIdentity={...received};
    if(account&&input.supplement)throw new UnsupportedReplacement("Account import requires received stable IDs");
    for(const kind of ["userId"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received stable identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=typeof parsed.data.url==="string"?parsed.data.url:null;
    if(original&&input.supplement?.url&&input.supplement.url!==original)throw new StaleOperationError("Received original URL cannot be replaced");
    const url=original??input.supplement?.url;
    const nativeId=url?instagramCode(url):null;
    if(!account&&(!nativeId||!url))throw new UnsupportedReplacement("A documented native Instagram post permalink is required; short links are not resolved");
    if(!account&&parsed.data.workId&&parsed.data.workId!==nativeId)throw new StaleOperationError("Received work ID differs from its native original URL");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified author user ID is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`instagram:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='instagram' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=`userId:${identity.userId}`;
    const sourceId=input.sourceId??owners[0]??`instagram-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    if(!account&&input.sourceId&&owners[0]!==input.sourceId)throw new UnsupportedReplacement("Work import follows the verified author, not an arbitrary source");
    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Instagram accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof InstagramIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='instagram' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof InstagramIdentity]&&identity[b.id_kind as keyof InstagramIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.instagramImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.fullName??record.username??(record.user as {username?:string}|undefined)?.username??`Instagram ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"instagram"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!account&&!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"instagram",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    if(!account){
      const body=record.captionText,publishedAt=publicationTime(record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=(record.user as {fullName?:string;username?:string}|undefined)?.fullName??(record.user as {username?:string}|undefined)?.username;
      const material=await upsertMaterial({sourceId,url:url!,identityKey:`instagram:code:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:"fill-missing",bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:(redfoxInstagramHasVideo(record)?[...media(record),...confirmedVideoMedia()]:media(record)),via:"import",raw:{provider:"redfox",resultId,takenAt:record.takenAt??null,takenAtDate:record.takenAtDate??null,originResultId:origin?.resultId??null,request:snapshot.input.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({instagramImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    if(articleId)await registerImportedVideo(tx,resultId,{platform:"instagram",operationId:String(parsed.data.operationId),record:record,confirmed:(redfoxInstagramHasVideo(record)),singleVideo:true,videoProof:"verified-current-work-type",workId:nativeId!});
    await audit(actor,account?"source.bind_account":"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}

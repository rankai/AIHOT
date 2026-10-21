import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256,stableJson } from "../../lib/ids.ts";
import { youtubeVideoId } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline,upsertMaterial,type MediaItem } from "../../content/materials.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseYoutube,YoutubeOrigin } from "./youtube.ts";
import { YoutubeOperationId,youtubeOperations } from "./youtube-contract.ts";
type YoutubeIdentity={channelId?:string};
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500),supplement:z.object({channelId:z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),url:z.url().refine(v=>!!youtubeVideoId(v),"A native Youtube watch permalink is required").optional(),evidence:z.string().trim().min(1).max(1000)}).strict().optional()}).strict();
function media(record:Record<string,unknown>):MediaItem[]{
  if(!Array.isArray(record.thumbnails))return [];
  return record.thumbnails.flatMap(image=>{if(!image||typeof image.url!=="string")return [];try{const u=new URL(image.url);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?[{kind:"image" as const,url:image.url}]:[];}catch{return [];}});
}
function publicationTime(record:Record<string,unknown>):Date|null{
  const raw=record.date;
  if(typeof raw!=="string"||!z.iso.datetime({offset:true}).safeParse(raw).success)return null;
  const date=new Date(raw);return Number.isFinite(date.getTime())?date:null;
}
export async function importYoutubeResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if(!snapshot)return null;
    const operation=YoutubeOperationId.safeParse(snapshot.input.operationId);
    if(!operation.success||snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.receipt_model!==operation.data||!["received","completed"].includes(snapshot.receipt_status)||snapshot.data.platform!=="youtube"||snapshot.data.operationId!==operation.data)throw new UnsupportedReplacement("Not a confirmed Youtube result");
    const sourceDiscoveredAt=await collectionDiscoveredAt(tx,snapshot,"youtube",operation.data);
    if(snapshot.kind!=="youtube_work")throw new UnsupportedReplacement("YouTube query summaries are not importable works");
    const parameters=youtubeOperations[operation.data].schema.parse(snapshot.input.parameters);
    const origin=snapshot.input.origin===undefined?undefined:YoutubeOrigin.parse(snapshot.input.origin);
    const payload=operation.data==="GC5SC5HS"?{videos:[snapshot.data.record]}:snapshot.data.record;
    const parsed=parseYoutube(operation.data,payload,parameters,origin)[0];
    if(!parsed||parsed.kind!==snapshot.kind)throw new UnsupportedReplacement("Result kind does not match its received operation record");
    const record=parsed.data.record as Record<string,unknown>,received=parsed.data.identity as YoutubeIdentity,identity:YoutubeIdentity={...received};
    for(const kind of ["channelId"] as const){const extra=input.supplement?.[kind];if(extra&&received[kind]&&extra!==received[kind])throw new StaleOperationError("Received stable identity cannot be replaced");if(extra)identity[kind]=extra;}
    const original=typeof parsed.data.url==="string"?parsed.data.url:null;
    if(original&&input.supplement?.url&&input.supplement.url!==original)throw new StaleOperationError("Received original URL cannot be replaced");
    const url=original??input.supplement?.url;
    const nativeId=url?youtubeVideoId(url):null;
    if((!nativeId||!url))throw new UnsupportedReplacement("A documented native Youtube video permalink is required; short links are not resolved");
    if(parsed.data.workId&&parsed.data.workId!==nativeId)throw new StaleOperationError("Received work ID differs from its native original URL");
    const ids=Object.entries(identity).sort(([a],[b])=>a.localeCompare(b));
    if(!ids.length)throw new UnsupportedReplacement("A verified author channel ID is required");
    for(const [kind,value] of ids)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`youtube:${kind}:${value}`},0))`;
    const owners:string[]=[];
    for(const [kind,value] of ids){const [b]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='youtube' AND id_kind=${kind} AND id_value=${value}`;if(b)owners.push(b.source_id);}
    if(new Set(owners).size>1)throw new StaleOperationError("Received account IDs belong to different sources");
    const primary=`channelId:${identity.channelId}`;
    const sourceId=input.sourceId??owners[0]??`youtube-${sha256(primary).slice(0,24)}`;
    if(owners.length&&owners[0]!==sourceId)throw new StaleOperationError("Account identity already belongs to another source");
    if(input.sourceId&&owners[0]!==input.sourceId)throw new UnsupportedReplacement("Work import follows the verified author, not an arbitrary source");
    let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source&&input.sourceId)return null;
    if(source&&source.kind!=="external")throw new UnsupportedReplacement("Youtube accounts require an external source");
    if(source&&source.participation_mode!=="isolated"&&ids.some(([kind])=>!received[kind as keyof YoutubeIdentity]))throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior=await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='youtube' AND source_id=${sourceId}`;
    if(prior.some(b=>identity[b.id_kind as keyof YoutubeIdentity]&&identity[b.id_kind as keyof YoutubeIdentity]!==b.id_value))throw new StaleOperationError("Source already has another identity of this type");
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.youtubeImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    if(!source){const name=String(record.name??record.author??`YouTube ${primary}`).slice(0,200);[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${name},'external',${tx.json({platform:"youtube"})},'isolated',false,false,true,NULL) RETURNING *`;}
    if(!source!.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for(const [idKind,idValue] of ids)await bindSourceAccount(tx,{platform:"youtube",idKind,idValue,sourceId,evidence:{kind:"result",reference:String(resultId)}});
    let articleId:string|null=null;
    {
      const body=record.description,publishedAt=publicationTime(record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=record.author;
      const material=await upsertMaterial({sourceId,url:url!,identityKey:`youtube:videoId:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:"fill-missing",bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:media(record),via:"import",raw:{provider:"redfox",resultId,date:record.date??null,originResultId:origin?.resultId??null,request:snapshot.input.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({youtubeImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}

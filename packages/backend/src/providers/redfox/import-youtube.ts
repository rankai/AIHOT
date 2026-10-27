import {importSource} from "../../sources/subscriptions.ts";
import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { stableJson } from "../../lib/ids.ts";
import { youtubeVideoId } from "../../lib/url.ts";
import { audit } from "../../admin/auth.ts";
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
    await lockVideoParentSubscriptions(tx,resultId);
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
    if(snapshot.article_id&&snapshot.source_id&&snapshot.provenance?.youtubeImport?.key===commandKey){
      const [completed]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
      requireLiveResult(completed,snapshot.kind);
      if(!completed!.article_id||!completed!.source_id||completed!.provenance?.youtubeImport?.key!==commandKey||stableJson(completed!.provenance.youtubeImport.intent)!==stableJson({sourceId:input.sourceId??null,supplement:input.supplement??null}))throw new StaleOperationError("Completed import command has different input");
      return {resultId,sourceId:completed!.source_id as string,articleId:completed!.article_id as string};
    }
    const source=await importSource(tx,snapshot.input.members??[],input.sourceId,snapshot.input.forceSourceId,origin&&"resultId" in origin?{resultId:Number(origin.resultId),provider:snapshot.provider,runId:snapshot.run_id}:undefined);
    if(!source)throw new UnsupportedReplacement("Select an associated source; subscription/source is missing, disabled or changed");
    const sourceId=source.id;
    const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent={sourceId:input.sourceId??null,supplement:input.supplement??null},previous=result!.provenance?.youtubeImport;
    if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
    if(result!.source_id||result!.article_id){if(result!.source_id!==sourceId||(previous&&stableJson(previous.intent)!==stableJson(intent)))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId,articleId:result!.article_id};}
    let articleId:string|null=null;
    {
      const body=record.description,publishedAt=publicationTime(record),discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
      const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
      const author=record.author;
      const material=await upsertMaterial({sourceId,url:url!,identityKey:`youtube:videoId:${nativeId}`,title:String(parsed.data.title),author:typeof author==="string"?author:null,bodyUpdate:"fill-missing",bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:(confirmedVideoMedia(media(record))),via:"import",raw:{provider:"redfox",resultId,date:record.date??null,originResultId:origin?.resultId??null,request:snapshot.input.parameters,supplement:input.supplement??null}},tx);
      articleId=material.articleId;if(material.created||material.revised)await queueProcessing(articleId,{db:tx});
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({youtubeImport:{key:commandKey,intent}})} WHERE id=${resultId}`;
    if(articleId)await registerImportedVideo(tx,resultId,{platform:"youtube",operationId:String(parsed.data.operationId),record:record,confirmed:(true),singleVideo:true,videoProof:"verified-current-work-type",workId:nativeId!});
    await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId,identity,supplement:input.supplement??null},undefined,tx);
    return {resultId,sourceId,articleId};
  };
  return db?execute(db):sql.begin(execute);
}

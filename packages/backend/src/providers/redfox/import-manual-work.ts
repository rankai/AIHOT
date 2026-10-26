import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {z} from "zod";
import {sql} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {identityKeyForUrl} from "../../lib/url.ts";
import {audit} from "../../admin/auth.ts";
import {decideTimeline,upsertMaterial,type MediaItem} from "../../content/materials.ts";
import {queueProcessing} from "../../jobs/content.ts";
import {StaleOperationError} from "../operations/store.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {ShipinhaoOperationId,shipinhaoOperations,isShipinhaoShareUrl} from "./shipinhao-contract.ts";
import {KuaishouOperationId,kuaishouOperations} from "./kuaishou-contract.ts";
import {parseShipinhao} from "./shipinhao.ts";
import {parseKuaishou} from "./kuaishou.ts";
import {checkedManualOrigin} from "./manual-work-origin.ts";
/** Documented native permalink only; opaque supplier photoId is not a path identity. */
export function isKuaishouWorkUrl(value:string):boolean{
 if(!/^https?:\/\/(?:www\.)?kuaishou\.com\//i.test(value)||value.includes('#'))return false;
 try{const u=new URL(value);return !u.username&&!u.password&&!u.port&&!u.hash&&/^\/short-video\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);}catch{return false;}
}
const Input=z.object({sourceId:z.string().min(1),reason:z.string().trim().min(1).max(500),supplement:z.object({url:z.string().refine(v=>isShipinhaoShareUrl(v)||isKuaishouWorkUrl(v),"A verified native work permalink is required"),evidence:z.string().trim().min(1).max(1000)}).strict()}).strict();
function safeUrl(v:unknown):string|null{if(typeof v!=="string")return null;try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?v:null;}catch{return null;}}
function media(record:Record<string,unknown>):MediaItem[]{
 const video=safeUrl(record.videoUrl),cover=safeUrl(record.thumbUrl??record.coverUrl??record.cover);
 return [...(video?[{kind:"video" as const,url:video,...(cover?{poster:cover}:{})}]:[]),...(!video&&cover?[{kind:"image" as const,url:cover}]:[])];
}
export async function importManualWorkResult(resultId:number,raw:unknown,actor:string,key:unknown){
 const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw);
 return sql.begin(async tx=>{
  const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  if(!snapshot)return null;
    await lockVideoParentSubscriptions(tx,resultId);
  if(snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||!["received","completed"].includes(snapshot.receipt_status))throw new UnsupportedReplacement("Not a confirmed synchronous work result");
  const sph=ShipinhaoOperationId.safeParse(snapshot.input.operationId),ks=KuaishouOperationId.safeParse(snapshot.input.operationId);
  const platform=sph.success?"shipinhao":ks.success?"kuaishou":null;
  if(!platform||snapshot.input.platform!==platform||snapshot.kind!==`${platform}_work`||snapshot.data.platform!==platform||snapshot.data.operationId!==snapshot.input.operationId||snapshot.receipt_model!==snapshot.input.operationId)throw new UnsupportedReplacement("Only received video-channel or Kuaishou works can be manually imported");
  const sourceDiscoveredAt=await collectionDiscoveredAt(tx,snapshot,platform,snapshot.input.operationId);
  let parsed,parameters:Record<string,unknown>;
  if(sph.success){const op=shipinhaoOperations[sph.data];parameters=op.schema.parse(snapshot.input.parameters);parsed=parseShipinhao(sph.data,op.shape==="works"?{list:[snapshot.data.record]}:snapshot.data.record,parameters,snapshot.input.origin)[0]!;}
  else if(ks.success){const op=kuaishouOperations[ks.data];parameters=op.schema.parse(snapshot.input.parameters);parsed=parseKuaishou(ks.data,op.shape==="works"?{list:[snapshot.data.record]}:snapshot.data.record,parameters,snapshot.input.origin)[0]!;}
  else throw new UnsupportedReplacement("Unsupported work operation");
  if(parsed.kind!==snapshot.kind)throw new UnsupportedReplacement("Stored record does not match work kind");
  const origin=checkedManualOrigin(snapshot.input.origin,snapshot.input.operationId,parameters),url=input.supplement.url;
  if(!(platform==="shipinhao"?isShipinhaoShareUrl(url):isKuaishouWorkUrl(url)))throw new UnsupportedReplacement("Original URL does not belong to the result platform");
  if(snapshot.input.operationId==="MH5YA9DL"&&identityKeyForUrl(url)!==identityKeyForUrl(String(parameters.url)))throw new StaleOperationError("Verified share URL differs from the requested work link");
  const [source]=await tx`SELECT * FROM sources WHERE id=${input.sourceId} FOR UPDATE`;
  if(!source)return null;
  if(source.kind!=="external"||source.participation_mode!=="isolated"||!source.enabled)throw new UnsupportedReplacement("Manual work attribution requires an enabled isolated external source");
  const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
  const intent={sourceId:input.sourceId,supplement:input.supplement},previous=result!.provenance?.manualWorkImport;
  if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
  if(result!.source_id||result!.article_id){if(result!.source_id!==input.sourceId||!previous||stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Result already imported with different target or evidence");return {resultId,sourceId:input.sourceId,articleId:result!.article_id};}
  const record=parsed.data.record as Record<string,unknown>,body=platform==="shipinhao"?record.description:record.caption;
  const time=typeof record.publishTime==="string"&&z.iso.datetime({offset:true}).safeParse(record.publishTime).success?new Date(record.publishTime):null;
  const publishedAt=time&&Number.isFinite(time.getTime())?time:null,discoveredAt=new Date(origin?.discoveredAt??sourceDiscoveredAt);
  const backfill=decideTimeline(publishedAt,discoveredAt).publishedAt?null:"redfox-import-unknown-time";
  const material=await upsertMaterial({sourceId:input.sourceId,url,title:String(parsed.data.title),author:typeof record.nickname==="string"?record.nickname:null,bodyUpdate:"fill-missing",bodyText:typeof body==="string"?body:null,bodyStatus:body?"ok":"pending",publishedAt,discoveredAt,backfill,media:((platform==="kuaishou"&&record.workType==="1"&&!!safeUrl(record.videoUrl)||platform==="shipinhao"&&snapshot.input.operationId==="OE4KUEUO"&&!!safeUrl(record.videoUrl)&&record.workType!=="normal"&&record.workType!=="图文")?confirmedVideoMedia(media(record)):media(record)),via:"import",raw:{provider:"redfox",resultId,publishTime:record.publishTime??null,originResultId:origin?.resultId??null,request:snapshot.input.parameters,supplement:input.supplement}},tx);
  if(material.created||material.revised)await queueProcessing(material.articleId,{db:tx});
  await tx`UPDATE operation_results SET source_id=${input.sourceId},article_id=${material.articleId},provenance=provenance||${tx.json({manualWorkImport:{key:commandKey,intent,receivedWorkId:typeof parsed.data.workId==="string"?parsed.data.workId:null,workIdKind:typeof parsed.data.workIdKind==="string"?parsed.data.workIdKind:null,requestedWorkId:typeof parsed.data.requestedWorkId==="string"?parsed.data.requestedWorkId:null}})} WHERE id=${resultId}`;
  await registerImportedVideo(tx,resultId,{platform,operationId:snapshot.input.operationId,record,confirmed:platform==="kuaishou"&&record.workType==="1"&&!!safeUrl(record.videoUrl)||platform==="shipinhao"&&snapshot.input.operationId==="OE4KUEUO"&&!!safeUrl(record.videoUrl)&&record.workType!=="normal"&&record.workType!=="图文",singleVideo:true,videoProof:"manually-verified-current-work",originalUrl:url});
  await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId:input.sourceId,articleId:material.articleId,supplement:input.supplement},undefined,tx);
  return {resultId,sourceId:input.sourceId,articleId:material.articleId};
 });
}

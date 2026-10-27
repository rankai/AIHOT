import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import {z} from "zod";
import {sql,type Tx} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {audit} from "../../admin/auth.ts";
import {importSource} from "../../sources/subscriptions.ts";
import {xPostToCandidate,linksXArticle,needsXArticleExtraction} from "../../sources/x.ts";
import {decideTimeline,isHistorical,upsertMaterial} from "../../content/materials.ts";
import {queueProcessing} from "../../jobs/content.ts";
import {StaleOperationError} from "../operations/store.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {collectionDiscoveredAt} from "./collection-page-proof.ts";
import {parseXResearch} from "./x-research.ts";
import {xResearchOperations} from "./x-research-contract.ts";
import {xResultSnapshot,agentKeyXEvidence,agentKeyXWork} from "../agentkey/x-evidence.ts";
import {redfoxXHasVideo} from "./video-media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
const Input=z.object({sourceId:z.string().min(1).optional(),reason:z.string().trim().min(1).max(500)}).strict();
const Received=z.object({tweetId:z.string().regex(/^\d+$/).max(30),text:z.string().nullable().optional(),content:z.string().nullable().optional(),createdAt:z.string().nullable().optional(),lang:z.string().nullable().optional(),replyTo:z.string().nullable().optional(),quoted:z.object({authorName:z.string(),handle:z.string(),text:z.string(),url:z.string()}).optional(),metrics:z.record(z.string(),z.unknown()).optional(),user:z.object({userId:z.string().regex(/^\d+$/).max(30).optional(),username:z.string().regex(/^[A-Za-z0-9_]{1,15}$/),displayName:z.string().nullable().optional()}).passthrough(),medias:z.array(z.record(z.string(),z.unknown())).nullable().optional()}).passthrough();
const RedfoxReceived=Received.omit({lang:true,replyTo:true,quoted:true,metrics:true}).extend({createdAt:z.string()});
export async function importXSearchResult(resultId:number,raw:unknown,actor:string,key:unknown,db?:Tx){
 const execute=async(tx:Tx)=>{
  const [snapshot]=await tx`SELECT z.*,r.provider,r.operation_key,r.input,p.model AS receipt_model,p.status AS receipt_status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  if(!snapshot)return null;
  if(snapshot.provider==="agentkey"){
   const evidence=await agentKeyXEvidence(tx,await xResultSnapshot(tx,resultId));
   if(evidence.parsed.kind!=="x_research_work")throw new UnsupportedReplacement("Not an X research work");
   return importReceivedXWork(tx,resultId,raw,actor,key,agentKeyXWork(evidence.parsed),evidence.sourceDiscoveredAt,"agentkey");
  }
  if(snapshot.provider!=="redfox"||!["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key)||snapshot.input.operationId!=="5K5EG87P"||snapshot.input.platform!=="x-research"||snapshot.receipt_model!=="5K5EG87P"||!["received","completed"].includes(snapshot.receipt_status)||snapshot.kind!=="x_research_work"||snapshot.data.platform!=="x-research"||snapshot.data.operationId!=="5K5EG87P")throw new UnsupportedReplacement("Not a confirmed X search work");
  const parameters=xResearchOperations["5K5EG87P"].schema.parse(snapshot.input.parameters);
  const parsed=parseXResearch("5K5EG87P",{tweets:[snapshot.data.record]},parameters)[0]!;
  const checked=RedfoxReceived.safeParse(parsed.data.record);
  if(!checked.success)throw new UnsupportedReplacement("X work requires received tweetId, valid username");
  const record=checked.data,text=record.text??record.content,publishedAt=new Date(record.createdAt??"");
  if(typeof text!=="string"||!text.trim()||!Number.isFinite(publishedAt.getTime())||!/(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(record.createdAt??""))throw new UnsupportedReplacement("X work lacks verified text or a valid timezone-bearing publication time");
  const discoveredAt=await collectionDiscoveredAt(tx,snapshot,"x-research","5K5EG87P");
  return importReceivedXWork(tx,resultId,raw,actor,key,record,discoveredAt);
 };
 return db?execute(db):sql.begin(execute);
}
/** Shared X author/material transaction after a specific producer proves the received tweet. */
export async function importReceivedXWork(tx:Tx,resultId:number,raw:unknown,actor:string,key:unknown,received:unknown,discoveredAt:Date,provider:"redfox"|"agentkey"="redfox",originResultId?:number){
 await lockVideoParentSubscriptions(tx,resultId);
 const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw),record=Received.parse(provider==="redfox"?{...RedfoxReceived.parse(received),lang:undefined,replyTo:undefined,quoted:undefined,metrics:undefined}:received),text=record.text??record.content,date=new Date(record.createdAt??""),validTime=Number.isFinite(date.getTime())&&/(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(record.createdAt??"");
 if(typeof text!=="string"||!text.trim()||provider==="redfox"&&!validTime)throw new UnsupportedReplacement("X work lacks verified text or a valid timezone-bearing publication time");
  const timeline=decideTimeline(validTime?date:null,discoveredAt),backfill=timeline.publishedAt?null:`${provider}-import-unknown-time`;
  const [snapshot]=await tx`SELECT z.source_id,z.article_id,z.provenance,r.input,r.id AS run_id FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.id=${resultId}`;
  if(snapshot!.article_id&&snapshot!.source_id&&snapshot!.provenance?.xSearchImport?.key===commandKey){
    const [completed]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(completed);
    if(!completed!.article_id||!completed!.source_id||completed!.provenance?.xSearchImport?.key!==commandKey||stableJson(completed!.provenance.xSearchImport.intent)!==stableJson({sourceId:input.sourceId??null}))throw new StaleOperationError("Completed import command has different input");
    return {resultId,sourceId:completed!.source_id as string,articleId:completed!.article_id as string};
  }
  const source=await importSource(tx,snapshot!.input.members??[],input.sourceId,snapshot!.input.forceSourceId,originResultId?{resultId:originResultId,provider,runId:snapshot!.run_id}:undefined);
  if(!source)throw new UnsupportedReplacement("Select an associated source; subscription/source is missing, disabled or changed");
  const sourceId=source.id;
  const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result);
  const intent={sourceId:input.sourceId??null},previous=result!.provenance?.xSearchImport;
  if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
  if(result!.article_id||result!.source_id){if(result!.source_id!==sourceId||previous&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Result already imported to another target");return {resultId,sourceId,articleId:result!.article_id};}
  if(linksXArticle(text)&&needsXArticleExtraction("x_search",source?.participation_mode??"isolated",isHistorical({backfill:timeline.backfill||!!backfill,published_at:timeline.publishedAt,discovered_at:discoveredAt})))throw new UnsupportedReplacement("This author's X Article requires unsupported full-article completion; search text cannot replace it");
  const media=provider==="agentkey"&&record.medias===undefined?undefined:(record.medias??[]).flatMap(m=>{if(m.type!=="photo"||typeof m.coverUrl!=="string")return [];try{const u=new URL(m.coverUrl);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?[{kind:"image" as const,url:m.coverUrl,width:null,height:null,poster:null}]:[];}catch{return [];}});
  const candidate=xPostToCandidate({tweetId:record.tweetId,text,handle:record.user.username,authorName:record.user.displayName??record.user.username,...(provider==="redfox"?{avatarUrl:null,media,lang:record.lang??null}:{...(media!==undefined?{media}:{}),...(record.lang!==undefined?{lang:record.lang}:{})}),...(provider==="redfox"?{replyTo:null,quoted:null}:{...(record.replyTo!==undefined?{replyTo:record.replyTo}:{}),...(record.quoted?{quoted:record.quoted}:{})})},validTime?date:null,record.metrics??{favorite:null,retweet:null,views:null});
  if(provider==="redfox"&&redfoxXHasVideo(record.medias))candidate.media=confirmedVideoMedia(candidate.media);
  if(provider==="agentkey"){candidate.media=media;candidate.bodyText=null;candidate.bodyStatus="pending";candidate.excerpt=text;}
  const material=await upsertMaterial({...candidate,sourceId,bodyUpdate:"fill-missing",discoveredAt,backfill,via:"import",raw:{...candidate.raw as Record<string,unknown>,provider,...(provider==="agentkey"?{receivedText:text}:{}),resultId,tweetId:record.tweetId,userId:record.user.userId,createdAt:record.createdAt??null}},tx);
  if(material.created||material.revised)await queueProcessing(material.articleId,{db:tx});
  await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${material.articleId},provenance=provenance||${tx.json({xSearchImport:{key:commandKey,intent,userId:record.user.userId,tweetId:record.tweetId}})} WHERE id=${resultId}`;
  await registerImportedVideo(tx,resultId,{platform:"x",operationId:"5K5EG87P",record,confirmed:provider==="redfox"&&redfoxXHasVideo(record.medias),singleVideo:(record.medias??[]).filter(m=>redfoxXHasVideo([m])).length===1,videoProof:"verified-own-media-type"});
  await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId:material.articleId,userId:record.user.userId},undefined,tx);
  return {resultId,sourceId,articleId:material.articleId};
}

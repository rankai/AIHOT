import {requireLiveResult} from "../../operations/result-retention.ts";
import {z} from "zod";
import {sql,type Tx} from "../../db.ts";
import {sha256,stableJson} from "../../lib/ids.ts";
import {audit} from "../../admin/auth.ts";
import {bindSourceAccount} from "../../sources/account-bindings.ts";
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
const Received=z.object({tweetId:z.string().regex(/^\d+$/).max(30),text:z.string().nullable().optional(),content:z.string().nullable().optional(),createdAt:z.string().nullable().optional(),lang:z.string().nullable().optional(),replyTo:z.string().nullable().optional(),quoted:z.object({authorName:z.string(),handle:z.string(),text:z.string(),url:z.string()}).optional(),metrics:z.record(z.string(),z.unknown()).optional(),user:z.object({userId:z.string().regex(/^\d+$/).max(30),username:z.string().regex(/^[A-Za-z0-9_]{1,15}$/),displayName:z.string().nullable().optional()}).passthrough(),medias:z.array(z.record(z.string(),z.unknown())).nullable().optional()}).passthrough();
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
  if(!checked.success)throw new UnsupportedReplacement("X work requires received tweetId, stable author userId and valid username");
  const record=checked.data,text=record.text??record.content,publishedAt=new Date(record.createdAt??"");
  if(typeof text!=="string"||!text.trim()||!Number.isFinite(publishedAt.getTime())||!/(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(record.createdAt??""))throw new UnsupportedReplacement("X work lacks verified text or a valid timezone-bearing publication time");
  const discoveredAt=await collectionDiscoveredAt(tx,snapshot,"x-research","5K5EG87P");
  return importReceivedXWork(tx,resultId,raw,actor,key,record,discoveredAt);
 };
 return db?execute(db):sql.begin(execute);
}
/** Shared X author/material transaction after a specific producer proves the received tweet. */
export async function importReceivedXWork(tx:Tx,resultId:number,raw:unknown,actor:string,key:unknown,received:unknown,discoveredAt:Date,provider:"redfox"|"agentkey"="redfox"){
 const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),input=Input.parse(raw),record=Received.parse(provider==="redfox"?{...RedfoxReceived.parse(received),lang:undefined,replyTo:undefined,quoted:undefined,metrics:undefined}:received),text=record.text??record.content,date=new Date(record.createdAt??""),validTime=Number.isFinite(date.getTime())&&/(?:Z|[+-]\d{2}:?\d{2})(?:\s+\d{4})?$/.test(record.createdAt??"");
 if(typeof text!=="string"||!text.trim()||provider==="redfox"&&!validTime)throw new UnsupportedReplacement("X work lacks verified text or a valid timezone-bearing publication time");
  const timeline=decideTimeline(validTime?date:null,discoveredAt),backfill=timeline.publishedAt?null:`${provider}-import-unknown-time`;
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`x:user_id:${record.user.userId}`},0))`;
  const [binding]=await tx`SELECT source_id FROM source_account_bindings WHERE platform='x' AND id_kind='user_id' AND id_value=${record.user.userId}`;
  if(input.sourceId&&binding?.source_id!==input.sourceId)throw new UnsupportedReplacement("Explicit target must already be bound to this received X user ID");
  const sourceId=input.sourceId??binding?.source_id??`x-${sha256(record.user.userId).slice(0,24)}`;
  let [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
  if(source&&!['external','x_search'].includes(source.kind))throw new UnsupportedReplacement("X work author source must be external or an existing bound X source");
  if(source&&!source.enabled)throw new UnsupportedReplacement("Author source is disabled; material import is paused");
  const [result]=await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result);
  const intent={sourceId:input.sourceId??null},previous=result!.provenance?.xSearchImport;
  if(previous?.key===commandKey&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Import key reused with different input");
  if(result!.article_id||result!.source_id){if(result!.source_id!==sourceId||previous&&stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError("Result already imported to another target");return {resultId,sourceId,articleId:result!.article_id};}
  if(linksXArticle(text)&&needsXArticleExtraction("x_search",source?.participation_mode??"isolated",isHistorical({backfill:timeline.backfill||!!backfill,published_at:timeline.publishedAt,discovered_at:discoveredAt})))throw new UnsupportedReplacement("This author's X Article requires unsupported full-article completion; search text cannot replace it");
  if(!source){[source]=await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at) VALUES (${sourceId},${record.user.displayName||record.user.username},'external','{"platform":"x"}','isolated',false,false,true,NULL) RETURNING *`;}
  if(!binding){try{await bindSourceAccount(tx,{platform:"x",idKind:"user_id",idValue:record.user.userId,sourceId,evidence:{kind:"result",reference:String(resultId)}});}catch(error){if(error instanceof Error&&error.message==="Account identity already belongs to another source")throw new StaleOperationError(error.message);throw error;}}
  const media=provider==="agentkey"&&record.medias===undefined?undefined:(record.medias??[]).flatMap(m=>{if(m.type!=="photo"||typeof m.coverUrl!=="string")return [];try{const u=new URL(m.coverUrl);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?[{kind:"image" as const,url:m.coverUrl,width:null,height:null,poster:null}]:[];}catch{return [];}});
  const candidate=xPostToCandidate({tweetId:record.tweetId,text,handle:record.user.username,authorName:record.user.displayName??record.user.username,...(provider==="redfox"?{avatarUrl:null,media,lang:record.lang??null}:{...(media!==undefined?{media}:{}),...(record.lang!==undefined?{lang:record.lang}:{})}),...(provider==="redfox"?{replyTo:null,quoted:null}:{...(record.replyTo!==undefined?{replyTo:record.replyTo}:{}),...(record.quoted?{quoted:record.quoted}:{})})},validTime?date:null,record.metrics??{favorite:null,retweet:null,views:null});
  if(provider==="redfox"&&redfoxXHasVideo(record.medias))candidate.media=confirmedVideoMedia(candidate.media);
  if(provider==="agentkey"){candidate.media=media;candidate.bodyText=null;candidate.bodyStatus="pending";candidate.excerpt=text;}
  const material=await upsertMaterial({...candidate,sourceId,bodyUpdate:"fill-missing",discoveredAt,backfill,via:"import",raw:{...candidate.raw as Record<string,unknown>,provider,...(provider==="agentkey"?{receivedText:text}:{}),resultId,tweetId:record.tweetId,userId:record.user.userId,createdAt:record.createdAt??null}},tx);
  if(material.created||material.revised)await queueProcessing(material.articleId,{db:tx});
  await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${material.articleId},provenance=provenance||${tx.json({xSearchImport:{key:commandKey,intent,userId:record.user.userId,tweetId:record.tweetId}})} WHERE id=${resultId}`;
  await audit(actor,"material.import",`result:${resultId}`,input.reason,null,{sourceId,articleId:material.articleId,userId:record.user.userId},undefined,tx);
  return {resultId,sourceId,articleId:material.articleId};
}

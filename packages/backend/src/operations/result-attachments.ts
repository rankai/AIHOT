import {requireLiveResult} from "./result-retention.ts";
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {guardedDownload} from '../lib/http-fetch.ts';
import {mediaToolOperations,MediaToolOperationId} from '../providers/redfox/media-tools-contract.ts';
import {describeOutputMedia,MediaValidationError} from './asset-media.ts';
import {readFile,stat} from 'node:fs/promises';
import {resolveMaterialIdentity} from '../content/material-identities.ts';
import {upsertMaterial} from '../content/materials.ts';
import {queueProcessing} from '../jobs/content.ts';
import {douyinVideoId,xiaohongshuNoteId,bilibiliVideoId,youtubeVideoId,tiktokVideoId,instagramCode,toutiaoWorkId,tweetIdFromUrl} from '../lib/url.ts';
import {Readable} from 'node:stream';
import {sql,type Db,type Tx} from '../db.ts';
import {sha256,stableJson} from '../lib/ids.ts';
import {audit} from '../admin/auth.ts';
import {parseTranscriptionPoll} from '../providers/redfox/transcription.ts';
import {transcriptionPairs,TranscriptionPlatform} from '../providers/redfox/transcription-contract.ts';
import {StaleOperationError} from '../providers/operations/store.ts';
import {UnsupportedReplacement} from '../sources/x-replacement.ts';
import {prepareUpload,writeUpload,publishUpload,getAsset,assetPath,hasCompleteLocalFile,AssetError,OUTPUT_IMAGE_BYTES,AUDIO_BYTES,VIDEO_BYTES,type AssetRow} from './assets.ts';
import {parseAttachmentText,attachmentTextTypes,type AttachmentTextFormat,ATTACHMENT_TEXT_BYTES} from './attachment-text.ts';
const SaveInput=z.object({formatIndex:z.number().int().nonnegative().optional(),reason:z.string().trim().min(1).max(500)}).strict();
const CommandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/);
async function parentResult(db:Db,id:number){
 const [r]=await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model receipt_model,p.status receipt_status,p.request receipt_request FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;
 if(!r)throw new AssetError(404,'Result does not exist');
 requireLiveResult(r);
 if(r.provider!=='redfox'||!['received','completed'].includes(r.receipt_status))throw new UnsupportedReplacement('Result lacks a confirmed provider receipt');
 return r;
}
function transcription(r:Record<string,any>){
 if(r.kind!=='transcription'||!['redfox.transcript.submit','redfox.transcript.query'].includes(r.operation_key))throw new UnsupportedReplacement('Only successful transcription is supported by this save path');
 const platform=TranscriptionPlatform.parse(r.input.platform);
 if(r.data.platform!==platform||r.receipt_model!==transcriptionPairs[platform].poll)throw new UnsupportedReplacement('Transcription receipt does not match its platform');
 if(r.receipt_request?.input?.taskId!==r.data.requestedTaskId)throw new UnsupportedReplacement('Transcription task does not match the received request');
 const data=parseTranscriptionPoll(r.data,z.string().min(1).parse(r.data.requestedTaskId));
 if(data.status!=='succeeded'||!data.text?.trim())throw new UnsupportedReplacement('Transcription has not succeeded');
 return {text:data.text,sourceUrl:typeof r.input.parameters.url==='string'?r.input.parameters.url:null};
}
type Selection={selection:string;format:AttachmentTextFormat|null;text:string|null;url:string|null;sourceUrl:string|null;kind:'image'|'audio'|'video'|'text';acquisition:string;maxBytes:number};
function safeResourceUrl(value:unknown){const raw=z.string().min(1).parse(value);try{const u=new URL(raw);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)return raw;}catch{}throw new UnsupportedReplacement('Resource URL must be HTTP(S), without credentials');}
function mediaProof(r:Record<string,any>){
 const op=MediaToolOperationId.parse(r.input.operationId),spec=mediaToolOperations[op],parameters=spec.schema.parse(r.input.parameters);
 if(r.operation_key!=='redfox.sync.query'||r.input.platform!=='tools'||r.data.platform!=='tools'||r.data.operationId!==op||r.receipt_model!==op||stableJson(r.receipt_request?.input)!==stableJson(parameters))throw new UnsupportedReplacement('Media result does not match its received operation');
 const sourceUrl='url' in parameters?parameters.url:null;
 if(spec.group==='subtitle'&&sourceUrl){
  const reported=r.data.reportedMetadata?.id;
  const requested=op==='API_1792051516512'?youtubeVideoId(sourceUrl):bilibiliVideoId(sourceUrl);
  const validReported=typeof reported==='string'&&(op==='API_1792051516512'?/^[A-Za-z0-9_-]{11}$/.test(reported):/^BV[A-Za-z0-9]{10}$/.test(reported));
  if(requested&&validReported&&requested!==reported)throw new StaleOperationError('Subtitle metadata identifies a different requested work');
 }
 return {op,spec,parameters,sourceUrl};
}
function selectAttachment(r:Record<string,any>,formatIndex?:number):Selection{
 if(r.kind==='transcription'){const t=transcription(r);if(formatIndex!==undefined)throw new UnsupportedReplacement('Transcription has one deterministic TXT format, without a format index');return {selection:'transcription:txt',format:'txt',text:t.text,url:null,sourceUrl:t.sourceUrl,kind:'text',acquisition:'transcription',maxBytes:ATTACHMENT_TEXT_BYTES};}
 const proof=mediaProof(r);
 if(r.kind==='subtitle_track'&&proof.spec.group==='subtitle'){
  if(formatIndex===undefined)throw new UnsupportedReplacement('Select the exact subtitle format index');
  const record=z.object({languageName:z.string(),languageTag:z.string(),urls:z.array(z.object({format:z.string(),url:z.string()}))}).parse(r.data.record),entry=record.urls[formatIndex];
  if(!entry||!['srt','vtt','json','json3'].includes(entry.format))throw new UnsupportedReplacement('Unsupported or missing subtitle format');
  return {selection:`subtitle:${formatIndex}`,format:entry.format as AttachmentTextFormat,text:null,url:safeResourceUrl(entry.url),sourceUrl:proof.sourceUrl,kind:'text',acquisition:'subtitle-download',maxBytes:ATTACHMENT_TEXT_BYTES};
 }
 if(r.kind==='media_resource'&&proof.spec.group==='media'){
  if(formatIndex!==undefined)throw new UnsupportedReplacement('Media resource has no format index');
  const record=z.object({type:z.string(),downloadUrl:z.string()}).parse(r.data.record),kind=record.type==='mp3'?'audio':record.type;
  if(!['image','audio','video'].includes(kind))throw new UnsupportedReplacement('Reported media type is not explicitly image, audio or video');
  return {selection:'media',format:null,text:null,url:safeResourceUrl(record.downloadUrl),sourceUrl:proof.sourceUrl,kind:kind as 'image'|'audio'|'video',acquisition:'media-download',maxBytes:kind==='image'?OUTPUT_IMAGE_BYTES:kind==='audio'?AUDIO_BYTES:VIDEO_BYTES};
 }
 throw new UnsupportedReplacement('This result cannot be saved as an attachment');
}
async function hashFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function existingAttachment(db:Db,parent:Record<string,any>,selection:string,actor:string,key:string){
 const rows=await db`SELECT z.*,f.status file_status FROM operation_results z LEFT JOIN stored_files f ON f.key=z.file_key WHERE z.run_id=${parent.run_id} AND z.kind='result_attachment' AND z.provenance->>'parentResultId'=${String(parent.id)}`;
 for(const r of rows){const command=r.provenance.command;if(command?.actor===actor&&command?.key===key&&r.data.selection!==selection)throw new StaleOperationError('Attachment command key reused with another format');}
 const found=rows.find(r=>r.data.selection===selection);
 if(found&&found.file_status!=='available')throw new StaleOperationError('This attachment was deleted or is being deleted; its saved history cannot be replaced');
 return found??null;
}
export async function saveResultAttachment(resultId:number,raw:unknown,actor:string,key:unknown){
 const input=SaveInput.parse(raw),commandKey=CommandKey.parse(key),snapshot=await parentResult(sql,resultId),selection=selectAttachment(snapshot,input.formatIndex);
 const existing=await existingAttachment(sql,snapshot,selection.selection,actor,commandKey);
 if(existing)return {result:existing,asset:await getAsset(existing.file_key)};
 const fileKey=`uploads/redfox/${sha256(stableJson({parentResultId:resultId,selection:selection.selection}))}`;
 const temp=await prepareUpload(selection.maxBytes);
 try{
  let file=temp.file;
  if(await hasCompleteLocalFile(fileKey))file=assetPath(fileKey);
  else if(selection.text!==null)await writeUpload(Readable.from([Buffer.from(selection.text,'utf8')]),file,AbortSignal.timeout(60_000),selection.maxBytes);
  else{
   if(process.env.REDFOX_CALLS_ENABLED!=='true')throw new AssetError(503,'Redfox outbound calls are disabled; enable the configured outbound switch before downloading');
   const response=await guardedDownload(selection.url!,file,{maxBytes:selection.maxBytes,timeoutMs:60_000}).catch(error=>{
    if(['ENOSPC','EACCES','EROFS','EEXIST'].includes(error?.code))throw error;
    throw new AssetError(error instanceof Error&&error.message==='Downloaded image exceeds local size limit'?413:422,'Attachment download was blocked, incomplete, unavailable, or exceeded its local limit');
   });
   if(response.status!==200)throw new UnsupportedReplacement(`Attachment download returned HTTP ${response.status}`);
  }
  let format:string,mime:string,bytes:number,bodyUsable=false;
  if(selection.format){if((await stat(file)).size>ATTACHMENT_TEXT_BYTES)throw new AssetError(413,"Text attachment exceeds 2 MiB");const buffer=await readFile(file);try{const parsed=parseAttachmentText(buffer,selection.format);bodyUsable=parsed.bodyText!==null;}catch(error){throw new AssetError(buffer.length>ATTACHMENT_TEXT_BYTES?413:422,error instanceof Error?error.message:'Invalid text attachment');}format=selection.format;mime=attachmentTextTypes[selection.format];bytes=buffer.length;}
  else{let detected;try{detected=await describeOutputMedia(file);}catch(error){if(error instanceof MediaValidationError)throw new AssetError(error.status,error.message);throw error;}if(detected.kind!==selection.kind)throw new UnsupportedReplacement('Downloaded bytes differ from the explicitly reported media type');format=detected.format;mime=detected.mime;bytes=detected.bytes;}
  const hash=await hashFile(file);
  return await sql.begin(async(tx:Tx)=>{
   await tx`SELECT id FROM operation_results WHERE id=${resultId} FOR UPDATE`;
   const current=await parentResult(tx,resultId),checked=selectAttachment(current,input.formatIndex);
   if(stableJson(checked)!==stableJson(selection))throw new StaleOperationError('Attachment source changed during preparation');
   const prior=await existingAttachment(tx,current,selection.selection,actor,commandKey);if(prior)return {result:prior,asset:await getAsset(prior.file_key)};
   const asset=await publishUpload({actor,key:fileKey,file,filename:`result-${resultId}.${format}`,mime,purpose:'operation-output',bytes,sha256:hash},tx);
   const [result]=await tx`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id,provenance,file_key) VALUES(${current.run_id},${current.step_version},${`attachment:${resultId}:${selection.selection}`},'result_attachment',${tx.json({parentResultId:resultId,selection:selection.selection,format,formatIndex:input.formatIndex??null,acquisition:selection.acquisition,bodyUsable})},${current.receipt_id},${tx.json({parentResultId:resultId,command:{actor,key:commandKey},acquisition:selection.acquisition})},${fileKey}) RETURNING *`;
   await audit(actor,'result.save_attachment',`result:${resultId}`,input.reason,null,{attachmentResultId:result!.id,fileKey,format},undefined,tx);
   return {result:result!,asset};
  });
 }finally{await temp.release();}
}

export async function listResultAttachments(resultId:number){
 await parentResult(sql,resultId);
 return sql`SELECT z.id,z.data,z.file_key,z.article_id,z.source_id,z.created_at,f.status file_status,f.content_type,f.bytes,f.metadata,a.revision article_revision FROM operation_results z LEFT JOIN stored_files f ON f.key=z.file_key LEFT JOIN articles a ON a.id=z.article_id WHERE z.kind='result_attachment' AND z.provenance->>'parentResultId'=${String(resultId)} ORDER BY z.id`;
}

const UseInput=z.object({articleId:z.string().min(1),expectedRevision:z.number().int().positive(),action:z.enum(['attach','fill-body']),evidence:z.string().trim().min(1).max(2000).optional(),reason:z.string().trim().min(1).max(500)}).strict();
// These are existing, proven original-work parsers, not media URLs or sharing-text extraction.
function sameWork(sourceUrl:string|null,articleUrl:string,evidence?:string){
 if(sourceUrl){
  const identify=(url:string)=>{
   for(const [platform,parse] of [['douyin',douyinVideoId],['xiaohongshu',xiaohongshuNoteId],['bilibili',bilibiliVideoId],['youtube',youtubeVideoId],['tiktok',tiktokVideoId],['instagram',instagramCode],['toutiao',toutiaoWorkId],['x',tweetIdFromUrl]] as const){const id=parse(url);if(id)return {platform,id};}
   return null;
  };
  const a=identify(sourceUrl),b=identify(articleUrl);
  if(a&&b){if(a.platform!==b.platform||a.id!==b.id)throw new StaleOperationError('Received original identifies a different work');return;}
 }
 if(!evidence)throw new UnsupportedReplacement('Explicit same-work evidence is required; task IDs, media URLs and sharing prose do not prove authorship');
}
async function usableResult(db:Db,resultId:number){
 const r=await parentResult(db,resultId);
 if(r.kind==='transcription'){const t=transcription(r);return {result:r,parent:r,bodyText:t.text,sourceUrl:r.input.platform==='videoUrl'?null:t.sourceUrl};}
 if(r.kind!=='result_attachment')throw new UnsupportedReplacement('Only transcription or a saved attachment can be used');
 const parentId=z.number().int().positive().parse(r.provenance.parentResultId),parent=await parentResult(db,parentId);
 if(parent.run_id!==r.run_id||parent.receipt_id!==r.receipt_id||r.data.parentResultId!==parentId)throw new UnsupportedReplacement('Attachment parent proof is invalid');
 const selection=selectAttachment(parent,r.data.formatIndex??undefined);
 assetPath(r.file_key);
 const [asset]=await db<AssetRow[]>`SELECT * FROM stored_files WHERE key=${r.file_key}`;
 if(!asset)throw new AssetError(404,'Asset not found.');
 if(asset.status!=='available')throw new AssetError(409,'Asset is unavailable.');
 if(r.data.selection!==selection.selection||asset.purpose!=='operation-output')throw new UnsupportedReplacement('Attachment selection proof is invalid');
 if(asset.metadata.kind!=='text')throw new UnsupportedReplacement('Only validated text attachments may be associated or used as article text');
 let bodyText:string|null=null;
 if(asset.metadata.kind==='text'){
  const format=z.enum(['txt','srt','vtt','json','json3']).parse(r.data.format);
  if((await stat(assetPath(asset.key))).size>ATTACHMENT_TEXT_BYTES)throw new AssetError(413,'Text attachment exceeds 2 MiB');
  bodyText=parseAttachmentText(await readFile(assetPath(asset.key)),format).bodyText;
 }
 return {result:r,parent,bodyText,sourceUrl:parent.input.platform==='videoUrl'||selection.kind!=='text'?null:selection.sourceUrl};
}
export async function useOperationResult(resultId:number,raw:unknown,actor:string,key:unknown){
 const input=UseInput.parse(raw),commandKey=CommandKey.parse(key),initial=await usableResult(sql,resultId);
 if(input.action==='fill-body'&&!initial.bodyText)throw new UnsupportedReplacement('This attachment format cannot supply article text');
 return sql.begin(async(tx:Tx)=>{
  const [snapshot]=await tx`SELECT * FROM articles WHERE id=${input.articleId}`;
  if(!snapshot)throw new UnsupportedReplacement('Article does not exist');
  const [source]=await tx`SELECT * FROM sources WHERE id=${snapshot.source_id} FOR UPDATE`;
  if(!source?.enabled)throw new UnsupportedReplacement('Article source is disabled');
  const resolved=await resolveMaterialIdentity(tx,{url:snapshot.url,identityKey:snapshot.identity_key});
  if(resolved&&resolved.identityKey!==snapshot.identity_key)throw new StaleOperationError('Material identity resolved to another owner');
  const [article]=await tx`SELECT * FROM articles WHERE id=${input.articleId} FOR UPDATE`;
  if(!article||article.source_id!==snapshot.source_id||article.identity_key!==snapshot.identity_key)throw new StaleOperationError('Article ownership changed');
  await tx`SELECT id FROM operation_results WHERE id=${resultId} FOR UPDATE`;
  const [lockedResult]=await tx`SELECT file_key FROM operation_results WHERE id=${resultId}`;
  if(lockedResult?.file_key)await tx`SELECT key FROM stored_files WHERE key=${lockedResult.file_key} FOR UPDATE`;
  const current=await usableResult(tx,resultId),r=current.result;
  const intent={articleId:input.articleId,expectedRevision:input.expectedRevision,action:input.action,evidence:input.evidence??null};
  const previous=r.provenance.resultUse;
  if(previous?.key===commandKey){if(previous.actor!==actor||stableJson(previous.intent)!==stableJson(intent))throw new StaleOperationError('Use command key reused with different intent');return {resultId,articleId:article.id,revision:article.revision,action:input.action};}
  if(r.source_id&&r.source_id!==article.source_id)throw new StaleOperationError('Result is already associated with another article owner');
  if(r.article_id&&r.article_id!==article.id)throw new StaleOperationError('Result is already associated with another article');
  if(article.revision!==input.expectedRevision)throw new StaleOperationError('Article revision changed');
  sameWork(current.sourceUrl,article.url,input.evidence);
  if(input.action==='fill-body'){
   if(article.body_text?.trim()||article.body_html?.trim())throw new StaleOperationError('Article already has a body; existing content is preserved');
   if(!current.bodyText)throw new UnsupportedReplacement('This format cannot supply article text');
   const material=await upsertMaterial({id:article.id,identityKey:article.identity_key,sourceId:article.source_id,url:article.url,title:article.title,author:article.author,language:article.language,publishedAt:article.published_at_claim,discoveredAt:article.discovered_at,sourceUpdatedAt:article.source_updated_at,backfill:article.backfill_reason,excerpt:article.excerpt,bodyText:current.bodyText,bodyHtml:null,bodyStatus:'ok',bodyUpdate:'fill-missing',raw:article.raw,via:'import'},tx);
   if(material.articleId!==article.id)throw new StaleOperationError('Body update resolved to another article');
   if(material.revised)await queueProcessing(article.id,{db:tx});
  }
  await tx`UPDATE operation_results SET article_id=${article.id},source_id=${article.source_id},provenance=provenance||${tx.json({resultUse:{key:commandKey,actor,intent,acquisition:current.parent.kind==='transcription'?'transcription':'subtitle'}})} WHERE id=${resultId}`;
  await audit(actor,'result.use',`result:${resultId}`,input.reason,null,{articleId:article.id,action:input.action,evidence:input.evidence??null},undefined,tx);
  const [updated]=await tx`SELECT revision FROM articles WHERE id=${article.id}`;
  return {resultId,articleId:article.id,revision:updated!.revision,action:input.action};
 });
}

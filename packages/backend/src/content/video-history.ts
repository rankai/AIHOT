import {z} from "zod";
import type {Tx} from "../db.ts";
import {sha256,stableJson} from "../lib/ids.ts";
import {identityKeyForUrl,bilibiliVideoId,douyinVideoId,xiaohongshuNoteId} from "../lib/url.ts";
import {mergeMaterialMedia,restoreMaterialMedia,type MediaItem} from "./materials.ts";
import {mergeMedia,confirmedVideoMedia,videoMediaFromHtml} from "./media.ts";
import {agentKeyWechatEvidence} from "../providers/agentkey/wechat-evidence.ts";
import {agentKeyXiaohongshuEvidence} from "../providers/agentkey/xiaohongshu-evidence.ts";
import {agentKeyBilibiliEvidence} from "../providers/agentkey/bilibili-evidence.ts";
import {agentKeyDouyinEvidence} from "../providers/redfox/import-douyin.ts";
import {redfoxHistoryProof,type HistoricalVideoProof} from "../providers/redfox/video-history-proof.ts";

const Entry=z.object({articleId:z.string().min(1),sourceId:z.string().min(1),identityKey:z.string().min(1),revision:z.number().int().positive(),sourceUpdatedAt:z.iso.datetime().nullable(),evidence:z.discriminatedUnion("kind",[z.object({kind:z.literal("result"),resultId:z.number().int().positive().safe(),proofHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({kind:z.literal("body"),bodyHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]),beforeHash:z.string().regex(/^[a-f0-9]{64}$/),afterHash:z.string().regex(/^[a-f0-9]{64}$/),factIndex:z.number().int().nonnegative(),existingFact:z.boolean(),status:z.enum(["planned","applied","restored"])}).strict();
export const VideoHistoryManifest=z.object({version:z.literal(1),database:z.string().min(1),createdAt:z.iso.datetime(),nextCursor:z.string().min(1).max(512).nullable().default(null),entries:z.array(Entry).max(5000),skipped:z.record(z.string(),z.number().int().nonnegative())}).strict();
export type VideoHistoryManifest=z.infer<typeof VideoHistoryManifest>;
type Entry=z.infer<typeof Entry>;
const mediaHash=(media:MediaItem[])=>sha256(stableJson(media));
function fail(reason:string):never{throw new Error(reason);}

async function articleSnapshot(tx:Tx,id:string){
 const [a]=await tx`SELECT a.id,a.source_id,a.identity_key,a.url,a.revision,a.media,a.source_updated_at,a.body_html,
 (SELECT count(*)::int FROM operation_results z WHERE z.article_id=a.id) AS result_count,
 (SELECT min(z.id) FROM operation_results z WHERE z.article_id=a.id) AS result_id FROM articles a WHERE a.id=${id}`;
 return a;
}
async function resultSnapshot(tx:Tx,id:number){
 const [s]=await tx`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,r.limits,
 p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status
 FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${id}`;
 return s;
}
/** Deliberately finite: use established exact receipt validators, never replay imports or suppliers. */
async function videoProof(tx:Tx,s:any,articleUrl:string):Promise<HistoricalVideoProof>{
 if(s.provider==="redfox")return redfoxHistoryProof(tx,s,articleUrl);
 if(s.provider!=="agentkey")return fail("route-not-covered");
 let evidence:{parsed:{data:Record<string,unknown>};hasVideo?:boolean},hasVideo=false;
 switch(s.kind){
 case "douyin_work":evidence=await agentKeyDouyinEvidence(tx,s);hasVideo=evidence.hasVideo===true;break;
 case "wechat_work":evidence=await agentKeyWechatEvidence(tx,s);hasVideo=(evidence.parsed.data.record as Record<string,unknown>)._content_type==="video";break;
 case "xiaohongshu_work":evidence=await agentKeyXiaohongshuEvidence(tx,s);hasVideo=(evidence.parsed.data.record as Record<string,unknown>).workType==="video";break;
 case "bilibili_work":evidence=await agentKeyBilibiliEvidence(tx,s);hasVideo=true;break;
 default:return fail("route-not-covered");
 }
 const data=evidence.parsed.data,platform=String(data.platform),workId=data.workId,url=typeof data.url==="string"?data.url:null;
 if(s.kind==="wechat_work"){
  const record=data.record as Record<string,unknown>,body=record.articleContent??record.content;
  if(url&&typeof body==="string"&&videoMediaFromHtml(body,url).length)hasVideo=true;
 }
 const identityKey=platform==="douyin"&&url&&douyinVideoId(url)===workId?`douyin:aweme_id:${workId}`
  :platform==="bilibili"&&url&&bilibiliVideoId(url)===workId?`bilibili:bvId:${workId}`
  :platform==="xiaohongshu"&&url&&xiaohongshuNoteId(url)===workId?`xiaohongshu:noteId:${workId}`
  :platform==="wechat"&&url?identityKeyForUrl(url):null;
 return {platform,identityKey,identity:data.identity as Record<string,string>,hasVideo};
}
async function prepare(tx:Tx,id:string):Promise<{entry:Entry;media:MediaItem[]}> {
 const a=await articleSnapshot(tx,id);if(!a)fail("article-missing");
 if(a!.media.some((m:MediaItem)=>m.kind==="video"&&m.confirmed))fail("already-confirmed");
 let evidence:Entry["evidence"];
 if(typeof a!.body_html==="string"&&videoMediaFromHtml(a!.body_html,a!.url).length){
  evidence={kind:"body",bodyHash:sha256(a!.body_html)};
 }else{
  // Without a source clock, only a single original unrevised import has proven ordering.
  if(a!.revision!==1||a!.source_updated_at!==null)fail("ordering-unproven");
  if(a!.result_count!==1)fail(a!.result_count===0?"no-retained-video-evidence":"result-association-ambiguous");
  const s=await resultSnapshot(tx,a!.result_id);if(!s||s.article_id!==a!.id||s.source_id!==a!.source_id)fail("result-association-mismatch");
  const proof=await videoProof(tx,s,a!.url);
  if(!proof.hasVideo)fail("no-positive-video-evidence");
  if(!proof.identityKey||proof.identityKey!==a!.identity_key)fail("work-identity-mismatch");
  // The committed material/result association owns attribution; author bindings are optional provenance.
  evidence={kind:"result",resultId:s.id,proofHash:sha256(stableJson({data:s.data,provenance:s.provenance,input:s.input,request:s.receipt_request,response:s.receipt_response}))};
 }
 const media=a!.media as MediaItem[],factIndex=media.findIndex(m=>m.kind==="video"&&m.url===undefined),slot=factIndex<0?undefined:media[factIndex];
 if(slot&&stableJson(slot)!==stableJson({kind:"video"}))fail("unsupported-fact-slot");
 const after=mergeMedia(media,confirmedVideoMedia());
 return {entry:{articleId:a!.id,sourceId:a!.source_id,identityKey:a!.identity_key,revision:a!.revision,sourceUpdatedAt:a!.source_updated_at?.toISOString()??null,evidence,beforeHash:mediaHash(media),afterHash:mediaHash(after),factIndex:factIndex<0?media.length:factIndex,existingFact:factIndex>=0,status:"planned"},media};
}

/** Read-only by default; callers can wrap this in a PostgreSQL READ ONLY transaction. */
export async function scanVideoHistory(tx:Tx,limit=500,after?:string):Promise<VideoHistoryManifest>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>5000)throw new Error("limit must be 1..5000");
 if(after!==undefined)z.string().min(1).max(512).parse(after);
 const [database]=await tx`SELECT current_database() AS name`;
 const page=await tx`SELECT a.id FROM articles a WHERE (${after??null}::text IS NULL OR a.id>${after??null}) ORDER BY a.id LIMIT ${limit+1}`;
 const rows=page.slice(0,limit),nextCursor=page.length>limit?String(rows.at(-1)!.id):null;
 const entries:Entry[]=[],skipped:Record<string,number>={};
 for(const row of rows){try{entries.push((await prepare(tx,row.id)).entry);}catch(error){const message=error instanceof Error?error.message:"invalid-evidence";const reason=/^[a-z-]+$/.test(message)?message:"invalid-evidence";skipped[reason]=(skipped[reason]??0)+1;}}
 return {version:1,database:database!.name,createdAt:new Date().toISOString(),nextCursor,entries,skipped};
}
/** Re-check every receipt and snapshot; media-only domain methods never queue processing. */
export async function applyVideoHistoryEntry(tx:Tx,raw:unknown):Promise<Entry>{
 const entry=Entry.parse(raw);if(entry.status!=="planned")throw new Error("entry is not planned");
 await tx`SELECT id FROM articles WHERE id=${entry.articleId} FOR UPDATE`;
 const current=await prepare(tx,entry.articleId);
 if(stableJson(current.entry)!==stableJson(entry))throw new Error("snapshot-changed");
 const applied=await mergeMaterialMedia({articleId:entry.articleId,sourceId:entry.sourceId,identityKey:entry.identityKey,expectedRevision:entry.revision,expectedMedia:current.media,media:confirmedVideoMedia(),...(entry.sourceUpdatedAt?{evidenceSourceUpdatedAt:new Date(entry.sourceUpdatedAt)}:{})},tx);
 if(!applied)throw new Error("snapshot-changed");
 return {...entry,status:"applied"};
}
export async function restoreVideoHistoryEntry(tx:Tx,raw:unknown):Promise<Entry>{
 const entry=Entry.parse(raw);if(entry.status!=="applied")throw new Error("entry was not applied by this manifest");
 const a=await articleSnapshot(tx,entry.articleId);if(!a||mediaHash(a.media)!==entry.afterHash)throw new Error("snapshot-changed");
 const media=(a!.media as MediaItem[]).map(m=>({...m}));
 if(stableJson(media[entry.factIndex])!==stableJson({kind:"video",confirmed:true}))throw new Error("snapshot-changed");
 if(entry.existingFact)media[entry.factIndex]={kind:"video"};else media.splice(entry.factIndex,1);
 if(mediaHash(media)!==entry.beforeHash)throw new Error("snapshot-changed");
 const restored=await restoreMaterialMedia({articleId:entry.articleId,sourceId:entry.sourceId,identityKey:entry.identityKey,expectedRevision:entry.revision,expectedMedia:a!.media,media,expectedSourceUpdatedAt:entry.sourceUpdatedAt?new Date(entry.sourceUpdatedAt):null,sourceUpdatedAt:entry.sourceUpdatedAt?new Date(entry.sourceUpdatedAt):null},tx);
 if(!restored)throw new Error("snapshot-changed");
 return {...entry,status:"restored"};
}

/** Recover the file-before-commit window without claiming a different media update. */
export async function reconcileVideoHistoryEntry(tx:Tx,raw:unknown):Promise<Entry>{
 const entry=Entry.parse(raw);
 if(entry.status==="planned")return entry;
 await tx`SELECT id FROM articles WHERE id=${entry.articleId} FOR UPDATE`;
 const a=await articleSnapshot(tx,entry.articleId);
 if(!a||a.source_id!==entry.sourceId||a.identity_key!==entry.identityKey||a.revision!==entry.revision||(a.source_updated_at?.toISOString()??null)!==entry.sourceUpdatedAt)fail("snapshot-changed");
 const hash=mediaHash(a.media);
 if(entry.status==="applied"&&hash===entry.beforeHash){
  const current=await prepare(tx,entry.articleId);
  if(stableJson(current.entry)!==stableJson({...entry,status:"planned"}))fail("snapshot-changed");
  return {...entry,status:"planned"};
 }
 if(entry.status==="restored"&&hash===entry.afterHash)return {...entry,status:"applied"};
 if(hash!==(entry.status==="applied"?entry.afterHash:entry.beforeHash))fail("snapshot-changed");
 return entry;
}

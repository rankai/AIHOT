import { z } from "zod";
import { sha256 } from "../../lib/ids.ts";
import { toolSafeUrl } from "../../users/tool-results.ts";
import { redfoxRequest } from "./client.ts";
import { XHS_COVER_OPERATION, XhsCoverInput, LegacyXhsCoverReceiptInput, coverCategories } from "./xhs-cover-contract.ts";
import type { PaidRequestOptions } from "../receipts.ts";
// Supplier abbreviations are display text, not exact counts (e.g. "97w+").
const metric = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite()), z.string().max(32).regex(/^\d+(?:\.\d+)?w\+$/i)]).nullable().optional();
const metrics = { fans: metric, collectedCount: metric, useShareCount: metric, useCommentCount: metric, useLikeCount: metric, interactiveCount: metric };
const incrementMetric = z.union([metric, z.number().finite(), z.string().regex(/^-\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite())]);
// The supplier's increment names contain spelling errors; preserve their actual meaning and spelling.
const increments = z.object({ addInteractiveount: incrementMetric, addCollectedCunt: incrementMetric, addShareCount: incrementMetric, addCommentCount: incrementMetric, addLikeCount: incrementMetric }).passthrough();
const rowSchema = z.object({ photoId: z.union([z.string(),z.number().int().safe()]).nullish(), userId: z.union([z.string(),z.number().int().safe()]).nullish(),
 title:z.string().nullish(),desc:z.string().nullish(),authorName:z.string().nullish(),userName:z.string().nullish(),coverUrl:z.string().nullish(),publicTime:z.string().nullish(),
 ...metrics,anaAdd:increments.nullish() }).passthrough();
const responseSchema = z.object({ lowPowderExplosiveArticle:z.array(rowSchema).max(10000), likeTheTop500:z.array(rowSchema).max(10000), singleDayIncrements:z.array(rowSchema).max(10000), sevenDaysOfIncrements:z.array(rowSchema).max(10000) });
type Result = { kind:string; itemKey:string; data:Record<string,any> };
export function parseXhsCovers(raw:unknown,input:z.infer<typeof XhsCoverInput>):Result[] {
 const response=responseSchema.parse(raw), candidates=new Map<string,Result>();
 let rawCount=0,excludedCount=0;
 const seen=new Set<string>();
 for(const category of coverCategories) {
 const accepted=new Set<string>();
 for(const row of response[category]) {
  rawCount++;
  const photoId=row.photoId==null?"":String(row.photoId).trim(),coverUrl=toolSafeUrl(row.coverUrl);
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(photoId)||!coverUrl){excludedCount++;continue;}
  seen.add(photoId);
  const increment=Object.fromEntries(Object.keys(increments.shape).map(key=>[key,row.anaAdd?.[key]??null]));
  const withinLimit=accepted.has(photoId)||accepted.size<20;
  if(withinLimit)accepted.add(photoId);
  const existing=candidates.get(photoId);
  if(existing){if(!existing.data.categories.includes(category))existing.data.categories.push(category);existing.data.increments[category]=increment;continue;}
  if(!withinLimit)continue;
  const values=Object.fromEntries(Object.keys(metrics).map(key=>[key,row[key]??null]));
  candidates.set(photoId,{kind:"xhs_cover_candidate",itemKey:sha256(photoId),data:{platform:"xiaohongshu",operationId:XHS_COVER_OPERATION,
   sourceId:`cover:${sha256(photoId).slice(0,24)}`,photoId,userId:row.userId==null?null:String(row.userId),title:row.title??null,desc:row.desc??null,authorName:row.authorName??row.userName??null,
   coverUrl,url:`https://www.xiaohongshu.com/explore/${encodeURIComponent(photoId)}`,publicTime:row.publicTime??null,...values,
   categories:[category],increments:{[category]:increment},missing:[...Object.entries(values).filter(([,v])=>v===null).map(([k])=>k),...(["title","desc","publicTime"] as const).filter(k=>!row[k]),...(!(row.authorName??row.userName)?["authorName"]:[])]}});
 }
 }
 // A candidate selected from a later list may also occur beyond the cap of an earlier list.
 // Recover those memberships without storing additional candidates.
 for(const category of coverCategories)for(const row of response[category]) {
  const candidate=candidates.get(String(row.photoId??"").trim());
  if(!candidate||!toolSafeUrl(row.coverUrl))continue;
  if(!candidate.data.categories.includes(category))candidate.data.categories.push(category);
  candidate.data.increments[category]??=Object.fromEntries(Object.keys(increments.shape).map(key=>[key,row.anaAdd?.[key]??null]));
 }
 return [...candidates.values(),{kind:"xhs_cover_research",itemKey:"summary",data:{platform:"xiaohongshu",operationId:XHS_COVER_OPERATION,...input,rawCount,excludedCount,deduplicatedCount:seen.size,candidateCount:candidates.size,truncated:seen.size>candidates.size,
  limitation:"供应商仅支持起始日期；候选元数据不是视觉分析，未返回的指标为未知；w+指标保留供应商展示文本，不代表精确计数"}}];
}
/** Bound the complete parent-model payload, including identities, URLs and metadata. Raw results remain intact. */
export function xhsCoverResults(rows:{id?:number;kind:string;data:Record<string,any>}[]) {
 const summary=rows.find(row=>row.kind==="xhs_cover_research")?.data;
 const output:{results:Record<string,unknown>[];metadata:Record<string,unknown>}={results:[],metadata:{operationId:XHS_COVER_OPERATION,rawCount:Number(summary?.rawCount)||0,excludedCount:Number(summary?.excludedCount)||0,
  deduplicatedCount:Number(summary?.deduplicatedCount)||0,candidateCount:Number(summary?.candidateCount)||0,projectedCount:0,truncated:summary?.truncated===true,startDate:typeof summary?.startDate==="string"?summary.startDate.slice(0,10):null,
  keyword:typeof summary?.keyword==="string"?[...summary.keyword].slice(0,200).join(""):null,limitation:"供应商仅支持起始日期；元数据不等于已看图，未返回指标为未知；w+指标为展示文本，精确数未知"}};
 for(const row of rows.filter(row=>row.kind==="xhs_cover_candidate")) {
  const d=row.data,candidate={id:row.id,sourceId:d.sourceId,title:typeof d.title==="string"?d.title.slice(0,40):null,
   desc:typeof d.desc==="string"?d.desc.slice(0,50):null,authorName:typeof d.authorName==="string"?d.authorName.slice(0,20):null,publicTime:typeof d.publicTime==="string"?d.publicTime.slice(0,40):null,
   increments:Object.fromEntries(coverCategories.filter(category=>d.increments?.[category]).map(category=>[category,Object.fromEntries(Object.keys(increments.shape).filter(key=>d.increments[category][key]!=null).map(key=>[key,d.increments[category][key]]))])),
   truncated:typeof d.title==="string"&&d.title.length>40||typeof d.desc==="string"&&d.desc.length>50||typeof d.authorName==="string"&&d.authorName.length>20,categories:coverCategories.filter(category=>Array.isArray(d.categories)&&d.categories.includes(category)),...Object.fromEntries(Object.keys(metrics).map(key=>[key,d[key]??null]))};
  output.results.push(candidate);output.metadata.projectedCount=output.results.length;
  if(JSON.stringify(output).length>12000){output.results.pop();output.metadata.projectedCount=output.results.length;output.metadata.truncated=true;}
 }
 return output;
}
export async function queryXhsCovers(parameters:Record<string,unknown>,window:string,options:PaidRequestOptions) {
 // Preserve legacy receipt identity; the client's onReceipt(call) gates every new outbound request.
 const input=LegacyXhsCoverReceiptInput.parse(parameters),response=await redfoxRequest(XHS_COVER_OPERATION,input,window,"query",options);
 return {...response,results:parseXhsCovers(response.data,input)};
}

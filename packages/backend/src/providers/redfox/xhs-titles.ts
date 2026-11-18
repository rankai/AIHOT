import { z } from "zod";
import { sha256 } from "../../lib/ids.ts";
import { redfoxRequest } from "./client.ts";
import { XHS_TITLE_OPERATION, XhsTitleInput } from "./xhs-title-contract.ts";
import { coverCategories } from "./xhs-cover-contract.ts";
import { responseSchema, metrics, increments } from "./xhs-trends.ts";
import type { PaidRequestOptions } from "../receipts.ts";
type Row={id?:number;kind:string;data:Record<string,any>};
export function parseXhsTitles(raw:unknown,input:z.infer<typeof XhsTitleInput>) {
 const response=responseSchema.parse(raw), candidates=new Map<string,{kind:string;itemKey:string;data:Record<string,any>}>(),seen=new Set<string>();
 const rawCounts=Object.fromEntries(coverCategories.map(category=>[category,response[category].length]));
 let excludedCount=0;
 for(const category of coverCategories){
  const accepted=new Set<string>();
  for(const row of response[category]){
   const photoId=String(row.photoId??'').trim(),title=row.title?.trim();
   if(!/^[A-Za-z0-9_-]{1,200}$/.test(photoId)||!title){excludedCount++;continue;}
   seen.add(photoId);
   const withinLimit=accepted.has(photoId)||accepted.size<20;
   if(withinLimit)accepted.add(photoId);
   const existing=candidates.get(photoId);
   if(existing){if(!existing.data.categories.includes(category))existing.data.categories.push(category);continue;}
   if(!withinLimit)continue;
   candidates.set(photoId,{kind:'xhs_title_candidate',itemKey:sha256(photoId),data:{operationId:XHS_TITLE_OPERATION,sourceId:`title:${sha256(photoId).slice(0,24)}`,photoId,title,
    url:`https://www.xiaohongshu.com/explore/${encodeURIComponent(photoId)}`,authorName:row.authorName??row.userName??null,publicTime:row.publicTime??null,
    ...Object.fromEntries(Object.keys(metrics).map(key=>[key,row[key]??null])),categories:[category],increments:{[category]:Object.fromEntries(Object.keys(increments.shape).map(key=>[key,row.anaAdd?.[key]??null]))}}});
  }
 }
 for(const category of coverCategories)for(const row of response[category]){
  const candidate=candidates.get(String(row.photoId??'').trim());if(!candidate||!row.title?.trim())continue;
  if(!candidate.data.categories.includes(category))candidate.data.categories.push(category);
  candidate.data.increments[category]=Object.fromEntries(Object.keys(increments.shape).map(key=>[key,row.anaAdd?.[key]??null]));
 }
 return [...candidates.values(),{kind:'xhs_title_research',itemKey:'summary',data:{operationId:XHS_TITLE_OPERATION,...input,rawCounts,rawCount:Object.values(rawCounts).reduce((a,b)=>a+b,0),excludedCount,deduplicatedCount:seen.size,candidateCount:candidates.size,truncated:seen.size>candidates.size}}];
}
/** Full titles are indivisible: skip an over-budget row rather than presenting a clipped title. */
export function xhsTitleResults(rows:Row[]) {
 const summary=rows.find(row=>row.kind==='xhs_title_research')?.data;
 const output:{results:Record<string,any>[];metadata:Record<string,any>}={results:[],metadata:{...summary,projectedCount:0,limitation:'仅支持起始日期；缺失指标未知，w+为近似展示；评分为编辑参考，不预测流量'}};
 for(const row of rows.filter(row=>row.kind==='xhs_title_candidate')){
  const candidate={id:row.id,...row.data};output.results.push(candidate);
  if(JSON.stringify(output).length>12000)output.results.pop();
 }
 output.metadata.projectedCount=output.results.length;
 return output;
}
export async function queryXhsTitles(parameters:Record<string,unknown>,window:string,options:PaidRequestOptions){
 const input=XhsTitleInput.parse(parameters),response=await redfoxRequest(XHS_TITLE_OPERATION,input,window,'query',options);
 return {...response,results:parseXhsTitles(response.data,input)};
}

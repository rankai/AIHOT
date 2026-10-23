import {z} from "zod";
import {redfoxRequest} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {hotResearchOperations,type HotResearchOperation} from "./hot-research-contract.ts";
const Text=z.string().nullable().optional(),Integer=z.union([z.number().int().safe(),z.string().regex(/^-?\d+$/)]).nullable().optional();
const Hot=z.object({title:z.string(),url:Text,index:Integer,hotCount:Text,gmtCreate:Text,hotId:Text,plat:Integer,platName:Text,maxHotScore:Integer,maxPosition:Integer,firstRankTime:Text,latestRankDate:Text,topOfTheDayTime:Text}).passthrough();
export interface HotResearchResult{kind:"hotspot_research"|"query_summary";itemKey:string;data:Record<string,unknown>}
export function parseHotResearch(op:HotResearchOperation,raw:unknown):HotResearchResult[]{
 const result:HotResearchResult[]=[];
 if(op==="9Y4EX7RW"){
  const groups=z.array(z.object({keyword:z.string(),plats:z.array(z.string()),hotSpotList:z.array(Hot)}).passthrough()).max(1000).parse(raw);
  groups.forEach((record,i)=>result.push({kind:"hotspot_research",itemKey:`group:${i}`,data:{platform:"hot-research",operationId:op,title:record.keyword,identity:{},record,urlRole:"search-destination",missing:["热点与搜索链接不是原始新闻作品"]}}));
 }else if(op==="S28Q6HUD")z.array(Hot).max(10000).parse(raw).forEach((record,i)=>result.push({kind:"hotspot_research",itemKey:`hot:${i}`,data:{platform:"hot-research",operationId:op,title:record.title,identity:{},record,urlRole:"search-destination"}}));
 else{
  const page=z.object({ksList:z.array(Hot).optional(),dyList:z.array(Hot).optional(),wbList:z.array(Hot).optional(),bdList:z.array(Hot).optional(),bzList:z.array(Hot).optional(),zhList:z.array(Hot).optional(),ttList:z.array(Hot).optional()}).refine(p=>Object.values(p).some(v=>v!==undefined),"Missing platform hotspot lists").parse(raw);
  for(const [group,rows] of Object.entries(page))rows?.forEach((record,i)=>result.push({kind:"hotspot_research",itemKey:`${group}:${i}`,data:{platform:"hot-research",operationId:op,title:record.title,group,record,identity:{},urlRole:"search-destination"}}));
 }
 return [...result,{kind:"query_summary",itemKey:"page",data:{platform:"hot-research",operationId:op,count:result.length}}];
}
export async function queryHotResearch(op:HotResearchOperation,p:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){const input=hotResearchOperations[op].schema.parse(p),r=await redfoxRequest(op,input,window,purpose,options);return {...r,results:parseHotResearch(op,r.data)};}

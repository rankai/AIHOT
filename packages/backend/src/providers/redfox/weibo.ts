import type { MediaItem } from "../../content/materials.ts";
import { z } from "zod";
import { RedfoxResponseError, redfoxRequest } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";
const Id=z.union([z.string().regex(/^\d+$/).max(100),z.number().int().nonnegative().safe().transform(String)]);
import { weiboOperations, type WeiboOperation } from "./weibo-contract.ts";
const Text=z.string().nullable().optional();
export const WeiboAccount=z.object({uid:Id.optional(),nickname:Text,name:Text,avatar:Text,profileImageUrl:Text}).passthrough();
export const WeiboWork=z.object({opusId:Id.optional(),mblogid:z.string().regex(/^[A-Za-z0-9]+$/).nullable().optional(),uid:Id.optional(),nickname:Text,text:Text,opusUrl:Text,url:Text,publishTime:Text,videoUrl:Text,cover:Text,picUrl:z.array(z.string()).max(100).optional(),images:z.array(z.string()).max(100).optional()}).passthrough();
const Trend=z.object({cursor:z.string(),hasMore:z.boolean(),updateTime:z.string().optional(),list:z.array(z.object({topSearchName:z.string().min(1),topSearchNum:z.string(),tag:z.string().optional()}).passthrough()).max(500)}).passthrough();
export interface WeiboResult {kind:"weibo_account"|"weibo_work"|"weibo_trend";itemKey:string;data:Record<string,unknown>}
export function parseWeibo(operation:WeiboOperation,raw:unknown,parameters:Record<string,unknown>):WeiboResult[]{
  if(operation==="UAQ90A1F")return [{kind:"weibo_trend",itemKey:"snapshot",data:{platform:"weibo",...Trend.parse(raw)}}];
  const account=operation==="API_1789098515117" || operation==="API_1789098515245";
  const list=operation==="API_1789098515245" || operation==="TXQPVGJG";
  const rows=list?z.array(z.record(z.string(),z.unknown())).max(500).parse(raw):[raw];
  return rows.map((value,index)=>{
    // A searchType=3 response is not assumed to be an account merely because of the request label.
    const isAccount=account || (operation==="TXQPVGJG" && parameters.searchType==="3" && typeof value==="object" && value!==null && !("opusId" in value) && "uid" in value);
    const parsed=isAccount?WeiboAccount.parse(value):WeiboWork.parse(value);
    if(operation==="API_1789098515117" && parsed.uid!==parameters.userId)throw new RedfoxResponseError("Weibo account identity does not match request");
    if(operation==="API_1789098514899" && parsed.opusId!==parameters.opusId)throw new RedfoxResponseError("Weibo work identity does not match request");
    const missing:string[]=[];
    if(!parsed.uid)missing.push("缺少稳定作者 UID");
    if(!isAccount && !parsed.opusId)missing.push("缺少作品数字 ID");
    if(!isAccount && !(parsed.opusUrl || parsed.url))missing.push("缺少原文地址");
    return {kind:isAccount?"weibo_account":"weibo_work",itemKey:`${isAccount?"user":"work"}:${isAccount?parsed.uid??index:parsed.opusId??index}`,data:{...parsed,platform:"weibo",missing,searchType:parameters.searchType??null}};
  });
}
export async function queryWeibo(operation:WeiboOperation,parameters:Record<string,unknown>,window:string,purpose:"query"|"collect",options:PaidRequestOptions){
  const input=weiboOperations[operation].schema.parse(parameters);
  const receipt=await redfoxRequest(operation,input,window,purpose,options);
  return {...receipt,results:parseWeibo(operation,receipt.data,input)};
}

/** Only the documented zoned Weibo format and explicit-zone ISO; never server-local time. */
export function weiboPublishedAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text=value.trim();
  const documented=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [+-][0-9]{4} [0-9]{4}$/;
  if (!documented.test(text) && !z.iso.datetime({offset:true}).safeParse(text).success) return null;
  const date=new Date(text);
  return Number.isFinite(date.getTime())?date:null;
}
function mediaUrl(value: string | null | undefined): string | null {
  if(!value)return null;
  try {const url=new URL(value);return ["http:","https:"].includes(url.protocol) && !url.username && !url.password?url.href:null;}catch{return null;}
}
export function weiboMedia(work: z.infer<typeof WeiboWork>): MediaItem[] {
  const images=[...new Set([...(work.picUrl??[]),...(work.images??[])].map(mediaUrl).filter((url):url is string=>url!==null))];
  const media:MediaItem[]=images.map(url=>({kind:"image",url}));
  const video=mediaUrl(work.videoUrl);
  if(video)media.push({kind:"video",url:video,poster:mediaUrl(work.cover)});
  return media;
}

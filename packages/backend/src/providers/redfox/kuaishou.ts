import {checkedManualOrigin} from "./manual-work-origin.ts";
import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {kuaishouOperations,type KuaishouOperation} from "./kuaishou-contract.ts";
const Text=z.string().nullable().optional(),Count=z.union([z.number().int().nonnegative(),z.string().regex(/^[0-9]+$/)]).nullable().optional();
const Work=z.object({photoId:Text,caption:Text,nickname:Text,headUrl:Text,videoUrl:Text,coverUrl:Text,publishTime:Text,duration:Count,workType:Text,authorFans:Count,collectCount:z.union([z.number().int().nonnegative(),z.string()]).nullable().optional(),commentCount:Count,forwardCount:Count,likeCount:Count,shareCount:Count,viewCount:Count}).passthrough().refine(v=>!!(v.photoId||v.caption||v.videoUrl),"No recognizable Kuaishou work fields");
const Account=z.object({kwaiId:Text,nickname:Text,signature:Text,headUrl:Text,coverImgUrl:Text}).passthrough().refine(v=>!!(v.kwaiId||v.nickname||v.signature),"No recognizable Kuaishou account fields");
export interface KuaishouResult{kind:"kuaishou_work"|"kuaishou_account"|"query_summary";itemKey:string;data:Record<string,unknown>}
function work(op:KuaishouOperation,raw:unknown,index:number,parameters:Record<string,unknown>):KuaishouResult{
 const record=Work.parse(raw);if(op==="UOM99OQI"&&record.photoId&&record.photoId!==parameters.photoId)throw new RedfoxResponseError("Kuaishou response differs from requested photo ID");
 const missing=["缺少已收到的原文链接；视频 CDN 地址不是原文"];if(!record.photoId)missing.push("缺少响应已收到的 photoId；请求参数不冒充已收身份");
 return {kind:"kuaishou_work",itemKey:`work:${index}`,data:{platform:"kuaishou",operationId:op,title:record.caption?.slice(0,200)||"快手作品",workId:record.photoId??null,workIdKind:record.photoId?"photoId":null,url:null,identity:{},missing,record,...(record.duration!==undefined&&record.duration!==null?{duration:record.duration,durationUnit:"milliseconds"}:{}),...(op==="UOM99OQI"?{requestedWorkId:parameters.photoId}:{})}};
}
export function parseKuaishou(op:KuaishouOperation,raw:unknown,parameters:Record<string,unknown>,originInput?:unknown):KuaishouResult[]{
 const origin=checkedManualOrigin(originInput,op,parameters);
 const shape=kuaishouOperations[op].shape;if(shape==="work")return [withOrigin(work(op,raw,0,parameters),origin?.resultId)];
 const page=z.object({list:z.array(z.unknown()).max(1000),total:Count,page:z.number().int().positive().optional(),size:z.number().int().positive().optional(),pageSize:z.number().int().positive().optional()}).passthrough().parse(raw);
 const results:KuaishouResult[]=page.list.map((raw,index)=>{if(shape!=="accounts")return work(op,raw,index,parameters);const record=Account.parse(raw);return {kind:"kuaishou_account",itemKey:`account:${index}`,data:{platform:"kuaishou",operationId:op,title:record.nickname||"快手账号",identity:{},missing:["缺少已确认稳定作者 ID；kwaiId 是展示号，不能据此永久绑定"],record}};});
 results.push({kind:"query_summary",itemKey:"page",data:{platform:"kuaishou",operationId:op,count:page.list.length,...(page.total!==undefined?{total:page.total}:{}),...(page.page!==undefined?{page:page.page}:{}),...(page.size!==undefined?{size:page.size}:{}),...(page.pageSize!==undefined?{pageSize:page.pageSize}:{})}});return results;
}
function withOrigin(result:KuaishouResult,resultId?:number){return resultId?{...result,data:{...result.data,originResultId:resultId}}:result;}
export async function queryKuaishou(op:KuaishouOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,origin?:unknown,purpose:"query"|"collect"="query"){const input=kuaishouOperations[op].schema.parse(parameters),receipt=await redfoxRequest(op,input,window,purpose,options);return {...receipt,results:parseKuaishou(op,receipt.data,input,origin)};}

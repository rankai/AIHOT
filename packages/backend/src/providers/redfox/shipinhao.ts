import {checkedManualOrigin} from "./manual-work-origin.ts";
import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {shipinhaoOperations,type ShipinhaoOperation} from "./shipinhao-contract.ts";
const Text=z.string().nullable().optional(),Count=z.union([z.number().int().nonnegative(),z.string().regex(/^[0-9]+$/)]).nullable().optional();
const Work=z.object({videoId:Text,exportId:Text,description:Text,title:Text,nickname:Text,headUrl:Text,avatar:Text,videoUrl:Text,thumbUrl:Text,coverUrl:Text,cover:Text,publishTime:Text,videoDuration:Text,topic:Text,location:Text,width:Count,height:Count,likeCount:Count,commentCount:Count,forwardCount:z.union([z.number().int().nonnegative(),z.string()]).nullable().optional(),favCount:Count,favoriteNum:Text,commentNum:Text,shareNum:Text,likeNum:Text,collectNum:Text}).passthrough().refine(v=>!!(v.videoId||v.exportId||v.description||v.title||v.videoUrl),"No recognizable video-channel work fields");
const Account=z.object({nickname:Text,signature:Text,headUrl:Text,coverImgUrl:Text,findName:Text}).passthrough().refine(v=>!!(v.nickname||v.signature||v.findName),"No recognizable video-channel account fields");
export interface ShipinhaoResult{kind:"shipinhao_work"|"shipinhao_account"|"query_summary";itemKey:string;data:Record<string,unknown>}
function work(op:ShipinhaoOperation,raw:unknown,index:number,parameters:Record<string,unknown>):ShipinhaoResult{
 const record=Work.parse(raw),workId=op==="MH5YA9DL"?record.exportId:record.videoId,workIdKind=workId?(op==="MH5YA9DL"?"exportId":"videoId"):null;
 if(op==="OE4KUEUO"&&record.videoId&&record.videoId!==parameters.videoId)throw new RedfoxResponseError("Video-channel response differs from requested video ID");
 const missing=["缺少稳定作者 ID；昵称不证明作者归属","缺少已收到的原文链接；视频 CDN 地址不是原文"];
 if(!workId)missing.push("缺少响应已收到的作品 ID；请求参数不冒充已收身份");
 return {kind:"shipinhao_work",itemKey:`work:${index}`,data:{platform:"shipinhao",operationId:op,title:record.title||record.description?.slice(0,200)||"视频号作品",workId:workId??null,workIdKind,url:null,identity:{},missing,record,...(op==="OE4KUEUO"?{requestedWorkId:parameters.videoId}:{}),...(op==="MH5YA9DL"?{inputUrl:parameters.url}:{})}};
}
export function parseShipinhao(op:ShipinhaoOperation,raw:unknown,parameters:Record<string,unknown>,originInput?:unknown):ShipinhaoResult[]{
 const origin=checkedManualOrigin(originInput,op,parameters);
 const shape=shipinhaoOperations[op].shape;
 if(shape==="work"||shape==="share")return [withOrigin(work(op,raw,0,parameters),origin?.resultId)];
 const page=z.object({list:z.array(z.unknown()).max(1000),total:Count,page:z.number().int().positive().optional(),size:z.number().int().positive().optional(),pageSize:z.number().int().positive().optional()}).passthrough().parse(raw);
 const results:ShipinhaoResult[]=page.list.map((raw,index)=>{if(shape!=="accounts")return work(op,raw,index,parameters);const record=Account.parse(raw);return {kind:"shipinhao_account",itemKey:`account:${index}`,data:{platform:"shipinhao",operationId:op,title:record.nickname||"视频号账号",identity:{},missing:["缺少已确认稳定作者 ID；nickname/findName 不能用于永久绑定"],record}};});
 results.push({kind:"query_summary",itemKey:"page",data:{platform:"shipinhao",operationId:op,count:page.list.length,total:page.total??null,page:page.page??null,size:page.size??null,pageSize:page.pageSize??null}});return results;
}
function withOrigin(result:ShipinhaoResult,resultId?:number){return resultId?{...result,data:{...result.data,originResultId:resultId}}:result;}
export async function queryShipinhao(op:ShipinhaoOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,origin?:unknown,purpose:"query"|"collect"="query"){const input=shipinhaoOperations[op].schema.parse(parameters),receipt=await redfoxRequest(op,input,window,purpose,options);return {...receipt,results:parseShipinhao(op,receipt.data,input,origin)};}

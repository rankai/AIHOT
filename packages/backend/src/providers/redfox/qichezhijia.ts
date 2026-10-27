import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {qichezhijiaOperations,type QichezhijiaOperation} from "./qichezhijia-contract.ts";
const Text=z.string().nullable().optional(),Integer=z.union([z.number().int().safe(),z.string().regex(/^-?[0-9]+$/)]).nullable().optional();
const Work=z.object({workId:Text,authorId:Text,authorName:Text,title:Text,description:Text,content:Text,workUrl:Text,cjhUrl:Text,ycUrl:Text,workType:Text,infoType:Text,publishTime:Text,duration:Text,durationSeconds:Integer,playCount:Integer,viewCount:Integer,likeCount:Integer,commentCount:Integer,coverUrl:Text,thumbnail:Text,videoUrl:Text,authorAvatar:Text,location:Text,topics:Text}).passthrough().refine(r=>!!(r.workId||r.title||r.description||r.content),"No recognizable Autohome work fields");
export interface QichezhijiaResult{kind:"qichezhijia_work"|"query_summary";itemKey:string;data:Record<string,unknown>}
function work(op:QichezhijiaOperation,raw:unknown,index:number,p:Record<string,unknown>):QichezhijiaResult{
 const record=Work.parse(raw),requested=op==="LLCI8QTE"?p.workId:op==="TE6AGWAF"?p.videoId:undefined;
 if(requested&&record.workId&&requested!==record.workId)throw new RedfoxResponseError("Autohome response differs from requested work ID");
 if(op==="4BOZ9DLE"&&record.authorId&&record.authorId!==p.authorId)throw new RedfoxResponseError("Autohome list author differs from requested author ID");
 const url=op==="TE6AGWAF"?(p.videoType===4?record.cjhUrl:record.ycUrl):record.workUrl;
 const namespace={operationId:op,...(p.sourceType!==undefined?{sourceType:p.sourceType}:{}),...(p.videoType!==undefined?{videoType:p.videoType}:{}),...(record.workType!=null?{workType:record.workType}:{}),...(record.infoType!=null?{infoType:record.infoType}:{})};
 return {kind:"qichezhijia_work",itemKey:`work:${index}`,data:{platform:"qichezhijia",operationId:op,title:record.title||"汽车之家作品",identity:record.authorId?{authorId:record.authorId}:{},identityNamespace:namespace,workId:record.workId??null,workNamespace:namespace,url:url??null,record,requestContext:p,...(requested?{requestedWorkId:requested}:{}),...(record.durationSeconds!=null?{duration:record.durationSeconds,durationUnit:"seconds"}:op==="4BOZ9DLE"&&record.duration!=null?{duration:record.duration,durationUnit:"seconds"}:{}),missing:[...(!record.workId?["缺少本条已收作品 ID"]:[]),...(!url?["缺少响应原文链接；媒体不作原文"]:[])]}};
}
export function parseQichezhijia(op:QichezhijiaOperation,raw:unknown,p:Record<string,unknown>):QichezhijiaResult[]{
 if(op==="LLCI8QTE"||op==="TE6AGWAF")return [work(op,raw,0,p)];
 const page=op==="4BOZ9DLE"?z.object({workList:z.array(z.unknown()).max(1000),total:Text}).parse(raw):undefined;
 const list=page?.workList??z.array(z.unknown()).max(1000).parse(raw);
 return [...list.map((r,i)=>work(op,r,i,p)),{kind:"query_summary",itemKey:"page",data:{platform:"qichezhijia",operationId:op,count:list.length,...(page?.total!==undefined?{total:page.total}:{})}}];
}
export async function queryQichezhijia(op:QichezhijiaOperation,p:Record<string,unknown>,window:string,options:PaidRequestOptions,purpose:"query"|"collect"="query"){const input=qichezhijiaOperations[op].schema.parse(p),r=await redfoxRequest(op,input,window,purpose,options);return {...r,results:parseQichezhijia(op,r.data,input)};}

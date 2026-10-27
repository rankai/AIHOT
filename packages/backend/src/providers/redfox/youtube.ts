import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {youtubeOperations,type YoutubeOperation} from "./youtube-contract.ts";
import {youtubeVideoId,youtubeChannelId} from "../../lib/url.ts";
export {youtubeVideoId,youtubeChannelId} from "../../lib/url.ts";
export const YoutubeOrigin=z.object({resultId:z.number().int().positive().safe(),videoId:z.string().regex(/^[A-Za-z0-9_-]{11}$/),channelId:z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),discoveredAt:z.iso.datetime()}).strict();
export type YoutubeOrigin=z.infer<typeof YoutubeOrigin>;
const Text=z.string().nullable().optional(),VideoId=z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable().optional();
const Count=z.union([z.number().nonnegative(),z.string()]);
const Image=z.object({url:z.string(),width:z.number().int().nonnegative().optional(),height:z.number().int().nonnegative().optional()}).passthrough();
const Work=z.object({videoId:VideoId,title:Text,description:Text,author:Text,channelId:z.string().regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),channelUrl:Text,channelHandle:Text,videoUrl:Text,publishedTime:Text,date:Text,relativeDate:Text,duration:Text,lengthSeconds:Text,thumbnails:z.array(Image).optional(),channelAvatars:z.array(Image).optional(),viewCount:Count.nullable().optional(),isLiveContent:z.boolean().optional(),isVerified:z.boolean().optional()}).passthrough().refine(v=>!!(v.videoId||v.title||v.description),"No recognizable YouTube work fields");
export interface YoutubeResult{kind:"youtube_work"|"query_summary";itemKey:string;data:Record<string,unknown>}
function work(op:YoutubeOperation,raw:unknown,index:number,parameters:Record<string,unknown>,origin?:YoutubeOrigin):YoutubeResult{
 const record=Work.parse(raw),receivedUrlId=youtubeVideoId(record.videoUrl),channelFromUrl=youtubeChannelId(record.channelUrl);
 if(op==="609DF2IR"&&record.videoId!==parameters.videoId)throw new RedfoxResponseError("YouTube response differs from requested video ID");
 if(record.videoUrl&&(!receivedUrlId||!record.videoId||receivedUrlId!==record.videoId))throw new RedfoxResponseError("YouTube received original is not a matching native watch URL");
 // Only search declares a direct channelId. Detail has a documented /channel/<id> locator.
 const returnedChannelId=op==="GC5SC5HS"?record.channelId??channelFromUrl:channelFromUrl;
 if(op==="GC5SC5HS"&&record.channelId&&channelFromUrl&&record.channelId!==channelFromUrl)throw new RedfoxResponseError("YouTube channel identities disagree");
 if(origin&&(op!=="609DF2IR"||record.videoId!==origin.videoId))throw new RedfoxResponseError("YouTube detail differs from frozen origin video");
 if(origin?.channelId&&returnedChannelId&&origin.channelId!==returnedChannelId)throw new RedfoxResponseError("YouTube detail author differs from frozen same-video evidence");
 const channelId=returnedChannelId??origin?.channelId;
 const missing:string[]=[];if(!record.videoId)missing.push("缺少已收到的视频 ID，不能生成原文链接");
 const url=record.videoUrl??(record.videoId?`https://www.youtube.com/watch?v=${record.videoId}`:null);
 return {kind:"youtube_work",itemKey:`work:${index}`,data:{platform:"youtube",operationId:op,title:record.title||"YouTube 视频",workId:record.videoId??null,url,identity:channelId?{channelId}:{},missing,record,...(origin?{originResultId:origin.resultId}:{})}};
}
export function parseYoutube(op:YoutubeOperation,raw:unknown,parameters:Record<string,unknown>,context?:unknown):YoutubeResult[]{
 const origin=context===undefined?undefined:YoutubeOrigin.parse(context);
 if(op==="609DF2IR")return [work(op,raw,0,parameters,origin)];
 const page=z.object({videos:z.array(z.unknown()).max(1000),continuationToken:z.string().nullable().optional(),estimatedResults:Count.optional(),query:Text,videoCount:z.number().int().nonnegative().optional()}).passthrough().parse(raw);
 return [...page.videos.map((r,i)=>work(op,r,i,parameters)),{kind:"query_summary",itemKey:"page",data:{platform:"youtube",operationId:op,count:page.videos.length,continuationToken:page.continuationToken??null,estimatedResults:page.estimatedResults??null,query:page.query??null,videoCount:page.videoCount??null}}];
}
export async function queryYoutube(op:YoutubeOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,origin?:unknown,purpose:"query"|"collect"="query"){const input=youtubeOperations[op].schema.parse(parameters),receipt=await redfoxRequest(op,input,window,purpose,options);return {...receipt,results:parseYoutube(op,receipt.data,input,origin)};}

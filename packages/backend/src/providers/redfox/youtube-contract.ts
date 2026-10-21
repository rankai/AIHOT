import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
export const youtubeOperations={
 GC5SC5HS:{path:"/story/api/youtube/searchVideo",shape:"works",label:"YouTube 视频搜索",schema:z.object({searchQuery:z.string().trim().min(1).max(500),continuationToken:z.string().nullable().optional()}).strict()},
 "609DF2IR":{path:"/story/api/youtube/videoDetail",shape:"work",label:"YouTube 视频详情",schema:z.object({videoId:z.string().regex(/^[A-Za-z0-9_-]{11}$/)}).strict()},
} as const;
export type YoutubeOperation=keyof typeof youtubeOperations;
export const YoutubeOperationId=z.enum(["GC5SC5HS","609DF2IR"]);
export function youtubeDescriptors():PlatformOperationDescriptor[]{return [{id:"GC5SC5HS",platform:"youtube",label:youtubeOperations.GC5SC5HS.label,fields:[{name:"searchQuery",label:"搜索关键词",type:"string",required:true},{name:"continuationToken",label:"下一页游标",type:"string",required:false,hint:"使用上次响应的原始 continuationToken；首页可留空"}],purpose:"只读视频搜索；不推断相对发布时间",schedulableType:"search"},{id:"609DF2IR",platform:"youtube",label:youtubeOperations['609DF2IR'].label,fields:[{name:"videoId",label:"视频 ID",type:"string",required:true}],purpose:"只读详情；频道名称和 handle 不证明稳定作者身份",schedulableType:null}];}

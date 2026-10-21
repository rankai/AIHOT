import { z } from "zod";
import type { PlatformOperationDescriptor } from "@aihot/contracts/redfox";
const UrlInput = z.object({url:z.string().min(1).max(10000).refine(v=>v.trim().length>0,"请输入链接或分享文案")}).strict();
const TextInput = z.object({content:z.string().min(1).max(2999).refine(v=>v.trim().length>0,"请输入待检查文本")}).strict();
export const mediaToolOperations = {
 "9Q2PQBKU": {path:"/story/api/parseWork/audioExtract/bilibili",method:"POST",platform:"tools",group:"media",purpose:"media",label:"获取哔哩哔哩音频地址",schema:UrlInput},
 "API_1792053861083": {path:"/story/api/parseWork/videoSubtitle/bili",method:"POST",platform:"tools",group:"subtitle",purpose:"transcript",label:"哔哩哔哩视频字幕提取",schema:UrlInput},
 "API_1792051516512": {path:"/story/api/parseWork/videoSubtitle/youtube",method:"POST",platform:"tools",group:"subtitle",purpose:"transcript",label:"YouTube视频字幕提取",schema:UrlInput},
 "API_1791881343238": {path:"/story/api/cozeSkill/sensitiveWordSearch",method:"POST",platform:"tools",group:"text-check",purpose:"query",label:"多平台违禁词查询",schema:TextInput},
 "AWUTFI4V": {path:"/story/api/parseWork/parse",method:"POST",platform:"tools",group:"media",purpose:"media",label:"短视频下载器",schema:UrlInput},
 "D52IUEIM": {path:"/story/api/parseWork/videoDownload/youtube",method:"POST",platform:"tools",group:"media",purpose:"media",label:"YouTube视频下载",schema:UrlInput},
 "7UW1PT1F": {path:"/story/api/parseWork/videoDownload/x",method:"POST",platform:"tools",group:"media",purpose:"media",label:"X(Twitter)视频下载",schema:UrlInput},
 "MQMDU19Q": {path:"/story/api/parseWork/videoDownload/tiktok",method:"POST",platform:"tools",group:"media",purpose:"media",label:"TikTok视频下载",schema:UrlInput},
 "QPNFJRG1": {path:"/story/api/parseWork/videoDownload/xhs",method:"POST",platform:"tools",group:"media",purpose:"media",label:"小红书视频下载",schema:UrlInput},
 "U2NJ13MW": {path:"/story/api/parseWork/videoDownload/sph",method:"POST",platform:"tools",group:"media",purpose:"media",label:"视频号视频下载",schema:UrlInput},
 "0W27H3O6": {path:"/story/api/parseWork/videoDownload/douyin",method:"POST",platform:"tools",group:"media",purpose:"media",label:"抖音视频下载",schema:UrlInput},
 "0ZIWOO8P": {path:"/story/api/parseWork/videoDownload/kuaishou",method:"POST",platform:"tools",group:"media",purpose:"media",label:"快手视频下载",schema:UrlInput},
 "CWX77QIH": {path:"/story/api/parseWork/videoDownload/bilibili",method:"POST",platform:"tools",group:"media",purpose:"media",label:"哔哩哔哩视频下载",schema:UrlInput},
 "UUSP1G1P": {path:"/story/api/parseWork/videoDownload/instagram",method:"POST",platform:"tools",group:"media",purpose:"media",label:"Instagram视频下载",schema:UrlInput},
} as const;
export type MediaToolOperation = keyof typeof mediaToolOperations;
export const MediaToolOperationId = z.enum(["9Q2PQBKU", "API_1792053861083", "API_1792051516512", "API_1791881343238", "AWUTFI4V", "D52IUEIM", "7UW1PT1F", "MQMDU19Q", "QPNFJRG1", "U2NJ13MW", "0W27H3O6", "0ZIWOO8P", "CWX77QIH", "UUSP1G1P"]);
export function mediaToolDescriptors():PlatformOperationDescriptor[]{
 return (Object.keys(mediaToolOperations) as MediaToolOperation[]).map(id=>{const o=mediaToolOperations[id],text=o.group==="text-check";
 return {id,platform:o.platform,label:o.label,fields:[{name:text?"content":"url",label:text?"待检查文本":"链接或分享文案",type:"string",required:true,constraints:{maxLength:text?2999:10000},hint:text?"小于3000字；当前按JavaScript字符长度限制为2999，不注入示例文本":"保留原串，由固定供应商解析；本地不打开链接"}],purpose:`${o.group==="subtitle"?"字幕查询":text?"文本检查":"媒体解析"}；使用 redfox.${o.purpose} 次数预算。仅保存研究结果，不下载文件或自动导入材料。`,schedulableType:null};});
}

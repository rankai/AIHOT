import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().min(1),Opaque=z.string(),Integer=z.number().int().safe();
export const socialResearchOperations={
 ZMFVK589:{platform:"toutiao",method:"POST",path:"/story/api/toutiao/workComment",label:"今日头条作品评论（只读研究）",schema:z.object({opusId:Text,offset:Opaque.optional()}).strict()},
 API_1790577699794:{platform:"tiktok",method:"POST",path:"/story/api/tiktok/ability/userFollowing",label:"TikTok 用户关注列表（只读研究）",schema:z.object({userId:z.string().regex(/^[0-9]+$/).optional(),secUserId:Text.optional(),minTime:Text,pageToken:Opaque}).strict().refine(p=>!!p.userId!==!!p.secUserId,"userId 与 secUserId 必须且只能填写一个")},
 API_1790581645603:{platform:"tiktok",method:"POST",path:"/story/api/tiktok/ability/commentList",label:"TikTok 视频评论（只读研究）",schema:z.object({aweme_id:Text,cursor:Integer}).strict()},
 API_1791446025175:{platform:"tiktok",method:"POST",path:"/story/api/tiktok/ability/commentReply",label:"TikTok 评论回复（只读研究）",schema:z.object({itemId:Text,commentId:Text,cursor:Integer,count:Integer}).strict()},
 WULKP6JP:{platform:"youtube",method:"POST",path:"/story/api/youtube/videoComments",label:"YouTube 视频评论（只读研究）",schema:z.object({videoId:Text,languageCode:Text.optional(),countryCode:Text.optional(),sortBy:z.enum(["top","newest"]).optional(),continuationToken:Opaque.nullable().optional()}).strict()},
 U1SGKF2G:{platform:"instagram",method:"POST",path:"/story/api/ins/postComment",label:"Instagram 帖子评论（只读研究）",schema:z.object({codeOrUrl:Text,sortBy:z.enum(["recent","popular"]),paginationToken:Opaque.optional()}).strict()},
} as const;
export type SocialResearchOperation=keyof typeof socialResearchOperations;
export const SocialResearchOperationId=z.enum(["ZMFVK589","API_1790577699794","API_1790581645603","API_1791446025175","WULKP6JP","U1SGKF2G"]);
export function socialResearchDescriptors():PlatformOperationDescriptor[]{
 const text=(name:string,label:string,required=true,hint?:string)=>({name,label,type:"string" as const,required,...(hint?{hint}:{})});
 const cursor={name:"cursor",label:"数值游标",type:"integer" as const,required:true,hint:"首次传整数 0；后续使用实际 nextCursor，不与字符串令牌互换"};
 const fields:Record<SocialResearchOperation,PlatformOperationDescriptor['fields']>={
  ZMFVK589:[text("opusId","作品 ID"),text("offset","原始翻页游标",false,"保留上次收到的字符串，首次可不传")],
  API_1790577699794:[text("userId","数字用户 ID",false,"与 secUserId 恰填一个；完整字符串，不转数值"),text("secUserId","安全用户 ID",false,"与 userId 恰填一个"),text("minTime","原始 minTime",true,"首次字符串 0；后续原样使用上次 minTime"),text("pageToken","原始 pageToken",true,"此字段必须传递；首次允许空字符串。响应 null 按事实保留，不擅自转为空字符串")],
  API_1790581645603:[text("aweme_id","作品 ID",true,"必填，保留完整作品 ID 字符串"),cursor],
  API_1791446025175:[text("itemId","作品 ID"),text("commentId","请求评论 ID"),cursor,{name:"count",label:"请求数量",type:"integer",required:true,hint:"明确填写本次请求数量"}],
  WULKP6JP:[text("videoId","视频 ID"),text("languageCode","语言偏好",false,"文档默认 zh-CN，语言示例不是完整枚举"),text("countryCode","地区偏好",false,"文档默认 US，地区示例不是完整枚举"),{name:"sortBy",label:"评论排序",type:"select",required:false,options:[{value:"top",label:"热门"},{value:"newest",label:"最新"}],hint:"文档默认 top"},text("continuationToken","原始续页令牌",false,"首次可不传或传 null；原串不裁剪")],
  U1SGKF2G:[text("codeOrUrl","帖子短码或完整 URL"),{name:"sortBy",label:"评论排序",type:"select",required:true,default:"recent",options:[{value:"recent",label:"最新"},{value:"popular",label:"热门"}],hint:"必填，默认选择最新"},text("paginationToken","原始分页令牌",false,"后续按收到的字符串原样传递，不推定结束条件")],
 };
 return (Object.keys(socialResearchOperations) as SocialResearchOperation[]).map(id=>({id,platform:socialResearchOperations[id].platform,label:socialResearchOperations[id].label,fields:fields[id],purpose:"同步只读评论 / 关注研究，使用 query 次数预算；评论作者不是作品作者，不提供材料导入或账号绑定",schedulableType:null}));
}

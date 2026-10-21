import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {instagramOperations,instagramRequestCode,type InstagramOperation} from "./instagram-contract.ts";
import {instagramCode} from "../../lib/url.ts";
const Text=z.string().nullable().optional(),Id=z.string().regex(/^[0-9]+$/).nullable().optional(),Code=z.string().regex(/^[A-Za-z0-9_-]+$/).nullable().optional();
const Count=z.union([z.number().int().nonnegative(),z.string().regex(/^[0-9]+$/)]).nullable().optional();
const User=z.object({id:Id,username:Text,fullName:Text,profilePicUrl:Text,isPrivate:z.boolean().optional(),isVerified:z.boolean().optional(),followerCount:Count}).passthrough();
const Child=z.object({id:Id,isVideo:z.boolean().optional(),mediaType:z.number().int().optional(),thumbnailUrl:Text,imageUrl:Text,videoUrl:Text,originalWidth:Count,originalHeight:Count}).passthrough();
const Work=z.object({code:Code,mediaId:Id,postId:Id,user:User.nullable().optional(),captionText:Text,captionHashtags:z.array(z.string()).optional(),accessibilityCaption:Text,takenAt:z.union([z.number().int().safe(),z.string().regex(/^-?[0-9]+$/)]).nullable().optional(),takenAtDate:Text,mediaType:z.union([z.literal(1),z.literal(2),z.literal(8)]).optional(),mediaFormat:Text,productType:Text,imageUrl:Text,thumbnailUrl:Text,videoUrl:Text,carouselItems:z.array(Child).optional(),carouselMediaCount:Text,videoDuration:z.number().nonnegative().nullable().optional(),url:Text,postUrl:Text,permalink:Text,likeCount:Count,commentCount:Count,shareCount:Count,playCount:Count}).passthrough().refine(v=>!!(v.code||v.captionText||v.user),"No recognizable Instagram work fields");
const Account=z.object({userId:Id,username:Text,fullName:Text,biography:Text,accountType:z.number().int().optional(),dateJoined:Text,bioLinks:z.array(z.object({url:Text,title:Text,linkType:Text}).passthrough()).optional(),followerCount:Count,followingCount:Count,mediaCount:Count,profilePicUrl:Text,profilePicUrlHd:Text}).passthrough().refine(v=>!!(v.userId||v.username||v.fullName),"No recognizable Instagram account fields");
export const InstagramOrigin=z.object({resultId:z.number().int().positive().safe(),code:z.string().regex(/^[A-Za-z0-9_-]+$/),userId:z.string().regex(/^[0-9]+$/).optional(),discoveredAt:z.iso.datetime()}).strict();
export type InstagramOrigin=z.infer<typeof InstagramOrigin>;
export interface InstagramResult{kind:"instagram_work"|"instagram_account"|"query_summary";itemKey:string;data:Record<string,unknown>}
function work(op:InstagramOperation,raw:unknown,index:number,parameters:Record<string,unknown>,origin?:InstagramOrigin):InstagramResult{
 const record=Work.parse(raw),requested=op==="Z9M88QI8"?instagramRequestCode(String(parameters.codeOrUrl)):null;
 if(requested&&record.code!==requested)throw new RedfoxResponseError("Instagram detail differs from requested shortcode");
 if(origin&&(op!=="Z9M88QI8"||record.code!==origin.code))throw new RedfoxResponseError("Instagram detail differs from frozen origin shortcode");
 if(origin?.userId&&record.user?.id&&origin.userId!==record.user.id)throw new RedfoxResponseError("Instagram author differs from frozen same-work evidence");
 const originals=[record.url,record.postUrl,record.permalink].filter((v):v is string=>!!v);
 if(originals.some(url=>!record.code||instagramCode(url)!==record.code))throw new RedfoxResponseError("Instagram received original differs from its shortcode");
 const inputUrl=typeof parameters.codeOrUrl==="string"&&instagramCode(parameters.codeOrUrl)?parameters.codeOrUrl:null;
 const url=originals[0]??inputUrl??(record.code?`https://www.instagram.com/${record.productType==="clips"?"reel":"p"}/${record.code}/`:null);
 const userId=record.user?.id??origin?.userId,missing:string[]=[];
 if(!record.code)missing.push("缺少已收到的帖子短码及可核实原文");if(!userId)missing.push("缺少已确认用户 ID；用户名不能证明作者归属");
 return {kind:"instagram_work",itemKey:`work:${index}`,data:{platform:"instagram",operationId:op,title:record.captionText?.slice(0,200)||"Instagram 帖子",workId:record.code??null,url,identity:userId?{userId}:{},missing,record,...(origin?{originResultId:origin.resultId}:{})}};
}
export function parseInstagram(op:InstagramOperation,raw:unknown,parameters:Record<string,unknown>,context?:unknown):InstagramResult[]{
 const origin=context===undefined?undefined:InstagramOrigin.parse(context);
 if(op==="3YJT69FL"){
  const record=Account.parse(raw);if(parameters.userId&&record.userId!==parameters.userId)throw new RedfoxResponseError("Instagram response differs from requested user ID");
  if(!parameters.userId&&parameters.username&&record.username&&String(parameters.username).toLowerCase()!==record.username.toLowerCase())throw new RedfoxResponseError("Instagram response differs from requested username");
  return [{kind:"instagram_account",itemKey:"account",data:{platform:"instagram",operationId:op,title:record.fullName||record.username||"Instagram 账号",identity:record.userId?{userId:record.userId}:{},missing:record.userId?[]:["缺少已收到的稳定用户 ID"],record}}];
 }
 if(op==="Z9M88QI8")return [work(op,raw,0,parameters,origin)];
 const page=z.object({items:z.array(z.unknown()).max(1000),count:z.number().int().nonnegative().optional(),paginationToken:z.string().nullable().optional()}).passthrough().parse(raw);
 return [...page.items.map((r,i)=>work(op,r,i,parameters)),{kind:"query_summary",itemKey:"page",data:{platform:"instagram",operationId:op,count:page.items.length,reportedCount:page.count??null,paginationToken:page.paginationToken??null}}];
}
export async function queryInstagram(op:InstagramOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions,origin?:unknown,purpose:"query"|"collect"="query"){const input=instagramOperations[op].schema.parse(parameters),receipt=await redfoxRequest(op,input,window,purpose,options);return {...receipt,results:parseInstagram(op,receipt.data,input,origin)};}

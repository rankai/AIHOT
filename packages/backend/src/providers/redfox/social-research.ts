import {z} from "zod";
import {redfoxRequest,RedfoxResponseError} from "./client.ts";
import type {PaidRequestOptions} from "../receipts.ts";
import {socialResearchOperations,type SocialResearchOperation} from "./social-research-contract.ts";
const Text=z.string().nullable().optional(),Integer=z.union([z.number().int().safe(),z.string().regex(/^-?[0-9]+$/)]).nullable().optional();
const User=z.object({userId:Text,secUserId:Text,channelId:Text,id:Text,uid:Text,userHandle:Text,userName:Text,username:Text,nickname:Text,displayName:Text,fullName:Text,avatarImage:Text,avatarUrl:Text,profilePicUrl:Text,channelUrl:Text,signature:Text,createTime:Integer,isSecret:Integer,isVerified:z.boolean().nullable().optional(),isPrivate:z.boolean().nullable().optional(),isCreator:z.boolean().nullable().optional()}).passthrough();
const CommonComment={commentId:Text,content:Text,text:Text,likeCount:Integer,replyCount:Integer,replyId:Text,workId:Text,hasMoreReplies:z.boolean().nullable().optional(),publishTime:Integer,language:Text};
const TikComment=z.object({...CommonComment,userData:User.nullable().optional(),replyToCommentId:Text,replyToUserId:Text,replyToUserName:Text,replyToUserHandle:Text,threadId:Integer,likedByAuthor:z.boolean().nullable().optional(),pinnedByAuthor:z.boolean().nullable().optional()}).passthrough().refine(r=>!!(r.commentId||r.content||r.text),"No recognizable TikTok comment");
const YoutubeComment=z.object({commentId:Text,content:Text,likeCount:Text,replyCount:Text,publishedTime:Text,author:User.nullable().optional()}).passthrough().refine(r=>!!(r.commentId||r.content),"No recognizable YouTube comment");
const InstagramComment=z.object({commentId:Text,text:Text,createdAt:Integer,likeCount:Integer,replyCount:Integer,isEdited:z.boolean().nullable().optional(),isPinned:z.boolean().nullable().optional(),user:User.nullable().optional()}).passthrough().refine(r=>!!(r.commentId||r.text),"No recognizable Instagram comment");
const ToutiaoComment=z.object({cid:Text,uid:Text,content:Text,nickname:Text,avatar:Text,createTime:Text,updateTime:Text,likeNum:Text}).passthrough().refine(r=>!!(r.cid||r.content),"No recognizable Toutiao comment");
export interface SocialResearchResult{kind:"social_comment"|"social_followee"|"query_summary";itemKey:string;data:Record<string,unknown>}
function ownFields(record:Record<string,unknown>,fields:readonly string[]){return Object.fromEntries(fields.filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]));}
function identity(op:SocialResearchOperation,record:Record<string,unknown>){
 if(op==="ZMFVK589")return record.uid?{uid:record.uid}:{};
 const author=(op==="WULKP6JP"?record.author:op==="U1SGKF2G"?record.user:op==="API_1790577699794"?record:record.userData) as z.infer<typeof User>|null|undefined;
 if(!author)return {};
 return op==="WULKP6JP"?author.channelId?{channelId:author.channelId}:{}:op==="U1SGKF2G"?author.id?{userId:author.id}:{}:{...(author.userId?{userId:author.userId}:{}),...(author.secUserId?{secUserId:author.secUserId}:{})};
}
export function parseSocialResearch(op:SocialResearchOperation,raw:unknown,parameters:Record<string,unknown>):SocialResearchResult[]{
 const spec=socialResearchOperations[op],following=op==="API_1790577699794";
 let rows:Record<string,unknown>[],paging:Record<string,unknown>,receivedScope:Record<string,unknown>={};
 if(op==="ZMFVK589"){
  const page=z.object({opusId:Text,total:Integer,offset:Text,hasMore:z.boolean().nullable().optional(),comments:z.array(ToutiaoComment).max(1000)}).passthrough().parse(raw);
  if(page.opusId&&page.opusId!==parameters.opusId)throw new RedfoxResponseError("Toutiao comment page differs from requested work");
  rows=page.comments;paging={root:ownFields(page,["total","offset","hasMore"])};receivedScope=ownFields(page,["opusId"]);
 }else if(following){
  const page=z.object({followingList:z.array(User.refine(r=>!!(r.userId||r.secUserId||r.userHandle||r.userName),"No recognizable followee")).max(1000),hasMore:Integer,minTime:Text,pageToken:Text}).passthrough().parse(raw);
  rows=page.followingList;paging={data:ownFields(page,["hasMore","minTime","pageToken"])};
 }else if(op==="API_1790581645603"||op==="API_1791446025175"){
  const page=z.object({commentList:z.array(TikComment).max(1000),hasMore:Integer,nextCursor:Integer,total:Integer}).passthrough().parse(raw);
  const requested=op==="API_1790581645603"?parameters.aweme_id:parameters.itemId;
  if(page.commentList.some(r=>r.workId&&r.workId!==requested))throw new RedfoxResponseError("TikTok comments differ from requested work");
  rows=page.commentList;paging={data:ownFields(page,["hasMore","nextCursor","total"])};
 }else if(op==="WULKP6JP"){
  // The official example's continuationToken is outside data. Preserve both reported paths; never merge them.
  const page=z.object({code:z.literal(2000),data:z.object({comments:z.array(YoutubeComment).max(1000),continuationToken:Text}).passthrough(),continuationToken:Text}).passthrough().parse(raw);
  rows=page.data.comments;paging={root:ownFields(page,["continuationToken"]),data:ownFields(page.data,["continuationToken"])};
 }else{
  const page=z.object({comments:z.array(InstagramComment).max(1000),count:Integer,total:Integer,paginationToken:Text}).passthrough().parse(raw);
  rows=page.comments;paging={data:ownFields(page,["count","total","paginationToken"])};
 }
 const result:SocialResearchResult[]=rows.map((record,index)=>{
  const actual=identity(op,record),role=following?"followee":op==="API_1791446025175"?"comment-reply":"comment";
  return {kind:following?"social_followee":"social_comment",itemKey:`${role}:${index}`,data:{platform:spec.platform,operationId:op,role,title:String(following?record.userName||record.userHandle||"关注列表账号":record.content||record.text||"研究评论").slice(0,200),identity:actual,identityRole:following?"followee":"comment-author",record,requestedScope:parameters,...(Object.keys(receivedScope).length?{receivedScope}:{}),...(following?{}:{commentId:record.commentId??record.cid??null}),timeUnits:op==="ZMFVK589"?{createTime:"seconds",updateTime:"unspecified"}:following?{createTime:"seconds"}:op==="WULKP6JP"?{publishedTime:"relative-or-unspecified"}:op==="U1SGKF2G"?{createdAt:"seconds"}:{publishTime:"seconds"},missing:[...(!Object.keys(actual).length?["缺少已收评论者 / 关注者稳定 ID；请求身份不补作实际作者"]:[]),"仅用于评论或关系研究，不提供材料导入和账号绑定"]}};
 });
 result.push({kind:"query_summary",itemKey:"page",data:{platform:spec.platform,operationId:op,role:"social-research-summary",researchType:following?"following":op==="API_1791446025175"?"comment-replies":"comments",count:rows.length,reportedPaging:paging,requestedScope:parameters,...(Object.keys(receivedScope).length?{receivedScope}:{})}});
 return result;
}
export async function querySocialResearch(op:SocialResearchOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions){
 const input=socialResearchOperations[op].schema.parse(parameters),response=await redfoxRequest(op,input,window,"query",options);
 return {...response,results:parseSocialResearch(op,response.data,input)};
}

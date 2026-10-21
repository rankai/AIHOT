import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
import {instagramCode} from "../../lib/url.ts";
export const instagramRequestCode=(value:string)=>/^[A-Za-z0-9_-]+$/.test(value)?value:instagramCode(value);
export const instagramOperations={
 GM0TISWI:{path:"/story/api/ins/search",label:"Instagram 帖子搜索",schema:z.object({keyword:z.string().trim().min(1).max(500),paginationToken:z.string().nullable().optional()}).strict()},
 "3YJT69FL":{path:"/story/api/ins/userInfo",label:"Instagram 账号详情",schema:z.object({username:z.string().trim().min(1).nullable().optional(),userId:z.string().regex(/^[0-9]+$/).nullable().optional()}).strict().refine(v=>!!(v.username||v.userId),"username 与 userId 至少填写一个")},
 Z9M88QI8:{path:"/story/api/ins/postDetail",label:"Instagram 帖子详情",schema:z.object({codeOrUrl:z.string().trim().min(1).refine(v=>!!instagramRequestCode(v),"填写帖子短码或 Instagram /p/、/reel/ 原文链接")}).strict()},
} as const;
export type InstagramOperation=keyof typeof instagramOperations;
export const InstagramOperationId=z.enum(["GM0TISWI","3YJT69FL","Z9M88QI8"]);
export function instagramDescriptors():PlatformOperationDescriptor[]{return [
 {id:"GM0TISWI",platform:"instagram",label:instagramOperations.GM0TISWI.label,fields:[{name:"keyword",label:"搜索关键词",type:"string",required:true},{name:"paginationToken",label:"下一页游标",type:"string",required:false,hint:"使用上一页原始 paginationToken；首页可留空"}],purpose:"只读帖子搜索",schedulableType:"search"},
 {id:"3YJT69FL",platform:"instagram",label:instagramOperations['3YJT69FL'].label,fields:[{name:"username",label:"用户名",type:"string",required:false,hint:"与用户 ID 至少填一个；同时填写时上游优先用户 ID"},{name:"userId",label:"用户 ID",type:"string",required:false}],purpose:"只读账号查询；用户名不是永久作者身份",schedulableType:null},
 {id:"Z9M88QI8",platform:"instagram",label:instagramOperations.Z9M88QI8.label,fields:[{name:"codeOrUrl",label:"帖子短码或原文链接",type:"string",required:true,hint:"支持 Instagram /p/ 与 /reel/ 链接"}],purpose:"只读帖子详情，不提取转写",schedulableType:null},
 ];}

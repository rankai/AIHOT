import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().min(1),Digits=z.string().regex(/^[0-9]+$/);
export const ZhihuCommentSubscriptionInput=z.object({articleId:Digits}).strict();
export const zhihuOperations={
 "API_1792651427872":{path:"/story/api/zhihu/ability/articleDetail",label:"知乎文章详情",schema:z.object({articleId:Digits}).strict()},
 "API_1792651427970":{path:"/story/api/zhihu/ability/articleComment",label:"知乎文章评论",schema:ZhihuCommentSubscriptionInput.extend({nextUrl:Text.optional()}).strict()},
 "API_1792651512423":{path:"/story/api/zhihu/ability/accountDetail",label:"知乎账号详情",schema:z.object({userId:Text}).strict()},
 "API_1792651658984":{path:"/story/api/zhihu/ability/hotSearch",label:"知乎搜索热点",schema:z.object({}).strict()},
 "API_1789095347662":{path:"/story/api/zhihu/ability/searchWork",label:"知乎关键词搜索作品",schema:z.object({offset: Digits, sort: z.enum(["upvoted_count","created_time"]).optional(), timeInterval: z.enum(["a_day","a_week","a_month","three_months","half_a_year","a_year"]).optional(), vertical: z.enum(["answer","article","zvide"]).optional(), keword: Text}).strict()},
} as const;
export type ZhihuOperation=keyof typeof zhihuOperations;
export const ZhihuOperationId=z.enum(["API_1789095347662","API_1792651427872","API_1792651427970","API_1792651512423","API_1792651658984"]);
export function zhihuDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<ZhihuOperation,PlatformOperationDescriptor["fields"]>={
 "API_1792651427872":[{name:"articleId",label:"文章 ID",type:"string",required:true,hint:"仅知乎专栏文章；填写原文 /p/ 后的数字 ID"}],
 "API_1792651427970":[{name:"articleId",label:"文章 ID",type:"string",required:true},{name:"nextUrl",label:"下一页地址",type:"string",required:false,hint:"仅填写上次实收 nextUrl；定时快照每轮从首页开始，不沿用查询续页"}],
 "API_1792651512423":[{name:"userId",label:"主页 URL 标识",type:"string",required:true,hint:"填写知乎主页中的 token，例如 he-jia-lei-80"}],
 "API_1792651658984":[],
"API_1789095347662":[{"name": "offset", "label": "翻页偏移量", "type": "string", "required": true, "hint": "翻页偏移量，+20递增，第一页为0，必填"}, {"name": "sort", "label": "排序", "type": "select", "required": false, "options": [{"value": "upvoted_count", "label": "upvoted_count"}, {"value": "created_time", "label": "created_time"}], "hint": "排序：upvoted_count 最多点赞；created_time 最新发布，非必填"}, {"name": "timeInterval", "label": "时间范围", "type": "select", "required": false, "options": [{"value": "a_day", "label": "a_day"}, {"value": "a_week", "label": "a_week"}, {"value": "a_month", "label": "a_month"}, {"value": "three_months", "label": "three_months"}, {"value": "half_a_year", "label": "half_a_year"}, {"value": "a_year", "label": "a_year"}], "hint": "时间范围：a_day 一天内；a_week 一周内；a_month 一个月内；\nthree_months 3个月内；half_a_year 半年内；a_year 一年内，非必填"}, {"name": "vertical", "label": "内容类型", "type": "select", "required": false, "options": [{"value": "answer", "label": "answer"}, {"value": "article", "label": "article"}, {"value": "zvide", "label": "zvide"}], "hint": "类型：answer 回答；article 文章；zvide 视频，非必填"}, {"name": "keword", "label": "关键词", "type": "string", "required": true, "hint": "关键词，必填"}],
 };
 return (Object.keys(zhihuOperations) as ZhihuOperation[]).map(id=>({id,platform:"zhihu",label:zhihuOperations[id].label,fields:fields[id],purpose:"只读查询与结果查看；身份保留操作及内容类型范围，不自动导入或关联来源",schedulableType:id==="API_1792651427970"?"list":id==="API_1789095347662"?"search":null}));
}

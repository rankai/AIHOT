import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().min(1),Digits=z.string().regex(/^[0-9]+$/);
export const baijiahaoOperations={
 "API_1789097000710":{path:"/story/api/bjh/ability/opusHtml",label:"百家号作品内容html",schema:z.object({articleId: Text}).strict()},
 "API_1789097000761":{path:"/story/api/bjh/ability/videoDetail",label:"百家号视频详情",schema:z.object({svId: Text}).strict()},
 "API_1789097000814":{path:"/story/api/bjh/ability/accountDetail",label:"百家号账号信息",schema:z.object({uk: Text}).strict()},
 "API_1789097000858":{path:"/story/api/bjh/ability/searchWork",label:"百家号关键词搜索作品",schema:z.object({sort: z.enum(["1","2"]).optional(), pn: Digits, keyWord: Text}).strict()},
 "API_1789097000885":{path:"/story/api/bjh/ability/accountSearch",label:"百家号账号关键词搜索",schema:z.object({page: Text, keyword: Text}).strict()},
} as const;
export type BaijiahaoOperation=keyof typeof baijiahaoOperations;
export const BaijiahaoOperationId=z.enum(["API_1789097000710", "API_1789097000761", "API_1789097000814", "API_1789097000858", "API_1789097000885"]);
export function baijiahaoDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<BaijiahaoOperation,PlatformOperationDescriptor["fields"]>={
"API_1789097000710":[{"name": "articleId", "label": "文章 ID", "type": "string", "required": true, "hint": "文章id，必填"}],
"API_1789097000761":[{"name": "svId", "label": "视频 ID", "type": "string", "required": true, "hint": "视频id，必填"}],
"API_1789097000814":[{"name": "uk", "label": "账号 uk", "type": "string", "required": true, "hint": "账号uk，必填"}],
"API_1789097000858":[{"name": "sort", "label": "排序", "type": "select", "required": false, "options": [{"value": "1", "label": "1"}, {"value": "2", "label": "2"}], "default": "1", "hint": "排序：1-焦点排序 2-时间排序；不传则默认焦点排序"}, {"name": "pn", "label": "翻页偏移量", "type": "string", "required": true, "hint": "翻页，第一页传0，翻页+10"}, {"name": "keyWord", "label": "关键词", "type": "string", "required": true, "hint": "关键词，必填"}],
"API_1789097000885":[{"name": "page", "label": "页码", "type": "string", "required": true, "hint": "页码，第一页传0，下一页传返回数据中的page值，必填"}, {"name": "keyword", "label": "关键词", "type": "string", "required": true, "hint": "搜索关键词，必填"}],
 };
 return (Object.keys(baijiahaoOperations) as BaijiahaoOperation[]).map(id=>({id,platform:"baijiahao",label:baijiahaoOperations[id].label,fields:fields[id],purpose:"只读查询与结果查看；身份保留操作及内容类型范围，不自动导入或关联来源",schedulableType:["API_1789097000858"].includes(id)?"search":null}));
}

import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
const Text=z.string().min(1),Digits=z.string().regex(/^[0-9]+$/);
export const dongchediOperations={
 "W86F8SSK":{path:"/story/api/dongchedi/searchWork",label:"懂车帝关键词搜索作品",schema:z.object({keyword: Text.refine(v => !/[\s,，]/.test(v), "仅支持单个关键词，不能以空格或逗号分隔"), offset: Digits, sourceType: z.enum(["1","2"])}).strict()},
 "QQ5E3EZ9":{path:"/story/api/dongchedi/workDetail",label:"懂车帝作品详情",schema:z.object({workId: Text, workType: z.enum(["video","article"])}).strict()},
 "X16I71WV":{path:"/story/api/dongchedi/searchUser",label:"懂车帝用户搜索",schema:z.object({keyword: Text, offset: z.number().int().safe().nonnegative()}).strict()},
 "API_1791793668086":{path:"/story/api/dongchedi/accountWorks",label:"懂车帝账号详情+作品列表",schema:z.object({userId: Text}).strict()},
} as const;
export type DongchediOperation=keyof typeof dongchediOperations;
export const DongchediOperationId=z.enum(["W86F8SSK", "QQ5E3EZ9", "X16I71WV", "API_1791793668086"]);
export function dongchediDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<DongchediOperation,PlatformOperationDescriptor["fields"]>={
"W86F8SSK":[{"name": "keyword", "label": "关键词", "type": "string", "required": true, "hint": "搜索关键词 不支持采用空格/逗号等方式一次输入多个关键词"}, {"name": "offset", "label": "翻页偏移量", "type": "string", "required": true, "hint": "翻页偏移量，从0开始，翻页+20"}, {"name": "sourceType", "label": "内容类型", "type": "select", "required": true, "options": [{"value": "1", "label": "1"}, {"value": "2", "label": "2"}], "hint": "内容类型：1=综合，2=视频"}],
"QQ5E3EZ9":[{"name": "workId", "label": "作品 ID", "type": "string", "required": true, "hint": "懂车帝作品ID"}, {"name": "workType", "label": "作品类型", "type": "select", "required": true, "options": [{"value": "video", "label": "video"}, {"value": "article", "label": "article"}], "hint": "作品类型：video=视频，article=图文"}],
"X16I71WV":[{"name": "keyword", "label": "关键词", "type": "string", "required": true, "hint": "搜索关键词"}, {"name": "offset", "label": "翻页偏移量", "type": "integer", "required": true, "hint": "偏移量，从0开始"}],
"API_1791793668086":[{"name": "userId", "label": "用户 ID", "type": "string", "required": true, "hint": "用户id"}],
 };
 return (Object.keys(dongchediOperations) as DongchediOperation[]).map(id=>({id,platform:"dongchedi",label:dongchediOperations[id].label,fields:fields[id],purpose:"只读查询与结果查看；身份保留操作及内容类型范围，不自动导入或关联来源",schedulableType:["W86F8SSK", "API_1791793668086"].includes(id)?id==="API_1791793668086"?"list":"search":null}));
}

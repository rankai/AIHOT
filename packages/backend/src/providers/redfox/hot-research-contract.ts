import {z} from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
import {beijingDate,addDays} from "@aihot/contracts/time";
const Text=z.string().min(1);
const LocalDateTime=z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).refine(v=>z.iso.datetime().safeParse(v.replace(" ","T")+"Z").success,"需要有效年月日时分秒；不推断时区");
const KeywordParameters=z.object({platforms:z.array(z.union([z.literal(1),z.literal(2),z.literal(5),z.literal(7),z.literal(8),z.literal(9),z.literal(10)])).optional(),keywords:z.array(Text)}).strict();
const PlatformParameters=z.object({platform:z.union([z.literal(1),z.literal(2),z.literal(6),z.literal(5),z.literal(7),z.literal(8),z.literal(9),z.literal(10)])}).strict();

export const hotResearchOperations={
 "9Y4EX7RW":{path:"/story/api/hotKeyword/list",method:"POST",label:"全网聚合热点TOP10列表",schema:z.object({startDate:LocalDateTime,endDate:LocalDateTime}).strict().refine(p=>p.startDate<=p.endDate,"开始时间不得晚于结束时间")},
 "W94P1QH1":{path:"/story/api/hotSpot/getListByPlatformWithKeyword",method:"POST",label:"全网热搜查询（关键词）",schema:KeywordParameters.extend({startDate:z.iso.date(),endDate:z.iso.date()}).refine(p=>p.startDate<=p.endDate&&(Date.parse(p.endDate)-Date.parse(p.startDate))<=30*86400000,"查询窗口必须为正向且不超过30天")},
 "S28Q6HUD":{path:"/story/api/hotSpot/getListByPlatform",method:"GET",label:"各平台热点榜",schema:PlatformParameters.extend({startDate:z.iso.date(),endDate:z.iso.date()}).refine(p=>p.startDate<=p.endDate,"开始日期不得晚于结束日期")},
} as const;
export type HotResearchOperation=keyof typeof hotResearchOperations;
export const HotResearchOperationId=z.enum(["9Y4EX7RW", "W94P1QH1", "S28Q6HUD"]);
export const hotResearchCollectionSchemas={"9Y4EX7RW":z.object({}).strict(),"W94P1QH1":KeywordParameters,"S28Q6HUD":PlatformParameters} as const;
/** Subscriptions store static filters only; each new run freezes its Shanghai calendar window. */
export function hotResearchCollectionParameters(op:HotResearchOperation,parameters:unknown){
 return hotResearchCollectionSchemas[op].parse(parameters);
}
export function hotResearchDayParameters(op:HotResearchOperation,parameters:unknown,now:Date|string|number){
 const start=beijingDate(now),end=addDays(start,1),suffix=op==="9Y4EX7RW"?" 00:00:00":"";
 return hotResearchOperations[op].schema.parse({...hotResearchCollectionParameters(op,parameters),startDate:start+suffix,endDate:end+suffix});
}
export function hotResearchDescriptors():PlatformOperationDescriptor[]{
 const fields:Record<HotResearchOperation,PlatformOperationDescriptor["fields"]>={"9Y4EX7RW": [{"name": "startDate", "label": "开始日期/时间", "type": "string", "required": true, "hint": "开始时间，格式：yyyy-MM-dd HH:mm:ss"}, {"name": "endDate", "label": "结束日期/时间", "type": "string", "required": true, "hint": "结束时间，格式：yyyy-MM-dd HH:mm:ss"}], "W94P1QH1": [{"name": "platforms", "label": "平台列表", "type": "integer-array", "required": false, "options": [{"value":"1","label":"快手"},{"value":"2","label":"抖音"},{"value":"5","label":"微博"},{"value":"7","label":"百度"},{"value":"8","label":"B站"},{"value":"9","label":"知乎"},{"value":"10","label":"今日头条"}], "hint": "平台：1-快手 2-抖音 5-微博 7-百度 8-B站 9-知乎 10-今日头条 如果未指定平台，则查询所有平台"}, {"name": "keywords", "label": "关键词列表", "type": "string-array", "required": true, "hint": "关键词"}, {"name": "startDate", "label": "开始日期/时间", "type": "string", "required": true, "hint": "开始时间 查询时间范围不能超过30天 (查询当日数据时 开始时间传今日 结束时间传明日)"}, {"name": "endDate", "label": "结束日期/时间", "type": "string", "required": true, "hint": "结束时间"}], "S28Q6HUD": [{"name": "platform", "label": "平台", "type": "integer", "required": true, "hint": "平台 1-快手 2-抖音 6-小红书 5-微博  7-百度 8-B站 9-知乎 10-今日头条"}, {"name": "startDate", "label": "开始日期/时间", "type": "string", "required": true, "hint": "起始日期，格式：yyyy-MM-dd"}, {"name": "endDate", "label": "结束日期/时间", "type": "string", "required": true, "hint": "截止日期，格式：yyyy-MM-dd"}]};
 return (Object.keys(hotResearchOperations) as HotResearchOperation[]).map(id=>({id,platform:"hot-research",label:hotResearchOperations[id].label,fields:fields[id],purpose:"只读查询研究；不自动导入、绑定来源或承诺采集替换语义",schedulableType:"trend"}));
}

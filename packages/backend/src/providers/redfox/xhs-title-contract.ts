import { z } from "zod";
export const XHS_TITLE_OPERATION = "xhs.titleResearch";
export const XHS_TITLE_SOURCE = "小红书标题生成与评分-xhs";
export const XhsTitleOperationId = z.literal(XHS_TITLE_OPERATION);
export const XhsTitleInput = z.object({keyword:z.string().transform(value=>[...new Set(value.split(/[,，]/).map(word=>word.trim()).filter(Boolean))].join(",")).refine(value=>value.length<=30&&(!value||value.split(",").length<=5),"最多5个去重词，含逗号总长不超过30"),startDate:z.iso.date()}).strict();

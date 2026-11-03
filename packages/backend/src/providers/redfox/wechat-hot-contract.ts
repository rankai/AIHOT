import { z } from "zod";
/** Internal stable identity for this exact endpoint; not a vendor documentation number. */
export const WECHAT_HOT_OPERATION = "wechat.hotArticleNew";
export const WechatHotOperationId = z.literal(WECHAT_HOT_OPERATION);
export const WECHAT_HOT_SOURCE = "公众号文案创作-GitHub";
export const WechatHotInput = z.object({
  keyword: z.string().transform(value => [...new Set(value.split(/[,，]/).map(word => word.trim()).filter(Boolean))].join(","))
    .refine(value => value.length > 0 && value.split(",").length <= 5 && [...value].length <= 200, "需要1–5个去重关键词，总长不超过200字符"),
  startDate: z.iso.date(), endDate: z.iso.date(),
}).strict().refine(value => value.startDate <= value.endDate, "开始日期不得晚于结束日期");

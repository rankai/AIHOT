import { z } from "zod";
export const XHS_COVER_OPERATION = "xhs.coverResearch";
export const XHS_COVER_SOURCE = "小红书爆款封面生成-xhs";
export const XhsCoverOperationId = z.literal(XHS_COVER_OPERATION);
const normalizedKeyword = z.string().transform(value => [...new Set(value.split(/[,，]/).map(word => word.trim()).filter(Boolean))].join(","));
// Retain the original normalization/limit solely for consuming already-received responses.
export const LegacyXhsCoverReceiptInput = z.object({ keyword: normalizedKeyword.refine(value => value.length > 0 && value.split(",").length <= 5 && [...value].length <= 200, "旧封面回执关键词须符合原1–5词、200 Unicode字符合同"), startDate: z.iso.date() }).strict();
// Verified supplier limit includes commas and counts an emoji as two UTF-16 code units.
export const XhsCoverInput = z.object({ keyword: normalizedKeyword.refine(value => value.length > 0 && value.split(",").length <= 5 && value.length <= 30, "需要1–5个去重关键词，含英文逗号总长不超过30个UTF-16单元（emoji计2）"), startDate: z.iso.date() }).strict();
export const coverCategories = ["lowPowderExplosiveArticle", "likeTheTop500", "singleDayIncrements", "sevenDaysOfIncrements"] as const;

import type { OperationResult } from "./operation-types.ts";
import { researchObject } from "./research-platform-data.ts";
import { isXSearchWork } from "./x-search-import-data.ts";
export function xSearchDetailBody(result: Pick<OperationResult, "id" | "kind" | "data">) {
  const record = researchObject(result.data.record), user = researchObject(record.user);
  const validId = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
  if (!isXSearchWork(result.kind, result.data) || !Number.isSafeInteger(result.id) || result.id < 1 || !validId(record.tweetId) || user.userId != null && !validId(user.userId)) throw new Error("需收到合法 tweetId 才能查询同一作品详情；作者 ID 可选，已提供的 ID 须合法，不从关键词或请求作者补造身份。");
  return { tweetId: record.tweetId, sourceResultId: result.id };
}

import type { ToolRunCategory, ToolRunStatus } from "@aihot/contracts/user-tools";

export const RUN_CATEGORIES: ReadonlyArray<{ value: ToolRunCategory; label: string }> = [
  { value: "query", label: "平台查询 / 辅助工具" }, { value: "ai-search", label: "AI 搜索" },
  { value: "images", label: "图片创作" }, { value: "videos", label: "视频创作" },
  { value: "transcriptions", label: "视频转写" }, { value: "xhs-comments", label: "小红书评论" },
  { value: "media-upload", label: "素材上传" },
];
export const RUN_STATUSES: ReadonlyArray<{ value: ToolRunStatus; label: string }> = [
  { value: "active", label: "执行中" }, { value: "waiting", label: "等待结果" },
  { value: "completed", label: "已完成" }, { value: "needs_review", label: "需要处理" },
  { value: "stopped", label: "已停止" }, { value: "failed", label: "执行失败" },
];
export interface RunFilters { q: string; category: ToolRunCategory | ""; status: ToolRunStatus | "" }

/** Only user-visible history filters can travel from the URL to the private API. */
export function parseRunFilters(search: URLSearchParams): RunFilters {
  const category = RUN_CATEGORIES.find(option => option.value === search.get("category"))?.value ?? "";
  const status = RUN_STATUSES.find(option => option.value === search.get("status"))?.value ?? "";
  return { q: (search.get("q") ?? "").trim().slice(0, 120), category, status };
}

export function runFiltersQuery(filters: RunFilters, after?: number | null): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.category) query.set("category", filters.category);
  if (filters.status) query.set("status", filters.status);
  if (after !== undefined && after !== null && Number.isSafeInteger(after) && after > 0) query.set("after", String(after));
  return query;
}

export function runHistoryHref(filters: RunFilters): string {
  const search = new URLSearchParams({ view: "runs" });
  for (const [key, value] of runFiltersQuery(filters)) search.set(key, value);
  return `/tools?${search}`;
}

/** The return context contains filters, never an arbitrary destination URL. */
export function runDetailHref(id: number, filters: RunFilters): string {
  const history = runFiltersQuery(filters).toString();
  return `/tools/runs/${id}${history ? `?${new URLSearchParams({ history })}` : ""}`;
}

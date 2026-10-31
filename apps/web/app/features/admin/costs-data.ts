import type { CostFilters, CostGroupBy } from "@aihot/contracts/costs";

export type CostPageView = "overview" | "details" | "billing";
export type CostRangePreset = "24h" | "7d" | "30d";

const BEIJING_OFFSET = "+08:00";
const DAY_MS = 86_400_000;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class CostFilterError extends Error {}

export const COST_GROUP_BY = [
  { value: "provider", label: "计费供应商" },
  { value: "service", label: "接口服务" },
  { value: "model", label: "模型" },
  { value: "skill", label: "Skill" },
  { value: "user", label: "用户" },
] as const satisfies ReadonlyArray<{ value: CostGroupBy; label: string }>;

const SKILL_SPECIAL_GROUPS = {
  __shared__: {
    label: "多 Skill 共享步骤",
    description: "同一模型步骤激活了多个 Skill，费用只计一次，不能拆分相加。",
    action: "共享步骤不可拆分",
  },
  __not_activated__: {
    label: "已确认无 Skill 激活",
    description: "该模型步骤已记录激活集合，确认当时没有激活任何 Skill。",
    action: "无单一 Skill 可筛选",
  },
  __historical_unknown__: {
    label: "历史 Skill 归属未知",
    description: "该历史模型步骤未记录当时的激活集合，不能反推为“无 Skill”。",
    action: "历史归属不可筛选",
  },
  __not_applicable__: {
    label: "Skill 不适用",
    description: "该调用没有对应的助手模型步骤，Skill 归属不适用。",
    action: "Skill 不适用",
  },
} as const;

export function skillSpecialGroupPresentation(key: string): {
  label: string;
  description: string;
  action: string;
} {
  return SKILL_SPECIAL_GROUPS[key as keyof typeof SKILL_SPECIAL_GROUPS] ?? {
    label: "其他 Skill 状态",
    description: "无法识别该特殊分组状态。",
    action: "无法精确筛选",
  };
}

export function costPageView(value: string | null): CostPageView {
  if (value === null || value === "overview") return "overview";
  if (value === "details" || value === "billing") return value;
  throw new CostFilterError("页面视图必须是 overview、details 或 billing。");
}

export function costGroupBy(value: string | null): CostGroupBy {
  if (value === null) return "provider";
  const match = COST_GROUP_BY.find((item) => item.value === value);
  if (!match) throw new CostFilterError("分组维度无效。");
  return match.value;
}

export function beijingDateTimeInput(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return new Date(time + 8 * 3_600_000).toISOString().slice(0, 16);
}

export function normalizeCostDateTime(value: string, label: string): string {
  const trimmed = value.trim();
  if (ZONED_DATE_TIME.test(trimmed) && Number.isFinite(Date.parse(trimmed))) return trimmed;
  if (!LOCAL_DATE_TIME.test(trimmed)) throw new CostFilterError(`${label}须为北京时间，或带明确时区偏移的 ISO 时间。`);
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  const zoned = `${withSeconds}${BEIJING_OFFSET}`;
  if (!Number.isFinite(Date.parse(zoned))) throw new CostFilterError(`${label}不是有效时间。`);
  return zoned;
}

export function resolveCostRange(search: URLSearchParams, now = Date.now()): { start: string; end: string } {
  const rawRange = search.get("range");
  const rawStart = search.get("start");
  const rawEnd = search.get("end");
  if (rawStart || rawEnd || rawRange) {
    const hours = rawRange === "24h" ? 24 : rawRange === "7d" ? 7 * 24 : rawRange === "30d" ? 30 * 24 : null;
    if (rawRange && hours === null) throw new CostFilterError("时间范围必须是 24h、7d 或 30d。");
    const end = rawEnd ? normalizeCostDateTime(rawEnd, "结束时间") : new Date(now).toISOString();
    const start = rawStart ? normalizeCostDateTime(rawStart, "开始时间") : new Date(Date.parse(end) - (hours ?? 7 * 24) * 3_600_000).toISOString();
    if (!(Date.parse(start) < Date.parse(end))) throw new CostFilterError("开始时间必须早于结束时间。");
    if (Date.parse(end) - Date.parse(start) > 92 * DAY_MS) throw new CostFilterError("单次查询最多 92 天。");
    return { start, end };
  }
  return { start: new Date(now - 7 * DAY_MS).toISOString(), end: new Date(now).toISOString() };
}

export function presetRange(anchorEnd: string, preset: CostRangePreset): { start: string; end: string } {
  const hours = preset === "24h" ? 24 : preset === "30d" ? 30 * 24 : 7 * 24;
  const end = new Date(anchorEnd);
  return { start: new Date(end.getTime() - hours * 3_600_000).toISOString(), end: end.toISOString() };
}

export function costSearchParams(input: {
  start: string;
  end: string;
  view: "overview" | "details";
  groupBy?: CostGroupBy | null;
  filters?: CostFilters | null;
  cursor?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams({ start: input.start, end: input.end, view: input.view });
  if (input.view === "overview") params.set("groupBy", input.groupBy ?? "provider");
  const filters = input.filters;
  if (filters) {
    const entries: Array<[keyof CostFilters, string | number | null]> = [
      ["billingProvider", filters.billingProvider],
      ["service", filters.service],
      ["operation", filters.operation],
      ["model", filters.model],
      ["skillId", filters.skillId],
      ["moduleId", filters.moduleId],
      ["userId", filters.userId],
      ["username", filters.username],
      ["owner", filters.owner],
      ["origin", filters.origin],
      ["environment", filters.environment],
      ["status", filters.status],
      ["costBasis", filters.costBasis],
    ];
    for (const [key, value] of entries) if (value !== null && value !== "") params.set(key, String(value));
  }
  if (input.cursor) params.set("cursor", input.cursor);
  return params;
}

export function costPageHref(input: Parameters<typeof costSearchParams>[0]): string {
  return `/admin/costs?${costSearchParams(input)}`;
}

import type { ToolCreditKind } from "@aihot/contracts/credits";

export const TOOL_PRICE_KINDS: Array<{ kind: ToolCreditKind; label: string }> = [
  { kind: "query", label: "平台查询 / 辅助工具" }, { kind: "x-account", label: "X 账号查询" }, { kind: "x-tweet", label: "X 推文查询" },
  { kind: "images", label: "图片创作" }, { kind: "videos", label: "视频创作" }, { kind: "ai-search", label: "AI 搜索" },
  { kind: "transcriptions", label: "视频转写" }, { kind: "xhs-comments", label: "小红书评论" }, { kind: "media-upload", label: "上传至供应商" },
];

export interface MatchRow { key: string; type: "string" | "number" | "boolean"; value: string }

export function priceMatchRows(match: Record<string, string | number | boolean>): MatchRow[] {
  return Object.entries(match).map(([key, value]) => ({ key, type: typeof value as MatchRow["type"], value: String(value) }));
}

export function parsePriceMatch(rows: MatchRow[]): Record<string, string | number | boolean> {
  const entries: Array<[string, string | number | boolean]> = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(key) || key.split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error("参数路径应为字段名或以点分隔的字段名，例如 parameters.size。");
    if (keys.has(key)) throw new Error(`参数路径 ${key} 重复，请合并为一条规则。`);
    keys.add(key);
    if (row.type === "number") {
      if (!row.value.trim() || !Number.isFinite(Number(row.value))) throw new Error(`${key} 需要填写有效数字。`);
      entries.push([key, Number(row.value)]);
    } else if (row.type === "boolean") {
      if (row.value !== "true" && row.value !== "false") throw new Error(`${key} 需要选择是或否。`);
      entries.push([key, row.value === "true"]);
    } else entries.push([key, row.value]);
  }
  return Object.fromEntries(entries);
}

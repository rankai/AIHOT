import { duration } from "./format.ts";

export interface FetchRunDetail { pages?: number; backlog?: number; dropped?: number }
interface HistoryBase {
  id: number; history_key: string; occurred_at: string; status: string; error: string | null;
}
export type SourceHistoryRun = HistoryBase & ({
  kind: "fetch"; time_basis: "fetch_started_at"; started_at: string; finished_at: string | null;
  created_at: null; updated_at: null; found_count: number | null; new_count: number | null;
  related_material_count: null; detail: FetchRunDetail | null; provider: null; step: null; next_attempt_at: null;
} | {
  kind: "operation"; time_basis: "operation_created_at"; started_at: null; finished_at: null;
  created_at: string; updated_at: string; found_count: null; new_count: null;
  related_material_count: number; detail: null; provider: string; step: string; next_attempt_at: string | null;
});
export interface SourceActiveOperation { id: number; status: string; step: string; waitReason: string | null; nextAttemptAt: string | null }

export function sourceHistoryFacts(row: SourceHistoryRun) {
  return row.kind === "operation"
    ? { timeLabel: "执行记录创建", time: row.occurred_at, href: `/admin/operations/${row.id}`, provider: row.provider || "未记录", quantityLabel: "该源关联材料", quantity: String(row.related_material_count), elapsed: null }
    : { timeLabel: "抓取开始", time: row.occurred_at, href: null, provider: "未记录", quantityLabel: "发现 / 新增", quantity: `${row.found_count ?? "—"} / ${row.new_count ?? "—"}`, elapsed: duration(row.started_at, row.finished_at) };
}

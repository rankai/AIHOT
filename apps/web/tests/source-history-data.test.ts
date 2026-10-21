import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceHistoryFacts, type SourceHistoryRun } from "../app/features/admin/source-history-data.ts";

const fetch: SourceHistoryRun = { id: 7, kind: "fetch", history_key: "fetch:7", occurred_at: "2026-10-20T00:00:00Z", time_basis: "fetch_started_at", started_at: "2026-10-20T00:00:00Z", finished_at: "2026-10-20T00:00:02Z", created_at: null, updated_at: null, status: "ok", found_count: 5, new_count: 0, related_material_count: null, error: null, detail: { backlog: 2, dropped: 0 }, provider: null, step: null, next_attempt_at: null };
const operation: SourceHistoryRun = { id: 7, kind: "operation", history_key: "operation:7", occurred_at: "2026-10-19T00:00:00Z", time_basis: "operation_created_at", started_at: null, finished_at: null, created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-20T09:00:00Z", status: "waiting", found_count: null, new_count: null, related_material_count: 3, error: "collect budget waiting", detail: null, provider: "redfox", step: "redfox.collection.page", next_attempt_at: "2026-10-21T00:00:00Z" };

test("operation history labels creation and actual source-related materials, never execution duration or new items", () => {
  assert.deepEqual(sourceHistoryFacts(operation), { timeLabel: "任务创建", time: operation.occurred_at, href: "/admin/operations/7", provider: "redfox", quantityLabel: "该源关联材料", quantity: "3", elapsed: null });
  const later = { ...operation, updated_at: "2026-11-01T00:00:00Z", related_material_count: 0 };
  assert.equal(sourceHistoryFacts(later).elapsed, null);
  assert.equal(sourceHistoryFacts(later).time, operation.created_at);
  assert.equal(sourceHistoryFacts(later).quantity, "0");
});
test("legacy fetch retains discovery/new zero and actual started-finished duration without guessing provider", () => {
  assert.deepEqual(sourceHistoryFacts(fetch), { timeLabel: "抓取开始", time: fetch.started_at, href: null, provider: "未记录", quantityLabel: "发现 / 新增", quantity: "5 / 0", elapsed: "2.0s" });
  assert.equal(sourceHistoryFacts({ ...fetch, found_count: null, new_count: null, finished_at: null }).quantity, "— / —");
  assert.equal(sourceHistoryFacts({ ...fetch, finished_at: null }).elapsed, "—");
  assert.deepEqual(fetch.detail, { backlog: 2, dropped: 0 });
});
test("same numeric ID across fetch and operation retains independent display meaning and source-specific material counts", () => {
  const rows = [fetch, operation];
  assert.equal(new Set(rows.map(row => row.history_key)).size, 2);
  assert.equal(sourceHistoryFacts(rows[0]!).href, null);
  assert.equal(sourceHistoryFacts(rows[1]!).href, "/admin/operations/7");
  const otherSource = { ...operation, related_material_count: 1 };
  assert.equal(sourceHistoryFacts(otherSource).quantity, "1");
  assert.equal(sourceHistoryFacts(operation).quantity, "3");
});
test("waiting and review facts stay intact and unknown recorded provider does not adopt a current source provider", () => {
  for (const status of ["waiting", "needs_review", "stopped", "completed"]) {
    const row: SourceHistoryRun = { ...operation, status, provider: "" };
    assert.equal(sourceHistoryFacts(row).provider, "未记录");
    assert.equal(sourceHistoryFacts(row).elapsed, null);
    assert.equal(row.error, "collect budget waiting");
    assert.equal(row.next_attempt_at, "2026-10-21T00:00:00Z");
    assert.equal(row.status, status);
  }
});

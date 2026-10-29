import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunFilters, runDetailHref, runFiltersQuery, runHistoryHref } from "../app/features/tools/run-history-data.ts";

test("history URLs forward only bounded supported filters to the private API", () => {
  const filters = parseRunFilters(new URLSearchParams({ view: "runs", q: "  手机测评  ", category: "query", status: "completed", actor: "user:2", after: "10", token: "not-forwarded" }));
  assert.deepEqual(filters, { q: "手机测评", category: "query", status: "completed" });
  assert.equal(runFiltersQuery(filters, 99).toString(), "q=%E6%89%8B%E6%9C%BA%E6%B5%8B%E8%AF%84&category=query&status=completed&after=99");
  assert.deepEqual(parseRunFilters(new URLSearchParams({ q: "x".repeat(200), category: "admin", status: "unknown" })), { q: "x".repeat(120), category: "", status: "" });
  for (const cursor of [0, -1, NaN, Infinity, 1.5]) assert.equal(runFiltersQuery(filters, cursor).has("after"), false);
});

test("detail navigation round-trips history filters without an arbitrary return URL", () => {
  const filters = parseRunFilters(new URLSearchParams({ q: "AI & 100%_+创作", category: "images", status: "needs_review" }));
  const href = new URL(runDetailHref(123, filters), "http://web.test");
  assert.equal(href.pathname, "/tools/runs/123");
  const restored = parseRunFilters(new URLSearchParams(href.searchParams.get("history")!));
  assert.deepEqual(restored, filters);
  const back = new URL(runHistoryHref(restored), "http://web.test");
  assert.equal(back.pathname, "/tools"); assert.equal(back.searchParams.get("view"), "runs"); assert.equal(back.searchParams.get("q"), filters.q);
  assert.equal(runHistoryHref(parseRunFilters(new URLSearchParams("return=https://external.test&actor=user:2"))), "/tools?view=runs");
});

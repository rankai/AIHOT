import assert from "node:assert/strict";
import { test } from "node:test";
import { billParameterText, billRecordPage, redfoxCostBasis, redfoxCostDefaults, redfoxCostEnvironment, redfoxCostInputKey, redfoxCostQuery, redfoxCostText } from "../app/features/admin/redfox-cost-data.ts";

const input = { start: "2026-10-20T08:00:00+08:00", end: "2026-10-21T00:00:00Z", billRunId: "" };
test("loader defaults are a single supplied instant and exactly the preceding 24 hours, with no client clock read", () => {
  const now = new Date("2026-10-21T08:00:00+08:00");
  assert.deepEqual(redfoxCostDefaults(now), { start: "2026-10-20T00:00:00.000Z", end: "2026-10-21T00:00:00.000Z" });
  assert.equal(now.toISOString(), "2026-10-21T00:00:00.000Z");
});
test("only explicit-zone increasing intervals build a local GET query, retaining exact offsets and selected run string", () => {
  const request = new URL(redfoxCostQuery(input), "http://local.test");
  assert.equal(request.pathname, "/api/admin/redfox/costs");
  assert.deepEqual(Object.fromEntries(request.searchParams), { start: input.start, end: input.end });
  assert.equal(new URL(redfoxCostQuery({ ...input, billRunId: "42" }), "http://local.test").searchParams.get("billRunId"), "42");
  for (const start of ["2026-10-20T00:00:00", "2026-10-20", "", "invalidZ", " 2026-10-20T00:00:00Z", "2026-10-20T00:00:00+99:00"]) assert.throws(() => redfoxCostQuery({ ...input, start }));
  assert.throws(() => redfoxCostQuery({ ...input, start: input.end }));
  assert.throws(() => redfoxCostQuery({ ...input, start: "2026-10-21T08:00:00+08:00" }));
  assert.throws(() => redfoxCostQuery({ ...input, start: "2026-10-22T00:00:00Z" }));
  for (const billRunId of ["0", "-1", "01", "1.5", "9007199254740993", " 42 "]) assert.throws(() => redfoxCostQuery({ ...input, billRunId }));
});
test("snapshot identity distinguishes every edited query condition without relabeling old response", () => {
  const key = redfoxCostInputKey(input);
  assert.equal(redfoxCostInputKey({ ...input }), key);
  for (const changed of [{ ...input, start: "2026-10-19T00:00:00Z" }, { ...input, end: "2026-10-22T00:00:00Z" }, { ...input, billRunId: "42" }]) assert.notEqual(redfoxCostInputKey(changed), key);
});
test("cost strings and zero stay exact; unknown and grouping basis/environment are not real-payment claims", () => {
  for (const value of ["0", "-0.00000000000000001", "900719925474099312345.67890123456789"]) assert.equal(redfoxCostText(value), value);
  assert.equal(redfoxCostText(null), "未知");
  assert.equal(redfoxCostBasis("actual"), "实收成本（actual）"); assert.equal(redfoxCostBasis("estimated"), "文档估算（estimated）"); assert.equal(redfoxCostBasis(null), "未知（null）");
  assert.match(redfoxCostEnvironment("other"), /测试或其他端点/); assert.match(redfoxCostEnvironment("other"), /未判定/);
});
test("bill parameter omission, empty, null, zero, false and opaque raw strings remain distinct", () => {
  assert.equal(billParameterText({}, "pageNum"), "省略（上游默认未声明）");
  for (const [value, expected] of [["", "空字符串"], [null, "null"], [0, "0"], [false, "false"], [" raw | page\n ", " raw | page\n "], ["900719925474099312345", "900719925474099312345"]] as const) assert.equal(billParameterText({ pageNum: value }, "pageNum"), expected);
});
test("local 100-row display preserves same-second duplicates, signed precision and all remaining rows", () => {
  const duplicate = { points: "-0.00000000000000001", reason: "api_consume", reasonDesc: "same", gmtCreate: "2026-10-20 08:00:00" };
  const rows = Array.from({ length: 241 }, (_, index) => ({ ...duplicate, index }));
  const first = billRecordPage(rows, 0), last = billRecordPage(rows, 999);
  assert.equal(first.rows.length, 100); assert.equal(first.rows[0]!.points, first.rows[1]!.points); assert.equal(first.rows[0]!.gmtCreate, first.rows[1]!.gmtCreate);
  assert.notEqual(first.rows[0]!.index, first.rows[1]!.index);
  assert.equal(last.page, 2); assert.equal(last.rows.length, 41); assert.equal(last.rows.at(-1)!.index, 240);
  assert.equal(rows.length, 241); assert.equal(rows[0]!.points, duplicate.points);
  assert.deepEqual(billRecordPage([], 100).rows, []);
});

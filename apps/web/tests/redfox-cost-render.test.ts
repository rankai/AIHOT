import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { RedfoxCostsData } from "../app/features/admin/redfox-cost-types.ts";

test("real cost view starts without reading data and report keeps dimensions, precision, duplicate records and noncomparison labels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-redfox-costs-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/redfox-costs.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    const output = join(directory, "costs.mjs"); await bundle.write({ file: output, format: "esm" });
    const { RedfoxCosts, RedfoxCostReport } = await import(pathToFileURL(output).href);
    const render = (element: ReactElement) => { const router = createMemoryRouter([{ path: "/admin/data-tools", element }], { initialEntries: ["/admin/data-tools?view=costs"] }); try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); } };
    const interval = { start: "2026-10-20T00:00:00.000Z", end: "2026-10-21T00:00:00.000Z" };
    const initial = render(createElement(RedfoxCosts, { initialInterval: interval }));
    assert(initial.includes(interval.start)); assert(initial.includes(interval.end)); assert(initial.includes("读取已存费用数据")); assert(!initial.includes("本地登记的外发尝试"));
    assert(initial.includes('href="/admin/data-tools?view=platforms"')); assert(initial.includes('target="_blank"'));
    const precise = "900719925474099312345.67890123456789";
    const group = { service: "redfox.query", model: "model", origin: "live", base: "http://local-synthetic.test", environment: "other" as const, currency: "USD", costBasis: "estimated" as const, attempts: 2, knownCost: precise, unknownCostCount: 0, estimatedCredits: null, chargedCredits: null, unknownEstimatedCreditsCount: 2, unknownChargedCreditsCount: 2, statusCounts: { pending: 0, received: 1, failed: 0, unknown: 1 } };
    const agentKey = { ...group, service: "agentkey.collect", model: "TikHub/douyin-search", currency: null, costBasis: null, knownCost: null, unknownCostCount: 2, estimatedCredits: "0.5", chargedCredits: "0.2", unknownEstimatedCreditsCount: 0, unknownChargedCreditsCount: 1 };
    const bill = { runId: 42, receiptId: 7, responseIdentity: "receipt:7", queriedAt: interval.start, receivedAt: interval.end, savedAt: interval.end, parameters: { pageNum: " 1 ", pageSize: "900719925474099312345" }, operationId: "API_1792043329817", base: "https://redfox.hk", environment: "production" as const, count: 2, total: "900719925474099312345", pages: 0, rawTimeRange: { min: " raw same-second ", max: " raw same-second ", timezone: null }, records: [0, 1].map(index => ({ index, points: "-0.00000000000000001", reason: "api_consume", reasonDesc: "duplicate preserved", gmtCreate: " raw same-second " })), summary: { signedPoints: "-0.00000000000000002", knownApiConsumptionPoints: "0.00000000000000002", otherRecords: 0, nominalCny: { amount: "0.000000000000000002", label: "积分面值折算", pointsPerCny: "10", evidence: "docs", actualCost: false as const } } };
    const data: RedfoxCostsData = { local: { interval: { ...interval, timeBasis: "attempt_started_at" }, groups: [group, { ...group, currency: "EUR", costBasis: "actual", knownCost: "0" }, { ...group, currency: null, costBasis: null, knownCost: null }, agentKey] }, billPages: [bill], selectedBill: bill, comparison: { comparable: false, reasonCodes: ["NO_UNIQUE_REQUEST_ID"] } };
    const html = render(createElement(RedfoxCostReport, { data }));
    assert(html.includes(precise)); assert(html.includes("USD")); assert(html.includes("EUR")); assert(html.includes("币种未知"));
    assert(html.includes("文档估算（estimated）")); assert(html.includes("实收成本（actual）")); assert(html.includes("测试或其他端点")); assert(html.includes("不证明上游收到"));
    assert(html.includes("AgentKey 采集")); assert(html.includes("估价 0.5 credits")); assert(html.includes("实扣 0.2 credits"));
    assert(html.includes("积分面值折算（非实际扣款）")); assert(html.includes(bill.summary.nominalCny.amount)); assert(html.includes("当前不能逐笔匹配或计算精确差额"));
    assert.equal((html.match(/duplicate preserved/g) ?? []).length, 2); assert.equal((html.match(/ raw same-second /g) ?? []).length, 2);
    assert(html.includes(" 1 ")); assert(html.includes("900719925474099312345")); assert(html.includes("省略") === false); assert(!html.includes("已退款"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

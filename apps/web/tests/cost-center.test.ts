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
import type {
  CostDetailsResponse,
  CostOverviewResponse,
  CostTotals,
  CostWarning,
} from "@aihot/contracts/costs";

const start = "2026-10-24T00:00:00+08:00";
const end = "2026-10-31T00:00:00+08:00";

const filters = {
  billingProvider: null,
  service: null,
  operation: null,
  model: null,
  skillId: null,
  moduleId: null,
  userId: null,
  username: null,
  owner: null,
  origin: "live" as const,
  environment: null,
  status: null,
  costBasis: null,
};

const totals: CostTotals = {
  attempts: 4,
  logicalRequests: 3,
  feeItems: 4,
  statusCounts: { pending: 1, received: 2, failed: 1, unknown: 0 },
  usage: {
    inputTokens: 1234,
    outputTokens: 567,
    cachedTokens: 89,
    estimatedCredits: "0.5",
    chargedCredits: "0.2",
    outputSeconds: "8",
    knownTokenRows: 2,
    missingUsageRows: 1,
  },
  amountBuckets: [
    { origin: "live", environment: "production", currency: "CNY", costBasis: "estimated", amount: "900719925474099312345.678901", records: 1 },
    { origin: "live", environment: "production", currency: "USD", costBasis: "actual", amount: "0.002000", records: 1 },
  ],
  knownCostItems: 2,
  unknownCostItems: 2,
  actualCostItems: 1,
  estimatedCostItems: 1,
  sharedFeeItems: 1,
};

const overviewWarnings: CostWarning[] = [
  { code: "historical_identity_unknown", count: 2, message: "部分调用没有可证明的计费供应商或模型身份。" },
  { code: "historical_owner_unknown", count: 1, message: "部分历史调用没有可靠的用户或执行者归属。" },
  { code: "historical_skill_unknown", count: 3, message: "部分历史模型步骤早于 Skill 成本上下文记录，不能反推当时激活范围。" },
  { code: "shared_skill_steps", count: 1, message: "多 Skill 共同步骤只计一次；按单个 Skill 相加会重复，因此标记为不可加总。" },
  { code: "wan_cost_conflict", count: 1, message: "部分万相任务的终态用量或价格证据不一致，费用保持未知。" },
  { code: "unknown_fee_evidence", count: 2, message: "部分外发调用缺少可复算的用量或价格证据，未知费用没有按零计算。" },
  { code: "facets_truncated", count: 1, message: "候选项过多，列表只显示前 50 项；可使用精确 ID 继续筛选。" },
];

const overview: CostOverviewResponse = {
  view: "overview",
  asOf: "2026-10-31T01:00:00.000Z",
  query: { start, end, view: "overview", groupBy: "provider", timeBasis: "attempt_started_at" },
  filters,
  selectedUser: null,
  totals,
  groups: [{
    key: "deepseek",
    groupBy: "provider",
    billingProvider: "deepseek",
    upstreamProvider: "synthetic-upstream",
    service: "assistant.text",
    operation: "chat.completions",
    model: "synthetic-model-with-a-long-name",
    skill: null,
    userId: null,
    username: null,
    displayName: null,
    ownerKind: null,
    additive: true,
    totals,
  }],
  nextGroupCursor: "group-next",
  facets: {
    providers: [{ value: "deepseek", label: "DeepSeek", count: 4 }],
    services: [{ value: "assistant.text", label: "assistant.text", count: 4 }],
    models: [{ value: "synthetic-model-with-a-long-name", label: "synthetic-model-with-a-long-name", count: 4 }],
    skills: [{ value: "xhs:synthetic-module", label: "小红书 · 合成模块", count: 0 }],
    truncated: false,
  },
  warnings: overviewWarnings,
};

const details: CostDetailsResponse = {
  view: "details",
  asOf: "2026-10-31T01:00:00.000Z",
  query: { start, end, view: "details", groupBy: null, timeBasis: "attempt_started_at" },
  filters: { ...filters, model: "synthetic-model-with-a-long-name" },
  selectedUser: null,
  rows: [{
    attemptId: 91,
    receiptId: 77,
    attempt: 2,
    runId: 42,
    startedAt: "2026-10-30T16:30:00.000Z",
    finishedAt: "2026-10-30T16:30:01.250Z",
    latencyMs: 1250,
    origin: "live",
    environment: "production",
    status: "received",
    billingProvider: "deepseek",
    upstreamProvider: null,
    service: "assistant.text",
    operation: "chat.completions",
    model: "synthetic-model-with-a-long-name-that-must-wrap",
    identitySource: "explicit",
    providerRequestId: "request-long-identifier-01234567890123456789",
    owner: { kind: "member", userId: 8, username: "synthetic-user", displayName: "合成用户" },
    assistant: {
      sessionId: "session-long-identifier",
      turnId: "turn-long-identifier",
      modelStepId: "step-long-identifier",
      activations: [{ activationId: "activation-1", skillId: "xhs", moduleId: "search", version: "1.2.0", label: "小红书检索" }],
      attribution: "activated",
    },
    cost: { amount: "0.002000", currency: "CNY", basis: "estimated", estimateBasis: "standard_input_without_cache_breakdown", applicable: true, reason: null },
    usage: { inputTokens: 1000, outputTokens: 20, cachedTokens: 100, estimatedCredits: null, chargedCredits: null, outputSeconds: null },
    priceSnapshot: { state: "ready", reason: null, selectedAt: "2026-10-30T16:30:00.000Z", sourceUrl: "https://example.test/pricing", verifiedOn: "2026-10-29" },
    warnings: ["多个 Skill 共享此调用，不可按单个 Skill 分摊"],
  }],
  nextCursor: "detail-next",
  warnings: [{ code: "shared_skill_steps", count: 1, message: "当前页含多个 Skill 共享的调用，不可按单个 Skill 相加。" }],
};

test("cost center renders unified filters, exact decimal buckets, details and bill-only fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-cost-center-")), require = createRequire(import.meta.url);
  const input = {
    feature: new URL("../app/features/admin/costs.tsx", import.meta.url).pathname,
    data: new URL("../app/features/admin/costs-data.ts", import.meta.url).pathname,
  };
  const bundle = await rolldown({ input, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const feature = await import(pathToFileURL(join(directory, "feature.mjs")).href);
    const data = await import(pathToFileURL(join(directory, "data.mjs")).href);
    const render = (element: ReactElement, path = "/admin/costs") => {
      const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [path] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };

    const html = render(createElement(feature.CostCenter, { page: { view: "overview", range: { start, end }, costs: overview } }));
    for (const text of ["成本中心", "概览", "调用明细", "已存账单", "筛选条件", "北京时间", "调用次数", "有估算费用的记录", "已有实扣的记录", "费用待确认", "按服务商汇总", "需要留意", "7 类数据需要核对", "影响："]) {
      assert(html.includes(text), text);
    }
    const warningCopy = [
      ["2 笔历史调用无法确认服务商或模型", "总费用仍会计入，但按服务商或模型拆分时可能不完整。"],
      ["1 笔历史调用无法确认调用者", "总费用仍可查看，但这些费用不能可靠分摊到具体用户。"],
      ["3 笔旧记录没有保存所用技能", "不能推断当时没有使用技能，按技能统计时可能缺少这部分记录。"],
      ["1 个费用项目由多个技能共同使用", "同一笔费用只计算一次；按不同技能分别相加会重复计算。"],
      ["1 个万相任务的费用记录存在冲突", "系统不会自行选择其中一个结果，请结合回执和账单进一步核对。"],
      ["2 笔调用缺少完整费用信息", "这些记录按“费用未知”处理，不会自动当成 0 元。"],
      ["筛选项较多，列表只展示前 50 项", "可以直接输入准确编号继续筛选，下方费用汇总不受影响。"],
    ] as const;
    for (const [title, impact] of warningCopy) {
      assert(html.includes(title), title);
      assert(html.includes(impact), impact);
    }
    const withoutDetails = html.replace(/<details[\s\S]*?<\/details>/g, "");
    for (const warning of overviewWarnings) {
      assert(html.includes(warning.code), warning.code);
      assert(html.includes(warning.message), warning.message);
      assert(!withoutDetails.includes(warning.code), `${warning.code} should be folded`);
    }
    assert(html.includes("900,719,925,474,099,312,345.678901 CNY"));
    assert(html.includes("0.002"));
    assert(html.includes("USD"));
    assert(html.includes("synthetic-model-with-a-long-name"));
    assert(html.includes("min-w-0"));
    assert(html.includes("overflow-x-auto"));
    assert(html.includes("grid-cols-2"));
    assert(html.includes("view=details"));
    assert(html.includes("groupCursor=group-next") === false);
    assert(html.includes("cursor=group-next"));

    const specialSkillStates = [
      ["__shared__", "多个技能共同使用", "费用只计一次，不能分别相加", "这笔费用不能拆分"],
      ["__not_activated__", "已确认未使用技能", "确认当时没有使用任何技能", "没有单独技能可筛选"],
      ["__historical_unknown__", "旧记录未保存所用技能", "不能因此推断为没有使用技能", "历史记录无法按技能筛选"],
      ["__not_applicable__", "无需归属技能", "不需要进行技能归属", "无需按技能筛选"],
    ] as const;
    for (const [key, label, description, action] of specialSkillStates) {
      const specialSkillOverview: CostOverviewResponse = {
        ...overview,
        query: { ...overview.query, groupBy: "skill" },
        groups: [{
          ...overview.groups[0]!,
          key,
          groupBy: "skill",
          skill: null,
          additive: key !== "__shared__",
        }],
      };
      const specialSkillHtml = render(createElement(feature.CostCenter, { page: { view: "overview", range: { start, end }, costs: specialSkillOverview } }));
      assert(specialSkillHtml.includes(label), key);
      assert(specialSkillHtml.includes(description), key);
      assert(specialSkillHtml.includes(action), key);
      assert(!specialSkillHtml.includes(">查看明细</a>"), key);
      if (key === "__shared__") assert(specialSkillHtml.includes("同一次调用由多个技能共同完成时，费用只计算一次，不能把这些分组金额相加。"));
      if (key === "__historical_unknown__") assert(!specialSkillHtml.includes("已确认未使用技能"));
    }
    for (const key of Object.keys({
      __shared__: true,
      __not_activated__: true,
      __historical_unknown__: true,
      __not_applicable__: true,
    })) {
      assert.equal(typeof data.skillSpecialGroupPresentation(key).label, "string");
    }
    assert.equal(data.skillSpecialGroupPresentation("unexpected").label, "其他技能状态");

    const detailHtml = render(createElement(feature.CostCenter, { page: { view: "details", range: { start, end }, costs: details } }), "/admin/costs?view=details");
    for (const text of ["调用明细 · 1 条", "左右滑动表格，可查看费用和记录依据", "运行 #42", "0.002", "CNY", "按资料估算", "标准输入价估算，不含缓存优惠", "价格已锁定", "小红书检索", "多个技能共同完成这次调用，费用不能按单个技能拆分", "复制回执", "下一页调用明细", "助手模型调用", "生成文本", "成功", "实时调用", "正式环境", "1.25 秒", "模型输入量/输出量"]) assert(detailHtml.includes(text), text);
    assert(detailHtml.includes("技术详情"));
    assert(detailHtml.includes("identity_source") === false);
    assert(detailHtml.includes("synthetic-model-with-a-long-name-that-must-wrap"));
    assert(detailHtml.includes("/admin/operations/42"));

    const billing = render(createElement(feature.CostCenter, { page: { view: "billing", range: { start, end }, costs: null } }), "/admin/costs?view=billing");
    assert(billing.includes("Redfox 已存账单页"));
    assert(billing.includes("读取已存账单"));
    assert(!billing.includes("本地登记的外发尝试"));
    assert(!billing.includes("万相视频复刻"));

    assert.equal(feature.decimalText("900719925474099312345.67890123456789"), "900,719,925,474,099,312,345.67890123456789");
    assert.equal(data.beijingDateTimeInput(start), "2026-10-24T00:00");
    assert.equal(data.normalizeCostDateTime("2026-10-24T09:30", "开始时间"), "2026-10-24T09:30:00+08:00");
    assert.deepEqual(data.presetRange(end, "24h"), { start: "2026-10-29T16:00:00.000Z", end: "2026-10-30T16:00:00.000Z" });
    assert.equal(data.costPageView("billing"), "billing");
    assert.throws(() => data.costGroupBy("bad"), /分组维度无效/);
  } finally {
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cost route loaders, redirects, admin navigation and model/settings links use the unified entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-cost-routes-")), require = createRequire(import.meta.url);
  const input = {
    costs: new URL("../app/routes/admin/costs.tsx", import.meta.url).pathname,
    redfox: new URL("../app/routes/admin/redfox.tsx", import.meta.url).pathname,
    models: new URL("../app/routes/admin/models.tsx", import.meta.url).pathname,
    settings: new URL("../app/routes/admin/settings.tsx", import.meta.url).pathname,
    layout: new URL("../app/routes/admin/layout.tsx", import.meta.url).pathname,
    routes: new URL("../app/routes.ts", import.meta.url).pathname,
  };
  const bundle = await rolldown({ input, plugins: [{
    name: "existing-react-runtime",
    resolveId(id) {
      if (["react", "react/jsx-runtime", "react-router", "motion/react", "@react-router/dev/routes"].includes(id)) return { id: require.resolve(id), external: true };
    },
  }] });
  const originalFetch = globalThis.fetch;
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const costs = await import(pathToFileURL(join(directory, "costs.mjs")).href);
    const redfox = await import(pathToFileURL(join(directory, "redfox.mjs")).href);
    const models = await import(pathToFileURL(join(directory, "models.mjs")).href);
    const settings = await import(pathToFileURL(join(directory, "settings.mjs")).href);
    const layout = await import(pathToFileURL(join(directory, "layout.mjs")).href);
    const routes = (await import(pathToFileURL(join(directory, "routes.mjs")).href)).default;
    const adminRoutes = routes.find((route: { id?: string }) => route.id === "admin-layout").children;
    assert.equal(adminRoutes.find((route: { path?: string }) => route.path === "admin/costs").file, "routes/admin/costs.tsx");

    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${url.pathname}${url.search}`);
      assert.equal(new Headers(init?.headers).get("cookie"), "synthetic=session");
      return Response.json(overview);
    };
    const request = (path: string) => new Request(`http://local.test${path}`, { headers: { cookie: "synthetic=session", "user-agent": "cost-center-test" } });
    const loaded = await costs.loader({ request: request("/admin/costs?model=synthetic-model") });
    assert.equal(loaded.view, "overview");
    const api = new URL(calls[0]!, "http://local.test");
    assert.equal(api.pathname, "/api/admin/costs");
    assert.equal(api.searchParams.get("view"), "overview");
    assert.equal(api.searchParams.get("groupBy"), "provider");
    assert.equal(api.searchParams.get("origin"), "live");
    assert.equal(api.searchParams.get("model"), "synthetic-model");
    assert.equal(api.searchParams.get("limit"), "50");

    calls.length = 0;
    const billing = await costs.loader({ request: request("/admin/costs?view=billing") });
    assert.equal(billing.view, "billing");
    assert.equal(calls.length, 0);
    await assert.rejects(costs.loader({ request: request("/admin/costs?userId=not-an-id") }), (error: { init?: { status?: number } }) => error.init?.status === 400);

    const oldCosts = await redfox.loader({ request: request("/admin/data-tools?view=costs") });
    assert.equal(oldCosts.status, 308);
    assert.equal(oldCosts.headers.get("location"), "/admin/costs?view=billing");

    const render = (page: { default: (props: { loaderData: unknown }) => ReactElement }, data: unknown, path: string) => {
      const router = createMemoryRouter([{ path, element: createElement(page.default, { loaderData: data }) }], { initialEntries: [path] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const modelPage = render(models, {
      days: 7,
      capabilities: [{
        key: "synthetic",
        label: "合成能力",
        env: "SYNTHETIC_MODEL",
        defaultModel: "synthetic-default",
        vision: false,
        current: { model: "synthetic-model", source: "default" },
        usage: [{ purpose: "selection", model: "synthetic-model", promptVersion: "v1", calls: 2, ok: 2, failed: 0, unknown: 0, p50: 20, p95: 30, tokensIn: 100, tokensOut: 20 }],
      }],
      choices: [],
      history: [],
      benches: [],
    }, "/admin/models");
    assert(modelPage.includes("费用统一在成本中心查看"));
    assert(modelPage.includes("/admin/costs?view=details&amp;range=7d&amp;model=synthetic-model"));
    assert(!modelPage.includes("按用量 × 单价推算"));
    assert(!modelPage.includes("未定价"));

    const settingsPage = render(settings, {
      contact: { wechatQr: "/synthetic-wechat.png", feishuQr: "/synthetic-feishu.png" },
      targets: [],
      budgetScopes: [],
      budgets: [],
    }, "/admin/settings");
    assert(settingsPage.includes('href="/admin/costs?view=overview"'));
    assert(settingsPage.includes("查看成本中心"));

    const admin = { me: { name: "测试管理员", csrf: "synthetic", dev: false }, counts: {} };
    const navRouter = createMemoryRouter([{
      id: "admin-layout",
      path: "/admin/costs",
      element: createElement(layout.default, { loaderData: admin }),
      children: [{ index: true, element: createElement("div", null, "成本页") }],
    }], { initialEntries: ["/admin/costs"], hydrationData: { loaderData: { "admin-layout": admin } } });
    try {
      const navHtml = renderToStaticMarkup(createElement(RouterProvider, { router: navRouter }));
      assert.equal((navHtml.match(/href="\/admin\/costs"/g) ?? []).length, 2);
      assert(navHtml.includes("成本中心"));
    } finally {
      navRouter.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
});

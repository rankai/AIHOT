import {after, test} from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {closeDb, sql} from "@aihot/backend/db";
import {stopBoss} from "@aihot/backend/jobs/queue";
import {executeOperationStep} from "@aihot/backend/providers/operations/execute";
import {douyinSearchRoute} from "@aihot/backend/providers/agentkey/douyin-contract";
import {createAgentKeyQuery} from "@aihot/backend/providers/agentkey/queries";
import {createSynchronousQuery} from "@aihot/backend/providers/redfox/synchronous";
import {importDouyinResult} from "@aihot/backend/providers/redfox/import-douyin";
import {abandonRun, resumeRun} from "@aihot/backend/providers/operations/store";
import {scheduleNativeCollections} from "@aihot/backend/sources/native-scheduling";
import {createSubscription} from "@aihot/backend/sources/subscriptions";
import {config as backendConfig} from "@aihot/backend/config";
import {
  createPlatformSubscription,
  schedulePlatformSubscriptions,
  startPlatformSubscription,
  updatePlatformSubscription,
  preflightPlatformSubscriptionProvider,
  switchPlatformSubscriptionProvider,
} from "@aihot/backend/sources/platform-subscriptions";
import {assertConfiguredTestDatabase, gate, stub as httpStub, tag} from "./setup.ts";

type JsonRpcRequest = {method?: string; id?: string | number | null};

type StubPage = unknown[] | {appBody:Record<string,unknown>} | {items: unknown[]; pagination?: Record<string, unknown>};

async function mcpStub(pages: StubPage[], beforeReply?: (index: number) => Promise<void>) {
  const calls: Array<{name: string; tool: string; params: Record<string, unknown>}> = [];
  let toolCall = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as {
        id?: string | number | null;
        method?: string;
        params?: {name?: string; arguments?: {name?: string; params?: Record<string, unknown>}};
      };
      if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") {
        response.writeHead(202).end();
        return;
      }
      const envelope = body.method === "initialize"
        ? {protocolVersion: (body.params as unknown as {protocolVersion?: string})?.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: "agentkey-test", version: "1"}}
        : (() => {
          calls.push({
            name: body.params?.name ?? "",
            tool: body.params?.arguments?.name ?? "",
            params: body.params?.arguments?.params ?? {},
          });
          const index = toolCall++;
          const page = pages[index] ?? [];
          const data = Array.isArray(page)
            ? {itemList: page, hasMore: index + 1 < pages.length, cursor: (index + 1) * 12}
            : "appBody" in page ? page.appBody : {itemList: page.items, ...(page.pagination ?? {})};
          return {
            content: [],
            structuredContent: {
              provider: "TikHub",
              category: "social/douyin",
              credits_charged: 0.2,
              took_ms: 1,
              request_id: `request-${index + 1}`,
              data: {code: 200, data: !Array.isArray(page)&&"appBody" in page?data:{code: 0, msg: "success", data}},
            },
          };
        })();
      if (body.method === "tools/call") await beforeReply?.(toolCall - 1);
      response.writeHead(200, {"content-type": "application/json"});
      response.end(JSON.stringify({jsonrpc: "2.0", id: (body as JsonRpcRequest).id, result: envelope}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as {port: number}).port}/v1/mcp`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

after(async () => {
  await stopBoss();
  await closeDb();
});

test("scheduled AgentKey collection uses its own valve, follows only upstream pagination, imports deduplicated Douyin materials and closes the subscription", async () => {
  const [database] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(database.name, database.port);

  const note = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const author = `9007199254740993${note.slice(-6)}`;
  const items = [0, 1, 2].map((index) => {
    const id = `${note}${index}`;
    return {AwemeInfo: {
      AwemeId: id, Desc: `AgentKey synthetic ${index}`, CreateTime: String((1729400000 + index) * 1000),
      Author: {Uid: author, SecUid: `sec-${author}`, Nickname: "AgentKey synthetic author"},
      Video: {ItemID: id, Title: `AgentKey synthetic ${index}`, CreateTime: String(1729400000 + index),
        Cover: {UrlList: ["https://p3.douyinpic.com/test.jpeg"]}},
    }};
  });
  const stub = await mcpStub([[items[0]!, items[1]!], [items[2]!]]);
  const [savedBudget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='agentkey.collect'`;
  assert.ok(savedBudget);
  const previous = Object.fromEntries([
    "NODE_ENV",
    "AIHOT_ENVIRONMENT",
    "AGENTKEY_CALLS_ENABLED",
    "AGENTKEY_API_KEY",
    "AGENTKEY_MCP_URL",
    "REDFOX_CALLS_ENABLED",
    "COLLECT_ENABLED",
  ].map((key) => [key, process.env[key]]));
  let subscriptionId: number | null = null;

  try {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AIHOT_ENVIRONMENT: "test",
      AGENTKEY_CALLS_ENABLED: "true",
      AGENTKEY_API_KEY: "test-agentkey-collection-key",
      AGENTKEY_MCP_URL: stub.url,
      REDFOX_CALLS_ENABLED: "false",
      COLLECT_ENABLED: "true",
    });
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='agentkey.collect'`;

    const subscription = await createPlatformSubscription({sourceId:await selectedSource(),
      name: tag(),
      provider: "agentkey",
      operationId: "OWIBYU1V",
      parameters: {keyword: "AgentKey synthetic"},
      enabled: true,
      intervalMinutes: 15,
      enrichDetails: false,
      limits: {pages: 3, items: 10, details: 0},
    }, "agentkey-integration", tag());
    subscriptionId = subscription.id;

    await sql`UPDATE collection_subscriptions SET next_run_at=now()-interval '1 second' WHERE id=${subscription.id}`;
    await schedulePlatformSubscriptions();
    const [configured] = await sql`SELECT provider,operation_key,active_run_id FROM collection_subscriptions WHERE id=${subscription.id}`;
    assert.equal(configured!.provider, "agentkey");
    assert.equal(configured!.operation_key, douyinSearchRoute.operationKey);
    assert.ok(configured!.active_run_id);

    const runId = configured!.active_run_id as number;
    const [run] = await sql`SELECT * FROM operation_runs WHERE id=${runId}`;
    assert.equal(run!.provider, "agentkey");
    assert.equal(run!.operation_key, douyinSearchRoute.operationKey);
    assert.equal(run!.step_key, douyinSearchRoute.stepKey);

    await executeOperationStep(runId, run!.step_version, run!.job_id);
    const [afterFirst] = await sql`SELECT status,step_version,job_id FROM operation_runs WHERE id=${runId}`;
    assert.equal(afterFirst!.status, "active");
    await executeOperationStep(runId, afterFirst!.step_version, afterFirst!.job_id);

    const [completed] = await sql`SELECT status,current_receipt_id FROM operation_runs WHERE id=${runId}`;
    assert.deepEqual(completed, {status: "completed", current_receipt_id: null});
    assert.equal(stub.calls.length, 2);
    assert.ok(stub.calls.every((call) => call.name === "execute_tool" && call.tool === douyinSearchRoute.tool));
    assert.deepEqual(stub.calls[0]!.params, {keyword: "AgentKey synthetic", cursor: 0});
    assert.deepEqual(stub.calls[1]!.params, {keyword: "AgentKey synthetic", cursor: 12});

    const summaries = await sql`SELECT data,receipt_id FROM operation_results WHERE run_id=${runId} AND kind='query_summary' ORDER BY step_version`;
    assert.equal(summaries.length, 2);
    assert.deepEqual(summaries.map((row) => row.data.count), [2, 1]);
    assert.equal(summaries[1]!.data.stopReason, "upstream-no-more");
    assert.equal(summaries[1]!.data.nextParameters, null);

    const works = await sql`SELECT data,source_id,article_id,receipt_id FROM operation_results WHERE run_id=${runId} AND kind='douyin_work' ORDER BY id`;
    assert.equal(works.length, 3);
    assert.ok(works.every((row) => row.source_id && row.article_id));
    const [articleCount] = await sql`SELECT count(*)::int AS count FROM articles WHERE source_id=${works[0]!.source_id}`;
    assert.deepEqual(articleCount, {count: 3});
    const [source] = await sql`SELECT kind,participation_mode,enabled FROM sources WHERE id=${works[0]!.source_id}`;
    assert.deepEqual(source, {kind: "external", participation_mode: "isolated", enabled: true});

    const receipts = await sql`SELECT id,model,service,status FROM receipts WHERE id IN ${sql([summaries[0]!.receipt_id, summaries[1]!.receipt_id])} ORDER BY id`;
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every((row) => row.model === douyinSearchRoute.tool && row.service === "agentkey.collect" && row.status === "completed"));
    const attempts = [...await sql`SELECT DISTINCT model FROM receipt_attempts WHERE receipt_id IN ${sql(receipts.map((row) => row.id))}`];
    assert.deepEqual(attempts, [{model: douyinSearchRoute.tool}]);

    const [subscriptionAfter] = await sql`SELECT active_run_id,next_run_at,progress FROM collection_subscriptions WHERE id=${subscription.id}`;
    assert.equal(subscriptionAfter!.active_run_id, null);
    assert.ok(subscriptionAfter!.next_run_at.getTime() > Date.now());
    assert.deepEqual(subscriptionAfter!.progress, {
      pages: 2,
      items: 3,
      parameters: stub.calls[1]!.params,
      tokens: stub.calls.map((call) => JSON.stringify(Object.fromEntries(Object.entries(call.params).sort()))),
      stopReason: "upstream-no-more",
    });
  } finally {
    if (subscriptionId !== null) await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id=${subscriptionId}`;
    await sql`UPDATE budgets SET per_minute=${savedBudget.per_minute},per_hour=${savedBudget.per_hour},per_day=${savedBudget.per_day} WHERE service='agentkey.collect'`;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await stub.close();
  }
});

test("AgentKey and Redfox scheduling valves do not gate or reroute each other", async () => {
  const stub = await mcpStub([[]]);
  const initial = {
    AGENTKEY_CALLS_ENABLED: process.env.AGENTKEY_CALLS_ENABLED,
    AGENTKEY_API_KEY: process.env.AGENTKEY_API_KEY,
    AGENTKEY_MCP_URL: process.env.AGENTKEY_MCP_URL,
    REDFOX_CALLS_ENABLED: process.env.REDFOX_CALLS_ENABLED,
    COLLECT_ENABLED: process.env.COLLECT_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
    AIHOT_ENVIRONMENT: process.env.AIHOT_ENVIRONMENT,
  };
  const ids: number[] = [];
  try {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AIHOT_ENVIRONMENT: "test",
      AGENTKEY_CALLS_ENABLED: "true",
      AGENTKEY_API_KEY: "test-agentkey-valve-key",
      AGENTKEY_MCP_URL: stub.url,
      REDFOX_CALLS_ENABLED: "false",
      COLLECT_ENABLED: "true",
    });
    const agentKey = await createPlatformSubscription({sourceId:await selectedSource(),
      name: tag(), provider: "agentkey", operationId: "OWIBYU1V", parameters: {keyword: "agentkey only"},
      enabled: false, limits: {pages: 1, items: 10, details: 0},
    }, "agentkey-valve", tag());
    ids.push(agentKey.id);
    await sql`UPDATE collection_subscriptions SET enabled=true,next_run_at=now()-interval '1 second' WHERE id=${agentKey.id}`;

    const redfox = await createPlatformSubscription({sourceId:await selectedSource(),
      name: tag(), provider: "redfox", operationId: "OWIBYU1V", parameters: {keyword: "redfox only"},
      enabled: false, limits: {pages: 1, items: 10, details: 0},
    }, "agentkey-valve", tag());
    ids.push(redfox.id);
    await sql`UPDATE collection_subscriptions SET enabled=true,next_run_at=now()-interval '1 second' WHERE id=${redfox.id}`;

    await schedulePlatformSubscriptions();
    const rows = await sql`SELECT id,provider,active_run_id FROM collection_subscriptions WHERE id IN ${sql(ids)} ORDER BY id`;
    assert.equal(rows.find((row) => row.provider === "agentkey")!.active_run_id !== null, true);
    assert.equal(rows.find((row) => row.provider === "redfox")!.active_run_id, null);

    const agentKeyRow = rows.find((row) => row.provider === "agentkey")!;
    const [run] = await sql`SELECT * FROM operation_runs WHERE id=${agentKeyRow.active_run_id}`;
    assert.equal(run!.provider, "agentkey");
    assert.equal(run!.operation_key, douyinSearchRoute.operationKey);

    const manual = await startPlatformSubscription(redfox.id, "manual", tag());
    assert.equal(manual.provider, "redfox");
    assert.equal(manual.operation_key, "redfox.platform.collection");
  } finally {
    if (ids.length) await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL,active_run_id=NULL WHERE id IN ${sql(ids)}`;
    for (const [key, value] of Object.entries(initial)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await stub.close();
  }
});

test("ordinary subscription editing cannot switch its provider", async () => {
  const id = (await createPlatformSubscription({sourceId:await selectedSource(),
    name: tag(), provider: "redfox", operationId: "OWIBYU1V", parameters: {keyword: "cannot switch"},
    enabled: false, limits: {pages: 1, items: 10, details: 0},
  }, "provider-lock", tag())).id;
  try {
    await assert.rejects(updatePlatformSubscription(id, {
      editVersion: 1,
      config: {
        name: "AgentKey must use the explicit switch flow",
        provider: "agentkey",
        operationId: "OWIBYU1V",
        parameters: {keyword: "cannot switch"},
        enabled: false,
        enrichDetails: false,
        limits: {pages: 1, items: 10, details: 0},
      },
    }, "provider-lock"), /cannot be changed/);
  } finally {
    await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id=${id}`;
  }
});

const runOf = async (id: number) => (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id: number) {
  const run = await runOf(id);
  return executeOperationStep(id, run.step_version, run.job_id);
}
async function finish(id: number) {
  for (let i = 0; i < 12; i++) {
    const run = await runOf(id);
    if (run.status !== "active") return run;
    await step(id);
  }
  throw new Error("Fixture exceeded bounded steps");
}
const work = () => {
  const id = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  return {AwemeInfo: {AwemeId: id, Desc: "Synthetic bounded collection", CreateTime: "1729400000000",
    Author: {Uid: `${id}1`, SecUid: `sec-${id}`, Nickname: "Synthetic author"},
    Video: {ItemID: id, Title: "Synthetic bounded collection", CreateTime: "1729400000",
      Cover: {UrlList: ["https://p3.douyinpic.com/test.jpeg"]}}}};
};
const collectionConfig = (limits = {pages: 3, items: 10, details: 0}, keyword = tag()) => ({
  name: tag(), provider: "agentkey", operationId: "OWIBYU1V", parameters: {keyword},
  enabled: true, enrichDetails: false, intervalMinutes: 15, limits,
});
async function agentKeyFixture<T>(pages: StubPage[], body: (fixture: {
  stub: Awaited<ReturnType<typeof mcpStub>>;
  create: (limits?: {pages: number; items: number; details: number}, overrides?:Record<string,unknown>) => Promise<{
    subscription: Awaited<ReturnType<typeof createPlatformSubscription>>;
    run: Awaited<ReturnType<typeof startPlatformSubscription>>;
    config: ReturnType<typeof collectionConfig>;
  }>;
}) => Promise<T>, beforeReply?: (index: number) => Promise<void>) {
  const [database] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(database.name, database.port);
  const stub = await mcpStub(pages, beforeReply);
  const [budget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='agentkey.collect'`;
  assert.ok(budget);
  const values = {NODE_ENV: "test", AIHOT_ENVIRONMENT: "test", COLLECT_ENABLED: "true",
    AGENTKEY_CALLS_ENABLED: "true", AGENTKEY_API_KEY: "test-agentkey-bounded-key", AGENTKEY_MCP_URL: stub.url,
    REDFOX_CALLS_ENABLED: "false"};
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const ids: number[] = [];
  try {
    Object.assign(process.env, values);
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='agentkey.collect'`;
    return await body({stub, create: async (limits,overrides) => {
      const config = {...collectionConfig(limits),...overrides};
      const subscription = await createPlatformSubscription({...config,sourceId:await selectedSource()}, "bounded-agentkey", tag());
      ids.push(subscription.id);
      const run = await startPlatformSubscription(subscription.id, "bounded-agentkey", tag());
      return {subscription, run, config};
    }});
  } finally {
    if (ids.length) {
      await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id IN ${sql(ids)}`;
      for (const run of await sql`SELECT id,step_version,generation FROM operation_runs WHERE subscription_id IN ${sql(ids)} AND status NOT IN ('completed','failed')`) {
        await sql.begin(tx => abandonRun(tx, {runId: run.id, stepVersion: run.step_version, generation: run.generation}, "Synthetic fixture cleanup"));
      }
    }
    await sql`UPDATE budgets SET per_minute=${budget.per_minute},per_hour=${budget.per_hour},per_day=${budget.per_day} WHERE service='agentkey.collect'`;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await stub.close();
  }
}
async function closedSubscription(id: number, pages: number, items: number, stopReason: string) {
  const [subscription] = await sql`SELECT active_run_id,next_run_at,progress FROM collection_subscriptions WHERE id=${id}`;
  assert.equal(subscription.active_run_id, null);
  assert.ok(subscription.next_run_at.getTime() > Date.now());
  assert.equal(subscription.progress.pages, pages);
  assert.equal(subscription.progress.items, items);
  assert.equal(subscription.progress.stopReason, stopReason);
}

test("an empty successful AgentKey subscription page commits receipt-linked zero summary and releases occupancy", async () => {
  await agentKeyFixture([[]], async ({create, stub}) => {
    const {subscription, run} = await create();
    assert.equal((await finish(run.id)).status, "completed");
    const results = await sql`SELECT kind,data,receipt_id FROM operation_results WHERE run_id=${run.id}`;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.kind, "query_summary");
    assert.equal(results[0]!.data.count, 0);
    assert.equal(results[0]!.data.selectedCount, 0);
    assert.equal(results[0]!.data.nextParameters, null);
    assert.equal(results[0]!.data.stopReason, "upstream-no-more");
    const [receipt] = await sql`SELECT status,service,model FROM receipts WHERE id=${results[0]!.receipt_id}`;
    assert.deepEqual(receipt, {status: "completed", service: "agentkey.collect", model: douyinSearchRoute.tool});
    assert.equal(stub.calls.length, 1);
    await closedSubscription(subscription.id, 1, 0, "upstream-no-more");
  });
});

for (const reason of ["missing-next-token-needs-review", "repeated-next-token-needs-review"] as const) {
  test(`AgentKey subscription retains evidence for review on ${reason}`, async () => {
    const pagination = {hasMore: true, cursor: 12};
    const first = work(), second = work();
    const pages: StubPage[] = reason === "missing-next-token-needs-review"
      ? [{items: [first], pagination: {hasMore: true}}]
      : [{items: [first], pagination}, {items: [second], pagination}];
    await agentKeyFixture(pages, async ({create, stub}) => {
      const {subscription, run} = await create();
      assert.equal((await finish(run.id)).status, "needs_review");
      const summaries = await sql`SELECT data,receipt_id FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY step_version`;
      assert.equal(summaries.length, pages.length);
      assert.equal(summaries.at(-1)!.data.stopReason, reason);
      assert.equal(summaries.at(-1)!.data.nextParameters, null);
      assert.equal(summaries.at(-1)!.data.count, 1);
      assert.equal(stub.calls.length, pages.length);
      const receipts = await sql`SELECT status FROM receipts WHERE id IN ${sql(summaries.map(row => row.receipt_id))}`;
      assert.equal(receipts.filter(row => row.status === "received").length, 1);
      const [held] = await sql`SELECT active_run_id,next_run_at FROM collection_subscriptions WHERE id=${subscription.id}`;
      assert.equal(held.active_run_id, run.id);
      assert.equal((await runOf(run.id)).next_attempt_at, null);
    });
  });
}

for (const limit of ["page", "item"] as const) {
  test(`AgentKey subscription enforces ${limit} limit without another upstream request`, async () => {
    const pages = [[work(), work()], [work(), work()], [work()]];
    await agentKeyFixture(pages, async ({create, stub}) => {
      const {subscription, run} = await create(limit === "page" ? {pages: 1, items: 10, details: 0} : {pages: 3, items: 3, details: 0});
      assert.equal((await finish(run.id)).status, "completed");
      const expectedPages = limit === "page" ? 1 : 2, expectedItems = limit === "page" ? 2 : 3;
      assert.equal(stub.calls.length, expectedPages);
      const summaries = await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY step_version`;
      assert.deepEqual(summaries.map(row => row.data.count), Array(expectedPages).fill(2));
      assert.deepEqual(summaries.map(row => row.data.selectedCount), limit === "page" ? [2] : [2, 1]);
      const last = summaries.at(-1)!.data;
      assert.equal(last.stopReason, `${limit}-limit`);
      assert.equal(last.nextParameters, null);
      assert.equal(last.unprocessedDueToLimit, limit === "page" ? 0 : 1);
      const [count] = await sql`SELECT count(*)::int AS count FROM operation_results WHERE run_id=${run.id} AND kind='douyin_work' AND article_id IS NOT NULL`;
      assert.equal(count.count, expectedItems);
      await closedSubscription(subscription.id, expectedPages, expectedItems, `${limit}-limit`);
    });
  });
}

test("editing active AgentKey execution rejects a late old-generation page and permits a fresh run", async () => {
  const started = gate(), release = gate(), staleWork = work();
  await agentKeyFixture([[staleWork], []], async ({create, stub}) => {
    const {subscription, run, config} = await create();
    let pending: ReturnType<typeof step> | undefined;
    try {
      pending = step(run.id);
      await started.promise;
      const active = await runOf(run.id);
      assert.ok(active.current_receipt_id);
      assert.equal(active.status, "active");
      await updatePlatformSubscription(subscription.id, {editVersion: 1, config: {...config, parameters: {keyword: "Changed execution"}}}, "bounded-agentkey");
      release.open();
      assert.deepEqual(await pending, {skipped: true});
      const stopped = await runOf(run.id);
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.generation, active.generation + 1);
      assert.match(stopped.wait_reason, /execution configuration changed/);
      assert.equal(stopped.current_receipt_id, active.current_receipt_id);
      const [receipt] = await sql`SELECT status,response FROM receipts WHERE id=${stopped.current_receipt_id}`;
      assert.equal(receipt.status, "received");
      assert.ok(receipt.response);
      assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length, 0);
      assert.equal((await sql`SELECT id FROM articles WHERE identity_key=${`douyin:aweme_id:${staleWork.AwemeInfo.AwemeId}`}`).length, 0);
      const [edited] = await sql`SELECT active_run_id,execution_version,edit_version,progress,config FROM collection_subscriptions WHERE id=${subscription.id}`;
      assert.equal(edited.active_run_id, null);
      assert.equal(edited.execution_version, run.input.members[0]!.executionVersion + 1);
      assert.equal(edited.edit_version, 2);
      assert.deepEqual(edited.progress, {});
      assert.equal(edited.config.parameters.keyword, "Changed execution");
      await assert.rejects(sql.begin(tx => resumeRun(tx, {runId: run.id, stepVersion: stopped.step_version, generation: stopped.generation})), /No eligible subscription members/);
      assert.deepEqual(await step(run.id), {skipped: true});
      assert.equal(stub.calls.length, 1);
      const fresh = await startPlatformSubscription(subscription.id, "bounded-agentkey", tag());
      assert.notEqual(fresh.id, run.id);
      assert.equal((await finish(fresh.id)).status, "completed");
      assert.equal(stub.calls.length, 2);
      assert.equal(stub.calls[1]!.params.keyword, "Changed execution");
      await closedSubscription(subscription.id, 1, 0, "upstream-no-more");
    } finally {
      release.open();
      await pending;
    }
  }, async index => {if (index === 0) {started.open(); await release.promise;}});
});

test("current AgentKey execution surfaces a deterministic identity conflict for review instead of treating it as a stale delivery", async () => {
  const item = work();
  const aweme = item.AwemeInfo;

  const left = `agentkey-conflict-left-${tag()}`, right = `agentkey-conflict-right-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode,enabled) VALUES
    (${left},'AgentKey conflict left','external',${sql.json({platform:"douyin"})},'isolated',true),
    (${right},'AgentKey conflict right','external',${sql.json({platform:"douyin"})},'isolated',true)`;
  try {
    const {newArticleId}=await import('@aihot/backend/lib/ids');
    const {identityKeyForUrl}=await import('@aihot/backend/lib/url');
    await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES
      (${newArticleId()},${left},${identityKeyForUrl(`https://www.douyin.com/video/${aweme.AwemeId}`)!},${`https://www.douyin.com/video/${aweme.AwemeId}`},'First historical work',now(),now()),
      (${newArticleId()},${right},${identityKeyForUrl(`https://www.iesdouyin.com/share/video/${aweme.AwemeId}`)!},${`https://www.iesdouyin.com/share/video/${aweme.AwemeId}`},'Second historical work',now(),now())`;
    await agentKeyFixture([[item]], async ({create, stub}) => {
      const {run} = await create();
      const outcome = await step(run.id);
      if ("skipped" in outcome) assert.fail("A current deterministic conflict must not be reported as a stale delivery");
      assert.equal(outcome.runId, run.id);
      assert.match(outcome.error ?? "", /Douyin native work already belongs to different articles/);
      const current = await runOf(run.id);
      assert.equal(stub.calls.length, 1);
      assert.equal(current.status, "needs_review");
      assert.match(current.wait_reason, /different articles/);
      assert.ok(current.current_receipt_id);
      const [receipt] = await sql`SELECT status,response FROM receipts WHERE id=${current.current_receipt_id}`;
      assert.equal(receipt.status, "received");
      assert.ok(receipt.response);
      assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length, 0);
    });
  } finally {
    await sql`DELETE FROM articles WHERE source_id IN ${sql([left, right])}`;
    await sql`DELETE FROM sources WHERE id IN ${sql([left, right])}`;
  }
});

test("platform scheduling explicitly rejects an unknown persisted provider even with both provider valves closed", async () => {
  const previous = {COLLECT_ENABLED: process.env.COLLECT_ENABLED, REDFOX_CALLS_ENABLED: process.env.REDFOX_CALLS_ENABLED, AGENTKEY_CALLS_ENABLED: process.env.AGENTKEY_CALLS_ENABLED};
  const subscription = await createPlatformSubscription({sourceId:await selectedSource(),...collectionConfig(), provider: "redfox", enabled: false}, "unknown-provider", tag());
  try {
    Object.assign(process.env, {COLLECT_ENABLED: "true", REDFOX_CALLS_ENABLED: "false", AGENTKEY_CALLS_ENABLED: "false"});
    await sql`UPDATE collection_subscriptions SET provider='future-provider',enabled=true,next_run_at='1900-01-01' WHERE id=${subscription.id}`;
    await assert.rejects(schedulePlatformSubscriptions(), new RegExp(`Unsupported collection provider: future-provider \\(subscription ${subscription.id}\\)`));
    const [saved] = await sql`SELECT active_run_id,provider FROM collection_subscriptions WHERE id=${subscription.id}`;
    assert.deepEqual(saved, {active_run_id: null, provider: "future-provider"});
    assert.equal((await sql`SELECT id FROM operation_runs WHERE subscription_id=${subscription.id}`).length, 0);
  } finally {
    await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id=${subscription.id}`;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("source-backed scheduling only enqueues implemented providers and retains the independent Redfox valve", async () => {
  const previous = {COLLECT_ENABLED: process.env.COLLECT_ENABLED, REDFOX_CALLS_ENABLED: process.env.REDFOX_CALLS_ENABLED, AGENTKEY_CALLS_ENABLED: process.env.AGENTKEY_CALLS_ENABLED};
  const ids: number[] = [], sourceIds: string[] = [];
  try {
    Object.assign(process.env, {COLLECT_ENABLED: "true", REDFOX_CALLS_ENABLED: "false", AGENTKEY_CALLS_ENABLED: "true"});
    const fixtures: Array<{provider: string; kind: "x_search" | "mp_account"; operationKey: string}> = [
      {provider: "agentkey", kind: "x_search", operationKey: "x.search"},
      {provider: "future-provider", kind: "x_search", operationKey: "x.search"},
      {provider: "agentkey", kind: "mp_account", operationKey: "mp.history"},
      {provider: "future-provider", kind: "mp_account", operationKey: "mp.history"},
      {provider: "socialdata", kind: "x_search", operationKey: "x.search"},
      {provider: "dajiala", kind: "mp_account", operationKey: "mp.history"},
      {provider: "redfox", kind: "x_search", operationKey: "redfox.x.timeline"},
    ];
    for (const fixture of fixtures) {
      const sourceId = `scheduler-${tag()}`;
      sourceIds.push(sourceId);
      const config = fixture.kind === "x_search" ? {query: fixture.provider === "socialdata" ? "from:synthetic -filter:replies" : "from:synthetic"} : {ghid: sourceId};
      await sql`INSERT INTO sources(id,name,kind,config,participation_mode,enabled) VALUES (${sourceId},'Synthetic scheduler',${fixture.kind},${sql.json(config)},'isolated',true)`;
      if (fixture.provider === "redfox") await sql`INSERT INTO source_account_bindings(source_id,platform,id_kind,id_value,evidence) VALUES (${sourceId},'x','user_id',${`rest-${tag()}`},${sql.json({kind: "test", reference: sourceId})})`;
      ids.push(await sql.begin(tx => createSubscription(tx, {sourceId, provider: fixture.provider,
        platform: fixture.kind === "x_search" ? "x" : "wechat", operationKey: fixture.operationKey,
        contractVersion: 1, config, enabled: true, intervalMinutes: 30})));
      if (fixture.provider === "socialdata") await sql`UPDATE collection_subscriptions SET progress='{"lastTweetId":"123"}' WHERE id=${ids.at(-1)!}`;
    }
    await scheduleNativeCollections("x_search");
    await scheduleNativeCollections("mp_account");
    const rows = await sql`SELECT provider,active_run_id FROM collection_subscriptions WHERE id IN ${sql(ids)} ORDER BY id`;
    assert.ok(rows.filter(row => ["agentkey", "future-provider", "redfox"].includes(row.provider)).every(row => row.active_run_id === null));
    for (const provider of ["socialdata", "dajiala"]) {
      const run = await runOf(rows.find(row => row.provider === provider)!.active_run_id);
      assert.equal(run.provider, provider);
      assert.equal(run.operation_key, provider === "socialdata" ? "x.search" : "mp.history");
    }
    process.env.REDFOX_CALLS_ENABLED = "true";
    await scheduleNativeCollections("x_search");
    const [scheduled] = await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${ids.at(-1)!}`;
    const run = await runOf(scheduled.active_run_id);
    assert.equal(run.provider, "redfox");
    assert.equal(run.operation_key, "redfox.x.timeline");
    const [unsupportedRuns] = await sql`SELECT count(*)::int AS count FROM operation_runs WHERE subscription_id IN ${sql(ids.slice(0, 4))}`;
    assert.equal(unsupportedRuns.count, 0);
  } finally {
    if (ids.length) {
      await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id IN ${sql(ids)}`;
      for (const run of await sql`SELECT id,step_version,generation FROM operation_runs WHERE subscription_id IN ${sql(ids)} AND status NOT IN ('completed','failed')`) {
        await sql.begin(tx => abandonRun(tx, {runId: run.id, stepVersion: run.step_version, generation: run.generation}, "Synthetic fixture cleanup"));
      }
    }
    if (sourceIds.length) await sql`UPDATE sources SET enabled=false WHERE id IN ${sql(sourceIds)}`;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("confirmed Redfox and AgentKey Douyin imports share one stable work identity and preserve source permissions", async () => {
  const item = work();
  const aweme = item.AwemeInfo;
  await agentKeyFixture([[item]], async ({stub}) => {
    const redfox = await httpStub(() => ({code: 2000, data: {list: [{videoId: aweme.AwemeId,
      content: aweme.Desc, opusUrl: `https://www.douyin.com/video/${aweme.AwemeId}`, authorUid: aweme.Author.Uid, authorSecUid: aweme.Author.SecUid}]}}));
    const services = ["redfox.query", "agentkey.query"];
    const budgets = await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ${sql(services)}`;
    assert.equal(budgets.length, 2);
    const previous = {REDFOX_CALLS_ENABLED: process.env.REDFOX_CALLS_ENABLED, REDFOX_API_KEY: process.env.REDFOX_API_KEY, REDFOX_TEST_BASE_URL: process.env.REDFOX_TEST_BASE_URL};
    const allowPrivate = backendConfig.allowPrivateNetworkFetch;
    try {
      Object.assign(process.env, {REDFOX_CALLS_ENABLED: "true", REDFOX_API_KEY: "test-redfox-identity-key", REDFOX_TEST_BASE_URL: redfox.url});
      backendConfig.allowPrivateNetworkFetch = true;
      await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ${sql(services)}`;
      const direct = await createSynchronousQuery({operationId: "OWIBYU1V", parameters: {keyword: "Cross-provider identity"}}, "cross-provider", tag());
      assert.equal((await finish(direct.id)).status, "completed");
      const [directResult] = await sql`SELECT * FROM operation_results WHERE run_id=${direct.id} AND kind='douyin_work'`;
      const crossSource=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${crossSource},'Cross provider chosen source','external','isolated')`;
      const first = await importDouyinResult(directResult!.id, {sourceId:crossSource,reason: "Synthetic confirmed Redfox import"}, "cross-provider", tag());
      assert.ok(first?.articleId);
      const [permissions] = await sql`SELECT kind,participation_mode,site_fulltext,syndicate_fulltext,enabled FROM sources WHERE id=${first.sourceId}`;
      assert.deepEqual(permissions, {kind: "external", participation_mode: "isolated", site_fulltext: false, syndicate_fulltext: false, enabled: true});

      const gateway = await createAgentKeyQuery({provider: "agentkey", operationId: "OWIBYU1V", parameters: {keyword: "Cross-provider identity"}}, "cross-provider", tag());
      assert.equal((await finish(gateway.id)).status, "completed");
      const [gatewayResult] = await sql`SELECT * FROM operation_results WHERE run_id=${gateway.id} AND kind='douyin_work'`;
      const second = await importDouyinResult(gatewayResult!.id, {sourceId:crossSource,reason: "Synthetic confirmed AgentKey import"}, "cross-provider", tag());
      assert.ok(second);
      assert.equal(second.sourceId, first.sourceId);
      assert.equal(second.articleId, first.articleId);
      const articles = await sql`SELECT id,identity_key,source_id FROM articles WHERE identity_key=${`douyin:aweme_id:${aweme.AwemeId}`} OR source_id=${first.sourceId}`;
      assert.deepEqual([...articles], [{id: first.articleId, identity_key: `douyin:aweme_id:${aweme.AwemeId}`, source_id: first.sourceId}]);
      const bindings = await sql`SELECT source_id,id_kind,id_value FROM source_account_bindings WHERE platform='douyin' AND source_id=${first.sourceId} ORDER BY id_kind`;
      assert.deepEqual([...bindings], []);
      const [after] = await sql`SELECT kind,participation_mode,site_fulltext,syndicate_fulltext,enabled FROM sources WHERE id=${first.sourceId}`;
      assert.deepEqual(after, permissions);
      const results = await sql`SELECT r.provider,z.source_id,z.article_id,p.status,p.service,p.model FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id IN ${sql([directResult!.id, gatewayResult!.id])} ORDER BY z.id`;
      assert.equal(results.length, 2);
      assert.deepEqual(results.map(row => [row.provider, row.service, row.model]), [["redfox", "redfox.query", "OWIBYU1V"], ["agentkey", "agentkey.query", douyinSearchRoute.tool]]);
      assert.ok(results.every(row => row.status === "completed" && row.source_id === first.sourceId && row.article_id === first.articleId));
      const [summary] = await sql`SELECT receipt_id FROM operation_results WHERE id=${gatewayResult!.data.querySummaryId} AND run_id=${gateway.id} AND kind='query_summary'`;
      assert.equal(summary.receipt_id, gatewayResult!.receipt_id);
      assert.equal(redfox.hits(), 1);
      assert.equal(stub.calls.length, 1);
    } finally {
      for (const budget of budgets) await sql`UPDATE budgets SET per_minute=${budget.per_minute},per_hour=${budget.per_hour},per_day=${budget.per_day} WHERE service=${budget.service}`;
      backendConfig.allowPrivateNetworkFetch = allowPrivate;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await redfox.close();
    }
  });
});

test("explicit Redfox to AgentKey switch preserves the subscription and history, fences the old run and executes the new provider", async () => {
  const item = work();
  await agentKeyFixture([[item]], async ({stub}) => {
    const config = {...collectionConfig({pages: 2, items: 7, details: 0}), provider: "redfox", intervalMinutes: 37};
    const subscription = await createPlatformSubscription({...config,sourceId:await selectedSource()}, "switch-test", tag());
    try {
      const old = await startPlatformSubscription(subscription.id, "switch-test", tag());
      const progress = {oldProviderCursor: "not-portable", pages: 2};
      await sql`UPDATE collection_subscriptions SET progress=${sql.json(progress)} WHERE id=${subscription.id}`;
      const [before] = await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`;
      process.env.AGENTKEY_CALLS_ENABLED = "false";
      const preflight = await preflightPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey"});
      assert.equal(preflight!.supported, true);
      assert.deepEqual(preflight!.checks.map(check => check.key), ["operation", "parameters", "details", "credentials", "execution", "videoDownload"]);
      assert.equal(stub.calls.length, 0);
      assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`)[0], before, "preflight is read only");
      const switched = await switchPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey", reason: "Synthetic explicit provider choice"}, "switch-test");
      assert.equal(switched!.id, subscription.id);
      assert.equal(switched!.editVersion, 2);
      assert.equal(switched!.executionVersion, before.execution_version + 1);
      assert.equal(switched!.config.provider, "agentkey");
      assert.deepEqual(switched!.config.parameters, config.parameters);
      const [after] = await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`;
      assert.equal(after.provider, "agentkey");
      assert.equal(after.operation_key, douyinSearchRoute.operationKey);
      assert.equal(after.active_run_id, null);
      assert.deepEqual(after.progress, {});
      assert.equal(after.enabled, before.enabled);
      assert.equal(after.interval_minutes, before.interval_minutes);
      assert.deepEqual(after.limits, before.limits);
      assert.ok(after.next_run_at.getTime() > Date.now() + 36 * 60_000);
      const stopped = await runOf(old.id);
      assert.equal(stopped.status, "stopped");
      assert.equal(stopped.provider, "redfox");
      assert.equal(stopped.generation, old.generation + 1);
      assert.deepEqual(stopped.input, old.input);
      await assert.rejects(sql.begin(tx => resumeRun(tx, {runId: old.id, stepVersion: stopped.step_version, generation: stopped.generation})), /No eligible subscription members/);
      assert.deepEqual(await step(old.id), {skipped: true});
      assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${old.id}`).length, 0);
      const [audit] = await sql`SELECT reason,before,after FROM audit_log WHERE action='subscription.switch_provider' AND subject=${`subscription:${subscription.id}`}`;
      assert.equal(audit.reason, "Synthetic explicit provider choice");
      assert.equal(audit.before.provider, "redfox");
      assert.deepEqual(audit.before.config, before.config);
      assert.deepEqual(audit.before.progress, progress);
      assert.equal(audit.after.provider, "agentkey");
      process.env.AGENTKEY_CALLS_ENABLED = "true";
      const fresh = await startPlatformSubscription(subscription.id, "switch-test", tag());
      assert.equal(fresh.provider, "agentkey");
      assert.equal((await finish(fresh.id)).status, "completed");
      assert.equal(stub.calls.length, 1);
      const [result] = await sql`SELECT article_id FROM operation_results WHERE run_id=${fresh.id} AND kind='douyin_work'`;
      assert.ok(result.article_id);
      assert.equal((await sql`SELECT id FROM operation_runs WHERE subscription_id=${subscription.id}`).length, 2);
    } finally {
      await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id=${subscription.id}`;
      for (const run of await sql`SELECT id,step_version,generation FROM operation_runs WHERE subscription_id=${subscription.id} AND status NOT IN ('completed','failed')`) {
        await sql.begin(tx => abandonRun(tx, {runId: run.id, stepVersion: run.step_version, generation: run.generation}, "Synthetic switch cleanup"));
      }
    }
  });
});

test("AgentKey to Redfox switch keeps a disabled subscription disabled and starts from the same keyword", async () => {
  const previous = {AGENTKEY_API_KEY: process.env.AGENTKEY_API_KEY, REDFOX_API_KEY: process.env.REDFOX_API_KEY};
  const config = {...collectionConfig(), enabled: false};
  const subscription = await createPlatformSubscription({...config,sourceId:await selectedSource()}, "reverse-switch", tag());
  try {
    process.env.REDFOX_API_KEY = "test-redfox-switch-key";
    process.env.AGENTKEY_API_KEY = "test-agentkey-switch-key";
    const preflight = await preflightPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "redfox"});
    assert.equal(preflight!.supported, true);
    const switched = await switchPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "redfox", reason: "Synthetic reverse choice"}, "reverse-switch");
    assert.equal(switched!.config.provider, "redfox");
    assert.deepEqual(switched!.config.parameters, config.parameters);
    const [after] = await sql`SELECT provider,operation_key,enabled,next_run_at,progress FROM collection_subscriptions WHERE id=${subscription.id}`;
    assert.deepEqual(after, {provider: "redfox", operation_key: "redfox.platform.collection", enabled: false, next_run_at: null, progress: {}});
  } finally {
    for (const [key, value] of Object.entries(previous)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
  }
});

test("provider switch preflight blocks untranslatable parameters, details, missing credentials and unopened operations without changing the subscription", async () => {
  const previous = process.env.AGENTKEY_API_KEY;
  process.env.AGENTKEY_API_KEY = "test-agentkey-preflight-key";
  const fixtures = [
    {parameters: {keyword: "exact", exactMatch: false}},
    {parameters: {keyword: "dates", startDate: "2026-01-01"}},
    {parameters: {keyword: "page", pageNum: 1}},
    {enrichDetails: true, detailOperationId: "FK67XDVQ"},
    {operationId: "774OBKK0"},
  ];
  try {
    for (const patch of fixtures) {
      const config = {...collectionConfig(), provider: "redfox", enabled: false, ...patch};
      const subscription = await createPlatformSubscription({...config,sourceId:await selectedSource()}, "blocked-switch", tag());
      const [before] = await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`;
      const result = await preflightPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey"});
      assert.equal(result!.supported, false);
      const key = patch.operationId ? "operation" : patch.enrichDetails ? "details" : "parameters";
      assert.equal(result!.checks.find(check => check.key === key)!.conclusion, "unsupported");
      await assert.rejects(switchPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey", reason: "Must remain blocked"}, "blocked-switch"), /承接|仅开放/);
      assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`)[0], before);
    }
    const subscription = await createPlatformSubscription({sourceId:await selectedSource(),...collectionConfig(), provider: "redfox", enabled: false}, "missing-switch-key", tag());
    delete process.env.AGENTKEY_API_KEY;
    const result = await preflightPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey"});
    assert.equal(result!.supported, false);
    assert.equal(result!.checks.find(check => check.key === "credentials")!.conclusion, "unavailable");
    await assert.rejects(switchPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey", reason: "Missing local credential"}, "missing-switch-key"), /AGENTKEY_API_KEY/);
    await assert.rejects(preflightPlatformSubscriptionProvider(subscription.id, {editVersion: 1, targetProvider: "agentkey", config: {parameters: {keyword: "injected"}}}));
  } finally {if (previous === undefined) delete process.env.AGENTKEY_API_KEY; else process.env.AGENTKEY_API_KEY = previous;}
});

test("provider switch API rejects stale versions and arbitrary config, rechecks credentials and keeps ordinary PATCH provider-locked", async () => {
  const {buildApp} = await import("../apps/api/src/app.ts"), app = await buildApp();
  const previous = {devAdmin: backendConfig.devAdmin, AGENTKEY_API_KEY: process.env.AGENTKEY_API_KEY};
  backendConfig.devAdmin = {displayName: "Synthetic provider switch"};
  process.env.AGENTKEY_API_KEY = "test-agentkey-api-switch-key";
  const config = {...collectionConfig(), provider: "redfox", enabled: false};
  const subscription = await createPlatformSubscription({...config,sourceId:await selectedSource()}, "switch-api", tag());
  const path = `/api/admin/redfox/collections/${subscription.id}`, headers = {"x-csrf-token": "dev"};
  try {
    const request = {editVersion: 1, targetProvider: "agentkey"};
    const preview = await app.inject({method: "POST", url: `${path}/provider/preflight`, headers, payload: request});
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().supported, true);
    const [before] = await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`;
    assert.equal((await app.inject({method: "POST", url: `${path}/provider/switch`, headers, payload: {...request, editVersion: 2, reason: "Stale choice"}})).statusCode, 409);
    assert.equal((await app.inject({method: "POST", url: `${path}/provider/switch`, headers, payload: {...request, reason: "Injected choice", config: {parameters: {keyword: "injected"}}}})).statusCode, 400);
    assert.equal((await app.inject({method: "PATCH", url: path, headers, payload: {editVersion: 1, config: {...config, provider: "agentkey"}}})).statusCode, 409);
    delete process.env.AGENTKEY_API_KEY;
    assert.equal((await app.inject({method: "POST", url: `${path}/provider/switch`, headers, payload: {...request, reason: "Credential removed after preview"}})).statusCode, 422);
    assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${subscription.id}`)[0], before);
    process.env.AGENTKEY_API_KEY = "test-agentkey-api-switch-key";
    const switched = await app.inject({method: "POST", url: `${path}/provider/switch`, headers, payload: {...request, reason: "Explicit API choice"}});
    assert.equal(switched.statusCode, 200, switched.body);
    assert.equal(switched.json().config.provider, "agentkey");
    assert.equal(switched.json().editVersion, 2);
    assert.equal((await app.inject({method: "POST", url: `${path}/provider/preflight`, headers, payload: request})).statusCode, 409);
  } finally {
    backendConfig.devAdmin = previous.devAdmin;
    if (previous.AGENTKEY_API_KEY === undefined) delete process.env.AGENTKEY_API_KEY; else process.env.AGENTKEY_API_KEY = previous.AGENTKEY_API_KEY;
    await app.close();
  }
});


for (const pagination of [undefined, {}, {hasMore: "false"}, {hasMore: 2}, {hasMore: null}]) {
  test(`AgentKey requires review for untrustworthy pagination ${JSON.stringify(pagination)}`, async () => {
    await agentKeyFixture([{items: [work()], ...(pagination ? {pagination} : {})}], async ({create, stub}) => {
      const {subscription, run} = await create();
      const [before] = await sql`SELECT next_run_at FROM collection_subscriptions WHERE id=${subscription.id}`;
      assert.equal((await finish(run.id)).status, "needs_review");
      const [summary] = await sql`SELECT data,receipt_id FROM operation_results WHERE run_id=${run.id} AND kind='query_summary'`;
      assert.equal(summary.data.stopReason, "invalid-pagination-needs-review");
      assert.equal((await sql`SELECT status FROM receipts WHERE id=${summary.receipt_id}`)[0].status, "received");
      const [held] = await sql`SELECT active_run_id,next_run_at FROM collection_subscriptions WHERE id=${subscription.id}`;
      assert.equal(held.active_run_id, run.id);
      assert.deepEqual(held.next_run_at, before.next_run_at);
      assert.equal(stub.calls.length, 1);
    });
  });
}

for (const enabledProvider of ["agentkey", "redfox"] as const) {
  test(`closed providers do not starve ${enabledProvider} behind the scheduling limit`, async () => {
    const previous = {COLLECT_ENABLED: process.env.COLLECT_ENABLED, AGENTKEY_CALLS_ENABLED: process.env.AGENTKEY_CALLS_ENABLED, REDFOX_CALLS_ENABLED: process.env.REDFOX_CALLS_ENABLED};
    const ids: number[] = [];
    try {
      process.env.COLLECT_ENABLED = "true";
      process.env.AGENTKEY_CALLS_ENABLED = String(enabledProvider === "agentkey");
      process.env.REDFOX_CALLS_ENABLED = String(enabledProvider === "redfox");
      for (let i = 0; i < 101; i++) {
        const provider = i === 100 ? enabledProvider : enabledProvider === "agentkey" ? "redfox" : "agentkey";
        const sub = await createPlatformSubscription({sourceId:await selectedSource(),...collectionConfig(), provider, enabled: false}, "starvation-test", tag());
        ids.push(sub.id);
        await sql`UPDATE collection_subscriptions SET enabled=true,next_run_at=now()-interval '2 days'+${i}*interval '1 second' WHERE id=${sub.id}`;
      }
      await schedulePlatformSubscriptions();
      const rows = await sql`SELECT id,active_run_id FROM collection_subscriptions WHERE id IN ${sql(ids)}`;
      assert.ok(rows.find(row => row.id === ids[100])!.active_run_id);
      assert.ok(rows.filter(row => row.id !== ids[100]).every(row => row.active_run_id === null));
    } finally {
      if (ids.length) await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id IN ${sql(ids)}`;
      for (const [key,value] of Object.entries(previous)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
    }
  });
}


for (const limit of ["page", "item"] as const) {
  test(`AgentKey ${limit} limit completes without requiring unused pagination`, async () => {
    await agentKeyFixture([{items: [work()]}], async ({create, stub}) => {
      const {subscription, run} = await create(limit === "page" ? {pages: 1, items: 10, details: 0} : {pages: 3, items: 1, details: 0});
      assert.equal((await finish(run.id)).status, "completed");
      await closedSubscription(subscription.id, 1, 1, `${limit}-limit`);
      assert.equal(stub.calls.length, 1);
    });
  });
}

test("account subscription retains page through bounded detail, resumes list and imports original historical results",async()=>{
  const {douyinAccountPostsRoute:list,douyinDetailRoute:detail}=await import("@aihot/backend/providers/agentkey/douyin-contract");
  const note=String(Date.now()),uid=`91${note}`,sec=`synthetic-${note}`;
  const work=(i:number)=>({aweme_id:`92${note}${i}`,desc:`synthetic ${i}`,create_time:1729400000,author:{uid,sec_uid:sec,nickname:"Synthetic APP"}});
  const stub=await mcpStub([{appBody:{status_code:0,uid,sec_uid:sec,aweme_list:[work(0),work(1)],has_more:1,max_cursor:1730437046000}},
    {appBody:{aweme_detail:work(0)}},{appBody:{status_code:0,aweme_list:[work(2)],has_more:0}}]);
  const previous=Object.fromEntries(["AGENTKEY_CALLS_ENABLED","AGENTKEY_API_KEY","AGENTKEY_MCP_URL","COLLECT_ENABLED"].map(key=>[key,process.env[key]]));
  const [budget]=await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='agentkey.collect'`;
  let id:number|undefined;
  try{
    Object.assign(process.env,{AGENTKEY_CALLS_ENABLED:"true",AGENTKEY_API_KEY:"test-app-collection",AGENTKEY_MCP_URL:stub.url,COLLECT_ENABLED:"true"});
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='agentkey.collect'`;
    const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:tag(),provider:"agentkey",operationId:"QEQLCKD6",parameters:{sec_user_id:sec},enabled:true,enrichDetails:true,detailOperationId:"FK67XDVQ",limits:{pages:3,items:10,details:1}},"app-integration",tag());id=sub.id;
    await schedulePlatformSubscriptions();
    const [s]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`;
    const step=async()=>{const [run]=await sql`SELECT * FROM operation_runs WHERE id=${s.active_run_id}`;await executeOperationStep(run.id,run.step_version,run.job_id);return (await sql`SELECT * FROM operation_runs WHERE id=${run.id}`)[0];};
    const first=await step();assert.equal(first.status,"active");assert.equal(first.operation_key,list.operationKey);assert.equal(first.step_key,detail.stepKey);assert.equal(first.progress.retainedReceiptIds.length,1);
    const [sourceResult]=await sql`SELECT id,article_id,source_id,receipt_id FROM operation_results WHERE run_id=${first.id} AND kind='douyin_work' ORDER BY id LIMIT 1`;
    await importDouyinResult(sourceResult.id,{reason:"historical list while detail active"},"app-integration",tag());
    // Simulate a process interruption after raw detail receipt persistence and before business commit.
    const {paidRequest}=await import("@aihot/backend/providers/receipts");
    const {receiptOptions}=await import("@aihot/backend/providers/operations/store");
    const {agentKeyTransport}=await import("@aihot/backend/providers/agentkey/transport");
    const transport=agentKeyTransport(),params=first.progress.parameters;
    await paidRequest({service:"agentkey.collect",purpose:detail.operationKey,model:detail.tool,subject:`operation:${first.id}`,
      identity:{runId:first.id,stepVersion:first.step_version,endpoint:transport.endpoint,contractVersion:1,tool:detail.tool,params},
      requestSummary:{tool:detail.tool,endpoint:transport.endpoint,params}},()=>transport.execute(params,detail),receiptOptions({runId:first.id,stepVersion:first.step_version,generation:first.generation}));
    process.env.AGENTKEY_CALLS_ENABLED="false";process.env.COLLECT_ENABLED="false";
    const second=await step();assert.equal(stub.calls.length,2,"received detail consumed locally without repurchase");
    process.env.AGENTKEY_CALLS_ENABLED="true";process.env.COLLECT_ENABLED="true";
    assert.equal(second.status,"active");assert.equal(second.step_key,list.stepKey);assert.equal(second.progress.parameters.max_cursor,1730437046000);
    const third=await step();assert.equal(third.status,"completed");assert.equal(stub.calls.length,3);
    assert.deepEqual(stub.calls.map(c=>c.tool),[list.tool,detail.tool,list.tool]);assert.deepEqual(stub.calls[1]!.params,{aweme_id:work(0).aweme_id});
    const results=await sql`SELECT * FROM operation_results WHERE run_id=${first.id} AND kind='douyin_work' ORDER BY id`;
    assert.equal(results.length,4);assert.ok(results.every(r=>r.article_id));assert.equal(results[0]!.article_id,results[2]!.article_id);
    const [receipts]=await sql`SELECT count(*)::int AS n FROM receipts WHERE subject=${`operation:${first.id}`} AND status='completed'`;assert.equal(receipts.n,3);
    const [closed]=await sql`SELECT active_run_id,progress FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(closed.active_run_id,null);assert.equal(closed.progress.details,1);assert.equal(closed.progress.pages,2);
    await importDouyinResult(results[0]!.id,{reason:"historical list after completion"},"app-integration",tag());
    await sql`UPDATE operation_results SET data=jsonb_set(data,'{title}','"forged"') WHERE id=${results[0]!.id}`;
    await assert.rejects(importDouyinResult(results[0]!.id,{reason:"reject forged historical result"},"app-integration",tag()),/differs/);
  }finally{
    if(id)await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id=${id}`;
    await sql`UPDATE budgets SET per_minute=${budget.per_minute},per_hour=${budget.per_hour},per_day=${budget.per_day} WHERE service='agentkey.collect'`;
    for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await stub.close();
  }
});

test("account collection imports without author and chosen detail keeps discovery time",async()=>{
  const id=`93${Date.now()}`,sec=`synthetic-${id}`;
  const partial={aweme_id:id,desc:"list description"};
  const complete={...partial,create_time:1729400000,author:{uid:`94${id}`,sec_uid:sec,nickname:"Synthetic recovered author"}};
  await agentKeyFixture([{appBody:{status_code:0,aweme_list:[partial],has_more:0}},{appBody:{aweme_detail:complete}}],async({create,stub})=>{
    const {run}=await create({pages:1,items:10,details:1},{operationId:"QEQLCKD6",parameters:{sec_user_id:sec},enrichDetails:true,detailOperationId:"FK67XDVQ"});
    await step(run.id);
    const [original]=await sql`SELECT z.*,p.received_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.run_id=${run.id} AND z.kind='douyin_work'`;
    assert.ok(original.article_id);assert.equal(original.data.pendingReason,undefined);
    assert.equal((await finish(run.id)).status,"completed");assert.equal(stub.calls.length,2);
    const [detail]=await sql`SELECT z.article_id,a.discovered_at FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id} AND z.kind='douyin_work'`;
    assert.ok(detail.article_id);assert.equal(detail.discovered_at.toISOString(),original.received_at.toISOString());
  });
});

test("account pagination retains invalid continuation evidence but ignores unused continuation",async()=>{
  for(const pages of [1,2])await agentKeyFixture([{appBody:{status_code:0,aweme_list:[],has_more:1}}],async({create,stub})=>{
    const {run,subscription}=await create({pages,items:10,details:0},{operationId:"QEQLCKD6",parameters:{sec_user_id:"synthetic-empty"}});
    const done=await finish(run.id);assert.equal(done.status,pages===1?"completed":"needs_review");assert.equal(stub.calls.length,1);
    const [summary]=await sql`SELECT z.data,p.status FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.run_id=${run.id} AND kind='query_summary'`;
    assert.equal(summary.data.count,0);assert.equal(summary.status,pages===1?"completed":"received");
    const [sub]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${subscription.id}`;assert.equal(sub.active_run_id,pages===1?null:run.id);
  });
});

test("account switch maps only supported identity and sort, fences old run and preserves rejected configs",async()=>{
  await agentKeyFixture([{appBody:{status_code:0,aweme_list:[],has_more:0}}],async({create,stub})=>{
    const previous=process.env.REDFOX_API_KEY;process.env.REDFOX_API_KEY="test-switch-redfox";
    try{
      const {run,subscription}=await create({pages:2,items:7,details:0},{provider:"redfox",operationId:"QEQLCKD6",parameters:{secUserId:"synthetic-switch",sortType:"_4"}});
      const preflight=await preflightPlatformSubscriptionProvider(subscription.id,{editVersion:1,targetProvider:"agentkey"});assert.equal(preflight?.supported,true);assert.equal(stub.calls.length,0);
      const switched=await switchPlatformSubscriptionProvider(subscription.id,{editVersion:1,targetProvider:"agentkey",reason:"Synthetic account switch"},"account-switch");
      assert.deepEqual(switched?.config.parameters,{sec_user_id:"synthetic-switch",max_cursor:0,count:20,sort_type:1,channel:"normal"});
      assert.equal((await runOf(run.id)).status,"stopped");assert.deepEqual(await step(run.id),{skipped:true});
      const fresh=await startPlatformSubscription(subscription.id,"account-switch",tag());assert.equal((await finish(fresh.id)).status,"completed");assert.equal(stub.calls[0]?.params.sort_type,1);
      const back=await switchPlatformSubscriptionProvider(subscription.id,{editVersion:2,targetProvider:"redfox",reason:"Synthetic switch back"},"account-switch");assert.deepEqual(back?.config.parameters,{secUserId:"synthetic-switch",sortType:"_4"});
      for(const parameters of [{accountId:"display-only"},{secUserId:"synthetic-switch",sortType:"_0"},{secUserId:"synthetic-switch",sortType:"default"},{secUserId:"synthetic-switch",offset:20}]){
        await sql`UPDATE collection_subscriptions SET config=jsonb_set(config,'{parameters}',${sql.json(parameters)}) WHERE id=${subscription.id}`;
        const [before]=await sql`SELECT config FROM collection_subscriptions WHERE id=${subscription.id}`;
        assert.equal((await preflightPlatformSubscriptionProvider(subscription.id,{editVersion:3,targetProvider:"agentkey"}))?.supported,false);
        await assert.rejects(switchPlatformSubscriptionProvider(subscription.id,{editVersion:3,targetProvider:"agentkey",reason:"Unsupported config"},"account-switch"));
        assert.deepEqual((await sql`SELECT config FROM collection_subscriptions WHERE id=${subscription.id}`)[0],before);
      }
      await sql`UPDATE collection_subscriptions SET config=jsonb_set(config,'{parameters}',${sql.json({secUserId:"synthetic-switch"})}) WHERE id=${subscription.id}`;
      assert.equal((await preflightPlatformSubscriptionProvider(subscription.id,{editVersion:3,targetProvider:"agentkey"}))?.supported,true,"unused optional sort permits disclosed latest default");
    }finally{if(previous===undefined)delete process.env.REDFOX_API_KEY;else process.env.REDFOX_API_KEY=previous;}
  });
});

test("account provider switch fences a late paid response without discarding receipt usage",async()=>{
  const started=gate(),release=gate(),id=`95${Date.now()}`,sec=`synthetic-${id}`;
  await agentKeyFixture([{appBody:{status_code:0,aweme_list:[{aweme_id:id,author:{uid:id,sec_uid:sec}}],has_more:0}}],async({create,stub})=>{
    const {subscription,run}=await create({pages:1,items:10,details:0},{operationId:"QEQLCKD6",parameters:{sec_user_id:sec}});
    const previous=process.env.REDFOX_API_KEY;process.env.REDFOX_API_KEY="test-late-switch";
    let pending:ReturnType<typeof step>|undefined;
    try{
      pending=step(run.id);await started.promise;
      const active=await runOf(run.id);
      await switchPlatformSubscriptionProvider(subscription.id,{editVersion:1,targetProvider:"redfox",reason:"Synthetic in-flight switch"},"account-switch");
      release.open();assert.deepEqual(await pending,{skipped:true});
      const stopped=await runOf(run.id);assert.equal(stopped.status,"stopped");assert.equal(stopped.current_receipt_id,active.current_receipt_id);
      const [receipt]=await sql`SELECT status,response,usage FROM receipts WHERE id=${stopped.current_receipt_id}`;
      assert.equal(receipt.status,"received");assert.ok(receipt.response);assert.equal(receipt.usage.chargedCredits,0.2);
      assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
      assert.equal((await sql`SELECT id FROM articles WHERE identity_key=${`douyin:aweme_id:${id}`}`).length,0);
      assert.equal(stub.calls.length,1);
    }finally{release.open();await pending;if(previous===undefined)delete process.env.REDFOX_API_KEY;else process.env.REDFOX_API_KEY=previous;}
  },async()=>{started.open();await release.promise;});
});

test("research API exposes truthful nonschedulable variants and freezes only supported query inputs",async()=>{
  const {buildApp}=await import("../apps/api/src/app.ts"),app=await buildApp(),previous=backendConfig.devAdmin;
  backendConfig.devAdmin={displayName:"Synthetic research API"};
  const headers={"x-csrf-token":"dev","idempotency-key":tag()};
  try{
    const reply=await app.inject({method:"GET",url:"/api/admin/redfox/operations"});assert.equal(reply.statusCode,200,reply.body);
    const operations=reply.json() as Array<import("@aihot/contracts/redfox").PlatformOperationDescriptor>;
    const suggest=operations.find(o=>o.id==="douyin.suggest")!,account=operations.find(o=>o.id==="P5CHB3BZ")!;
    assert.equal(suggest.schedulableType,null);assert.deepEqual(suggest.collectionProviders?.map(p=>p.id),["agentkey"]);assert.deepEqual(suggest.fields.map(f=>f.name),["keyword"]);assert.equal(suggest.collectionPrice?.amount,0.2);assert.equal(suggest.collectionPrice?.currency,"credits");
    assert.equal(account.schedulableType,null);assert.deepEqual(account.collectionProviders?.map(p=>p.id),["redfox","agentkey"]);
    const agentkey=account.collectionProviders?.find(p=>p.id==="agentkey")!;assert.deepEqual(agentkey.fields?.map(f=>f.name),["keyword"]);assert.match(agentkey.purpose!,/不支持筛选或续页/);
    for(const operationId of ["P5CHB3BZ","douyin.suggest"]){
      const result=await app.inject({method:"POST",url:"/api/admin/redfox/queries",headers:{...headers,"idempotency-key":tag()},payload:{provider:"agentkey",operationId,parameters:{keyword:" synthetic "}}});assert.equal(result.statusCode,202,result.body);
      const run=await runOf(result.json().runId);assert.equal(run.input.mode,"query");assert.equal(run.provider,"agentkey");assert.equal(run.input.operationId,operationId);
      assert.deepEqual(run.input.parameters,operationId==="P5CHB3BZ"?{keyword:"synthetic",cursor:0,douyin_user_fans:"",douyin_user_type:"",search_id:""}:{keyword:"synthetic"});
      assert.equal((await sql`SELECT id FROM receipts WHERE subject=${`operation:${run.id}`}`).length,0);
      await sql.begin(tx=>abandonRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},"Synthetic API input check complete"));
      const collection=await app.inject({method:"POST",url:"/api/admin/redfox/collections",headers:{...headers,"idempotency-key":tag()},payload:{...collectionConfig(),provider:"agentkey",operationId}});assert.equal(collection.statusCode,400,collection.body);
    }
    for(const patch of [{cursor:1},{douyin_user_type:"1"},{search_id:"arbitrary"}]){
      const result=await app.inject({method:"POST",url:"/api/admin/redfox/queries",headers:{...headers,"idempotency-key":tag()},payload:{provider:"agentkey",operationId:"P5CHB3BZ",parameters:{keyword:"synthetic",...patch}}});assert.equal(result.statusCode,400,result.body);
    }
  }finally{backendConfig.devAdmin=previous;await app.close();}
});

const selectedSourceId=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${selectedSourceId},'Selected test source','external','isolated') ON CONFLICT(id) DO NOTHING`;return selectedSourceId;}

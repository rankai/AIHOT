import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import {
  CostCenterBusyError,
  costs,
  withCostRead,
} from "@aihot/backend/admin/costs";
import { buildApp } from "../apps/api/src/app.ts";
import { config } from "@aihot/backend/config";

const T = tag();
const start = "2035-01-01T00:00:00.000Z";
const end = "2035-02-01T00:00:00.000Z";
const base = Date.parse("2035-01-10T00:00:00.000Z");
const receiptIds: number[] = [];
const runIds: number[] = [];
const sessionIds: string[] = [];

after(closeDb);

async function receipt(service: string, purpose: string, model: string | null) {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO receipts(logical_key,service,model,purpose,status,request,response,attempts)
    VALUES (${`${service}-${T}-${randomUUID()}`},${service},${model},${purpose},'completed','{}','{}',1)
    RETURNING id`;
  receiptIds.push(row!.id);
  return row!.id;
}

async function run(actor: string, operationKey: string, input: Record<string, unknown> = {}) {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key)
    VALUES (${actor},${randomUUID()},${operationKey.startsWith("assistant") ? "assistant" : "redfox"},${operationKey},1,
      ${sql.json(input as never)},${`hash-${T}`},'completed',${operationKey})
    RETURNING id`;
  runIds.push(row!.id);
  return row!.id;
}

test("unified cost reader attributes users and skills, counts Wan once, and keeps currencies separate", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);

  const username = `cost_${T}`;
  const [user] = await sql<{ id: number }[]>`
    INSERT INTO site_users(username,display_name,password_hash)
    VALUES (${username},'成本测试用户','synthetic-password-hash')
    RETURNING id`;
  const userId = user!.id;
  const parentRunId = await run(`user:${userId}`, "assistant.turn");
  const searchRunId = await run(`user:${userId}`, "redfox.xhs.search");

  const sessionId = randomUUID();
  const turnId = randomUUID();
  const stepId = randomUUID();
  const modelReceiptId = await receipt("assistant.text", "assistant.turn", "synthetic-model");
  sessionIds.push(sessionId);
  await sql`INSERT INTO assistant_sessions(id,owner_user_id,assistant_id,assistant_name,profile_version,title,command_key,command_hash)
    VALUES (${sessionId},${userId},'creative','创作助手','v1','成本测试',${randomUUID()},${`session-${T}`})`;
  await sql`INSERT INTO assistant_turns(id,session_id,parent_operation_run_id,command_key,command_hash,snapshot)
    VALUES (${turnId},${sessionId},${parentRunId},${randomUUID()},${`turn-${T}`},'{}')`;
  await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash,receipt_id,cost_context_version)
    VALUES (${stepId},${turnId},1,1,'{}',${`step-${T}`},${modelReceiptId},1)`;
  const xhsActivation = randomUUID();
  const writingActivation = randomUUID();
  await sql`INSERT INTO assistant_activations(id,turn_id,model_step_id,identity_hash,candidate)
    VALUES
      (${xhsActivation},${turnId},${stepId},${`xhs-${T}`},${sql.json({
        skillId: "xiaohongshu",
        moduleId: "note-rewrite",
        moduleVersion: "1.0.0",
        description: "小红书笔记改写",
      } as never)}),
      (${writingActivation},${turnId},${stepId},${`writing-${T}`},${sql.json({
        skillId: "creative",
        moduleId: "general-draft",
        moduleVersion: "1.0.0",
        description: "通用草稿",
      } as never)})`;
  await sql`INSERT INTO assistant_model_step_activations(model_step_id,activation_id)
    VALUES (${stepId},${xhsActivation}),(${stepId},${writingActivation})`;
  await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,activation_id,child_run_id,state)
    VALUES (${randomUUID()},${turnId},${stepId},1,${`call-${T}`},'search_xhs_notes',
      ${sql.json({ activationId: xhsActivation } as never)},NULL,${searchRunId},'completed')`;

  await sql`INSERT INTO receipt_attempts(
      receipt_id,attempt,service,model,origin,status,usage,cost,currency,cost_basis,started_at,finished_at,
      billing_provider,operation_id,model_id,environment,operation_run_id,owner_user_id,owner_kind,price_snapshot
    ) VALUES (
      ${modelReceiptId},1,'assistant.text','synthetic-model','live','received',
      ${sql.json({ prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 } as never)},
      0.002,'CNY','estimated',${new Date(base + 3_600_000)},${new Date(base + 3_601_000)},
      'deepseek','chat.completions','synthetic-model','test',NULL,NULL,NULL,
      ${sql.json({ version: 1, state: "ready", service: "deepseek", model: "synthetic-model", currency: "CNY", perRequest: null,
        inputPerMtok: "2", cachedInputPerMtok: "0.5", outputPerMtok: "3", sourceUrl: null, verifiedOn: "2035-01-01",
        selectedAt: "2035-01-10T01:00:00.000Z" } as never)}
    )`;

  const searchReceiptId = await receipt("redfox.xhs.search", "redfox.search", "XHS_SEARCH");
  await sql`INSERT INTO receipt_attempts(
      receipt_id,attempt,service,model,origin,status,usage,cost,currency,cost_basis,started_at,finished_at,
      billing_provider,operation_id,model_id,environment,operation_run_id,owner_user_id,owner_kind,price_snapshot
    ) VALUES (
      ${searchReceiptId},1,'redfox.xhs.search','XHS_SEARCH','live','received',
      ${sql.json({ notes: 8 } as never)},0.12,'CNY','actual',${new Date(base + 7_200_000)},${new Date(base + 7_201_000)},
      'redfox','XHS_SEARCH',NULL,'test',${searchRunId},${userId},'member',
      ${sql.json({ version: 1, state: "ready", service: "redfox.xhs.search", model: "XHS_SEARCH", currency: "CNY",
        perRequest: "0.12", inputPerMtok: null, cachedInputPerMtok: null, outputPerMtok: null,
        sourceUrl: null, verifiedOn: "2035-01-01", selectedAt: "2035-01-10T02:00:00.000Z" } as never)}
    )`;

  const submitReceiptId = await receipt("aliyun.wan.video", "wan.submit", "wan2.2-animate-mix");
  await sql`INSERT INTO receipt_attempts(
      receipt_id,attempt,service,model,origin,status,started_at,finished_at,billing_provider,operation_id,model_id,
      environment,owner_user_id,owner_kind
    ) VALUES (
      ${submitReceiptId},1,'aliyun.wan.video','wan2.2-animate-mix','live','received',
      ${new Date(base + 10_800_000)},${new Date(base + 10_801_000)},'aliyun','wan.submit','wan2.2-animate-mix','test',${userId},'member'
    )`;
  const pollReceiptId = await receipt("aliyun.wan.poll", "wan.poll", "wan2.2-animate-mix");
  await sql`INSERT INTO receipt_attempts(
      receipt_id,attempt,service,model,origin,status,usage,started_at,finished_at,billing_provider,operation_id,model_id,
      environment,owner_user_id,owner_kind
    ) VALUES (
      ${pollReceiptId},1,'aliyun.wan.poll','wan2.2-animate-mix','live','received',
      ${sql.json({ wanTask: {
        provider: "aliyun",
        configIdentity: { workspace: "synthetic" },
        taskId: `wan-${T}`,
        rootRunId: 999999,
        submissionReceiptId: submitReceiptId,
        submissionAttempt: 1,
        terminal: "SUCCEEDED",
        outputSeconds: 8,
        usageValid: true,
        priceSnapshot: { perSecondCny: "0.6", currency: "CNY", basis: "documented-estimate", date: "2035-01-01" },
      } } as never)},
      '2035-02-10T00:00:00.000Z','2035-02-10T00:00:01.000Z','aliyun','wan.poll','wan2.2-animate-mix','test',${userId},'member'
    )`;

  try {
    const overview = await costs({ start, end, view: "overview", groupBy: "provider", limit: 50 });
    assert.equal(overview.view, "overview");
    if (overview.view !== "overview") throw new Error("expected overview");
    assert.deepEqual(
      {
        attempts: overview.totals.attempts,
        logicalRequests: overview.totals.logicalRequests,
        feeItems: overview.totals.feeItems,
        unknownCostItems: overview.totals.unknownCostItems,
        sharedFeeItems: overview.totals.sharedFeeItems,
        outputSeconds: overview.totals.usage.outputSeconds,
      },
      { attempts: 3, logicalRequests: 3, feeItems: 3, unknownCostItems: 0, sharedFeeItems: 1, outputSeconds: "8" },
    );
    assert.equal(
      overview.totals.amountBuckets.find((bucket) => bucket.costBasis === "actual")?.amount,
      "0.120000",
    );
    assert.equal(
      overview.totals.amountBuckets.find((bucket) => bucket.costBasis === "estimated")?.amount,
      "4.802000",
    );
    assert.deepEqual(
      new Set(overview.groups.map((group) => group.billingProvider)),
      new Set(["deepseek", "redfox", "aliyun"]),
    );

    const byUser = await costs({ start, end, view: "overview", groupBy: "user", username, limit: 50 });
    assert.equal(byUser.view, "overview");
    if (byUser.view === "overview") {
      assert.equal(byUser.totals.attempts, 3);
      assert.deepEqual(byUser.groups.map((group) => group.userId), [userId]);
    }

    const bySkill = await costs({ start, end, view: "overview", groupBy: "skill", limit: 50 });
    assert.equal(bySkill.view, "overview");
    if (bySkill.view === "overview") {
      assert.equal(bySkill.groups.find((group) => group.key === "__shared__")?.additive, false);
      assert.equal(
        bySkill.groups.find((group) => group.skill?.skillId === "xiaohongshu")?.totals.attempts,
        1,
      );
      assert.equal(bySkill.groups.find((group) => group.key === "__not_applicable__")?.totals.attempts, 1);
    }

    const filtered = await costs({
      start,
      end,
      view: "overview",
      groupBy: "service",
      skillId: "xiaohongshu",
      moduleId: "note-rewrite",
      limit: 50,
    });
    assert.equal(filtered.view, "overview");
    if (filtered.view === "overview") assert.equal(filtered.totals.attempts, 2);

    const wanDetails = await costs({ start, end, view: "details", billingProvider: "aliyun", limit: 50 });
    assert.equal(wanDetails.view, "details");
    if (wanDetails.view === "details") {
      assert.equal(wanDetails.rows.length, 1);
      assert.equal(wanDetails.rows[0]!.cost.amount, "4.800000");
      assert.equal(wanDetails.rows[0]!.cost.basis, "estimated");
      assert.equal(wanDetails.rows[0]!.usage.outputSeconds, "8");
      assert.equal(wanDetails.rows[0]!.priceSnapshot.state, "ready");
    }

    const allDetails = await costs({ start, end, view: "details", limit: 50 });
    assert.equal(allDetails.view, "details");
    if (allDetails.view === "details") {
      const model = allDetails.rows.find((row) => row.service === "assistant.text")!;
      assert.equal(model.runId, null);
      assert.equal(model.owner.userId, userId);
      assert.equal(model.assistant.attribution, "multi_skill");
      assert.equal(model.assistant.sessionId, sessionId);
      assert.equal(model.cost.estimateBasis, "cache_split");
      assert.deepEqual(new Set(model.assistant.activations.map((item) => item.skillId)), new Set(["xiaohongshu", "creative"]));
    }

    await sql`DELETE FROM assistant_model_step_activations WHERE model_step_id=${stepId}`;
    await sql`UPDATE assistant_model_steps SET cost_context_version=NULL WHERE id=${stepId}`;
    await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash,receipt_id)
      VALUES (${randomUUID()},${turnId},2,2,'{}',${`duplicate-history-${T}`},${modelReceiptId})`;
    const historicalOverview = await costs({ start, end, view: "overview", groupBy: "skill", limit: 50 });
    assert.equal(historicalOverview.view, "overview");
    if (historicalOverview.view === "overview") {
      assert.equal(
        historicalOverview.groups.find((group) => group.key === "__historical_unknown__")?.totals.attempts,
        1,
      );
      assert.equal(historicalOverview.warnings.find((warning) => warning.code === "historical_skill_unknown")?.count, 1);
    }
    const historicalDetails = await costs({ start, end, view: "details", limit: 50 });
    assert.equal(historicalDetails.view, "details");
    if (historicalDetails.view === "details") {
      const historicalModel = historicalDetails.rows.find((row) => row.service === "assistant.text")!;
      assert.equal(historicalModel.assistant.attribution, "historical_unknown");
      assert.deepEqual(historicalModel.assistant.activations, []);
    }
  } finally {
    await sql`UPDATE receipt_attempts SET operation_run_id=NULL WHERE operation_run_id IN ${sql(runIds)}`;
    if (sessionIds.length) {
      await sql`DELETE FROM assistant_model_step_activations WHERE model_step_id IN (
        SELECT id FROM assistant_model_steps WHERE turn_id IN (SELECT id FROM assistant_turns WHERE session_id IN ${sql(sessionIds)})
      )`;
      await sql`DELETE FROM assistant_tool_calls WHERE turn_id IN (SELECT id FROM assistant_turns WHERE session_id IN ${sql(sessionIds)})`;
      await sql`UPDATE assistant_model_steps SET receipt_id=NULL WHERE turn_id IN (SELECT id FROM assistant_turns WHERE session_id IN ${sql(sessionIds)})`;
      await sql`UPDATE assistant_activations SET model_step_id=NULL WHERE turn_id IN (SELECT id FROM assistant_turns WHERE session_id IN ${sql(sessionIds)})`;
      await sql`DELETE FROM assistant_activations WHERE turn_id IN (SELECT id FROM assistant_turns WHERE session_id IN ${sql(sessionIds)})`;
      await sql`DELETE FROM assistant_model_steps WHERE turn_id IN (SELECT id FROM assistant_turns WHERE session_id IN ${sql(sessionIds)})`;
      await sql`DELETE FROM assistant_turns WHERE session_id IN ${sql(sessionIds)}`;
      await sql`DELETE FROM assistant_sessions WHERE id IN ${sql(sessionIds)}`;
    }
    if (runIds.length) await sql`DELETE FROM operation_runs WHERE id IN ${sql(runIds)}`;
    if (receiptIds.length) await sql`DELETE FROM receipts WHERE id IN ${sql(receiptIds)}`;
    await sql`DELETE FROM site_users WHERE id=${userId}`;
  }
});

test("logical requests remain distinct across retries, null dimensions, and group pages", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const id = await receipt("cost.logical", "logical-retry", "model-a");
  const range = { start: "2036-01-01T00:00:00.000Z", end: "2036-02-01T00:00:00.000Z" };
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const group = attempt <= 2 ? "a" : attempt === 3 ? "b" : null;
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,usage,cost,currency,cost_basis,started_at,
        billing_provider,operation_id,model_id,environment,owner_kind
      ) VALUES (
        ${id},${attempt},${`cost.logical.${group ?? "unknown"}`},${group ? `model-${group}` : null},'live',
        ${["received", "failed", "pending", "unknown"][attempt - 1]!},
        ${sql.json({ prompt_tokens: attempt * 10 } as never)},${attempt === 3 ? null : attempt / 10},'CNY',
        ${attempt === 2 ? "estimated" : "actual"},'2036-01-10T00:00:00.000Z',
        ${group ? `provider-${group}` : null},${`operation-${group ?? "unknown"}`},
        ${group ? `model-${group}` : null},'test',${attempt <= 2 ? "system" : attempt === 3 ? "admin" : "unassigned"}
      )`;
    }
    for (const groupBy of ["provider", "service", "model", "user"] as const) {
      const first = await costs({ ...range, view: "overview", groupBy, limit: 1 });
      assert.equal(first.view, "overview");
      if (first.view !== "overview") throw new Error("expected overview");
      assert.equal(first.totals.attempts, 4);
      assert.equal(first.totals.logicalRequests, 1);
      assert.equal(first.totals.usage.inputTokens, 100);
      assert.deepEqual(first.totals.statusCounts, { pending: 1, received: 1, failed: 1, unknown: 1 });
      assert.deepEqual(
        first.totals.amountBuckets.map((bucket) => [bucket.costBasis, bucket.amount, bucket.records]),
        [["actual", "0.500000", 2], ["estimated", "0.200000", 1]],
      );
      const groups = [...first.groups];
      let cursor = first.nextGroupCursor;
      while (cursor) {
        const page = await costs({ ...range, view: "overview", groupBy, limit: 1, cursor });
        assert.equal(page.view, "overview");
        if (page.view !== "overview") throw new Error("expected overview");
        assert.deepEqual(page.totals, first.totals);
        groups.push(...page.groups);
        cursor = page.nextGroupCursor;
      }
      assert.equal(groups.length, 3);
      assert.deepEqual(groups.map((group) => group.totals.attempts), [2, 1, 1]);
      assert.deepEqual(groups.map((group) => group.totals.logicalRequests), [1, 1, 1]);
    }
    const empty = await costs({ ...range, view: "overview", billingProvider: "missing-provider" });
    assert.equal(empty.view, "overview");
    if (empty.view === "overview") {
      assert.equal(empty.groups.length, 0);
      assert.equal(empty.totals.attempts, 0);
      assert.equal(empty.totals.logicalRequests, 0);
      assert.equal(empty.totals.usage.estimatedCredits, null);
    }
  } finally {
    await sql`DELETE FROM receipts WHERE id=${id}`;
  }
});

test("a Wan task linked to two submissions remains one conflicting fee item", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const range = {
    start: "2037-01-01T00:00:00.000Z",
    end: "2037-02-01T00:00:00.000Z",
  };
  await sql`DELETE FROM receipts WHERE id IN (
    SELECT receipt_id FROM receipt_attempts
    WHERE started_at>=${new Date(range.start)} AND started_at<${new Date(range.end)}
      AND service IN ('aliyun.wan.video','aliyun.wan.poll')
  )`;
  const submitReceiptId = await receipt("aliyun.wan.video", "wan.submit", "wan2.2-animate-mix");
  const createdReceiptIds = [submitReceiptId];
  const taskId = `wan-dedup-${T}`;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,started_at,finished_at,
        billing_provider,operation_id,model_id,environment
      ) VALUES (
        ${submitReceiptId},${attempt},'aliyun.wan.video','wan2.2-animate-mix','live','received',
        ${new Date(`2037-01-10T0${attempt}:00:00.000Z`)},${new Date(`2037-01-10T0${attempt}:00:01.000Z`)},
        'aliyun','wan.submit','wan2.2-animate-mix','test'
      )`;
      const pollReceiptId = await receipt("aliyun.wan.poll", "wan.poll", "wan2.2-animate-mix");
      createdReceiptIds.push(pollReceiptId);
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,usage,started_at,finished_at,
        billing_provider,operation_id,model_id,environment
      ) VALUES (
        ${pollReceiptId},1,'aliyun.wan.poll','wan2.2-animate-mix','live','received',
        ${sql.json({ wanTask: {
          provider: "aliyun",
          configIdentity: { workspace: "synthetic" },
          taskId,
          rootRunId: 999999,
          submissionReceiptId: submitReceiptId,
          submissionAttempt: attempt,
          terminal: "SUCCEEDED",
          outputSeconds: 8,
          usageValid: true,
          priceSnapshot: {
            perSecondCny: "0.6",
            currency: "CNY",
            basis: "documented-estimate",
            date: "2037-01-01",
          },
        } } as never)},
        ${new Date(`2037-01-10T0${attempt}:10:00.000Z`)},${new Date(`2037-01-10T0${attempt}:10:01.000Z`)},
        'aliyun','wan.poll','wan2.2-animate-mix','test'
      )`;
    }

    const overview = await costs({ ...range, view: "overview", groupBy: "provider", limit: 50 });
    assert.equal(overview.view, "overview");
    if (overview.view !== "overview") throw new Error("expected overview");
    assert.equal(overview.totals.attempts, 4);
    assert.equal(overview.totals.feeItems, 1);
    assert.equal(overview.totals.knownCostItems, 0);
    assert.equal(overview.totals.unknownCostItems, 1);
    assert.deepEqual(overview.totals.amountBuckets, []);
    assert.equal(overview.warnings.find((warning) => warning.code === "wan_cost_conflict")?.count, 1);

    const details = await costs({ ...range, view: "details", limit: 50 });
    assert.equal(details.view, "details");
    if (details.view !== "details") throw new Error("expected details");
    const submissions = details.rows
      .filter((row) => row.service === "aliyun.wan.video")
      .sort((a, b) => a.attempt - b.attempt);
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions.map((row) => row.cost.applicable), [true, false]);
    assert.match(submissions[0]!.cost.reason ?? "", /冲突/);
    assert.match(submissions[1]!.cost.reason ?? "", /更早.*提交/);
  } finally {
    await sql`DELETE FROM receipts WHERE id IN ${sql(createdReceiptIds)}`;
  }
});
test("the same Wan task id in different config identities remains two fee items", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const range = {
    start: "2039-01-01T00:00:00.000Z",
    end: "2039-02-01T00:00:00.000Z",
  };
  const created: number[] = [];
  const taskId = `wan-config-dedup-${T}`;
  try {
    for (const workspace of ["workspace-a", "workspace-b"]) {
      const submission = await receipt("aliyun.wan.video", "wan.submit", "wan2.2-animate-mix");
      const poll = await receipt("aliyun.wan.poll", "wan.poll", "wan2.2-animate-mix");
      created.push(submission, poll);
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,started_at,finished_at,
        billing_provider,operation_id,model_id,environment
      ) VALUES (
        ${submission},1,'aliyun.wan.video','wan2.2-animate-mix','live','received',
        ${new Date("2039-01-10T01:00:00.000Z")},${new Date("2039-01-10T01:00:01.000Z")},
        'aliyun','wan.submit','wan2.2-animate-mix','test'
      )`;
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,usage,started_at,finished_at,
        billing_provider,operation_id,model_id,environment
      ) VALUES (
        ${poll},1,'aliyun.wan.poll','wan2.2-animate-mix','live','received',
        ${sql.json({ wanTask: {
          provider: "aliyun",
          configIdentity: { workspace },
          taskId,
          rootRunId: workspace.endsWith("a") ? 910001 : 910002,
          submissionReceiptId: submission,
          submissionAttempt: 1,
          terminal: "SUCCEEDED",
          outputSeconds: 8,
          usageValid: true,
          priceSnapshot: {
            perSecondCny: "0.6",
            currency: "CNY",
            basis: "documented-estimate",
            date: "2039-01-01",
          },
        } } as never)},
        ${new Date("2039-01-10T01:10:00.000Z")},${new Date("2039-01-10T01:10:01.000Z")},
        'aliyun','wan.poll','wan2.2-animate-mix','test'
      )`;
    }
    const overview = await costs({
      ...range,
      view: "overview",
      groupBy: "provider",
      billingProvider: "aliyun",
      limit: 50,
    });
    assert.equal(overview.view, "overview");
    if (overview.view !== "overview") throw new Error("expected overview");
    assert.equal(overview.totals.attempts, 4);
    assert.equal(overview.totals.feeItems, 2);
    assert.equal(overview.totals.knownCostItems, 2);
    assert.equal(overview.totals.amountBuckets[0]?.amount, "9.600000");

    const details = await costs({
      ...range,
      view: "details",
      billingProvider: "aliyun",
      limit: 50,
    });
    assert.equal(details.view, "details");
    if (details.view !== "details") throw new Error("expected details");
    assert.equal(details.rows.filter((row) => row.service === "aliyun.wan.video" && row.cost.applicable).length, 2);
    assert.equal(details.rows.filter((row) => row.service === "aliyun.wan.poll" && !row.cost.applicable).length, 2);
  } finally {
    if (created.length) await sql`DELETE FROM receipts WHERE id IN ${sql(created)}`;
  }
});

test("a Wan task split across report periods never invoices either submission twice", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const taskId = `wan-cross-period-${T}`;
  const created: number[] = [];
  try {
    for (const day of [10, 11]) {
      const submission = await receipt("aliyun.wan.video", "wan.submit", "wan2.2-animate-mix");
      const poll = await receipt("aliyun.wan.poll", "wan.poll", "wan2.2-animate-mix");
      created.push(submission, poll);
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,started_at,finished_at,
        billing_provider,operation_id,model_id,environment
      ) VALUES (
        ${submission},1,'aliyun.wan.video','wan2.2-animate-mix','live','received',
        ${new Date(`2040-01-${day}T01:00:00.000Z`)},${new Date(`2040-01-${day}T01:00:01.000Z`)},
        'aliyun','wan.submit','wan2.2-animate-mix','test'
      )`;
      await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,usage,started_at,finished_at,
        billing_provider,operation_id,model_id,environment
      ) VALUES (
        ${poll},1,'aliyun.wan.poll','wan2.2-animate-mix','live','received',
        ${sql.json({ wanTask: {
          provider: "aliyun",
          configIdentity: { workspace: "synthetic" },
          taskId,
          rootRunId: 999999,
          submissionReceiptId: submission,
          submissionAttempt: 1,
          terminal: "SUCCEEDED",
          outputSeconds: 8,
          usageValid: true,
          priceSnapshot: {
            perSecondCny: "0.6",
            currency: "CNY",
            basis: "documented-estimate",
            date: "2040-01-01",
          },
        } } as never)},
        ${new Date(`2040-01-${day}T01:10:00.000Z`)},${new Date(`2040-01-${day}T01:10:01.000Z`)},
        'aliyun','wan.poll','wan2.2-animate-mix','test'
      )`;
    }

    for (const [start, end] of [
      ["2040-01-01T00:00:00.000Z", "2040-02-01T00:00:00.000Z"],
      ["2040-01-10T00:00:00.000Z", "2040-01-11T00:00:00.000Z"],
      ["2040-01-11T00:00:00.000Z", "2040-01-12T00:00:00.000Z"],
    ]) {
      const overview = await costs({
        start,
        end,
        view: "overview",
        groupBy: "provider",
        billingProvider: "aliyun",
        limit: 50,
      });
      assert.equal(overview.view, "overview");
      if (overview.view !== "overview") throw new Error("expected overview");
      const wholeRange = start.startsWith("2040-01-01");
      const earlierSubmission = start.startsWith("2040-01-10");
      assert.equal(overview.totals.attempts, wholeRange ? 4 : 2);
      assert.equal(overview.totals.feeItems, earlierSubmission || wholeRange ? 1 : 0);
      assert.equal(overview.totals.knownCostItems, 0);
      assert.equal(overview.totals.unknownCostItems, earlierSubmission || wholeRange ? 1 : 0);
      assert.deepEqual(overview.totals.amountBuckets, []);
      assert.equal(
        overview.warnings.find((warning) => warning.code === "wan_cost_conflict")?.count ?? 0,
        earlierSubmission || wholeRange ? 1 : 0,
      );
    }
  } finally {
    if (created.length) await sql`DELETE FROM receipts WHERE id IN ${sql(created)}`;
  }
});

test("cancelled cost reads stop SQL, release their slot, and reject subsequent transaction queries", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(() => withCostRead(async () => { throw new Error("must not run"); }, { signal: cancelled.signal }), { name: "AbortError" });
  await assert.rejects(() => costs({ start, end }, { signal: cancelled.signal }), { name: "AbortError" });

  let releaseHeld!: () => void;
  let heldReady!: () => void;
  const heldStarted = new Promise<void>((resolve) => { heldReady = resolve; });
  const heldGate = new Promise<void>((resolve) => { releaseHeld = resolve; });
  const held = withCostRead(async () => { heldReady(); await heldGate; return 1; });
  await heldStarted;
  const controller = new AbortController();
  let queryReady!: (pid: number) => void;
  const queryStarted = new Promise<number>((resolve) => { queryReady = resolve; });
  let lateQuery: (() => Promise<unknown>) | undefined;
  const reading = withCostRead(async (tx) => {
    const [backend] = await tx`SELECT pg_backend_pid() pid`;
    lateQuery = async () => await tx`SELECT 1`;
    const sleeping = tx`SELECT pg_sleep(4)`.execute();
    queryReady(backend!.pid);
    await sleeping;
    throw new Error("cancelled query must not complete");
  }, { signal: controller.signal });
  const rejected = assert.rejects(reading, { name: "AbortError" });
  try {
    const pid = await queryStarted;
    let active = false;
    for (let i = 0; i < 100; i++) {
      const [state] = await sql`SELECT state,query FROM pg_stat_activity WHERE pid=${pid}`;
      if (state?.state === "active" && state.query.includes("pg_sleep")) { active = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(active, true, "test must abort an executing PostgreSQL query");
    const abortedAt = performance.now();
    controller.abort();
    await rejected;
    assert.ok(performance.now() - abortedAt < 1000, "abort must release the slot before the 4s SQL finishes");
    const [state] = await sql`SELECT state FROM pg_stat_activity WHERE pid=${pid}`;
    assert.equal(state?.state, "idle");
    await assert.rejects(lateQuery!, { name: "AbortError" });
    assert.equal(await withCostRead(async (tx) => {
      const fragment = tx`1 AS value`;
      const [row] = await tx`SELECT ${fragment}`;
      return row!.value;
    }, { signal: new AbortController().signal }), 1);
  } finally {
    controller.abort();
    releaseHeld();
    await Promise.allSettled([reading, rejected, held]);
  }
});

test("cost HTTP boundary returns semantic status and a busy read never returns a partial total", async () => {
  const previous = config.devAdmin;
  const app = await buildApp();
  try {
    config.devAdmin = null;
    assert.equal((await app.inject({ url: `/api/admin/costs?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` })).statusCode, 401);
    config.devAdmin = { displayName: "Synthetic cost admin" };
    const before = await sql`SELECT (SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM receipt_attempts) attempts`;
    const ok = await app.inject({ url: `/api/admin/costs?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&view=overview` });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.headers["cache-control"], "no-store");
    assert.deepEqual(await sql`SELECT (SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM receipt_attempts) attempts`, before);
    assert.equal((await app.inject({ url: "/api/admin/costs?start=bad&end=bad" })).statusCode, 400);
    assert.equal(
      (await app.inject({ url: `/api/admin/costs?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&userId=999999999` })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: `/api/admin/costs?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&cursor=bad` })).statusCode,
      400,
    );

    const hold = () => withCostRead(async (tx) => { await tx`SELECT pg_sleep(0.8)`; return 1; });
    const first = hold();
    const second = hold();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rejected = await Promise.allSettled(
      Array.from({ length: 6 }, () => withCostRead(async () => 3)),
    );
    assert.equal(rejected.length, 6);
    for (const result of rejected) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.ok(result.reason instanceof CostCenterBusyError);
    }
    const busy = await app.inject({ url: `/api/admin/costs?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` });
    assert.equal(busy.statusCode, 503);
    assert.equal(busy.json().code, "cost_center_busy");
    assert.equal(busy.headers["retry-after"], "2");
    await Promise.all([first, second]);
    await assert.rejects(
      () => withCostRead(async (tx) => { await tx`SELECT 1/0`; return 3; }),
    );
    assert.equal(await withCostRead(async () => 4), 4);
  } finally {
    config.devAdmin = previous;
    await app.close();
  }
});

test("explicit unknown provider identity is not re-mapped from the service name", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const explicitReceipt = await receipt("jina", "reader", null);
  const legacyReceipt = await receipt("jina", "reader-legacy", null);
  const mixedUpstreamReceipt = await receipt("jina", "reader-mixed-upstream", null);
  try {
    await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,started_at,finished_at,
        billing_provider,upstream_provider,operation_id,model_id,environment,owner_kind
      ) VALUES
        (${explicitReceipt},1,'jina',NULL,'live','received',${new Date(base + 86_400_000)},${new Date(base + 86_401_000)},
          NULL,'reader-relay','reader.read',NULL,'test','unassigned'),
        (${legacyReceipt},1,'jina',NULL,'live','received',${new Date(base + 86_402_000)},${new Date(base + 86_403_000)},
          NULL,NULL,NULL,NULL,'test','unassigned')`;

    const details = await costs({ start, end, view: "details", service: "jina", limit: 50 });
    assert.equal(details.view, "details");
    if (details.view === "details") {
      const explicit = details.rows.find((row) => row.receiptId === explicitReceipt)!;
      const legacy = details.rows.find((row) => row.receiptId === legacyReceipt)!;
      assert.equal(explicit.billingProvider, "unknown");
      assert.equal(explicit.identitySource, "explicit");
      assert.equal(explicit.operation, "reader.read");
      assert.equal(legacy.billingProvider, "unknown");
      assert.equal(legacy.identitySource, "unknown");
      assert.equal(legacy.operation, "reader-legacy");
    }

    const overview = await costs({ start, end, view: "overview", service: "jina", groupBy: "provider", limit: 50 });
    assert.equal(overview.view, "overview");
    if (overview.view === "overview") {
      assert.deepEqual(
        overview.groups.map((group) => [group.key, group.totals.attempts]).sort(),
        [["unknown", 2]],
      );
      assert.equal(overview.groups.find((group) => group.key === "unknown")?.upstreamProvider, "reader-relay");
      assert.equal(overview.warnings.find((warning) => warning.code === "historical_identity_unknown")?.count, 2);
    }

    await sql`INSERT INTO receipt_attempts(
        receipt_id,attempt,service,model,origin,status,started_at,finished_at,
        billing_provider,upstream_provider,operation_id,model_id,environment,owner_kind
      ) VALUES (
        ${mixedUpstreamReceipt},1,'jina',NULL,'live','received',
        ${new Date(base + 86_404_000)},${new Date(base + 86_405_000)},
        NULL,'other-relay','reader.read-mixed',NULL,'test','unassigned'
      )`;
    const mixed = await costs({ start, end, view: "overview", service: "jina", groupBy: "provider", limit: 50 });
    assert.equal(mixed.view, "overview");
    if (mixed.view === "overview")
      assert.equal(mixed.groups.find((group) => group.key === "unknown")?.upstreamProvider, null);
  } finally {
    await sql`DELETE FROM receipts WHERE id IN ${sql([explicitReceipt, legacyReceipt, mixedUpstreamReceipt])}`;
  }
});
test("historical owner recovery keeps unique actors and leaves conflicting receipts unassigned", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const start = "2038-01-01T00:00:00.000Z", end = "2038-02-01T00:00:00.000Z";
  const suffix = tag();
  const [userA] = await sql<{ id: number }[]>`
    INSERT INTO site_users(username,display_name,password_hash)
    VALUES (${`owner_a_${suffix}`},'归属用户 A','synthetic-password-hash') RETURNING id`;
  const [userB] = await sql<{ id: number }[]>`
    INSERT INTO site_users(username,display_name,password_hash)
    VALUES (${`owner_b_${suffix}`},'归属用户 B','synthetic-password-hash') RETURNING id`;
  const createdRuns: number[] = [];
  const createdReceipts: number[] = [];
  const addRun = async (actor: string) => {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO operation_runs(
        actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key
      ) VALUES (
        ${actor},${randomUUID()},'cost-owner',${`owner.${suffix}`},1,
        '{}',${`hash-${suffix}`},'completed','owner'
      ) RETURNING id`;
    createdRuns.push(row!.id);
    return row!.id;
  };
  const addReceipt = async (name: string) => {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO receipts(logical_key,service,purpose,status,request,response,attempts)
      VALUES (
        ${`${name}-${suffix}-${randomUUID()}`},${name},'test','completed','{}','{}',1
      ) RETURNING id`;
    createdReceipts.push(row!.id);
    return row!.id;
  };
  const directMemberRun = await addRun(`user:${userA!.id}`);
  const adminRun = await addRun(`admin:${suffix}`);
  const systemRun = await addRun("scheduler");
  const sharedRunA = await addRun(`user:${userA!.id}`);
  const sharedRunB = await addRun(`user:${userB!.id}`);
  const directReceipt = await addReceipt(`cost.owner.direct.${suffix}`);
  const adminReceipt = await addReceipt(`cost.owner.admin.${suffix}`);
  const systemReceipt = await addReceipt(`cost.owner.system.${suffix}`);
  const sharedReceipt = await addReceipt(`cost.owner.shared.${suffix}`);
  try {
    await sql`INSERT INTO receipt_attempts(
      receipt_id,attempt,service,model,origin,status,started_at,environment,operation_run_id
    ) VALUES
      (${directReceipt},1,${`cost.owner.direct.${suffix}`},NULL,'live','received',
        ${new Date("2038-01-10T01:00:00.000Z")},'test',${directMemberRun}),
      (${adminReceipt},1,${`cost.owner.admin.${suffix}`},NULL,'live','received',
        ${new Date("2038-01-10T02:00:00.000Z")},'test',NULL),
      (${systemReceipt},1,${`cost.owner.system.${suffix}`},NULL,'live','received',
        ${new Date("2038-01-10T03:00:00.000Z")},'test',${systemRun}),
      (${sharedReceipt},1,${`cost.owner.shared.${suffix}`},NULL,'live','received',
        ${new Date("2038-01-10T04:00:00.000Z")},'test',NULL)`;
    await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id)
      VALUES
        (${adminRun},1,${`admin-${suffix}`},'fixture','{}',${adminReceipt}),
        (${sharedRunA},1,${`a-${suffix}`},'fixture','{}',${sharedReceipt}),
        (${sharedRunB},1,${`b-${suffix}`},'fixture','{}',${sharedReceipt})`;

    const details = await costs({
      start,
      end,
      view: "details",
      service: `cost.owner.${"direct"}.${suffix}`,
      limit: 50,
    });
    assert.equal(details.view, "details");
    if (details.view === "details") {
      assert.deepEqual(details.rows[0]!.owner, {
        kind: "member",
        userId: userA!.id,
        username: `owner_a_${suffix}`,
        displayName: "归属用户 A",
      });
    }

    for (const [kind, service] of [
      ["admin", `cost.owner.admin.${suffix}`],
      ["system", `cost.owner.system.${suffix}`],
    ] as const) {
      const row = await costs({ start, end, view: "details", service, limit: 50 });
      assert.equal(row.view, "details");
      if (row.view === "details") {
        assert.equal(row.rows[0]!.owner.kind, kind);
        assert.equal(row.rows[0]!.owner.userId, null);
      }
    }

    const shared = await costs({
      start,
      end,
      view: "details",
      service: `cost.owner.shared.${suffix}`,
      limit: 50,
    });
    assert.equal(shared.view, "details");
    if (shared.view === "details") {
      assert.equal(shared.rows.length, 1);
      assert.equal(shared.rows[0]!.owner.kind, null);
      assert.equal(shared.rows[0]!.owner.userId, null);
      assert.ok(shared.rows[0]!.warnings.includes("历史归属未知"));
      assert.equal(shared.warnings.find((warning) => warning.code === "historical_owner_unknown")?.count, 1);
    }

    const userOnly = await costs({
      start,
      end,
      view: "details",
      service: `cost.owner.shared.${suffix}`,
      username: `owner_a_${suffix}`,
      limit: 50,
    });
    assert.equal(userOnly.view, "details");
    if (userOnly.view === "details") assert.equal(userOnly.rows.length, 0);
  } finally {
    if (createdRuns.length)
      await sql`DELETE FROM operation_results WHERE run_id IN ${sql(createdRuns)}`;
    await sql`DELETE FROM receipts WHERE id IN ${sql(createdReceipts)}`;
    if (createdRuns.length)
      await sql`DELETE FROM operation_runs WHERE id IN ${sql(createdRuns)}`;
    await sql`DELETE FROM site_users WHERE id IN ${sql([userA!.id, userB!.id])}`;
  }
});

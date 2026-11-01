import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { paidRequest, estimatedCatalogCost, ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { resolveDeepSeekPriceSnapshot } from "@aihot/backend/providers/deepseek-pricing";
after(closeDb);
test("attempt price is frozen before dispatch; reuse preserves attribution and retry captures a new price", async () => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
  const service = `cost-fixture-${tag()}`, model = "synthetic";
  const request = { service, model, purpose: "cost-test", identity: { fixture: service }, costIdentity: { billingProvider: "fixture", operation: "test", model } };
  await sql`INSERT INTO service_prices(service,model,currency,input_per_mtok,output_per_mtok) VALUES (${service},${model},'CNY',2,3)`;
  let id: number | undefined;
  try {
    await assert.rejects(() => paidRequest(request, async ({ priceSnapshot }) => {
      assert.equal(priceSnapshot?.state, "ready");
      await sql`UPDATE service_prices SET input_per_mtok=9 WHERE service=${service}`;
      throw new ProviderRejectedError("synthetic retryable rejection", 429, true, {
        response: { retry: true }, usage: { prompt_tokens: 1000, completion_tokens: 0 },
        cost: estimatedCatalogCost(priceSnapshot, { prompt_tokens: 1000, completion_tokens: 0 }),
      });
    }), ProviderRejectedError);
    const first = await sql`SELECT a.id,a.receipt_id,a.price_snapshot,a.cost::text,a.owner_kind FROM receipt_attempts a WHERE service=${service}`;
    id = first[0]!.receipt_id;
    assert.equal(first[0]!.price_snapshot.inputPerMtok, "2.000000");
    assert.equal(first[0]!.cost, "0.002000");
    assert.equal(first[0]!.owner_kind, "unassigned");
    const retry = await paidRequest(request, async ({ priceSnapshot }) => {
      assert.equal(priceSnapshot?.state === "ready" && priceSnapshot.inputPerMtok, "9.000000");
      return { response: { ok: true }, usage: { prompt_tokens: 1000, completion_tokens: 0 }, cost: { amount: "0.004321", currency: "CNY", basis: "actual" } };
    });
    const reused = await paidRequest({ ...request, costIdentity: { billingProvider: "changed", operation: "changed" } }, async () => { throw Error("must not dispatch"); }, {
      resolvePriceSnapshot: async () => { throw Error("reuse must not select a price"); },
    });
    assert.equal(reused.reused, true);
    assert.equal(retry.attempt, 2);
    assert.equal(reused.receiptId, id);
    const attempts = await sql`SELECT price_snapshot,cost::text,cost_basis,billing_provider FROM receipt_attempts WHERE receipt_id=${id!} ORDER BY attempt`;
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map(a => a.price_snapshot.inputPerMtok), ["2.000000", "9.000000"]);
    assert.equal(attempts[1]!.cost, "0.004321");
    assert.equal(attempts[1]!.cost_basis, "actual");
    assert(attempts.every(a => a.billing_provider === "fixture"));
  } finally {
    await sql`DELETE FROM receipt_attempts WHERE service=${service}`;
    await sql`DELETE FROM receipts WHERE service=${service}`;
    await sql`DELETE FROM service_prices WHERE service=${service}`;
  }
});
test("unreliable provider costs become unknown without losing responses or rejection evidence", async () => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
  const suffix = tag();
  const service = `cost-evidence-${suffix}`;
  const invalidAmounts: Array<string | number> = ["-0.01", -0.01, "100000000", "99999999.9999999", "00000000000000000000000000000000000000000001", "1e2", "not-a-number", Number.NaN, Number.POSITIVE_INFINITY, 1e21];
  const receiptIds: number[] = [];
  try {
    for (const [index, amount] of invalidAmounts.entries()) {
      const result = await paidRequest({
        service,
        model: "synthetic",
        purpose: `received-${index}`,
        identity: { suffix, index },
      }, async () => ({
        response: { received: index },
        cost: { amount, currency: "CNY", basis: "actual" },
      }));
      receiptIds.push(result.receiptId);
      const [row] = await sql`SELECT r.status,r.response,r.cost,r.currency,r.cost_basis,a.status AS attempt_status,a.response AS attempt_response,a.cost AS attempt_cost,a.currency AS attempt_currency,a.cost_basis AS attempt_cost_basis
        FROM receipts r JOIN receipt_attempts a ON a.receipt_id=r.id WHERE r.id=${result.receiptId}`;
      assert.equal(row!.status, "received");
      assert.deepEqual(row!.response, { received: index });
      assert.equal(row!.cost, null);
      assert.equal(row!.currency, null);
      assert.equal(row!.cost_basis, null);
      assert.equal(row!.attempt_status, "received");
      assert.equal(row!.attempt_response, null, "accepted attempt response is retained by the existing business/recovery path");
      assert.equal(row!.attempt_cost, null);
      assert.equal(row!.attempt_currency, null);
      assert.equal(row!.attempt_cost_basis, null);
    }

    const validAmounts: Array<[string | number, string]> = [
      [0.00035999999999999997, "0.000360"],
      [0.0006000000000000001, "0.000600"],
      ["1.0000000", "1.000000"],
      ["0.0000004", "0.000000"],
      ["99999999.9999994", "99999999.999999"],
    ];
    for (const [index, [amount, expected]] of validAmounts.entries()) {
      const result = await paidRequest({
        service,
        model: "synthetic",
        purpose: `valid-${index}`,
        identity: { suffix, validAmountIndex: index },
      }, async () => ({
        response: { received: true },
        cost: { amount, currency: "CNY", basis: "actual" },
      }));
      receiptIds.push(result.receiptId);
      const [row] = await sql`SELECT cost::text FROM receipts WHERE id=${result.receiptId}`;
      assert.equal(row!.cost, expected);
    }

    const rejection = new ProviderRejectedError("synthetic rejected response", 400, false, {
      response: { rejected: true },
      cost: { amount: "-1.25", currency: "CNY", basis: "actual" },
    });
    await assert.rejects(() => paidRequest({
      service,
      model: "synthetic",
      purpose: "rejected",
      identity: { suffix, rejected: true },
    }, async () => { throw rejection; }), (error) => error === rejection);
    const [row] = await sql`SELECT r.id,r.status,r.error,r.response,r.cost,r.currency,r.cost_basis,a.status AS attempt_status,a.response AS attempt_response,a.cost AS attempt_cost,a.currency AS attempt_currency,a.cost_basis AS attempt_cost_basis
      FROM receipts r JOIN receipt_attempts a ON a.receipt_id=r.id WHERE r.service=${service} AND r.purpose='rejected'`;
    receiptIds.push(row!.id);
    assert.equal(row!.status, "failed");
    assert.equal(row!.error, "synthetic rejected response");
    assert.deepEqual(row!.response, { rejected: true });
    assert.equal(row!.cost, null);
    assert.equal(row!.currency, null);
    assert.equal(row!.cost_basis, null);
    assert.equal(row!.attempt_status, "failed");
    assert.deepEqual(row!.attempt_response, { rejected: true });
    assert.equal(row!.attempt_cost, null);
    assert.equal(row!.attempt_currency, null);
    assert.equal(row!.attempt_cost_basis, null);

    const maximum = await paidRequest({ service, model: "synthetic", purpose: "maximum", identity: { suffix, maximum: true } }, async () => ({
      response: { ok: true }, cost: { amount: "99999999.999999", currency: "CNY", basis: "actual" },
    }));
    receiptIds.push(maximum.receiptId);
    const [maximumRow] = await sql`SELECT cost::text FROM receipts WHERE id=${maximum.receiptId}`;
    assert.equal(maximumRow!.cost, "99999999.999999");
  } finally {
    if (receiptIds.length) await sql`DELETE FROM receipts WHERE id IN ${sql(receiptIds)}`;
  }
});

test("official DeepSeek off-peak rates are frozen in the attempt snapshot", async () => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
  const service = `deepseek-price-fixture-${tag()}`, model = `deepseek-fixture-${tag()}`;
  const request = {
    service,
    model,
    purpose: "deepseek-price-test",
    identity: { fixture: service },
    pricingKey: { service: "deepseek", model },
    costIdentity: { billingProvider: "deepseek", operation: "chat.completions", model },
  };
  await sql`INSERT INTO service_prices(
    service,model,currency,input_per_mtok,cached_per_mtok,output_per_mtok
  ) VALUES (${"deepseek"},${model},'CNY',2,0.5,3)`;
  try {
    const result = await paidRequest(
      request,
      async ({ priceSnapshot }) => {
        const usage = {
          prompt_tokens: 1000,
          completion_tokens: 100,
          prompt_cache_hit_tokens: 400,
          prompt_cache_miss_tokens: 600,
        };
        return {
          response: { ok: true },
          usage,
          cost: estimatedCatalogCost(priceSnapshot, usage),
        };
      },
      {
        resolvePriceSnapshot: async (tx, context) =>
          resolveDeepSeekPriceSnapshot(tx, {
            ...context,
            attemptTime: new Date("2026-10-31T03:00:00.000Z"),
          }),
      },
    );
    await sql`UPDATE service_prices
      SET input_per_mtok=9,cached_per_mtok=8,output_per_mtok=7
      WHERE service='deepseek' AND model=${model}`;
    const [attempt] = await sql`
      SELECT price_snapshot,cost::text AS cost
      FROM receipt_attempts
      WHERE receipt_id=${result.receiptId} AND attempt=${result.attempt}`;
    assert.equal(attempt!.cost, "0.000850");
    assert.deepEqual(
      {
        input: attempt!.price_snapshot.inputPerMtok,
        cached: attempt!.price_snapshot.cachedInputPerMtok,
        output: attempt!.price_snapshot.outputPerMtok,
        selection: attempt!.price_snapshot.rateRule.selection,
        multiplier: attempt!.price_snapshot.rateRule.multiplier,
        timezone: attempt!.price_snapshot.rateRule.timezone,
      },
      {
        input: "1.000000",
        cached: "0.250000",
        output: "1.500000",
        selection: "off_peak",
        multiplier: "0.5",
        timezone: "Asia/Shanghai",
      },
    );
  } finally {
    await sql`DELETE FROM receipts WHERE service=${service}`;
    await sql`DELETE FROM service_prices WHERE service='deepseek' AND model=${model}`;
  }
});

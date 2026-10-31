// Pure tests: no DB queries, migrations, credentials or provider dispatch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatedCatalogCost, logicalKeyFor, normalizedEnvironment, type PriceSnapshot } from "@aihot/backend/providers/receipts";
import { costOwnerForActor } from "@aihot/backend/providers/operations/store";
import { modelBillingProvider } from "@aihot/backend/providers/llm";
import { responseUsage } from "@aihot/backend/assistant/model";
import {
  deepseekRateSelection,
  resolveDeepSeekPriceSnapshot,
} from "@aihot/backend/providers/deepseek-pricing";
const price: PriceSnapshot = { version: 1, state: "ready", service: "synthetic", model: "fixture", currency: "CNY",
  inputPerMtok: "2", cachedInputPerMtok: "0.5", outputPerMtok: "3", perRequest: null,
  sourceUrl: "https://example.invalid/synthetic", verifiedOn: "2026-01-01", selectedAt: "2026-01-01T00:00:00Z" };

test("cost owners require exact member actors and explicit internal evidence", () => {
  assert.deepEqual(costOwnerForActor("user:12"), { budgetScope: "member", ownerKind: "member", ownerUserId: 12 });
  for (const actor of ["admin:12", "dev:12"]) assert.deepEqual(costOwnerForActor(actor), { budgetScope: "admin", ownerKind: "admin", ownerUserId: null });
  for (const actor of ["user:0", "user:01", "user:-1", "user:1abc", "user:9007199254740993", "system", "unknown", "admin:"]) {
    assert.equal(costOwnerForActor(actor).ownerKind, "unassigned");
    assert.equal(costOwnerForActor(actor).ownerUserId, null);
  }
  assert.equal(costOwnerForActor("scheduler").ownerKind, "system");
  assert.equal(costOwnerForActor("subscription-video").ownerKind, "system");
  assert.equal(normalizedEnvironment("PROD"), "production");
  assert.equal(normalizedEnvironment("ci"), "test");
  assert.equal(normalizedEnvironment("staging"), "other");
});
test("only exact known bases prove billing provider; custom proxies and model names do not", () => {
  assert.equal(modelBillingProvider("https://api.deepseek.com/v1/"), "deepseek");
  for (const url of ["https://proxy.invalid/deepseek", "https://api.deepseek.com.evil.invalid/v1", "https://api.deepseek.com/custom", "http://api.deepseek.com/v1"]) assert.equal(modelBillingProvider(url), null);
});
test("usage retains cache evidence without inventing missing or invalid tokens", () => {
  assert.deepEqual(responseUsage(JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 0, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, total_tokens: 1000, secret: "discard" } })),
    { prompt_tokens: 1000, completion_tokens: 0, total_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600 });
  assert.deepEqual(responseUsage('{"usage":{"prompt_tokens":10,"prompt_cache_hit_tokens":-1,"completion_tokens":"0"}}'), { prompt_tokens: 10 });
  assert.equal(responseUsage("invalid"), null);
});
test("catalog estimate uses million-token units, cache split and one final rounding", () => {
  assert.equal(estimatedCatalogCost(price, { prompt_tokens: 1000, completion_tokens: 0 })?.amount, "0.002000");
  assert.equal(estimatedCatalogCost(price, { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600, completion_tokens: 100 })?.amount, "0.001700");
  assert.equal(estimatedCatalogCost({ ...price, inputPerMtok: "0.4", outputPerMtok: "0.4" }, { prompt_tokens: 1, completion_tokens: 1 })?.amount, "0.000001");
  assert.equal(estimatedCatalogCost({ ...price, perRequest: "0" }, null)?.amount, "0.000000");
  assert.equal(estimatedCatalogCost({ ...price, outputPerMtok: null }, { prompt_tokens: 1000 })?.amount, "0.002000");
  for (const usage of [{ prompt_tokens: 1000 }, { completion_tokens: 100 }, { prompt_tokens: -1, completion_tokens: 0 },
    { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 800, completion_tokens: 0 },
    { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 400, completion_tokens: 0 },
    { prompt_tokens: 1000, prompt_cache_hit_tokens: 400, completion_tokens: 0 }]) assert.equal(estimatedCatalogCost(price, usage), null);
  assert.equal(estimatedCatalogCost({ ...price, perRequest: "100000000" }, null), null, "numeric(14,6) overflow is unknown");
});
test("reporting identity and price key never alter receipt logical identity", () => {
  const req = { service: "assistant.text", model: "fixture", purpose: "assistant.turn", identity: { stepId: "step", requestHash: "hash" } };
  assert.equal(logicalKeyFor(req), logicalKeyFor({ ...req, pricingKey: { service: "deepseek", model: "fixture" }, costIdentity: { billingProvider: "deepseek", operation: "chat.completions", model: "fixture" } }));
  assert.notEqual(logicalKeyFor(req), logicalKeyFor({ ...req, attemptTag: "retry" }));
});
test("DeepSeek rate windows use Shanghai time, legal holidays and conservative future peaks", () => {
  assert.deepEqual(
    [
      "2026-08-17T00:59:59.999Z",
      "2026-08-17T01:00:00.000Z",
      "2026-08-17T04:00:00.000Z",
      "2026-08-17T06:00:00.000Z",
      "2026-08-22T10:00:00.000Z",
      "2026-10-01T01:00:00.000Z",
      "2026-10-10T01:00:00.000Z",
      "2027-01-04T01:00:00.000Z",
    ].map((at) => {
      const selected = deepseekRateSelection(new Date(at));
      return selected && [selected.selection, selected.exact, selected.multiplier, selected.reason];
    }),
    [
      ["off_peak", true, "0.5", "outside_peak_window"],
      ["peak", true, "1", "weekday_peak"],
      ["off_peak", true, "0.5", "outside_peak_window"],
      ["peak", true, "1", "weekday_peak"],
      ["off_peak", true, "0.5", "weekend"],
      ["off_peak", true, "0.5", "legal_holiday"],
      ["off_peak", true, "0.5", "weekend"],
      ["conservative_peak", false, "1", "holiday_calendar_unavailable"],
    ],
  );
  assert.equal(deepseekRateSelection(new Date("2026-08-16T15:59:59.999Z")), null);
  assert.equal(deepseekRateSelection(new Date("invalid")), null);
});
test("DeepSeek resolver never infers official pricing from a custom proxy identity", async () => {
  const req = {
    service: "assistant.text",
    model: "fixture",
    purpose: "assistant.turn",
    identity: { fixture: true },
    pricingKey: { service: "deepseek", model: "fixture" },
    costIdentity: { billingProvider: "custom-proxy", operation: "chat.completions", model: "fixture" },
  };
  assert.equal(
    await resolveDeepSeekPriceSnapshot(null as never, {
      req,
      attemptTime: new Date("2026-08-17T01:00:00.000Z"),
      execution: { budgetScope: null },
    }),
    null,
  );
});

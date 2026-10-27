import assert from "node:assert/strict";
import { test } from "node:test";
import { subscriptionExecutionChanges, type CollectionSubscriptionConfig } from "../app/features/admin/collection-subscription-types.ts";
const current: CollectionSubscriptionConfig = { name: "微博研究", operationId: "TXQPVGJG", parameters: { keyword: "AI", searchType: "61", page: "1" }, enabled: true, intervalMinutes: 15, enrichDetails: false, limits: { pages: 3, items: 100, details: 20 } };
test("name and interval edits explain that the in-flight round is retained", () => {
  assert.equal(subscriptionExecutionChanges(current, { ...current, name: "新名称", intervalMinutes: 30 }), false);
  assert.equal(subscriptionExecutionChanges(current, { ...current, parameters: { page: "1", searchType: "61", keyword: "AI" } }), false);
});
test("execution changes explain the old round will stop instead of being resumed as the new configuration", () => {
  assert.equal(subscriptionExecutionChanges(current, { ...current, enabled: false }), true);
  assert.equal(subscriptionExecutionChanges(current, { ...current, parameters: { ...current.parameters, keyword: "机器人" } }), true);
  assert.equal(subscriptionExecutionChanges(current, { ...current, limits: { ...current.limits, details: 0 } }), true);
  assert.equal(subscriptionExecutionChanges(current, { ...current, enrichDetails: true }), true);
});

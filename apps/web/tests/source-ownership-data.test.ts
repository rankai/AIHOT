import assert from "node:assert/strict";
import { test } from "node:test";
import { frozenSourceOwnership, hasUnlinkedWork, ownershipCandidatesHref, ownershipCandidateValid, workSourceBody } from "../app/features/admin/source-ownership-data.ts";
import { collectionConfig, collectionDraft, collectionSubscriptionsHref, providerOperation } from "../app/features/admin/collection-subscription-data.ts";
import { subscriptionExecutionChanges, type CollectionSubscription } from "../app/features/admin/collection-subscription-types.ts";
import { importSelectedWorks } from "../app/features/admin/work-result-selection-data.ts";
import type { PlatformOperation } from "../app/features/admin/platform-types.ts";
import type { OperationResult } from "../app/features/admin/operation-types.ts";
const member = (sourceId: string | null) => ({ subscriptionId: 1, executionVersion: 2, sourceExecutionVersion: 3, sourceId });
const result = (kind: string, data: Record<string, unknown> = {}): OperationResult => ({ id: 1, kind, data, sourceId: null, articleId: null, receiptId: 1, file: null, fileKey: null, imported: false });
test("only frozen members authorize inherited source; source display metadata cannot manufacture ownership", () => {
  assert.deepEqual(frozenSourceOwnership({ sources: [{ id: "display-only", name: "预览" }] }), { id: null, name: null, ambiguous: false });
  assert.deepEqual(frozenSourceOwnership({ members: [member("owned"), member("owned")], sources: [{ id: "other", name: "其它" }, { id: "owned", name: "所属" }] }), { id: "owned", name: "所属", ambiguous: false });
  const mixed = frozenSourceOwnership({ members: [member("a"), member("b")] });
  assert.equal(mixed.ambiguous, true); assert.equal(mixed.id, null);
  assert.throws(() => workSourceBody({ id: "explicit-cannot-override", inherited: false, ambiguous: true }));
  assert.deepEqual(workSourceBody({ id: "owned", inherited: true, ambiguous: false }), {});
  assert.throws(() => workSourceBody({ id: null, inherited: false, ambiguous: false }));
  assert.deepEqual(workSourceBody({ id: "editorial-rss", inherited: false, ambiguous: false }), { sourceId: "editorial-rss" });
});
test("source candidates include every kind and participation mode but require the current enabled completed page", () => {
  const rows = [{ id: "rss", name: "RSS", kind: "rss", participation_mode: "editorial", enabled: true }, { id: "signal", name: "信号", kind: "mp_account", participation_mode: "hot_signal", enabled: true }, { id: "off", name: "停用", enabled: false }];
  assert.equal(ownershipCandidatesHref(" 名称 & ID ", 2), "/admin/sources?q=%E5%90%8D%E7%A7%B0+%26+ID&enabled=true&page=2");
  for (const id of ["rss", "signal"]) assert.equal(ownershipCandidateValid(id, "idle", "query", "query", rows), true);
  for (const state of ["loading", "submitting"]) assert.equal(ownershipCandidateValid("rss", state, "query", "query", rows), false);
  assert.equal(ownershipCandidateValid("rss", "idle", "changed", "query", rows), false);
  assert.equal(ownershipCandidateValid("rss", "idle", "query", "query", []), false);
  assert.equal(ownershipCandidateValid("off", "idle", "query", "query", rows), false);
  assert.equal(ownershipCandidateValid("unknown", "idle", "query", "query", rows), false);
});
test("source selector is relevant only for unlinked supported work candidates, including those missing original", () => {
  for (const kind of ["account", "douyin_account", "query_summary", "social_comment", "hotspot_research", "image", "result_expired"]) assert.equal(hasUnlinkedWork([result(kind)]), false);
  assert.equal(hasUnlinkedWork([result("douyin_work", { workId: "42", identity: {} })]), true);
  assert.equal(hasUnlinkedWork([result("douyin_work", { workId: "42", url: "https://cdn.example/a.mp4" })]), false);
  assert.equal(hasUnlinkedWork([{ ...result("douyin_work"), articleId: "linked" }]), false);
  assert.equal(hasUnlinkedWork([result("xiaohongshu_work", { provider: "agentkey", role: "provider_recommendation" })]), false);
});
const operation: PlatformOperation = { id: "OWIBYU1V", platform: "douyin", label: "作品", purpose: "query", schedulableType: "search", collectionCapabilities: { detailEnrichment: false, sourceRequired: true }, fields: [] };
const legacy: CollectionSubscription = { id: 3, provider: "redfox", operationId: operation.id, platform: "douyin", name: "旧订阅", enabled: false, enrichDetails: false, intervalMinutes: 15, parameters: {}, limits: { pages: 3, items: 100, details: 0 }, editVersion: 2, executionVersion: 2, nextRunAt: null, activeRun: null, sourceId: null, sourceRequired: true };
test("content subscriptions require source on creation, allow paused legacy management and a single repair, then lock ownership", () => {
  const draft = { ...collectionDraft(operation), name: "新订阅" };
  assert.throws(() => collectionConfig(operation, draft), /关联所属信源/);
  const paused = collectionConfig(operation, { ...draft, enabled: false }, "douyin", legacy);
  assert.equal(paused.sourceId, undefined); assert.equal(subscriptionExecutionChanges(legacy, { ...paused, name: legacy.name }), false);
  assert.throws(() => collectionConfig(operation, { ...draft, enabled: true }, "douyin", legacy));
  const repaired = collectionConfig(operation, { ...draft, sourceId: "rss-owner", enabled: true }, "douyin", legacy);
  assert.equal(repaired.sourceId, "rss-owner"); assert.equal(subscriptionExecutionChanges(legacy, repaired), true);
  const owned = { ...legacy, sourceId: "rss-owner" };
  assert.throws(() => collectionConfig(operation, { ...draft, sourceId: "different" }, "douyin", owned), /不能更换/);
  assert.equal(collectionConfig(operation, { ...draft, sourceId: "rss-owner" }, "douyin", owned).sourceId, "rss-owner");
  const research = { ...operation, collectionCapabilities: { detailEnrichment: false, sourceRequired: false } };
  assert.equal(collectionConfig(research, draft).sourceId, undefined);
  assert.equal(collectionSubscriptionsHref(null, "rss owner"), "/admin/sources?view=collections&sourceId=rss+owner");
});
test("provider-specific field metadata preserves base ownership capability when it supplies other capabilities", () => {
  const variant = { ...operation, queryProviders: [{ id: "agentkey", label: "AgentKey", fields: [], collectionCapabilities: { detailEnrichment: false } }] };
  assert.equal(providerOperation(variant, "agentkey").collectionCapabilities?.sourceRequired, true);
});
test("batch commands reuse the same explicitly chosen source and never emit optional author identity", async () => {
  const works = [result("douyin_work", { workId: "42", url: "https://douyin.com/video/42", identity: {} }), { ...result("weibo_work", { opusId: "43", opusUrl: "https://weibo.com/123/43" }), id: 2 }];
  const calls: unknown[] = [];
  await importSelectedWorks({ results: works, selectedIds: [2, 1], reason: "核实导入", source: { sourceId: "rss-owner" }, isCurrent: () => true, submit: async (id, body) => { calls.push({ id, body }); return true; } });
  assert.deepEqual(calls, [{ id: 1, body: { reason: "核实导入", sourceId: "rss-owner" } }, { id: 2, body: { reason: "核实导入", sourceId: "rss-owner" } }]);
});

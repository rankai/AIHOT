import assert from "node:assert/strict";
import { test } from "node:test";
import { platformParameters, safeExternalUrl, type PlatformOperation } from "../app/features/admin/platform-types.ts";
const base = { id: "test", platform: "weibo", label: "测试", purpose: "query", schedulableType: null };
test("descriptor fields preserve string work pages, convert integer account pages, and omit empty optional choices", () => {
  const operation: PlatformOperation = { ...base, fields: [
    { name: "page", label: "作品页码", type: "string", required: true, constraints: { pattern: "^[1-9][0-9]*$", max: Number.MAX_SAFE_INTEGER } },
    { name: "accountPage", label: "账号页码", type: "integer", required: true, constraints: { min: 1, max: Number.MAX_SAFE_INTEGER } },
    { name: "extParam", label: "认证", type: "select", required: false, options: [{ value: "0", label: "普通" }] },
  ] };
  assert.deepEqual(platformParameters(operation, { page: "100", accountPage: "100", extParam: "" }), { page: "100", accountPage: 100 });
  for (const page of ["0", "-1", "1.5", "9007199254740992"]) assert.throws(() => platformParameters(operation, { page, accountPage: "1" }));
});
test("upstream links reject credentials and executable schemes while preserving safe HTTP(S) destinations", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com/image", "//example.com/image"]) assert.equal(safeExternalUrl(value), null);
  assert.equal(safeExternalUrl("https://weibo.com/123/456"), "https://weibo.com/123/456");
});

test("optional booleans preserve omitted, false and true as separate wire values; offsets keep the documented step", () => {
  const operation: PlatformOperation = { ...base, platform: "wechat", fields: [
    { name: "offset", label: "偏移量", type: "integer", required: false, default: 0, constraints: { min: 0, step: 20, max: Number.MAX_SAFE_INTEGER } },
    { name: "exactMatch", label: "精准匹配", type: "boolean", required: false, default: false },
  ] };
  assert.deepEqual(platformParameters(operation, { offset: "20", exactMatch: "false" }), { offset: 20, exactMatch: false });
  assert.deepEqual(platformParameters(operation, { offset: "0", exactMatch: "true" }), { offset: 0, exactMatch: true });
  assert.deepEqual(platformParameters(operation, { offset: "", exactMatch: "" }), {});
  assert.throws(() => platformParameters(operation, { offset: "21", exactMatch: "false" }), /20/);
  assert.throws(() => platformParameters(operation, { exactMatch: "0" }));
});


test("Bilibili detail navigation accepts one received alias and only available AgentKey fields", async () => {
  const { bilibiliQuerySeed } = await import("../app/features/admin/platform-query-data.ts");
  const { bilibiliDetailSeed } = await import("../app/features/admin/bilibili-result-data.ts");
  const { operationLabel } = await import("../app/features/admin/operation-types.ts");
  const operation = { id: "TIN1NMTZ", platform: "bilibili", label: "详情", purpose: "query", schedulableType: null, fields: [], collectionProviders: [{ id: "agentkey", label: "AgentKey", fields: [{ name: "av_id", label: "AV", type: "string" as const, required: false }, { name: "bv_id", label: "BV", type: "string" as const, required: false }] }] };
  const seed = bilibiliDetailSeed({ provider: "agentkey", platform: "bilibili", operationId: "LEN9QXR3", avId: "321" });
  assert.deepEqual(bilibiliQuerySeed({ bilibiliDetailSeed: seed }, [operation])?.values, { av_id: "321" });
  for (const patch of [{ provider: "redfox" }, { platform: "other" }, { operationId: "EH53TOT7" }, { parameters: { av_id: "321", bv_id: "BV1234567890" } }, { parameters: { url: "https://example.com" } }, { parameters: { av_id: 321 } }]) assert.equal(bilibiliQuerySeed({ bilibiliDetailSeed: { ...seed, ...patch } }, [operation]), null);
  assert.equal(bilibiliQuerySeed({ bilibiliDetailSeed: seed }, []), null);
  assert.equal(bilibiliDetailSeed({ provider: "agentkey", platform: "bilibili", operationId: "bilibili.trending", workId: "BV1234567890" }), null);
  assert.equal(Object.keys(operationLabel).filter(key => key.startsWith("agentkey.bilibili.")).length, 11);
});

test("Weibo detail navigation uses only actual numeric status identity and an available AgentKey variant", async () => {
  const { weiboQuerySeed } = await import("../app/features/admin/platform-query-data.ts");
  const { weiboDetailSeed } = await import("../app/features/admin/weibo-result-data.ts");
  const operation = { id: "API_1789098514899", platform: "weibo", label: "详情", purpose: "query", schedulableType: null, fields: [], collectionProviders: [{ id: "agentkey", label: "AgentKey", fields: [{ name: "status_id", label: "微博 ID", type: "string" as const, required: true }] }] };
  const data = { provider: "agentkey", platform: "weibo", operationId: "TXQPVGJG", tool: "TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get", role: "status", opusId: "900719925474099312345" };
  const seed = weiboDetailSeed(data);
  assert.deepEqual(weiboQuerySeed({ weiboDetailSeed: seed }, [operation]), { platform: "weibo", provider: "agentkey", operationId: operation.id, values: { status_id: data.opusId } });
  assert(weiboDetailSeed({ ...data, operationId: "weibo.account_posts", tool: "TikHub/fetch_user_timeline_api_v1_weibo_app_fetch_user_timeline_get" }));
  for (const patch of [{ provider: "redfox" }, { platform: "other" }, { operationId: operation.id }, { tool: "other" }, { role: "outer-status-unparsed-retweet" }, { opusId: undefined, mblogid: "abc", requestedScope: { status_id: "123" } }, { opusId: 123 }, { opusId: "abc" }]) assert.equal(weiboDetailSeed({ ...data, ...patch }), null);
  for (const patch of [{ provider: "redfox" }, { platform: "other" }, { operationId: "TXQPVGJG" }, { parameters: { status_id: "123", uid: "456" } }, { parameters: { opusId: "123" } }, { parameters: { status_id: 123 } }, { parameters: { status_id: " 123 " } }, { parameters: { status_id: "abc" } }]) assert.equal(weiboQuerySeed({ weiboDetailSeed: { ...seed, ...patch } }, [operation]), null);
  for (const operations of [[], [{ ...operation, collectionProviders: [] }], [{ ...operation, collectionProviders: [{ ...operation.collectionProviders[0]!, fields: [] }] }]]) assert.equal(weiboQuerySeed({ weiboDetailSeed: seed }, operations), null);
});

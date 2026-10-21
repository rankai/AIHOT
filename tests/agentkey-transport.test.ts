import { test } from "node:test";
import assert from "node:assert/strict";
import type { FetchLike } from "@modelcontextprotocol/client";
import { agentKeyConfig, AGENTKEY_MAX_RESPONSE_BYTES } from "@aihot/backend/providers/agentkey/config";
import { agentKeyTransport } from "@aihot/backend/providers/agentkey/transport";
import { parseLosslessJson, type AgentKeyResponse } from "@aihot/backend/providers/agentkey/response";
import { douyinSearchInput, parseDouyinSearch } from "@aihot/backend/providers/agentkey/douyin-search";
import { ProviderRejectedError } from "@aihot/backend/providers/receipts";

// No sockets or database: real SDK over an injected FetchLike. HTTP/SQL integration is separate.
const key = "test-agentkey-transport-fake-key";
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", AIHOT_ENVIRONMENT: "test", AGENTKEY_API_KEY: key, AGENTKEY_CALLS_ENABLED: "true", AGENTKEY_MCP_URL: "http://127.0.0.1:10000/v1/mcp" };
const big = "9223372036854775807123456789";
const rawEnvelope = `{"provider":"TikHub","credits_charged":0,"request_id":"test-id","data":{"code":200,"data":{"code":0,"msg":"success","data":{"hasMore":false,"cursor":12,"itemList":[{"AwemeInfo":{"AwemeId":${big},"Author":{"Uid":${big},"SecUid":"test-sec","Nickname":"测试作者"},"Desc":"说明","CreateTime":"1729400000000","Video":{"ItemID":${big},"Title":"说明","CreateTime":"1729400000","Cover":{"UrlList":["https://p3.douyinpic.com/test.jpeg"]}}}}]}}}}`;

function stubFetch(answer: (id: unknown) => Response) {
  const calls: { url: string; init: RequestInit; request: Record<string, any> }[] = [];
  const stub: FetchLike = async (url, init) => {
    const request = JSON.parse(String(init?.body || "{}"));
    calls.push({ url: String(url), init: init!, request });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    if (request.method === "initialize") return Response.json({ jsonrpc: "2.0", id: request.id,
      result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "test-injected-mcp", version: "1" } } });
    if (request.method?.startsWith("notifications/")) return new Response(null, { status: 202 });
    return answer(request.id);
  };
  return { fetch: stub, calls };
}
const json = (id: unknown, result: string) => new Response(`{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":${result}}`, { headers: { "content-type": "application/json" } });

test("guards fail before injected fetch; production and non-test processes reject local endpoints", async () => {
  const stub = stubFetch((id) => json(id, '{"content":[]}'));
  for (const overrides of [{ AGENTKEY_CALLS_ENABLED: undefined }, { AGENTKEY_API_KEY: "" },
    { NODE_ENV: "production" }, { NODE_ENV: "development" }, { AIHOT_ENVIRONMENT: "production" },
    ...["https://attacker.example/v1/mcp", "http://192.0.2.1/v1/mcp", "https://api.agentkey.app/v1/mcp/", "https://a:b@api.agentkey.app/v1/mcp", "https://api.agentkey.app/v1/mcp?", "https://api.agentkey.app/v1/mcp#"].map((url) => ({ AGENTKEY_MCP_URL: url }))]) {
    assert.throws(() => agentKeyTransport({ env: { ...env, ...overrides }, fetch: stub.fetch }));
  }
  assert.equal(stub.calls.length, 0);
  assert.equal(agentKeyConfig({ ...env, AGENTKEY_MCP_URL: undefined }).url.href, "https://api.agentkey.app/v1/mcp");
  assert.throws(() => douyinSearchInput.parse({ keyword: "x", sort: "latest" }));
  assert.throws(() => douyinSearchInput.parse({ keyword: "x", cursor: -1 }));
});

test("real SDK uses Bearer and fixed execute_tool once, retaining unrounded structured IDs", async () => {
  const stub = stubFetch((id) => json(id, `{"content":[],"structuredContent":${rawEnvelope}}`));
  const outcome = await agentKeyTransport({ env, fetch: stub.fetch }).execute({ keyword: "测试" });
  const calls = stub.calls.filter((call) => call.request.method === "tools/call");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request.params, { name: "execute_tool", arguments: {
    name: "TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post",
    params: { keyword: "测试", cursor: 0 },
  } });
  assert.ok(stub.calls.every((call) => new Headers(call.init.headers).get("authorization") === `Bearer ${key}`));
  assert.ok(stub.calls.every((call) => call.init.redirect === "error"));
  const parsed = parseDouyinSearch(outcome.response, { keyword: "测试" });
  assert.equal(parsed.candidates[0].data.aweme_id, big);
  assert.equal(parsed.candidates[0].data.author.uid, big);
  assert.equal(parsed.summary.stopReason, "upstream_no_more");
  assert.equal(outcome.usage?.chargedCredits, 0);
  assert.equal(outcome.cost, undefined);
});

test("text fallback and SSE structuredContent both preserve raw integer literals", async () => {
  for (const sse of [false, true]) {
    const stub = stubFetch((id) => {
      const result = sse ? `{"content":[],"structuredContent":${rawEnvelope}}`
        : JSON.stringify({ content: [{ type: "text", text: rawEnvelope }] });
      const body = `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":${result}}`;
      return new Response(sse ? `event: message\ndata: ${body}\n\n` : body,
        { headers: { "content-type": sse ? "text/event-stream" : "application/json" } });
    });
    const outcome = await agentKeyTransport({ env, fetch: stub.fetch }).execute({ keyword: "x" });
    assert.equal(parseDouyinSearch(outcome.response, { keyword: "x" }).candidates[0].data.aweme_id, big);
  }
});

test("complete errors preserve redacted envelope, request and usage without inventing cost", async () => {
  const e = { provider: "TikHub", credits_charged: 0.2, request_id: "test-error-id", error: "test-disabled", disabled: true, api_key: key, message: `Bearer ${key}` };
  for (const answer of [
    (id: unknown) => json(id, JSON.stringify({ content: [], isError: true, structuredContent: e })),
    () => Response.json(e, { status: 402 }),
    (id: unknown) => Response.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "test-invalid", data: e } }),
  ]) {
    const stub = stubFetch(answer);
    await assert.rejects(agentKeyTransport({ env, fetch: stub.fetch }).execute({ keyword: "x" }), (error: unknown) => {
      assert.ok(error instanceof ProviderRejectedError);
      assert.equal(error.evidence?.requestId, "test-error-id");
      assert.equal(error.evidence?.usage?.chargedCredits, 0.2);
      assert.equal(error.evidence?.cost, undefined);
      assert.ok(!JSON.stringify(error.evidence).includes(key));
      assert.equal((error.evidence?.response as AgentKeyResponse).envelope && true, true);
      return true;
    });
    assert.equal(stub.calls.filter((call) => call.request.method === "tools/call").length, 1);
  }
});

test("unrecognized complete payload is returned for receipt storage and then fails parsing", async () => {
  const stub = stubFetch((id) => json(id, JSON.stringify({ content: [], structuredContent: { provider: "TikHub", data: { mystery: [] } } })));
  const outcome = await agentKeyTransport({ env, fetch: stub.fetch }).execute({ keyword: "x" });
  assert.throws(() => parseDouyinSearch(outcome.response, { keyword: "x" }), /Unrecognized/);
  assert.ok(outcome.response);
  const noIdentity = parseDouyinSearch({ envelope: { provider: "TikHub", data: { code: 200, data: { code: 0, msg: "success", data: { hasMore: false, cursor: 12, itemList: [{ AwemeInfo: { AwemeId: Number(big) } }] } } } } }, { keyword: "x" });
  assert.deepEqual(noIdentity.candidates[0].data.importBlockers, ["lossless_work_id_required", "lossless_author_id_required"]);
  const empty = parseDouyinSearch({ envelope: { provider: "TikHub", data: { code: 200, data: { code: 0, msg: "success", data: { hasMore: false, cursor: 0, itemList: [] } } } } }, { keyword: "x" });
  assert.equal(empty.summary.count, 0);
  assert.equal(empty.summary.stopReason, "upstream_no_more");
  assert.throws(() => parseDouyinSearch({ envelope: { provider: "TikHub", data: { code: 200, data: { code: 1, msg: "failed", data: { hasMore: false, cursor: 0, itemList: [] } } } } }, { keyword: "x" }), /non-success business status/);
  assert.equal((parseLosslessJson(`{"id":${big}}`) as { id: string }).id, big);
});

test("malformed and oversized responses fail conservatively without implicit replay", async () => {
  const malformed = stubFetch(() => new Response('{"jsonrpc":"2.0",', { headers: { "content-type": "application/json" } }));
  await assert.rejects(agentKeyTransport({ env, fetch: malformed.fetch }).execute({ keyword: "x" }), /incomplete/);
  assert.equal(malformed.calls.filter((call) => call.request.method === "tools/call").length, 1);

  const oversized = stubFetch((id) => json(id, JSON.stringify({ content: [{ type: "text", text: "x".repeat(AGENTKEY_MAX_RESPONSE_BYTES + 1) }] })));
  await assert.rejects(agentKeyTransport({ env, fetch: oversized.fetch }).execute({ keyword: "x" }), (error: unknown) => {
    assert.ok(error instanceof ProviderRejectedError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /byte limit/);
    return true;
  });
  assert.equal(oversized.calls.filter((call) => call.request.method === "tools/call").length, 1);
});

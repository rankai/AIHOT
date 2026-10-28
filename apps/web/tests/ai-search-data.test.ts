import assert from "node:assert/strict";
import { test } from "node:test";
import { aiSearchAnswer, aiSearchProducts, aiSearchCitationRows, aiSearchCitationUrl, aiSearchCommand, aiSearchFailureRows, aiSearchStatus, aiSearchTaskFacts, isAiSearchOperation, isAiSearchResult } from "../app/features/admin/ai-search-data.ts";
import type { AiSearchOptions } from "../app/features/admin/ai-search-types.ts";
const options: AiSearchOptions = {
  engines: [{ engine: "kimiK3", label: "Kimi K3", submit: "USDIOVU24", family: "kimi", price: 0.18 }, { engine: "kimiK25", label: "Kimi K2.5", submit: "USDIOVU23", family: "kimi", price: 0.06 }, { engine: "deepseek", label: "DeepSeek", submit: "KGX4SDXQ", family: "deepseek", price: 0.06 }],
  queries: [{ family: "kimi", poll: "IUAIUVB24" }, { family: "deepseek", poll: "AJWHKFQI" }],
  currency: "CNY", priceBasis: "estimated", pollEstimatedCny: 0, inquiryMaxCharacters: 10000,
  limits: { polls: 60, pollDeadlineSeconds: 7200, steps: 62, retries: 3, externalAttempts: 100, pollIntervalSeconds: 10, maxPollIntervalSeconds: 30 },
  services: { submission: "redfox.ai_search", poll: "redfox.poll" }, inputHint: "", resultPurpose: "research",
};
test("AI search submission and existing-task queries use separate endpoints and exact untrimmed commands", () => {
  const inquiry = " \n问题，emoji 👩‍💻\n ", taskId = " 900719925474099312345 | token ";
  assert.deepEqual(aiSearchCommand("submit", "kimiK3", inquiry, options), { path: "/api/admin/redfox/ai-searches", body: { engine: "kimiK3", inquiryText: inquiry } });
  assert.deepEqual(aiSearchCommand("query", "kimi", taskId, options), { path: "/api/admin/redfox/ai-searches/query", body: { family: "kimi", taskId } });
  assert.deepEqual(Object.keys(aiSearchCommand("query", "kimi", taskId, options).body).sort(), ["family", "taskId"]);
  assert.equal(aiSearchCommand("submit", "kimiK25", "x", options).body.engine, "kimiK25");
});
test("input checks reject blank, oversized or unknown selections without rewriting valid boundary input", () => {
  for (const mode of ["submit", "query"] as const) assert.throws(() => aiSearchCommand(mode, mode === "submit" ? "kimiK3" : "kimi", " \n ", options));
  assert.equal(aiSearchCommand("submit", "kimiK3", "x".repeat(10000), options).body.inquiryText?.length, 10000);
  assert.equal(aiSearchCommand("query", "kimi", "x".repeat(500), options).body.taskId?.length, 500);
  assert.throws(() => aiSearchCommand("submit", "kimiK3", "x".repeat(10001), options));
  assert.throws(() => aiSearchCommand("query", "kimi", "x".repeat(501), options));
  assert.throws(() => aiSearchCommand("submit", "invented", "x", options));
  assert.throws(() => aiSearchCommand("query", "kimiK25", "x", options));
});
test("AI result ownership is limited to three result kinds and known historical and product families", () => {
  assert(isAiSearchOperation("redfox.ai_search.submit")); assert(isAiSearchOperation("redfox.ai_search.query"));
  assert(!isAiSearchOperation("redfox.sync.query"));
  for (const family of ["kimi", "yuanbao", "qianwen", "baidu", "doubao", "deepseek", "qianwenProducts", "doubaoProducts"]) {
    for (const kind of ["ai_search_task", "ai_search_answer", "ai_search_citation"]) assert(isAiSearchResult(kind, { family }));
  }
  for (const kind of ["query_summary", "transcription", "image_task", "article"]) assert(!isAiSearchResult(kind, { family: "kimi" }));
  assert(!isAiSearchResult("ai_search_task", { family: "unknown" }));
});
test("a cleared terminal progress retains received/requested task identity from this page only", () => {
  const result = { kind: "ai_search_answer", data: { family: "kimi", requestedTaskId: " request-90071992547409931234 ", taskId: " actual-1 ", status: "completed" } };
  const operation = { progress: {}, inputs: { family: "kimi" }, results: [{ kind: "image_task", data: { taskId: "wrong" } }, result] };
  const facts = aiSearchTaskFacts(operation);
  assert.equal(facts.actualTaskId, " actual-1 "); assert.equal(facts.requestedTaskId, " request-90071992547409931234 ");
  assert.equal(facts.executionTaskId, " request-90071992547409931234 "); assert.equal(facts.latest, result);
  assert.equal(aiSearchTaskFacts({ ...operation, progress: { taskId: " live " } }).executionTaskId, " live ");
  assert.equal(aiSearchTaskFacts({ ...operation, inputs: { parameters: { taskId: " input " } } }).executionTaskId, " input ");
  const otherPage = aiSearchTaskFacts({ ...operation, results: [] });
  assert.equal(otherPage.latest, null); assert.equal(otherPage.actualTaskId, null); assert.equal(otherPage.executionTaskId, null);
});
test("Kimi responses without taskId retain requested task identity and citations do not masquerade as status", () => {
  const poll = { kind: "ai_search_task", data: { family: "kimi", requestedTaskId: " raw ", status: "processing", result: null, failReason: null } };
  const facts = aiSearchTaskFacts({ progress: {}, inputs: {}, results: [poll, { kind: "ai_search_citation", data: { family: "kimi", requestedTaskId: " raw ", url: null } }] });
  assert.equal(facts.actualTaskId, null); assert.equal(facts.executionTaskId, " raw "); assert.equal(facts.latest, poll);
  assert.equal(aiSearchStatus(poll.data), "处理中"); assert.equal(aiSearchAnswer(poll.data).content, null);
  assert.equal(aiSearchAnswer(poll.data).fact, "result 为 null（尚无回答）");
  assert.match(aiSearchStatus({ status: "unknown-future" }), /unknown-future/);
});
test("answers stay plain original text while null, absent, empty and malformed payload facts stay distinct", () => {
  const content = "<script>alert(1)</script>\n**研究答案** 🌍";
  assert.equal(aiSearchAnswer({ result: { content } }).content, content);
  assert.notEqual(aiSearchAnswer({ result: null }).fact, aiSearchAnswer({}).fact);
  assert.equal(aiSearchAnswer({ result: { content: "" } }).content, "");
  assert.equal(aiSearchAnswer({ result: { content: 0 } }).content, null);
});
test("citations only use backend-selected URL and preserve order, zero/null/false and huge ID facts", () => {
  const record = { title: "研究来源", index: 0, count: null, verified: false, id: "90071992547409931234", url: "https://search.example/result", nested: { arbitrary: true } };
  assert.equal(aiSearchCitationUrl({ url: null, record }), null);
  assert.equal(aiSearchCitationUrl({ url: "https://example.test/path", record }), "https://example.test/path");
  for (const url of ["//example.test/path", "javascript:alert(1)", "https://user:pass@example.test/x", "data:text/plain,x"]) assert.equal(aiSearchCitationUrl({ url, record }), null);
  const rows = aiSearchCitationRows({ record });
  assert.deepEqual(rows.map(([key]) => key), ["title", "index", "count", "verified", "id", "url"]);
  assert.equal(rows[1]?.[1], "0"); assert.match(rows[2]![1], /null/); assert.match(rows[3]![1], /false/); assert.equal(rows[4]?.[1], record.id);
});

test("normal processing/completed null failure facts stay diagnostic while actual failures distinguish null, empty and missing", () => {
  for (const status of ["processing", "completed"]) {
    assert.deepEqual(aiSearchFailureRows({ status, failReason: null }), []);
    assert.deepEqual(aiSearchFailureRows({ status, failReason: "" }), []);
  }
  assert.match(aiSearchFailureRows({ status: "failed", failReason: null })[0]![1], /null/);
  assert.equal(aiSearchFailureRows({ status: "failed", failReason: "" })[0]![1], "空字符串");
  assert.equal(aiSearchFailureRows({ status: "failed" })[0]![1], "未提供");
  assert.equal(aiSearchFailureRows({ status: "processing", failReason: "actual failure" })[0]![1], "actual failure");
});

test("product engines keep distinct submit/query selections and opaque task IDs", () => {
  for (const family of ["qianwenProducts", "doubaoProducts"]) {
    const productOptions={...options,engines:[...options.engines,{engine:family,label:family,submit:"synthetic",family,price:0.12}],queries:[...options.queries,{family,poll:"synthetic"}]};
    assert.deepEqual(aiSearchCommand("submit",family," 问题 ",productOptions).body,{engine:family,inquiryText:" 问题 "});
    assert.deepEqual(aiSearchCommand("query",family," opaque task ",productOptions).body,{family,taskId:" opaque task "});
    assert.equal(aiSearchTaskFacts({progress:{},inputs:{family},results:[{kind:"ai_search_answer",data:{family,taskId:"product-task"}}]}).executionTaskId,"product-task");
  }
});
test("product cards preserve original prices and IDs, isolate searchGuid, and block unsafe links", () => {
  const card={title:"<img src=x onerror=alert(1)>",price:"2???",originPrice:"",sales:"已售3万+",shopName:"Synthetic",sourceSeq:"tao_assistant_actual",productId:"3750619017870705088",url:"https://example.test/product",image:"https://example.test/image"};
  const data={family:"doubaoProducts",result:{content:"[(unknown_marker)]",cardData:[card],searchGuid:[{id:"90071992547409931",index:1,title:"Reference",url:"https://example.test/source"}]}};
  const result=aiSearchProducts(data)!;assert.equal(result.cards[0]!.title,card.title);assert.equal(result.cards[0]!.url,card.url);assert.equal(result.cards[0]!.imageUrl,card.image);assert.ok(result.cards[0]!.rows.some(([label,value])=>label==="价格（原值）"&&value==="2???"));assert.ok(result.cards[0]!.rows.some(([,value])=>value===card.productId));assert.equal(result.references[0]!.url,"https://example.test/source");assert.equal(aiSearchAnswer(data).content,"[(unknown_marker)]");
  for(const unsafe of ["javascript:alert(1)","data:text/html,x","https://user:password@example.test/item","file:///tmp/item"]){const blocked=aiSearchProducts({family:"doubaoProducts",result:{cardData:[{...card,url:unsafe,image:unsafe}],searchGuid:[{url:unsafe}]}})!;assert.equal(blocked.cards[0]!.url,null);assert.equal(blocked.cards[0]!.imageUrl,null);assert.equal(blocked.references[0]!.url,null);}
  assert.equal(aiSearchProducts({...data,family:"doubao"}),null);assert.equal(aiSearchProducts({...data,family:"qianwenProducts"})!.references.length,0);
  for(const cardData of [undefined,null,[]])assert.deepEqual(aiSearchProducts({family:"qianwenProducts",result:{content:"answer",cardData}})!.cards,[]);
});

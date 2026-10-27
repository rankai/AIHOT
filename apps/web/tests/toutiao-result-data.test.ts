import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateSelectionValid } from "../app/features/admin/candidate-selection.ts";
import { defaultPlatformValues, platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";
import { toutiaoDetailRequest, toutiaoImportFields, toutiaoImportSupplement, toutiaoMediaLinks, toutiaoNativeWork, toutiaoPageFacts, toutiaoQueryParameters, toutiaoWorkFacts } from "../app/features/admin/toutiao-result-data.ts";

const id = "987654321098765432109876543210", uid = "123456789012345678901234567890";
const url = `https://www.toutiao.com/article/${id}/?share=a%2Fb`;
const draft = { uid, secUid: "", url, evidence: "已核实同一作品及作者身份", manualTarget: false };
const work = (extra: Record<string, unknown> = {}) => ({ platform: "toutiao", operationId: "28CFGF5I", identity: { uid }, workId: id, url, ...extra });

test("four native permalink forms preserve decimal IDs and the received query string", () => {
  for (const path of [`a${id}`, `group/${id}`, `article/${id}`, `video/${id}`]) {
    const address = `http://toutiao.com/${path}/?share=a%2Fb`;
    assert.deepEqual(toutiaoNativeWork(address), { id, url: address });
  }
  for (const address of ["https://toutiao.com/c/user/123/", "https://toutiao.com/tok/short", "https://v.toutiao.com/short/", `https://toutiao.com.evil.test/a${id}`, `https://user:pass@toutiao.com/a${id}`, `https://@toutiao.com/a${id}`, `https://toutiao.com:443/a${id}`, `https://toutiao.com:8443/a${id}`, `${url}#`, `${url}#part`, `https://toutiao.com/article/${id}/extra`, "https://toutiao.com/article/has-letters/", "javascript:alert(1)"]) assert.equal(toutiaoNativeWork(address), null, address);
});

test("received mobile article permalink is preserved while other mobile paths and unproved author evidence stay blocked", () => {
  const mobile = `https://m.toutiao.com/article/${id}/?share=a%2Fb`;
  assert.deepEqual(toutiaoNativeWork(mobile), { id, url: mobile });
  for (const address of [`http://m.toutiao.com/article/${id}/`, `https://m.toutiao.com/video/${id}/`, `https://m.toutiao.com.evil.test/article/${id}/`, `https://@m.toutiao.com/article/${id}/`, `${mobile}#part`]) assert.equal(toutiaoNativeWork(address), null, address);
  assert.equal(toutiaoImportFields("toutiao_work", work({provider:"agentkey",operationId:"PAB6Z75Y",url:mobile})).canImport,true);
  assert.equal(toutiaoImportFields("toutiao_work",work({provider:"agentkey",identity:{}})).canImport,true);
  for (const extra of [{workId:null},{url:null}]) assert.equal(toutiaoImportFields("toutiao_work",work({provider:"agentkey",...extra})).canImport,false);
  assert.equal(toutiaoImportFields("toutiao_account",{provider:"agentkey",identity:{uid}}).canImport,false);
});

test("unsupported received raw original cannot be replaced even when the derived url is null", () => {
  const fields = toutiaoImportFields("toutiao_work", work({ url: null, record: { opusUrl: "https://v.toutiao.com/short/" } }));
  assert.equal(fields.receivedUrl, "https://v.toutiao.com/short/");
  assert.equal(fields.needsUrl, false);
  assert.equal(fields.canImport, false);
  assert.ok(toutiaoImportSupplement(fields, draft).error);
  assert.equal(toutiaoImportFields("toutiao_work", work({ operationId: "R1IGR09H", url: null, record: { workUrl: "https://cdn.example/video.mp4" } })).canImport, false);
  assert.equal(toutiaoImportFields("toutiao_work", work({ workId: "111" })).canImport, false);
});

test("account requires received uid; display names, token and raw record IDs are not a substitute", () => {
  assert.equal(toutiaoImportFields("toutiao_account", { identity: { uid } }).canImport, true);
  for (const data of [{ identity: { secUid: "safe-id" } }, { identity: {}, record: { uid, nickname: "name", token: uid } }, { identity: { uid: "nickname" } }]) {
    const fields = toutiaoImportFields("toutiao_account", data);
    assert.equal(fields.canImport, false);
    assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
    assert.ok(toutiaoImportSupplement(fields, draft).error);
  }
  assert.equal(toutiaoImportFields("query_summary", work()).canImport, false);
});

test("uid and secUid remain distinct received author types, including same-work origin identity", () => {
  const numeric = toutiaoImportFields("toutiao_work", work());
  assert.equal(numeric.uid, uid); assert.equal(numeric.secUid, null);
  const secure = toutiaoImportFields("toutiao_work", work({ operationId: "R1IGR09H", identity: { secUid: "opaque%2B+/_-==" } }));
  assert.equal(secure.uid, null); assert.equal(secure.secUid, "opaque%2B+/_-=="); assert.equal(Object.hasOwn(secure, "needsIdentity"), false);
  const origin = toutiaoImportFields("toutiao_work", work({ operationId: "PAB6Z75Y", identity: { uid, secUid: "safe-id" }, originResultId: 12 }));
  assert.equal(origin.uid, uid); assert.equal(origin.secUid, "safe-id");
  const missing = toutiaoImportFields("toutiao_work", work({ identity: {}, record: { uid, secUid: "safe-id", token: "locator" } }));
  assert.equal(Object.hasOwn(missing, "needsIdentity"), false);
});

test("manual original must agree with both received/derived ID and detail request ID", () => {
  const fields = toutiaoImportFields("toutiao_work", work({ url: null, operationId: "PAB6Z75Y", requestedWorkId: id }));
  assert.deepEqual(toutiaoImportSupplement(fields, draft), { supplement: { url, evidence: draft.evidence } });
  assert.ok(toutiaoImportSupplement(fields, { ...draft, url: url.replace(id, "111") }).error);
  assert.ok(toutiaoImportSupplement(toutiaoImportFields("toutiao_work", work({ workId: null, url: null, operationId: "PAB6Z75Y", requestedWorkId: "111" })), draft).error);
  assert.deepEqual(toutiaoImportSupplement(toutiaoImportFields("toutiao_work", work({ workId: null, url: null })), draft), { supplement: { url, evidence: draft.evidence } });
  assert.equal(toutiaoImportFields("toutiao_work", work({ operationId: "PAB6Z75Y", requestedWorkId: "111" })).canImport, false);
});

test("complete received fields are not overwritten by hidden or stale supplement drafts", () => {
  const fields = toutiaoImportFields("toutiao_work", work());
  assert.deepEqual(toutiaoImportSupplement(fields, { url: "https://example.com/replace", evidence: "stale" }), {});
  assert.deepEqual(toutiaoImportSupplement(fields, draft), {});
  assert.deepEqual(toutiaoImportSupplement(toutiaoImportFields("toutiao_account", { identity: { uid } }), draft), {});
});

test("missing work author is optional and never emits author supplements", () => {
  const fields = toutiaoImportFields("toutiao_work", work({ identity: {} }));
  assert.equal(fields.canImport, true); assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.deepEqual(toutiaoImportSupplement(fields, { url: "", evidence: "" }), {});
  const missing = toutiaoImportFields("toutiao_work", work({ identity: {}, url: null }));
  assert.deepEqual(toutiaoImportSupplement(missing, { url, evidence: draft.evidence }), { supplement: { url, evidence: draft.evidence } });
});

test("complete received work does not require author relation evidence", () => {
  const fields = toutiaoImportFields("toutiao_work", work());
  assert.deepEqual(toutiaoImportSupplement(fields, { url: "", evidence: "" }), {});
  assert.deepEqual(toutiaoImportSupplement(fields, draft), {});
  const missing = toutiaoImportFields("toutiao_work", work({ identity: {} }));
  assert.deepEqual(toutiaoImportSupplement(missing, { url: "", evidence: "" }), {});
});

test("account candidate selection still requires the current completed candidate page", () => {
  const rows = [{ id: "editorial", participation_mode: "editorial" }];
  assert.equal(candidateSelectionValid("editorial", "idle", "external", "external", rows), true);
  for (const state of ["loading", "submitting"]) assert.equal(candidateSelectionValid("editorial", state, "external", "external", rows), false);
  assert.equal(candidateSelectionValid("editorial", "idle", "external", "external", []), false);
});

test("explicit same-work detail uses only numeric work ID and actual result PK", () => {
  for (const operationId of ["28CFGF5I", "R1IGR09H"]) assert.deepEqual(toutiaoDetailRequest(42, "toutiao_work", work({ operationId, identity: {}, origin: { discoveredAt: "manual" }, requestedWorkId: "999" })), { operationId: "PAB6Z75Y", parameters: { opusId: id }, sourceResultId: 42 });
  for (const workId of [null, "", "1e20", "slug", "https://toutiao.com/a123"]) assert.equal(toutiaoDetailRequest(42, "toutiao_work", work({ workId })), null);
  for (const operationId of ["4QS1F8DE", "PAB6Z75Y", "other"]) assert.equal(toutiaoDetailRequest(42, "toutiao_work", work({ operationId })), null);
  assert.equal(toutiaoDetailRequest(42, "toutiao_account", work()), null);
  assert.equal(toutiaoDetailRequest(42, "toutiao_work", work({ platform: "other" })), null);
  for (const pk of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(toutiaoDetailRequest(pk, "toutiao_work", work()), null);
});

test("required digit offsets remain full strings and follow descriptor defaults without number conversion", () => {
  const op: PlatformOperation = { id: "28CFGF5I", platform: "toutiao", label: "search", purpose: "query", schedulableType: null, fields: [{ name: "keyword", label: "keyword", type: "string", required: true }, { name: "offset", label: "offset", type: "string", required: true, default: "0" }] };
  assert.equal(defaultPlatformValues(op).offset, "0");
  assert.deepEqual(toutiaoQueryParameters(op, { keyword: " query ", offset: `00${id}` }), { keyword: "query", offset: `00${id}` });
  for (const offset of ["", "-1", "1.5", "1e20", "next"]) assert.throws(() => toutiaoQueryParameters(op, { keyword: "query", offset }));
  const accountWorks: PlatformOperation = { ...op, id: "R1IGR09H", fields: [{ name: "category", label: "category", type: "select", required: true, options: ["profile_all", "pc_profile_article", "pc_profile_video", "pc_profile_ugc", "profile_wenda", "pc_profile_short_video"].map(value => ({ value, label: value })) }, { name: "token", label: "token", type: "string", required: true }, op.fields[1]!] };
  assert.deepEqual(toutiaoQueryParameters(accountWorks, { category: "profile_all", token: "locator-not-uid", offset: "0" }), { category: "profile_all", token: "locator-not-uid", offset: "0" });
  assert.throws(() => toutiaoQueryParameters(accountWorks, { category: "all", token: "locator", offset: "0" }));
});

test("account-search opaque offset/searchId preserve whitespace and empty strings without changing shared trim", () => {
  const op: PlatformOperation = { id: "4QS1F8DE", platform: "toutiao", label: "account", purpose: "query", schedulableType: null, fields: [{ name: "name", label: "name", type: "string", required: true }, { name: "offset", label: "offset", type: "string", required: false }, { name: "searchId", label: "searchId", type: "string", required: false }] };
  const values = { name: " query ", offset: "  opaque%2B+/_-==  ", searchId: " " };
  assert.deepEqual(toutiaoQueryParameters(op, values), { name: "query", offset: values.offset, searchId: " " });
  assert.deepEqual(toutiaoQueryParameters(op, { name: "query", offset: "", searchId: "" }), { name: "query", offset: "", searchId: "" });
  assert.deepEqual(platformParameters(op, values), { name: "query", offset: values.offset.trim() });
});

test("false work flags and per-item pagination survive; only search time and account-work duration have units", () => {
  const search = toutiaoWorkFacts({ operationId: "28CFGF5I", record: { workType: false, hasVideo: false, hasNext: false, publishTime: "1730000000", duration: "3" } });
  assert.equal(search.workType, false); assert.equal(search.hasVideo, false); assert.equal(search.hasNext, false);
  assert.equal(search.publishTimeUnit, "秒"); assert.equal(search.durationUnit, "单位未说明");
  assert.equal(toutiaoWorkFacts({ operationId: "R1IGR09H", record: { duration: 0 } }).durationUnit, "秒");
  assert.equal(toutiaoWorkFacts({ operationId: "PAB6Z75Y", record: { duration: 0 } }).durationUnit, "单位未说明");
  assert.deepEqual(toutiaoPageFacts({ operationId: "28CFGF5I", hasMore: true, pageCount: 3 }), []);
  assert.equal(toutiaoPageFacts({ operationId: "R1IGR09H", hasMore: false, offset: "0" })[0]?.[1], "否（false）");
  assert.equal(toutiaoPageFacts({ operationId: "R1IGR09H" })[0]?.[1], "未提供");
  assert.deepEqual(toutiaoPageFacts({ operationId: "4QS1F8DE", hasMore: true, offset: "  opaque  ", searchId: "" }).slice(1), [["上游 offset", "  opaque  "], ["上游 searchId", "空字符串"]]);
});

test("only safe received image/video arrays become media anchors, never an inferred original", () => {
  assert.deepEqual(toutiaoMediaLinks({ imageList: ["https://cdn.example/picture.jpg", "javascript:alert(1)", "https://user:pass@cdn.example/unsafe.jpg"], downloadUrl: ["https://cdn.example/video.mp4", "data:video/mp4;base64,abc"], opusUrl: url }).map(link => [link.key, link.url]), [["imageList:0", "https://cdn.example/picture.jpg"], ["downloadUrl:0", "https://cdn.example/video.mp4"]]);
  assert.deepEqual(toutiaoMediaLinks({ imageList: "https://cdn.example/picture.jpg", downloadUrl: null }), []);
});

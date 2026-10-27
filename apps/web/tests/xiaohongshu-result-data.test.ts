import assert from "node:assert/strict";
import { test } from "node:test";
import { xiaohongshuImportFields, xiaohongshuNativeNote, xiaohongshuRoleLabel } from "../app/features/admin/xiaohongshu-result-data.ts";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";

const id = "00AbC_note-987654321098765432109876543210";
const address = `https://www.xiaohongshu.com/explore/${id}?xsec_token=a%2Fb%2B%3D&xsec_source=pc_search`;

test("opaque note IDs retain case, leading zeros and signed URL bytes", () => {
  assert.deepEqual(xiaohongshuNativeNote(address), { id, url: address });
  const otherSignature = address.replace("a%2Fb%2B%3D", "different%2Btoken");
  assert.equal(xiaohongshuNativeNote(otherSignature)?.id, id);
  assert.equal(xiaohongshuNativeNote(otherSignature)?.url, otherSignature);
  assert.equal(xiaohongshuNativeNote(`http://xiaohongshu.com/explore/${id}/`)?.id, id);
  assert.notEqual(xiaohongshuNativeNote(address.replace("00AbC", "00abc"))?.id, id);
});

test("witnessed HTTPS discovery/item keeps signed bytes and matches AgentKey received note identity", () => {
  const discovery=address.replace("/explore/","/discovery/item/");
  assert.deepEqual(xiaohongshuNativeNote(discovery),{id,url:discovery});
  assert.equal(xiaohongshuNativeNote(discovery.replace("https:","http:")),null);
  const complete={provider:"agentkey",identity:{userId:"received-author"},workId:id,url:discovery,importable:false};
  assert.equal(xiaohongshuImportFields("xiaohongshu_work",{...complete,identity:{}}).canImport,true,"historical false hint does not override complete response proof");
  for(const change of [{workId:null},{url:null},{url:discovery.replace(id,"other-note")}]) {
    const fields=xiaohongshuImportFields("xiaohongshu_work",{...complete,...change},address);
    assert.equal(fields.canImport,false); assert.equal(Object.hasOwn(fields, "needsIdentity"),false); assert.equal(fields.needsUrl,false);
  }
  assert.equal(xiaohongshuImportFields("xiaohongshu_work",{...complete,role:"provider_recommendation"}).canImport,false);
  assert.equal(xiaohongshuImportFields("xiaohongshu_work",{...complete,provider:"redfox",role:"provider_recommendation"}).canImport,true,"Redfox keeps its existing recommendation work flow");
});

test("only native note paths without credentials, explicit ports or fragments classify as originals", () => {
  for (const url of [
    "https://xhslink.com/short", `https://xiaohongshu.com/user/profile/${id}`,
    `https://example.com/explore/${id}`, `https://xiaohongshu.com.evil.test/explore/${id}`,
    `https://user:pass@xiaohongshu.com/explore/${id}`, `https://xiaohongshu.com:8443/explore/${id}`,
    `https://xiaohongshu.com:443/explore/${id}`, `${address}#`, `${address}#section`,
    "https://xiaohongshu.com/explore/with.dot", "https://xiaohongshu.com/explore/encoded%2Fid",
    "https://xiaohongshu.com/explore/", `https://xiaohongshu.com/explore/${id}/extra`, "javascript:alert(1)",
  ]) assert.equal(xiaohongshuNativeNote(url), null, url);
});

test("received non-native addresses cannot be replaced, and received native ID disagreement blocks import", () => {
  for (const receivedUrl of ["https://xhslink.com/short", "https://example.com/note", "https://xiaohongshu.com/user/profile/author"]) {
    const fields = xiaohongshuImportFields("xiaohongshu_work", { identity: { userId: "author" }, workId: id, url: receivedUrl }, address);
    assert.equal(fields.needsUrl, false);
    assert.equal(fields.canImport, false);
    assert.match(fields.blockedReason!, /不能直接替换/);
  }
  const mismatch = xiaohongshuImportFields("xiaohongshu_work", { identity: { userId: "author" }, workId: "different-case-ID", url: address });
  assert.equal(mismatch.canImport, false);
  assert.match(mismatch.blockedReason!, /不一致/);
});

test("account search display identities cannot be manually upgraded, and research kinds never import", () => {
  const search = xiaohongshuImportFields("xiaohongshu_account", { operationId: "439NFLBD", identity: {}, record: { userId: "raw-only", accountId: "display-number" } });
  assert.equal(search.canImport, false);
  assert.equal(Object.hasOwn(search, "needsIdentity"), false, "the account dialog must never offer manual identity supplementation");
  assert.equal(xiaohongshuImportFields("xiaohongshu_account", { operationId: "4IVIDHEN", identity: { userId: "received-user" } }).canImport, true);
  for (const kind of ["xiaohongshu_account_rank", "xiaohongshu_research"]) assert.equal(xiaohongshuImportFields(kind, { identity: { userId: "not-authority-for-this-kind" }, url: address }).canImport, false);
});

test("AI raw authorId and photoId do not supply identity while a native original can identify only the note", () => {
  const fields = xiaohongshuImportFields("xiaohongshu_work", { operationId: "047JJ3UA", identity: {}, workId: null, url: address, record: { photoId: id, authorId: "not-confirmed-user", userName: "display" } });
  assert.equal(fields.workId, null);
  assert.equal(fields.native?.id, id);
  assert.equal(fields.userId, null);
  assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.equal(fields.needsUrl, false);
  assert.equal(fields.canImport, true, "only missing author identity and evidence remain supplementable");
});

test("dark-rank received author and note ID require only the missing original, not another author input", () => {
  const fields = xiaohongshuImportFields("xiaohongshu_work", { operationId: "P3W2W18P", identity: { userId: "confirmed-user" }, workId: id, url: null, record: { userId: "confirmed-user", photoId: id } }, address);
  assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
  assert.equal(fields.needsUrl, true);
  assert.equal(fields.canImport, true);
  assert.equal(fields.native?.id, fields.workId);
  for (const operationId of ["LBYLC5AK", "AEA6YE0J"]) {
    const received = xiaohongshuImportFields("xiaohongshu_work", { operationId, identity: { userId: "server-confirmed-profile-author" }, workId: id, url: address });
    assert.equal(Object.hasOwn(received, "needsIdentity"), false);
    assert.equal(received.needsUrl, false);
  }
});

test("main results retain their role even without a keyword, separate from provider recommendations", () => {
  assert.equal(xiaohongshuRoleLabel("keyword_match"), "主查询结果");
  assert.equal(xiaohongshuRoleLabel("provider_recommendation"), "上游推荐候选");
  assert.equal(xiaohongshuRoleLabel(undefined), null);
  assert.equal(xiaohongshuRoleLabel("unknown"), null);
});

test("descriptor inputs preserve opaque IDs, signed originals, false booleans and stepped numeric offsets", () => {
  const operation: PlatformOperation = { id: "xhs-input-test", platform: "xiaohongshu", label: "输入测试", purpose: "query", schedulableType: null, fields: [
    { name: "workId", label: "作品 ID", type: "string", required: true },
    { name: "workLink", label: "原文", type: "string", required: false },
    { name: "exactMatch", label: "精准匹配", type: "boolean", required: false },
    { name: "offset", label: "偏移量", type: "integer", required: false, constraints: { min: 0, max: Number.MAX_SAFE_INTEGER, step: 20 } },
  ] };
  assert.deepEqual(platformParameters(operation, { workId: id, workLink: address, exactMatch: "false", offset: "40" }), { workId: id, workLink: address, exactMatch: false, offset: 40 });
  assert.throws(() => platformParameters(operation, { workId: id, offset: "21" }));
  assert.deepEqual(platformParameters(operation, { workId: id, exactMatch: "" }), { workId: id });
});

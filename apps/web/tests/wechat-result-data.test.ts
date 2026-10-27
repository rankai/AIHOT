import assert from "node:assert/strict";
import { test } from "node:test";
import { wechatArticleLink, wechatImportFields } from "../app/features/admin/wechat-result-data.ts";

test("account and ranking imports need received stable identity, never a display name or arbitrary numeric rank ID", () => {
  assert.equal(wechatImportFields("wechat_account", { identity: {}, record: { accountName: "同名账号", account: "display" } }).canImport, false);
  assert.equal(wechatImportFields("wechat_account_rank", { identity: {}, record: { account_id: "123" } }).canImport, false);
  assert.equal(wechatImportFields("wechat_account_rank", { identity: { wxId: "gh_verified" } }).canImport, true);
});
test("work imports do not request an unnecessary alternate identity; only missing inputs are presented", () => {
  const address = "https://mp.weixin.qq.com/s/short_link";
  for (const identity of [{ wxId: "gh_verified" }, { bizInfo: "confirmed-biz" }]) {
    const fields = wechatImportFields("wechat_work", { identity, url: address });
    assert.equal(fields.canImport, true);
    assert.equal(Object.hasOwn(fields, "needsIdentity"), false);
    assert.equal(fields.needsUrl, false);
  }
  const long = "https://mp.weixin.qq.com/s?__biz=confirmed-biz&mid=123&idx=1";
  const received = wechatImportFields("wechat_work", { identity: {}, url: long });
  assert.equal(Object.hasOwn(received, "needsIdentity"), false);
  assert.equal(received.needsUrl, false);
  const supplied = wechatImportFields("wechat_work", { identity: {}, url: null }, long);
  assert.equal(Object.hasOwn(supplied, "needsIdentity"), false);
  assert.equal(supplied.needsUrl, true, "the supplied URL and evidence still need to be sent");
});
test("article link hints reject credentialed or wrong-host URLs without replacing backend article verification", () => {
  for (const value of ["https://user:secret@mp.weixin.qq.com/s/a", "https://mp.weixin.qq.com.evil.test/s/a", "javascript:alert(1)", "https://mp.weixin.qq.com:8443/s/a"]) assert.equal(wechatArticleLink(value), null);
  assert.equal(wechatArticleLink("https://mp.weixin.qq.com/s/article"), "https://mp.weixin.qq.com/s/article");
});
test("AgentKey article imports require received original while author identity is optional and manual supplements remain closed", () => {
  const data = { provider: "agentkey", identity: {}, url: "https://mp.weixin.qq.com/s/short" };
  assert.equal(wechatImportFields("wechat_work", data).canImport, true);
  assert.equal(wechatImportFields("wechat_work", { ...data, identity: { wxId: "gh_verified@app" } }).canImport, true);
  assert.equal(wechatImportFields("wechat_work", { ...data, url: "https://mp.weixin.qq.com/s?__biz=verified&mid=123&idx=1" }).canImport, true);
  assert.equal(wechatImportFields("wechat_work", { ...data, url: null, identity: { wxId: "gh_verified" } }).canImport, false);
  for (const kind of ["wechat_comment", "wechat_reply", "wechat_stats"]) assert.equal(wechatImportFields(kind, { ...data, identity: { wxId: "gh_verified" } }).canImport, false);
});

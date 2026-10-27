import assert from "node:assert/strict";
import { test } from "node:test";
import { douyinImportFields, douyinNativeVideo } from "../app/features/admin/douyin-result-data.ts";
import { platformParameters, type PlatformOperation } from "../app/features/admin/platform-types.ts";
const id = "987654321098765432109876543210";
const address = `https://www.douyin.com/video/${id}`;
test("native permalinks preserve complete string work IDs across both documented hosts", () => {
  for (const url of [address, `http://douyin.com/video/${id}/?tracking=1`, `https://www.iesdouyin.com/share/video/${id}/`]) assert.equal(douyinNativeVideo(url)?.id, id);
  assert.equal(douyinNativeVideo("https://douyin.com/video/00123")?.id, "00123");
});
test("short links, homepages, fake native hosts, credentials, ports and fragments cannot serve as native originals", () => {
  for (const url of ["https://v.douyin.com/short/", "https://douyin.com/user/author", `https://example.com/video/${id}`, `https://douyin.com.evil.test/video/${id}`, `https://user:pass@douyin.com/video/${id}`, `https://douyin.com:8443/video/${id}`, `${address}#time`, `${address}#`, "javascript:alert(1)"]) assert.equal(douyinNativeVideo(url), null, url);
});
test("received non-native URLs and mismatched work IDs block replacement while missing URLs remain supplementable", () => {
  const short = douyinImportFields("douyin_work", { identity: { uid: "author" }, workId: id, url: "https://v.douyin.com/short/" }, address);
  assert.equal(short.canImport, false);
  assert.equal(short.needsUrl, false, "a received short link cannot be replaced by a supplement");
  assert.match(short.blockedReason!, /不能直接替换/);
  assert.equal(douyinImportFields("douyin_work", { identity: { uid: "author" }, workId: "different-id", url: address }).canImport, false);
  const missing = douyinImportFields("douyin_work", { identity: { uid: "author" }, workId: id, url: null });
  assert.equal(missing.canImport, true);
  assert.equal(missing.needsUrl, true);
});
test("AI placeholder IDs and display names never provide author identity; native URLs may provide only the work ID", () => {
  const fields = douyinImportFields("douyin_work", { identity: {}, workId: null, url: address, record: { photoId: id, authorId: "looks-like-uid", userName: "display" } });
  assert.equal(fields.native?.id, id);
  assert.equal(fields.needsIdentity, true);
  assert.equal(fields.needsUrl, false);
  assert.equal(douyinImportFields("douyin_account", { identity: {}, record: { accountId: "display", uid: "unconfirmed" } }).canImport, false);
  assert.equal(douyinImportFields("douyin_account", { identity: { secUserId: "opaque-secure-id" } }).canImport, true);
  assert.equal(douyinImportFields("douyin_account_rank", { identity: { uid: "author" }, record: { accountName: "rank" } }).canImport, false);
});
test("Douyin inputs retain string IDs, literal false and numeric step-based offsets", () => {
  const operation: PlatformOperation = { id: "douyin-test", platform: "douyin", label: "抖音测试", purpose: "query", schedulableType: null, fields: [
    { name: "videoId", label: "原生作品 ID", type: "string", required: true },
    { name: "exactMatch", label: "精准匹配", type: "boolean", required: false },
    { name: "offset", label: "偏移量", type: "integer", required: false, constraints: { min: 0, max: Number.MAX_SAFE_INTEGER, step: 20 } },
  ] };
  assert.deepEqual(platformParameters(operation, { videoId: id, exactMatch: "false", offset: "20" }), { videoId: id, exactMatch: false, offset: 20 });
  assert.throws(() => platformParameters(operation, { videoId: id, offset: "19" }));
});

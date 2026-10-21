import assert from "node:assert/strict";
import { test } from "node:test";
import { bilibiliImportFields, bilibiliImportSupplement, bilibiliNativeVideo } from "../app/features/admin/bilibili-result-data.ts";
import { defaultPlatformValues, platformParameters, type PlatformField, type PlatformOperation } from "../app/features/admin/platform-types.ts";

const bv = "BV1ghJg6hEWV";
const url = `https://www.bilibili.com/video/${bv}?spm_id_from=333.example`;
const mid = "987654321098765432109876543210";
const draft = { mid, url, evidence: "已核实该 BV 原文与作者 MID" };

test("native BV permalinks preserve case, original query bytes and fixed length", () => {
  assert.deepEqual(bilibiliNativeVideo(url), { url, id: bv });
  assert.equal(bilibiliNativeVideo(`http://bilibili.com/video/${bv}/`)?.id, bv);
  assert.notEqual(bilibiliNativeVideo(url.replace("ghJg", "ghjg"))?.id, bv);
  for (const address of [`https://bilibili.com/video/${bv}x`, `https://bilibili.com/video/${bv.slice(0, -1)}`, url.replace("/BV", "/bv")]) assert.equal(bilibiliNativeVideo(address), null);
});

test("short, AV, cover, profile and unsafe addresses cannot serve as manually supplied originals", () => {
  for (const address of [
    "https://b23.tv/singleSlug", "https://bilibili.com/video/av12345", "https://i0.hdslb.com/cover.jpg",
    "https://space.bilibili.com/946974", `https://example.com/video/${bv}`, `https://bilibili.com.evil.test/video/${bv}`,
    `https://user:pass@bilibili.com/video/${bv}`, `https://bilibili.com:8443/video/${bv}`, `https://bilibili.com:443/video/${bv}`,
    `${url}#`, `${url}#part`, `https://bilibili.com/video/${bv}/extra`, "javascript:alert(1)",
  ]) assert.equal(bilibiliNativeVideo(address), null, address);
});

test("received original and BV disagreement blocks import instead of allowing replacement", () => {
  const mismatch = bilibiliImportFields("bilibili_work", { identity: { mid }, workId: "BV1wE7P6bESL", url });
  assert.equal(mismatch.canImport, false);
  assert.ok(bilibiliImportSupplement(mismatch, draft).error);
  const short = bilibiliImportFields("bilibili_work", { identity: { mid }, workId: bv, url: "https://b23.tv/slug" }, url);
  assert.equal(short.needsUrl, false);
  assert.equal(short.canImport, false);
  assert.ok(bilibiliImportSupplement(short, draft).error);
});

test("account imports require received MID, never a raw nickname or manually supplemented identity", () => {
  const account = bilibiliImportFields("bilibili_account", { identity: { mid }, record: { name: "name" } });
  assert.equal(account.canImport, true);
  assert.equal(account.mid, mid);
  assert.deepEqual(bilibiliImportSupplement(account, draft), {});
  const missing = bilibiliImportFields("bilibili_account", { identity: {}, record: { mid, name: "name" } });
  assert.equal(missing.canImport, false);
  assert.equal(missing.needsIdentity, false);
  assert.ok(bilibiliImportSupplement(missing, draft).error);
  assert.equal(bilibiliImportFields("query_summary", { identity: { mid }, workId: bv, url }).canImport, false);
});

test("work author uses the verified identity DTO while cover and outer account context do not fill missing identity", () => {
  const missing = bilibiliImportFields("bilibili_work", { identity: {}, workId: null, url: null, accountMid: mid, record: { authorId: mid, picUrl: url, author: "name" } });
  assert.equal(missing.mid, null);
  assert.equal(missing.needsIdentity, true);
  assert.equal(missing.needsUrl, true, "a cover is not an original URL even when it looks like a BV link");
  const received = bilibiliImportFields("bilibili_work", { identity: { mid }, workId: bv, url, accountMid: mid });
  assert.equal(received.needsIdentity, false);
  assert.deepEqual(bilibiliImportSupplement(received, { mid: "other", url: "https://example.com/replace", evidence: "changed" }), {}, "received fields are not sent as overrides");
});

test("missing original requires native BV agreement and evidence, then accepts a corrected draft", () => {
  const fields = bilibiliImportFields("bilibili_work", { identity: { mid }, workId: bv });
  assert.equal(fields.needsIdentity, false);
  assert.ok(bilibiliImportSupplement(fields, { ...draft, url: url.replace(bv, "BV1wE7P6bESL") }).error);
  assert.ok(bilibiliImportSupplement(fields, { ...draft, url: "https://b23.tv/slug" }).error);
  assert.ok(bilibiliImportSupplement(fields, { ...draft, evidence: " " }).error);
  assert.deepEqual(bilibiliImportSupplement(fields, draft), { supplement: { url, evidence: draft.evidence } });
});

test("missing author accepts an unrounded decimal MID with evidence, and only emits fields actually missing", () => {
  const fields = bilibiliImportFields("bilibili_work", { identity: {}, workId: bv, url });
  for (const invalid of ["", "-1", "12.3", "nickname"]) assert.ok(bilibiliImportSupplement(fields, { ...draft, mid: invalid }).error);
  assert.ok(bilibiliImportSupplement(fields, { ...draft, evidence: "" }).error);
  assert.deepEqual(bilibiliImportSupplement(fields, draft), { supplement: { mid, evidence: draft.evidence } });
  const both = bilibiliImportFields("bilibili_work", { identity: {}, workId: null });
  assert.deepEqual(bilibiliImportSupplement(both, draft), { supplement: { mid, url, evidence: draft.evidence } });
});

test("search page remains string while account-list page is integer; false, size limit and large MID survive forms", () => {
  const fields: PlatformField[] = [
    { name: "page", label: "页码", type: "string", required: true },
    { name: "pageSize", label: "每页条数", type: "integer", required: false, default: 10, constraints: { min: 1, max: 50 } },
    { name: "exactMatch", label: "精准匹配", type: "boolean", required: false, default: false },
  ];
  const search: PlatformOperation = { id: "LEN9QXR3", platform: "bilibili", label: "搜索", purpose: "query", schedulableType: null, fields };
  assert.equal(defaultPlatformValues(search).exactMatch, "false");
  assert.deepEqual(platformParameters(search, { page: mid, pageSize: "50", exactMatch: "false" }), { page: mid, pageSize: 50, exactMatch: false });
  assert.deepEqual(platformParameters(search, { page: "2", exactMatch: "" }), { page: "2" });
  assert.throws(() => platformParameters(search, { page: "1", pageSize: "51" }));
  const list: PlatformOperation = { ...search, id: "VPA67I98", fields: [{ name: "mid", label: "MID", type: "string", required: false }, { name: "page", label: "页码", type: "integer", required: false, constraints: { min: 1, max: Number.MAX_SAFE_INTEGER } }] };
  assert.deepEqual(platformParameters(list, { mid, page: "2" }), { mid, page: 2 });
  assert.throws(() => platformParameters(list, { mid, page: mid }));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { tiktokImportFields, tiktokImportSupplement, tiktokNativeVideo, tiktokPublicationTime } from "../app/features/admin/tiktok-result-data.ts";
import { platformParameters, type PlatformField, type PlatformOperation } from "../app/features/admin/platform-types.ts";

const id = "987654321098765432109876543210";
const url = `https://www.tiktok.com/@account.name-1_/video/${id}?share_item_id=${id}&token=a%2Fb`;
const draft = { url, identityType: "userId" as const, identityValue: "confirmed-author", evidence: "已核实作者与原文对应关系" };

test("native TikTok video links retain decimal ID strings, handles and received query bytes", () => {
  assert.deepEqual(tiktokNativeVideo(url), { url, id });
  assert.equal(tiktokNativeVideo("http://tiktok.com/@name/video/000123/")?.id, "000123");
  assert.equal(tiktokNativeVideo(`https://tiktok.com/@another_handle/video/${id}`)?.id, id);
});

test("short/photo/profile and unsafe or non-native URLs do not become importable video originals", () => {
  for (const address of [
    "https://vm.tiktok.com/short/", "https://vt.tiktok.com/short/", `https://tiktok.com/@name/photo/${id}`,
    "https://www.tiktok.com/@name", `https://example.com/@name/video/${id}`, `https://tiktok.com.evil.test/@name/video/${id}`,
    `https://user:pass@tiktok.com/@name/video/${id}`, `https://tiktok.com:8443/@name/video/${id}`,
    `${url}#`, `${url}#part`, `https://tiktok.com/video/${id}`, "https://tiktok.com/@name/video/not-decimal",
    `https://tiktok.com/@name/video/${id}/extra`, `https://tiktok.com/@name%2Fother/video/${id}`, "javascript:alert(1)",
  ]) assert.equal(tiktokNativeVideo(address), null, address);
});

test("received invalid originals cannot be silently replaced and mismatched native IDs block import", () => {
  for (const address of ["https://vm.tiktok.com/short/", `https://tiktok.com/@name/photo/${id}`]) {
    const fields = tiktokImportFields("tiktok_work", { identity: { userId: "author" }, workId: id, url: address }, url);
    assert.equal(fields.canImport, false);
    assert.equal(fields.needsUrl, false);
    assert.ok(tiktokImportSupplement(fields, draft).error);
  }
  assert.equal(tiktokImportFields("tiktok_work", { identity: { secUserId: "secure-author" }, workId: "different-id", url }).canImport, false);
});

test("account binding needs received typed identity while topic and summary records never import", () => {
  for (const identity of [{ userId: id }, { secUserId: "opaque-sec-id" }, { userId: id, secUserId: "opaque-sec-id" }]) {
    const fields = tiktokImportFields("tiktok_account", { identity });
    assert.equal(fields.canImport, true);
    assert.equal(fields.needsIdentity, false);
    assert.deepEqual(tiktokImportSupplement(fields, draft), {}, "account imports never send a manual supplement");
  }
  const displayOnly = tiktokImportFields("tiktok_account", { identity: {}, record: { userHandle: "name", userId: "raw-not-confirmed" } });
  assert.equal(displayOnly.canImport, false);
  assert.equal(displayOnly.needsIdentity, false);
  for (const kind of ["tiktok_topic", "query_summary"]) assert.equal(tiktokImportFields(kind, { identity: { userId: id }, url }).canImport, false);
});

test("work identity follows the received author DTO, never a requested collector or handle", () => {
  const unconfirmed = tiktokImportFields("tiktok_work", { identity: {}, workId: id, url, parameters: { sec_user_id: "collector" }, record: { authorData: { userHandle: "display", userId: "raw-only" } } });
  assert.equal(unconfirmed.needsIdentity, true);
  const received = tiktokImportFields("tiktok_work", { identity: { userId: "actual-author" }, workId: id, url });
  assert.equal(received.userId, "actual-author");
  assert.equal(received.needsIdentity, false);
  assert.deepEqual(tiktokImportSupplement(received, { ...draft, identityValue: "different-author", url: "https://example.com/replace" }), {}, "received identity and original are not emitted as overrides");
});

test("missing original requires matching native ID and evidence, then allows correction without changing received author", () => {
  const fields = tiktokImportFields("tiktok_work", { identity: { userId: "actual-author" }, workId: id });
  assert.equal(fields.needsIdentity, false);
  assert.equal(fields.needsUrl, true);
  assert.ok(tiktokImportSupplement(fields, { ...draft, url: url.replace(id, "123") }).error);
  assert.ok(tiktokImportSupplement(fields, { ...draft, evidence: " " }).error);
  assert.deepEqual(tiktokImportSupplement(fields, draft), { supplement: { url, evidence: draft.evidence } });
});

test("missing author accepts only the explicitly chosen identity type with evidence", () => {
  const fields = tiktokImportFields("tiktok_work", { identity: {}, workId: id, url });
  assert.ok(tiktokImportSupplement(fields, { ...draft, identityValue: " " }).error);
  assert.ok(tiktokImportSupplement(fields, { ...draft, evidence: "" }).error);
  assert.deepEqual(tiktokImportSupplement(fields, { ...draft, identityType: "secUserId", identityValue: " secure-author " }), { supplement: { secUserId: "secure-author", evidence: draft.evidence } });
  const bothMissing = tiktokImportFields("tiktok_work", { identity: {}, workId: id });
  assert.deepEqual(tiktokImportSupplement(bothMissing, draft), { supplement: { userId: "confirmed-author", url, evidence: draft.evidence } });
});

test("publication display treats safe integers as Unix seconds and does not guess invalid times", () => {
  assert.equal(tiktokPublicationTime(0), "1970-01-01T00:00:00.000Z");
  assert.equal(tiktokPublicationTime("1700000000"), "2023-11-14T22:13:20.000Z");
  for (const value of [null, undefined, "2026-01-01 12:00:00", "1.5", 1.5, id, 10 ** 15]) assert.equal(tiktokPublicationTime(value), null);
});

test("the seven descriptor forms retain large ID/cursor/count text and only convert declared integer filters", () => {
  const string = (name: string): PlatformField => ({ name, label: name, type: "string", required: true });
  const cases: Array<{ id: string; fields: PlatformField[]; values: Record<string, string>; expected?: Record<string, string | number> }> = [
    { id: "6SE9WIHJ", fields: [string("awemeId")], values: { awemeId: id } },
    { id: "R473NUE9", fields: [string("secUserId")], values: { secUserId: "opaque-sec-id" } },
    { id: "PXZXY8KQ", fields: [string("keyword"), string("offset"), string("count"), { name: "sortType", label: "sort", type: "select", required: false, options: [{ value: "0", label: "相关" }, { value: "1", label: "点赞" }] }], values: { keyword: "query", offset: id, count: id, sortType: "0" } },
    { id: "VBBTYLMV", fields: [string("keyword"), string("offset"), string("count"), { name: "followerCountFilter", label: "filter", type: "integer", required: false, constraints: { min: 1, max: 4 } }], values: { keyword: "author", offset: id, count: id, followerCountFilter: "4" }, expected: { keyword: "author", offset: id, count: id, followerCountFilter: 4 } },
    { id: "API_1790149158205", fields: [string("ch_id"), string("cursor")], values: { ch_id: id, cursor: id } },
    { id: "API_1790581450500", fields: [string("sec_user_id"), string("max_cursor")], values: { sec_user_id: "collector", max_cursor: id } },
    { id: "API_1790149281139", fields: [string("keyword"), string("offset")], values: { keyword: "topic", offset: id } },
  ];
  for (const item of cases) {
    const operation: PlatformOperation = { id: item.id, platform: "tiktok", label: item.id, purpose: "query", schedulableType: null, fields: item.fields };
    assert.deepEqual(platformParameters(operation, item.values), item.expected ?? item.values, item.id);
  }
});

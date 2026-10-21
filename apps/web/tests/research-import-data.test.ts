import assert from "node:assert/strict";
import { test } from "node:test";
import { researchImportBody, researchImportCandidates, researchImportState, researchSupplementFields } from "../app/features/admin/research-import-data.ts";
type Result = Parameters<typeof researchImportBody>[0];
const result = (platform: string, suffix = "work", data = {}): Result => ({ kind: `${platform}_${suffix}`, data: { platform, ...data }, sourceId: null, articleId: null });
const input = { reason: " 核实并导入 ", target: "auto", sourceId: "", requestState: "idle", rows: [], values: {}, evidence: "" };
const huge = "000900719925474099312345";

test("only five platforms' works and received-ID accounts expose local import; existing relations prevent repeats", () => {
  for (const platform of ["qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu"]) {
    assert.equal(researchImportState(result(platform)).canImport, true);
    assert.equal(researchImportState({ ...result(platform), sourceId: "author" }).canImport, false);
    assert.equal(researchImportState({ ...result(platform), articleId: "legacy" }).linked, true);
    assert.equal(researchImportState({ ...result(platform), kind: "query_summary" }).canImport, false);
  }
  for (const platform of ["dongchedi", "yiche", "baijiahao"]) {
    assert.equal(researchImportState(result(platform, "account", { identity: { uid: huge } })).canImport, true);
    assert.equal(researchImportState(result(platform, "account", { identity: {}, requestContext: { userId: huge }, record: { nickname: "locator" } })).canImport, false);
  }
  assert.equal(researchImportState(result("qichezhijia", "account", { identity: { authorId: huge } })).canImport, false);
  assert.equal(researchImportState(result("zhihu", "account", { identity: { uid: huge } })).canImport, false);
  assert.equal(researchImportState(result("youtube")).canImport, false);
});
test("default local commands need no replacement identity or supplement, including DCD same-page account evidence", () => {
  for (const platform of ["qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu"]) {
    const command = researchImportBody(result(platform, "work", { identity: {}, accountContext: { userId: huge }, requestContext: { workId: "input" } }), input);
    assert.deepEqual(command, { reason: "核实并导入" });
    assert.equal(Object.hasOwn(command, "parameters"), false); assert.equal(Object.hasOwn(command, "operationId"), false);
  }
});
test("exact five-platform supplement fields and enumerations retain large IDs as strings", () => {
  const cases = [
    ["qichezhijia", { authorId: huge, authorNamespace: "club" }],
    ["dongchedi", { userId: huge, authorId: "different-kind", workType: "video" }],
    ["yiche", { userId: huge, authorId: "different-kind", workType: "club" }],
    ["baijiahao", { uid: huge, secUid: "opaque/_-", uk: "another-kind", workType: "article" }],
    ["zhihu", { uid: huge, vertical: "zvide" }],
  ] as const;
  for (const [platform, values] of cases) assert.deepEqual(researchImportBody(result(platform), { ...input, values, evidence: " 已核实同一作者和原文 " }), { reason: "核实并导入", supplement: { ...values, evidence: "已核实同一作者和原文" } });
  assert.deepEqual(researchSupplementFields("qichezhijia").find(field => field.name === "authorNamespace")?.options, ["original", "chejiahao", "club"]);
  assert.deepEqual(researchSupplementFields("dongchedi").find(field => field.name === "workType")?.options, ["article", "video"]);
  assert.deepEqual(researchSupplementFields("yiche").find(field => field.name === "workType")?.options, ["club", "article", "video"]);
  assert.deepEqual(researchSupplementFields("baijiahao").find(field => field.name === "workType")?.options, ["article", "video"]);
  assert.deepEqual(researchSupplementFields("zhihu").find(field => field.name === "vertical")?.options, ["answer", "article", "zvide"]);
  assert.throws(() => researchImportBody(result("zhihu"), { ...input, values: { vertical: "zvideo" }, evidence: "proof" }));
  assert.throws(() => researchImportBody(result("dongchedi"), { ...input, values: { uid: "wrong-field" }, evidence: "proof" }));
});
test("optional supplements require evidence and received identity/types cannot be overwritten", () => {
  const received = result("yiche", "work", { identity: { userId: huge }, workNamespace: { workType: "article" } });
  assert.equal(researchImportState(received).fields.some(field => field.name === "userId" || field.name === "workType"), false);
  const replacements: Record<string, string>[] = [{ userId: "different" }, { userId: huge }, { workType: "video" }];
  for (const values of replacements) assert.throws(() => researchImportBody(received, { ...input, values, evidence: "proof" }));
  assert.throws(() => researchImportBody(result("zhihu"), { ...input, values: { uid: huge } }));
  assert.throws(() => researchImportBody(result("zhihu"), { ...input, values: { uid: huge }, evidence: "a".repeat(1001) }));
  assert.deepEqual(researchImportBody(result("zhihu"), { ...input, values: { uid: " ", url: "" }, evidence: "unused proof" }), { reason: "核实并导入" });
  assert.throws(() => researchImportBody(result("zhihu"), { ...input, reason: " " }));
  assert.throws(() => researchImportBody(result("zhihu"), { ...input, reason: "a".repeat(501) }));
  // A raw supplier type code is a fact, not a confirmed normalized import namespace.
  const rawType = result("yiche", "work", { workNamespace: { workType: "4" } });
  assert(researchImportState(rawType).fields.some(field => field.name === "workType"));
  assert.equal(researchImportBody(rawType, { ...input, values: { workType: "video" }, evidence: "verified namespace" }).supplement?.workType, "video");
});
test("account commands never send supplement or manually provided account identifiers", () => {
  const account = result("baijiahao", "account", { identity: { uk: huge } });
  assert.deepEqual(researchImportBody(account, { ...input, values: { uid: "manual", url: "https://example.com" }, evidence: "not sent" }), { reason: "核实并导入" });
  assert.deepEqual(researchImportBody(account, { ...input, target: "existing", sourceId: "editorial", rows: [{ id: "editorial", participation_mode: "editorial" }] }), { reason: "核实并导入", sourceId: "editorial" });
  assert.throws(() => researchImportBody(result("baijiahao", "account"), { ...input, values: { uk: huge } }));
});
test("manual work targets are current isolated candidates with evidence; stale/empty/loading/other-page choices are rejected", () => {
  const rows = [{ id: "iso", participation_mode: "isolated" }, { id: "editorial", participation_mode: "editorial" }];
  assert.deepEqual(researchImportCandidates(rows, false).map(row => row.id), ["iso"]);
  assert.deepEqual(researchImportCandidates(rows, true), rows);
  const chosen = { ...input, target: "existing", sourceId: "iso", rows, evidence: "same author confirmed" };
  assert.deepEqual(researchImportBody(result("zhihu"), chosen), { reason: "核实并导入", sourceId: "iso", supplement: { evidence: "same author confirmed" } });
  for (const change of [{ requestState: "loading" }, { requestState: "submitting" }, { sourceId: "editorial" }, { rows: [] }, { rows: [{ id: "other", participation_mode: "isolated" }] }, { sourceId: "" }, { evidence: "" }]) assert.throws(() => researchImportBody(result("zhihu"), { ...chosen, ...change }));
});
test("supplement originals are explicit safe text; received native originals are not replaced and DCD protocol is manual", () => {
  const evidence = "verified same work";
  const received = result("qichezhijia", "work", { url: "https://chejiahao.autohome.com.cn/info/opaque" });
  assert.deepEqual(researchImportBody(received, { ...input, values: { url: received.data.url as string }, evidence }).supplement, { url: received.data.url, evidence });
  assert.throws(() => researchImportBody(received, { ...input, values: { url: "https://chejiahao.autohome.com.cn/info/other" }, evidence }));
  const relative = result("dongchedi", "work", { url: "//www.dcdapp.com/motor/m/feed/detail?group_id=opaque" });
  assert.deepEqual(researchImportBody(relative, input), { reason: "核实并导入" });
  const url = `https:${relative.data.url}`;
  assert.equal(researchImportBody(relative, { ...input, values: { url }, evidence }).supplement?.url, url);
  assert.throws(() => researchImportBody(relative, { ...input, values: { url: "https://www.dcdapp.com/motor/m/feed/detail?group_id=other" }, evidence }));
  assert.equal(researchImportBody(result("yiche", "work", { url: "https://example.com/placeholder" }), { ...input, values: { url: "https://news.yiche.com/native-manually-verified" }, evidence }).supplement?.url, "https://news.yiche.com/native-manually-verified");
  for (const placeholder of ["https://www.yiche.com/", "https://www.yiche.com/cover.jpg"]) assert.equal(researchImportBody(result("yiche", "work", { url: placeholder }), { ...input, values: { url: "https://news.yiche.com/native-manually-verified" }, evidence }).supplement?.url, "https://news.yiche.com/native-manually-verified");
  for (const url of ["//example.com/path", "javascript:alert(1)", "https://user:pass@example.com/path", "https://example.com:444/path", "https://example.com/path#fragment"]) assert.throws(() => researchImportBody(result("zhihu"), { ...input, values: { url }, evidence }));
});

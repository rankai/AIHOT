import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { OperationResult, OperationDetail } from "../app/features/admin/operation-types.ts";
test("actual result cards share inherited ownership, require explicit source once for queries, and limit ambiguity to work imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-source-ownership-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { view: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, ownership: new URL("../app/features/admin/source-ownership.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { OperationResultItem } = await import(pathToFileURL(join(directory, "view.mjs")).href), { WorkSourceProvider } = await import(pathToFileURL(join(directory, "ownership.mjs")).href);
    const base: OperationResult = { id: 1, kind: "douyin_work", data: { workId: "42", url: "https://douyin.com/video/42", identity: {}, pendingReason: "历史缺作者 ID" }, sourceId: null, articleId: null, receiptId: 1, file: null, fileKey: null, imported: false };
    const member = (sourceId: string) => ({ subscriptionId: 1, executionVersion: 2, sourceId });
    const render = (results: OperationResult[], inputs: OperationDetail["inputs"]) => {
      const router = createMemoryRouter([{ path: "*", element: createElement(WorkSourceProvider, { inputs, results, children: results.map(result => createElement(OperationResultItem, { key: result.id, result })) }) }], { initialEntries: ["/admin/operations/1"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const inherited = render([base], { members: [member("owned")], sources: [{ id: "owned", name: "所属信源" }] });
    assert(!inherited.includes('aria-label="作品所属信源"')); assert.match(inherited, /<button(?![^>]*\sdisabled(?:\s|=|>))[^>]*>本地导入作品<\/button>/); assert(!inherited.includes("补充一种已核实作者身份"));
    assert(inherited.includes("历史处理提示")); assert(!inherited.includes("待导入：历史缺作者 ID"));
    const global = render([base], { sources: [{ id: "display-only", name: "展示上下文" }] });
    assert(global.includes('aria-label="作品所属信源"')); assert(global.includes('aria-label="搜索所属信源"')); assert.match(global, /<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/);
    const account = { ...base, id: 2, kind: "douyin_account", data: { identity: { uid: "123" } } };
    const ambiguous = render([base, account], { members: [member("a"), member("b")] });
    assert(ambiguous.includes("无法确定新作品归属")); assert(!ambiguous.includes('aria-label="搜索所属信源"')); assert.match(ambiguous, /<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/); assert.match(ambiguous, /<button(?![^>]*\sdisabled(?:\s|=|>))[^>]*>绑定账号信源<\/button>/);
    assert(!render([account], {}).includes('aria-label="作品所属信源"'));
    const linked = render([{ ...base, articleId: "existing", sourceId: "original-owner" }], { members: [member("a"), member("b")] });
    assert(!linked.includes("无法确定新作品归属")); assert(linked.includes("查看已关联文章")); assert(!linked.includes("历史缺作者 ID"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

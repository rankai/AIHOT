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
import type { OperationResult } from "../app/features/admin/operation-types.ts";

test("real service result hides stale pending and import button after linkage; other research has no new action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-x-search-result-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/service-research-result.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    const output = join(directory, "result.mjs"); await bundle.write({ file: output, format: "esm" });
    const { ServiceResearchResult } = await import(pathToFileURL(output).href);
    const result: OperationResult = { id: 9, kind: "x_research_work", data: { platform: "x-research", operationId: "5K5EG87P", title: "收到正文", record: { tweetId: "900719925474099312345", user: { userId: "900719925474099312346", username: "author" }, text: "收到正文", createdAt: "2026-10-21T00:00:00Z" }, pendingReason: "旧待处理原因" }, sourceId: null, articleId: null, receiptId: 4, fileKey: null, file: null, imported: false };
    const render = (row: OperationResult) => {
      const router = createMemoryRouter([{ path: "/", element: createElement(ServiceResearchResult, { result: row }) }]);
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const pending = render(result); assert(pending.includes("本地导入作品")); assert(pending.includes("旧待处理原因"));
    for (const association of [{ sourceId: "bound" }, { articleId: "legacy" }, { sourceId: "bound", articleId: "legacy" }]) {
      const linked = { ...result, ...association }, html = render(linked);
      assert(!html.includes("本地导入作品")); assert(!html.includes("旧待处理原因")); assert(!html.includes("本地处理待核实原因"));
      if (association.sourceId) assert(html.includes("/admin/sources/bound"));
      if (association.articleId) assert(html.includes("/admin/content/legacy"));
      assert.equal(linked.data.pendingReason, "旧待处理原因"); assert(html.includes("原始字段与研究溯源诊断"));
    }
    for (const kind of ["x_comment", "x_followee", "x_account_rank", "query_summary"]) assert(!render({ ...result, kind }).includes("本地导入作品"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

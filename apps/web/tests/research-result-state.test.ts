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

test("research result renders pending facts only before real linkage, while retaining same-page context and diagnostics", async () => {
  // Compile the real TSX component with the already installed web bundler; no server or DOM mocks.
  const directory = await mkdtemp(join(tmpdir(), "aihot-research-result-state-"));
  const require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/research-platform-result.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    const output = join(directory, "result.mjs");
    await bundle.write({ file: output, format: "esm" });
    const { ResearchPlatformResult } = await import(pathToFileURL(output).href);
    const result: OperationResult = { id: 29, kind: "dongchedi_work", receiptId: 4, sourceId: null, articleId: null, imported: false, fileKey: null, file: null, data: { platform: "dongchedi", title: "同页作品", record: {}, identity: {}, accountContext: { userId: "900719925474099312345" }, pendingReason: "需要核实作者原文关系" } };
    const render = (row: OperationResult) => {
      const router = createMemoryRouter([{ path: "/", element: createElement(ResearchPlatformResult, { result: row }) }]);
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const pending = render(result);
    assert(pending.includes("本地处理待核实原因")); assert(pending.includes("需要核实作者原文关系"));
    assert(pending.includes("同页已收账号上下文（导入时由后台核实归属）")); assert(pending.includes("900719925474099312345"));
    for (const association of [{ sourceId: "bound-author" }, { articleId: "existing-material" }, { sourceId: "bound-author", articleId: "existing-material" }]) {
      const linked = { ...result, ...association };
      const html = render(linked);
      assert(!html.includes("本地处理待核实原因")); assert(!html.includes("需要核实作者原文关系"));
      assert(html.includes("原始字段、冻结请求与溯源诊断"));
      assert.equal(linked.data.pendingReason, "需要核实作者原文关系");
      if (association.sourceId) assert(html.includes("/admin/sources/bound-author"));
      if (association.articleId) assert(html.includes("/admin/content/existing-material"));
    }
    const noPending = render({ ...result, data: { platform: "dongchedi", record: {} } });
    assert(!noPending.includes("本地处理待核实原因"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

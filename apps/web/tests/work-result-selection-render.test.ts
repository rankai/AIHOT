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
test("actual current-page toolbar renders only qualified work checkboxes; pure research/linked/expired pages have no toolbar", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-work-selection-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/work-result-selection.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ file: join(directory, "view.mjs"), format: "esm" });
    const { WorkResultSelection } = await import(pathToFileURL(join(directory, "view.mjs")).href);
    const base: OperationResult = { id: 1, kind: "weibo_work", data: { platform: "weibo", uid: "123", opusId: "42", url: "https://weibo.com/123/received", record: { title: "收到标题<script>plain</script>🦊" } }, sourceId: null, articleId: null, receiptId: 1, fileKey: null, file: null, imported: false };
    const render = (results: OperationResult[]) => {
      const router = createMemoryRouter([{ path: "/admin/operations/200", element: createElement(WorkResultSelection, { results }) }], { initialEntries: ["/admin/operations/200?cursor=12"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const unqualified = [
      { ...base, id: 2, articleId: "already-linked" },
      { ...base, id: 3, kind: "weibo_account" },
      { ...base, id: 4, kind: "result_expired" },
      { ...base, id: 5, kind: "shipinhao_work" },
      { ...base, id: 6, kind: "kuaishou_work" },
      { ...base, id: 7, kind: "qichezhijia_work" },
      { ...base, id: 8, kind: "query_summary" },
      { ...base, id: 9, data: { ...base.data, uid: null } },
      { ...base, id: 10, kind: "image" },
    ];
    const html = render([base, ...unqualified]);
    assert(html.includes('aria-label="本页作品多选导入"')); assert(html.includes('aria-label="选择结果 #1"')); assert(html.includes("本页可多选导入 1 项，已选 0 项"));
    for (const result of unqualified) assert(!html.includes(`aria-label="选择结果 #${result.id}"`));
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
    assert(html.includes("收到标题&lt;script&gt;plain&lt;/script&gt;🦊")); assert(!html.includes("<script>plain</script>"));
    assert(html.includes('href="/admin/operations/200?cursor=12#result-1"')); assert(!html.includes('checked=""'));
    for (const result of unqualified) assert.equal(render([result]), "", `${result.kind} has no empty toolbar`);
    const bodyHtml = render([{ ...base, data: { ...base.data, record: {}, text: "实收微博正文<script>plain</script>🦊" } }]);
    assert(bodyHtml.includes("实收微博正文&lt;script&gt;plain&lt;/script&gt;🦊")); assert(!bodyHtml.includes("weibo_work"));
    const fallback = render([{ ...base, data: { ...base.data, record: {} } }]);
    assert(fallback.includes("#1 · 作品")); assert(!fallback.includes("weibo_work"));
    assert.equal(render([]), "");
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

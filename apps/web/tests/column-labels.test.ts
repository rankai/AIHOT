import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import { DEFAULT_SITE_PRESENTATION } from "../app/lib/presentation.ts";

test("column names reach route titles and headings without renaming topic, report or board facts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-column-labels-")), require = createRequire(import.meta.url);
  const input = Object.fromEntries(["topics", "report-latest", "leaderboard"].map((route) => [route, new URL(`../app/routes/${route}.tsx`, import.meta.url).pathname]));
  const bundle = await rolldown({ input, plugins: [{ name: "existing-react-runtime", resolveId(name) { if (name.endsWith("?url&no-inline")) return `\0asset:${name}`; if (["react", "react-dom", "react/jsx-runtime", "react-router", "motion/react"].includes(name)) return { id: require.resolve(name), external: true }; }, load(id) { if (id.startsWith("\0asset:")) return 'export default "/local-test-nameplate.svg";'; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const topics = await import(pathToFileURL(join(directory, "topics.mjs")).href);
    const report = await import(pathToFileURL(join(directory, "report-latest.mjs")).href);
    const leaderboard = await import(pathToFileURL(join(directory, "leaderboard.mjs")).href);
    const presentation = structuredClone(DEFAULT_SITE_PRESENTATION);
    presentation.navigation = presentation.navigation.map((row) => ({ ...row, label: ({ topics: "技术专题", daily: "每日简报", leaderboard: "模型排行" } as Record<string, string>)[row.id] }));
    const matches = [undefined, { id: "root", loaderData: { presentation } }];
    assert(topics.meta({ matches }).some((row: { title?: string }) => row.title?.startsWith("技术专题")));
    assert(topics.meta({ matches: [] }).some((row: { title?: string }) => row.title?.startsWith("主题")));
    const topicData = { topics: [{ slug: "agent", name: "Agent", group: "field", definition: "业务实体保留原名", total: 1, recent: 1, indexable: true, latestAt: null }] };
    const render = (value: typeof presentation) => {
      const router = createMemoryRouter([{ id: "root", element: createElement(Outlet), children: [{ id: "topics", path: "/topics", element: createElement(topics.default) }] }], { initialEntries: ["/topics"], hydrationData: { loaderData: { root: { presentation: value }, topics: topicData } } });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    assert.match(render(presentation), /<h1[^>]*>技术专题<\/h1>/);
    assert(render(presentation).includes('href="/topics/agent"'));
    assert(render(presentation).includes(">Agent</span>"));
    assert.match(render(DEFAULT_SITE_PRESENTATION), /<h1[^>]*>按主题看 AI<\/h1>/);
    for (const kind of ["daily", "weekly", "monthly"]) {
      const args = { loaderData: { kind }, location: { pathname: `/${kind}` }, matches };
      const renamed = report.meta(args).find((row: { title?: string }) => row.title)?.title;
      const original = report.meta({ ...args, matches: [] }).find((row: { title?: string }) => row.title)?.title;
      if (kind === "daily") assert(renamed.startsWith("每日简报")); else assert.equal(renamed, original);
    }
    const board = { key: "overall", title: "原始模型综合榜标题", description: "原始说明", name: "综合" };
    const overall = { loaderData: { board, entries: [] }, matches };
    assert(leaderboard.meta(overall).some((row: { title?: string }) => row.title?.startsWith("模型排行")));
    assert(leaderboard.meta({ ...overall, matches: [] }).some((row: { title?: string }) => row.title === board.title));
    assert(leaderboard.meta({ ...overall, loaderData: { board: { ...board, key: "coding" }, entries: [] } }).some((row: { title?: string }) => row.title === board.title));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import { DEFAULT_SITE_PRESENTATION as DEFAULT_PRESENTATION } from "../app/lib/presentation.ts";
import type { SitePresentation } from "@aihot/contracts/presentation";

test("presentation feeds navigation surfaces, hidden-filter recovery and admin settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-presentation-"));
  const require = createRequire(import.meta.url);
  const input = Object.fromEntries(Object.entries({ nav: "components/shell/nav.ts", mobile: "components/shell/MobileTabBar.tsx", sidebar: "components/shell/Sidebar.tsx", more: "routes/more.tsx", filters: "features/feed/Filters.tsx", settings: "features/admin/presentation-settings.tsx" }).map(([key, path]) => [key, new URL(`../app/${path}`, import.meta.url).pathname]));
  const bundle = await rolldown({ input, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const nav = await import(pathToFileURL(join(directory, "nav.mjs")).href);
    const { MobileTabBar } = await import(pathToFileURL(join(directory, "mobile.mjs")).href);
    const { Sidebar } = await import(pathToFileURL(join(directory, "sidebar.mjs")).href);
    const { default: MorePage } = await import(pathToFileURL(join(directory, "more.mjs")).href);
    const { CategoryTabs } = await import(pathToFileURL(join(directory, "filters.mjs")).href);
    const { PresentationSettings } = await import(pathToFileURL(join(directory, "settings.mjs")).href);
    const defaults: SitePresentation = structuredClone(DEFAULT_PRESENTATION);
    const draft = structuredClone(defaults);
    draft.navigation = draft.navigation.map((item) => ({ ...item, visible: !["all", "daily", "about", "changelog", "feedback"].includes(item.id) }));
    draft.navigation.reverse();
    draft.categories = [{ id: "opinion", visible: true }, { id: "paper", visible: false }];
    const render = (element: ReactElement, path = "/", presentation = draft) => {
      const router = createMemoryRouter([{ id: "root", path: "*", element, loader: () => ({ presentation, changelogVersion: null }) }], { initialEntries: [path], hydrationData: { loaderData: { root: { presentation, changelogVersion: null } } } });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    assert.deepEqual(nav.mobileTabs(defaults).map((item: { to: string }) => item.to), ["/", "/all", "/daily", "/more"]);
    assert.deepEqual(nav.moreGroups(defaults).map((group: { title: string }) => group.title), ["内容", "偏好", "关于"]);
    assert.deepEqual(nav.sidebarGroups(draft).map((group: { title: string }) => group.title), ["内容", "模型", "更多"]);
    assert.equal(nav.navigationUnavailable("leaderboard", { leaderboard: false, codexResetMonitor: true }), "行业配置已关闭模型榜");
    assert.equal(nav.navigationUnavailable("codexReset", { leaderboard: true, codexResetMonitor: false }), "行业配置已关闭重置监控");
    const onlySelected = { ...draft, navigation: draft.navigation.map((item) => ({ ...item, visible: false })) };
    assert.deepEqual(nav.sidebarGroups(onlySelected).map((group: { title: string }) => group.title), ["内容"]);
    assert.deepEqual(nav.mobileTabs(onlySelected).map((item: { to: string }) => item.to), ["/", "/more"]);
    const tabs = nav.mobileTabs(draft);
    for (const path of ["/all", "/daily/2026-10-24", "/weekly/2026-10-19", "/monthly/2026-10", "/videos", "/privacy"]) assert(nav.tabIsActive(tabs.at(-1), path, tabs), path);
    const originalTabs = nav.mobileTabs(defaults);
    for (const path of ["/daily", "/weekly/2026-10-19", "/monthly/2026-10"]) {
      assert(nav.tabIsActive(originalTabs[2], path, originalTabs));
      assert(!nav.tabIsActive(originalTabs.at(-1), path, originalTabs));
    }
    const mobile = render(createElement(MobileTabBar, { presentation: draft, changelogVersion: null }), "/all");
    assert(mobile.includes("repeat(2, minmax(0, 1fr))"));
    assert.match(mobile, /<a(?=[^>]*href="\/more")(?=[^>]*aria-current="page")[^>]*>/);
    assert(!mobile.includes('href="/all"'));
    const sidebar = render(createElement(Sidebar, { presentation: draft, changelogVersion: null }));
    assert(sidebar.includes('href="/videos"')); assert(!sidebar.includes('href="/all"'));
    const more = render(createElement(MorePage));
    assert(more.includes("外观")); assert(more.includes("使用规则")); assert(more.includes("隐私说明"));
    assert(more.includes('href="/videos"')); assert(!more.includes('href="/all"')); assert(!more.includes('href="/about"'));
    assert.equal(nav.moreGroups(draft).some((group: { title: string }) => group.title === "关于"), false);
    const filter = render(createElement(CategoryTabs, { base: "/all", category: "paper", layoutId: "test" }), "/all?category=paper&page=3&q=hello");
    assert(filter.includes("当前筛选：论文（入口已隐藏）")); assert(filter.includes("清除筛选"));
    assert(filter.includes('href="/all?q=hello"')); assert(!filter.includes("page=3"));
    assert(filter.includes("观点")); assert(!filter.includes("行业</span>"));
    const renamed = structuredClone(defaults);
    renamed.navigation = renamed.navigation.map((entry) => (entry.id === "all" ? { ...entry, label: "行业快讯" } : entry.id === "selected" ? { ...entry, label: "今日必读" } : entry.id === "about" ? { ...entry, label: "认识我们" } : entry));
    assert.equal(nav.mobileTabs(renamed).find((item: { to: string }) => item.to === "/all").label, "行业快讯");
    assert.equal(nav.moreGroups(renamed).flatMap((group: { items: unknown[] }) => group.items).find((item: { to: string }) => item.to === "/about").label, "认识我们");
    assert(render(createElement(Sidebar, { presentation: renamed, changelogVersion: null }), "/", renamed).includes("今日必读"));
    const renamedEditor = render(createElement(PresentationSettings, { settings: { presentation: renamed, defaults, updatedAt: null } }));
    assert(renamedEditor.includes("今日必读"));
    assert(!renamedEditor.includes("显示名称 今日必读"), "name editor stays collapsed until editing");
    const settings = render(createElement(PresentationSettings, { settings: { presentation: defaults, defaults, updatedAt: "2026-10-24T03:00:00.000Z" } }));
    assert(settings.includes("前台栏目与展示")); assert(settings.includes("固定显示"));
    assert.equal((settings.match(/min="1" max="40" step="1"/g) ?? []).length, 3);
    assert(settings.includes('href="/" target="_blank"')); assert(settings.includes("60 秒")); assert(settings.includes("2026-10-24T03:00:00.000Z"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

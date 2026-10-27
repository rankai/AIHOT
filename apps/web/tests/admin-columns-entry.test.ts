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
import { DEFAULT_SITE_PRESENTATION } from "../app/lib/presentation.ts";

test("admin columns is the sole editor with shared desktop/mobile entry and independent loaders", async t => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-admin-columns-"));
  const require = createRequire(import.meta.url);
  const originalFetch = globalThis.fetch;
  const input = Object.fromEntries(["layout", "settings", "columns"].map(name => [name, new URL(`../app/routes/admin/${name}.tsx`, import.meta.url).pathname]));
  const bundle = await rolldown({ input: { ...input, routes: new URL("../app/routes.ts", import.meta.url).pathname }, plugins: [{
    name: "existing-react-runtime",
    resolveId(id) {
      if (["react", "react/jsx-runtime", "react-router", "motion/react", "@react-router/dev/routes"].includes(id)) return { id: require.resolve(id), external: true };
    },
  }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const layout = await import(pathToFileURL(join(directory, "layout.mjs")).href);
    const settings = await import(pathToFileURL(join(directory, "settings.mjs")).href);
    const columns = await import(pathToFileURL(join(directory, "columns.mjs")).href);
    const routes = (await import(pathToFileURL(join(directory, "routes.mjs")).href)).default;
    const adminRoutes = routes.find((route: { id?: string }) => route.id === "admin-layout").children;
    assert.equal(adminRoutes.find((route: { path?: string }) => route.path === "admin/columns").file, "routes/admin/columns.tsx");
    const presentation = { presentation: structuredClone(DEFAULT_SITE_PRESENTATION), defaults: structuredClone(DEFAULT_SITE_PRESENTATION), updatedAt: "2026-10-25T03:00:00.000Z" };
    const general = {
      contact: { wechatQr: "/synthetic-wechat.png", feishuQr: "/synthetic-feishu.png" },
      targets: [{ key: "synthetic-target", purpose: "content", kind: "feishu", enabled: false, enabled_at: null, config_ref: "synthetic", note: "测试通知", deliveries_7d: 0, last_sent_at: null }],
      budgets: [{ service: "synthetic-service", per_minute: 2, per_hour: 3, per_day: 4, note: null, updated_at: "2026-10-25T03:00:00.000Z", used_day: 0, used_hour: 0 }],
    };
    const admin = { me: { name: "测试管理员", csrf: "synthetic-csrf", dev: false }, counts: {} };
    const render = (page: typeof columns, data: unknown, path: string) => {
      const router = createMemoryRouter([{ id: "admin-layout", element: createElement(layout.default, { loaderData: admin }), children: [{ path, element: createElement(page.default, { loaderData: data }) }] }], { initialEntries: [path], hydrationData: { loaderData: { "admin-layout": admin } } });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); }
      finally { router.dispose(); }
    };

    await t.test("both navigation surfaces select columns and settings body has no columns entry", () => {
      const html = render(columns, presentation, "/admin/columns");
      const links = html.match(/<a\b[^>]*href="\/admin\/columns"[^>]*>/g) ?? [];
      assert.equal(links.length, 2, "desktop and mobile each have one columns entry");
      for (const link of links) assert.match(link, /aria-current="page"/);
      const navs = [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)].map(match => match[1]!);
      assert.equal(navs.length, 2);
      for (const nav of navs) {
        assert(nav.indexOf('href="/admin/content"') < nav.indexOf('href="/admin/columns"'));
        assert(nav.indexOf('href="/admin/columns"') < nav.indexOf('href="/admin/data-tools"'));
      }
      assert.match(html, /<h1\b[^>]*>栏目管理<\/h1>/);
      assert(html.includes("前台栏目与展示"));
      assert(html.includes("固定显示"));
      assert(html.includes("保存更改"));
      assert(html.includes("2026-10-25T03:00:00.000Z"));
      assert.equal((html.match(/min="1" max="40" step="1"/g) ?? []).length, 3);

      const oldPage = render(settings, general, "/admin/settings");
      for (const text of ["关于页二维码", "通知目的地", "付费请求上限", "synthetic-service", "测试通知"]) assert(oldPage.includes(text), text);
      for (const text of ["前台栏目与展示", "保存展示配置", "恢复默认", "精选每批卡片数"]) assert(!oldPage.includes(text), text);
      const settingsContent = oldPage.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)![1]!;
      assert(!settingsContent.includes("/admin/columns"));
      assert(!settingsContent.includes("栏目管理"));
      assert(!settingsContent.includes("<form"), "settings no longer mounts the presentation form");
    });

    await t.test("loaders read only their resource and preserve existing authentication/error behavior", async () => {
      const calls: string[] = [];
      let generalStatus = 200, presentationStatus = 200;
      globalThis.fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        const forwarded = new Headers(init?.headers);
        assert.equal(forwarded.get("cookie"), "synthetic=session");
        assert.equal(forwarded.get("user-agent"), "columns-test");
        if (path === "/api/admin/settings/presentation") return Response.json(presentationStatus === 200 ? presentation : { detail: "presentation unavailable" }, { status: presentationStatus });
        assert.equal(path, "/api/admin/settings");
        return Response.json(generalStatus === 200 ? general : { detail: "budget unavailable" }, { status: generalStatus });
      };
      const request = (path: string) => new Request(`http://local.test${path}`, { headers: { cookie: "synthetic=session", "user-agent": "columns-test" } });
      assert.deepEqual(await columns.loader({ request: request("/admin/columns") }), presentation);
      assert.deepEqual(await settings.loader({ request: request("/admin/settings") }), general);
      assert.deepEqual(calls, ["/api/admin/settings/presentation", "/api/admin/settings"]);
      generalStatus = 500;
      await assert.rejects(settings.loader({ request: request("/admin/settings") }), (error: { init?: { status?: number } }) => error.init?.status === 503);
      assert.deepEqual(await columns.loader({ request: request("/admin/columns") }), presentation);
      generalStatus = 200;
      presentationStatus = 500;
      await assert.rejects(columns.loader({ request: request("/admin/columns") }), (error: { init?: { status?: number } }) => error.init?.status === 503);
      assert.deepEqual(await settings.loader({ request: request("/admin/settings") }), general);
      presentationStatus = 401;
      await assert.rejects(columns.loader({ request: request("/admin/columns") }), (error: Response) => error.status === 302 && error.headers.get("location") === "/admin/login?return=%2Fadmin%2Fcolumns");
    });
  } finally {
    globalThis.fetch = originalFetch;
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
});

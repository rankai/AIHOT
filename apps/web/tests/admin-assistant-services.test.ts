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

test("admin service reminder is optional and skill compatibility remains read-only", async t => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-assistant-services-")), require = createRequire(import.meta.url);
  const originalFetch = globalThis.fetch;
  const bundle = await rolldown({ input: Object.fromEntries(["redfox", "assistant-skills"].map(name => [name, new URL(`../app/routes/admin/${name}.tsx`, import.meta.url).pathname])), plugins: [{
    name: "existing-react-runtime",
    resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; },
  }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const redfox = await import(pathToFileURL(join(directory, "redfox.mjs")).href);
    const skills = await import(pathToFileURL(join(directory, "assistant-skills.mjs")).href);
    await t.test("failed balance query leaves primary tool loader data available", async () => {
      let failure: "http" | "network" = "http", primaryFailure = false;
      const options = { models: [{ model: "gptImage2" }], resolutions: ["1k"] }, assets = { rows: [], next: null }, operations = [{ operationId: "synthetic-operation" }], pricing = { prices: [] };
      globalThis.fetch = async input => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/balance-observation")) {
          if (failure === "network") throw new Error("synthetic reminder unavailable");
          return Response.json({ detail: "synthetic reminder unavailable" }, { status: 500 });
        }
        if (path.endsWith("/images/options")) return Response.json(primaryFailure ? { detail: "primary unavailable" } : options, { status: primaryFailure ? 500 : 200 });
        return Response.json(path === "/api/admin/assets" ? assets : path.endsWith("/operations") ? operations : path.endsWith("/member-pricing") ? pricing : {});
      };
      const request = new Request("http://local.test/admin/data-tools?view=images");
      for (const mode of ["http", "network"] as const) {
        failure = mode;
        const data = await redfox.loader({ request });
        assert.equal(data.balance, null); assert.equal(data.initialView, "images");
        assert.deepEqual(data.assets, assets); assert.deepEqual(data.operations, operations); assert.deepEqual(data.pricing, pricing);
        assert.equal(data.options.models[0].generationAvailable, true);
      }
      primaryFailure = true;
      await assert.rejects(redfox.loader({ request }), (error: { init?: { status?: number } }) => error.init?.status === 503);
    });
    await t.test("technical disclosure shows supported capability, scope and archived scripts on both layouts", () => {
      const skill = { skillId: "synthetic-image", name: "合成图片技能", version: "1", modules: [{ id: "generate", name: "生成图片" }], acceptingNew: false, revision: 0, policyValid: true, available: false, reasons: [], updatedBy: null, updatedAt: null, source: { kind: "external" }, packageHash: "synthetic-hash", dependencies: ["redfox.image"], capabilities: ["generate_image@1"], openScope: ["生成图片：文本提示词；gptImage2、1K、单张、无参考图 → 本地图片作品，可预览和下载"] };
      const router = createMemoryRouter([{ path: "/admin/assistant-skills", element: createElement(skills.default, { loaderData: { skills: [skill] } }) }], { initialEntries: ["/admin/assistant-skills"] });
      try {
        const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
        const details = [...html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/g)].map(match => match[1]!);
        assert.equal(details.length, 2);
        for (const detail of details) {
          for (const text of ["支持能力", "generate_image@1", "开放输入与交付范围", "1K、单张、无参考图", "本地图片作品", "仅归档，不会执行；所需接口由平台受控能力接管"] ) assert(detail.includes(text), text);
          assert(!/<input|<textarea|<button/.test(detail));
        }
      } finally { router.dispose(); }
    });
  } finally { globalThis.fetch = originalFetch; await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

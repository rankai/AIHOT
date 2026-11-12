import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { rolldown } from "rolldown";

test("tool reads allow inline authentication failures while preserving the default login redirect", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-tool-client-"));
  const require = createRequire(import.meta.url);
  const bundle = await rolldown({
    input: new URL("../app/features/tools/client.ts", import.meta.url).pathname,
    plugins: [{ name: "existing-react-runtime", resolveId(id) {
      if (id === "react") return { id: require.resolve(id), external: true };
    } }],
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const destinations: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/assistant/sessions/kept", search: "?view=latest", assign: (url: string) => destinations.push(url) },
  } });
  try {
    await bundle.write({ dir: directory, format: "esm", entryFileNames: "client.mjs" });
    const { toolGet, ToolReadAuthError } = await import(pathToFileURL(join(directory, "client.mjs")).href);

    await t.test("the opted-out read throws a readable auth error without navigation", async (t) => {
      const controller = new AbortController();
      t.mock.method(globalThis, "fetch", async (path: string, options: RequestInit) => {
        assert.equal(path, "/api/account/credits");
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.cache, "no-store");
        assert.ok(options.signal instanceof AbortSignal);
        controller.abort();
        assert.equal(options.signal.aborted, true);
        return new Response("private server detail", { status: 401 });
      });
      await assert.rejects(toolGet("/api/account/credits", controller.signal, { redirectOnUnauthorized: false }), (cause: unknown) =>
        cause instanceof Error && cause instanceof ToolReadAuthError && cause.message === "登录已过期，请重新登录。");
      assert.deepEqual(destinations, []);
    });

    await t.test("existing reads still navigate to login with their safe return path", async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
      for (const options of [undefined, { redirectOnUnauthorized: true }]) {
        await assert.rejects(toolGet("/api/tools/runs", undefined, options), (cause: unknown) =>
          cause instanceof Error && cause instanceof ToolReadAuthError && cause.message === "登录已过期，请重新登录。");
      }
      assert.equal(destinations.length, 2);
      for (const destination of destinations) {
        const url = new URL(destination, "https://local.test");
        assert.equal(url.pathname, "/login");
        assert.equal(url.searchParams.get("return"), "/assistant/sessions/kept?view=latest");
        assert.equal(url.searchParams.get("expired"), "1");
      }
    });

    await t.test("inline reads retain ordinary error details and successful data", async (t) => {
      const responses = [
        Response.json({ detail: "当前无法读取" }, { status: 403 }),
        new Response("unreadable", { status: 503 }),
        Response.json({ balance: { available: 42 } }),
      ];
      t.mock.method(globalThis, "fetch", async () => responses.shift()!);
      await assert.rejects(toolGet("/read", undefined, { redirectOnUnauthorized: false }), { message: "当前无法读取" });
      await assert.rejects(toolGet("/read", undefined, { redirectOnUnauthorized: false }), { message: "暂时无法读取，请稍后重试。" });
      assert.deepEqual(await toolGet("/read", undefined, { redirectOnUnauthorized: false }), { balance: { available: 42 } });
      assert.equal(destinations.length, 2);
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
});

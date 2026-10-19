import "./setup.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, test, type TestContext } from "node:test";
import { promisify } from "node:util";
import Fastify from "fastify";
import { createMcpHandler, McpServer, ProtocolError, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MCP_TOOL_NAMES as T } from "@aihot/contracts/mcp";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { registerMcp } from "../apps/api/src/routes/mcp.ts";

const exec = promisify(execFile);
after(closeDb);

function check(url: string) {
  return exec(process.execPath, [path.join(REPO_ROOT, "scripts/mcp-check.ts"), url], {
    cwd: REPO_ROOT, env: { ...process.env }, timeout: 10_000,
  });
}

function fail(code?: string, text = "Tool failed"): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text }],
    ...(code ? { structuredContent: { error: { code } } } : {}),
  };
}

type Probe = "sdk" | "code" | "text" | "business" | "business-text" | "protocol-internal" | "success";

async function fixture(t: TestContext, options: { failure?: string; omit?: string; story?: boolean; probe?: Probe } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "cli-test", version: "1.0.0" });
    for (const name of Object.values(T)) {
      if (name === options.omit) continue;
      const limit = name === T.latest && (!options.probe || options.probe === "sdk")
        ? z.number().max(30).optional() : z.number().optional();
      server.registerTool(name, { inputSchema: z.object({ limit }).passthrough() }, async (args) => {
        calls.push({ name, args });
        if (name === T.latest && args.limit === 99) {
          if (options.probe === "code") return fail("invalid_params");
          if (options.probe === "text") return fail(undefined, `Input validation error: Invalid arguments for tool ${T.latest}: limit must be <=30`);
          if (options.probe === "business") return fail("internal_error", "Database validation error");
          if (options.probe === "business-text") return fail(undefined, "Database validation error");
          if (options.probe === "protocol-internal") throw new ProtocolError(-32603, "Internal error");
        }
        if (name === options.failure) return fail(name === T.daily ? "busy" : "internal_error");
        if (name === T.daily) return fail("not_found");
        return {
          content: [{ type: "text", text: "ok" }],
          structuredContent: { items: name === T.hot && options.story ? [{ links: { story: "https://example.invalid/story/public-example" } }] : [] },
        };
      });
    }
    return server;
  }, { legacy: "stateless" });
  const app = Fastify();
  app.addHook("preClose", async () => { await handler.close(); });
  app.route({ method: ["GET", "POST", "DELETE"], url: "/mcp", handler: async (req, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined && key !== "host" && key !== "content-length") headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const request = new Request("http://127.0.0.1/mcp", {
      method: req.method, headers, body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });
    const response = await handler.fetch(request, req.method === "POST" ? { parsedBody: req.body } : undefined);
    reply.code(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(response.body);
  } });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  return { url: `${address}/mcp`, calls };
}

test("MCP check runs with contract names against the actual API handler", async (t) => {
  const app = Fastify();
  registerMcp(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const { stdout } = await check(`${address}/api/mcp`);
  assert.ok(stdout.includes(T.latest), stdout);
  assert.match(stdout, /expected invalid parameters/);
  assert.doesNotMatch(stdout, /ERROR/);
});

test("empty hot topics skip story and daily not_found is an empty-data state", async (t) => {
  const server = await fixture(t);
  const { stdout } = await check(server.url);
  assert.match(stdout, /SKIP \(no hot topics\)/);
  assert.ok(stdout.includes(`${T.daily} {} \u2192 empty`), stdout);
  assert.equal(server.calls.some((call) => call.name === T.story), false);
  assert.match(stdout, /expected invalid parameters/);
});

test("a story returned by hot topics is checked using its actual public ID", async (t) => {
  const server = await fixture(t, { story: true });
  await check(server.url);
  assert.deepEqual(server.calls.find((call) => call.name === T.story)?.args, { public_id: "public-example", report_limit: 3 });
});

test("missing advertised contract tools fail the check", async (t) => {
  const server = await fixture(t, { omit: T.story });
  await assert.rejects(check(server.url), (error: unknown) => {
    assert.match((error as { stderr: string }).stderr, /Missing expected tool/);
    return true;
  });
  assert.equal(server.calls.length, 0);
});

for (const name of Object.values(T)) {
  test(`normal-result business errors from ${name} produce a nonzero exit`, async (t) => {
    const server = await fixture(t, { failure: name, story: true });
    await assert.rejects(check(server.url), (error: unknown) => {
      const failure = error as { code: number; stdout: string };
      assert.notEqual(failure.code, 0);
      assert.ok(failure.stdout.includes(`${name} `) && failure.stdout.includes("ERROR"), failure.stdout);
      return true;
    });
  });
}

for (const probe of ["code", "text", "business", "business-text", "protocol-internal", "success"] as const) {
  test(`invalid-limit probe handles ${probe} result explicitly`, async (t) => {
    const server = await fixture(t, { probe });
    if (probe === "code" || probe === "text") {
      const { stdout } = await check(server.url);
      assert.match(stdout, /expected invalid parameters/);
    } else {
      await assert.rejects(check(server.url), (error: unknown) => {
        const failure = error as { code: number; stdout: string };
        assert.notEqual(failure.code, 0);
        assert.doesNotMatch(failure.stdout, /expected invalid parameters/);
        return true;
      });
    }
    assert.ok(server.calls.some((call) => call.name === T.latest && call.args.limit === 99));
  });
}

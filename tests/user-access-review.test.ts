// Production SSR and single-fetch boundaries, using only a local synthetic API. Build web first.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

let web: ChildProcess | undefined;
let origin = "";
let logs = "";
const privateCookies: string[] = [];
const publicCookies: string[] = [];
const users = {
  a: { id: 101, username: "member_a", displayName: "PRIVATE_MEMBER_A", role: "member", status: "active", createdAt: "2026-10-28T00:00:00.000Z", lastLoginAt: null },
  b: { id: 102, username: "member_b", displayName: "PRIVATE_MEMBER_B", role: "member", status: "active", createdAt: "2026-10-28T00:00:00.000Z", lastLoginAt: null },
};
const api = createServer((req, res) => {
  const path = new URL(req.url!, "http://api.test").pathname;
  res.setHeader("Content-Type", "application/json");
  const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (path.startsWith("/api/site/")) {
    publicCookies.push(req.headers.cookie ?? "");
    if (path === "/api/site/meta") return send(200, { changelogVersion: null });
    if (path === "/api/site/contact") return send(200, { wechatQr: "/qr.png", feishuQr: "/qr.png" });
    return send(404, { code: "not_found" });
  }
  privateCookies.push(req.headers.cookie ?? "");
  const member = req.headers.cookie === "aihot_user=member-a" ? users.a : req.headers.cookie === "aihot_user=member-b" ? users.b : null;
  if (!member) return send(401, { code: "unauthorized", detail: "请先登录" });
  // Deliberately misleading upstream headers cannot make a private web route shareable.
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  if (path === "/api/account/me") return send(200, { user: member, csrf: `PRIVATE_CSRF_${member.id}` });
  if (path === "/api/account/credits") return send(200, { balance: { userId: member.id, available: 0, reserved: 0 }, entries: [], nextCursor: null });
  if (path === "/api/account/tool-pricing") return send(200, { version: "2026-10-30-v2", offers: [], unavailable: [] });
  if (path === "/api/tools/options") return send(200, {});
  if (path === "/api/tools/assets") return send(200, { items: [{ key: `private-file-${member.id}`, filename: `${member.displayName}-asset` }], nextCursor: null });
  if (path === "/api/tools/runs") return send(200, { rows: [{ id: member.id, operationKey: `${member.displayName}-task` }], nextCursor: null });
  if (path === `/api/tools/runs/${member.id}`) return send(200, {
    id: member.id, provider: "local", operationKey: "test", status: "completed", createdAt: "2026-10-28T00:00:00.000Z", stepVersion: 1, generation: 0,
    category: "query", title: `${member.displayName}-task`, summary: "Synthetic private query",
    message: member.displayName, actions: [], canResume: false, charge: null, recoveryKind: null, nextResultCursor: null,
    resultCount: 1, process: [], nextProcessCursor: null, processCount: 0, originRunId: null, continuationRunId: null,
    results: [{ id: member.id, kind: "test", title: `${member.displayName}-result`, text: "Private result", url: null, details: {}, links: [], file: null }],
  });
  return send(404, { code: "not_found", detail: "不可访问" });
});

before(async () => {
  api.listen(0, "127.0.0.1"); await once(api, "listening");
  web = spawn(process.execPath, [fileURLToPath(new URL("../apps/web/server.ts", import.meta.url))], {
    env: { ...process.env, WEB_PORT: "0", WEB_HOST: "127.0.0.1", TRUST_PROXY: "false", API_BASE_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`test web did not start: ${logs}`)), 15_000);
    web!.once("exit", () => { clearTimeout(timer); reject(new Error(`test web exited: ${logs}`)); });
    web!.stderr!.on("data", chunk => { logs += String(chunk); });
    web!.stdout!.on("data", chunk => {
      logs += String(chunk);
      const match = logs.match(/"msg":"web started","port":(\d+)/);
      if (match) { origin = `http://127.0.0.1:${match[1]}`; clearTimeout(timer); resolve(); }
    });
  });
});

after(async () => {
  if (web && web.exitCode === null) { web.kill("SIGTERM"); await once(web, "exit"); }
  api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve()));
});

function assertPrivate(response: Response) {
  assert.match(response.headers.get("Cache-Control") ?? "", /private.*no-store/);
  assert.equal(response.headers.get("X-Accel-Expires"), "0");
}

test("account HTML and .data never share cache entries or identities across cookies", async () => {
  for (const path of ["/account", "/account.data", "/account.data?_routes=routes%2Faccount"]) {
    const a = await fetch(origin + path, { headers: { cookie: "aihot_user=member-a" } });
    const b = await fetch(origin + path, { headers: { cookie: "aihot_user=member-b" } });
    assert.equal(a.status, 200, path); assert.equal(b.status, 200, path);
    assertPrivate(a); assertPrivate(b);
    const aBody = await a.text(), bBody = await b.text();
    assert.ok(aBody.includes("PRIVATE_MEMBER_A"), path); assert.ok(!aBody.includes("PRIVATE_MEMBER_B"), path);
    assert.ok(bBody.includes("PRIVATE_MEMBER_B"), path); assert.ok(!bBody.includes("PRIVATE_MEMBER_A"), path);
  }
  const rootOnly = await fetch(`${origin}/account.data?_routes=root`, { headers: { cookie: "aihot_user=member-a" } });
  assertPrivate(rootOnly);
  assert.equal((await rootOnly.text()).includes("PRIVATE_CSRF"), false);
});

test("private tool .data, prefetch and other-user failures remain uncached", async () => {
  for (const member of [users.a, users.b]) {
    const cookie = `aihot_user=member-${member === users.a ? "a" : "b"}`;
    for (const path of ["/tools.data", "/tools.data?_routes=routes%2Ftools", `/tools/runs/${member.id}.data`, `/tools/runs/${member.id}`]) {
      const response = await fetch(origin + path, { headers: { cookie, Purpose: "prefetch" } });
      assert.equal(response.status, 200, path); assertPrivate(response);
      const body = await response.text();
      assert.ok(body.includes(member.displayName), path);
      assert.equal(body.includes(member === users.a ? users.b.displayName : users.a.displayName), false, path);
    }
  }
  const forbidden = await fetch(`${origin}/tools/runs/101.data`, { headers: { cookie: "aihot_user=member-b" } });
  assert.equal(forbidden.status, 404); assertPrivate(forbidden);
  assert.equal((await forbidden.text()).includes("PRIVATE_MEMBER_A"), false);
});

test("signed-out private navigation redirects without caching and public loaders never receive user cookies", async () => {
  for (const path of ["/account", "/tools", "/tools/runs/101", "/account.data", "/tools.data"]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assertPrivate(response);
    assert.ok([302, 202].includes(response.status), `${path}: ${response.status}`);
    if (response.status === 302) assert.match(response.headers.get("Location") ?? "", /^\/login\?/);
    else assert.match(await response.text(), /\/login\?/);
  }
  const anonymous = await fetch(`${origin}/about.data`);
  const signedIn = await fetch(`${origin}/about.data`, { headers: { cookie: "aihot_user=member-a" } });
  assert.equal(anonymous.status, 200); assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get("Cache-Control") ?? "", /^public,/);
  assert.equal(await anonymous.text(), await signedIn.text());
  assert.ok(publicCookies.every(cookie => cookie === ""));
  assert.ok(privateCookies.includes("aihot_user=member-a") && privateCookies.includes("aihot_user=member-b"));
});

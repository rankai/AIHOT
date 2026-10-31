import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DEFAULT_PRESENTATION } from "@aihot/industry/presentation";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { endSession, passwordLogin, sessionPrincipal } from "@aihot/backend/admin/auth";
import { loadPresentationSettings, loadPublicPresentation, normalizePresentation, savePresentation } from "@aihot/backend/admin/presentation";
import { buildApp } from "../apps/api/src/app.ts";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const actor = `presentation-test-${T}`;
const previousPassword = config.adminPassword;
const previousDevAdmin = config.devAdmin;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let headers: { cookie: string; "x-csrf-token": string };
let initialAuditId = 0;
let initialized = false;
let original: { value: unknown; updated_at: Date; updated_by: string | null } | undefined;
before(async () => {
  const [database] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(database!.name, database!.port);
  const [auditCursor] = await sql`SELECT coalesce(max(id), 0) AS id FROM audit_log`;
  initialAuditId = auditCursor!.id;
  initialized = true;
  [original] = await sql`SELECT value, updated_at, updated_by FROM settings WHERE key = 'site_presentation'`;
  await sql`DELETE FROM settings WHERE key = 'site_presentation'`;
  config.adminPassword = `synthetic-${T}`;
  config.devAdmin = null;
  const login = await passwordLogin(config.adminPassword, "/admin", "presentation-test");
  cookie = `aihot_admin=${login.token}`;
  const principal = await sessionPrincipal(cookie);
  assert.ok(principal);
  headers = { cookie, "x-csrf-token": principal.csrf };
  app = await buildApp();
});
after(async () => {
  await app?.close();
  if (cookie) await endSession(cookie);
  config.adminPassword = previousPassword;
  config.devAdmin = previousDevAdmin;
  if (!initialized) { await closeDb(); return; }
  await sql`DELETE FROM settings WHERE key = 'site_presentation'`;
  if (original) await sql`INSERT INTO settings(key,value,updated_by,updated_at) VALUES ('site_presentation',${sql.json(original.value as never)},${original.updated_by},${original.updated_at})`;
  await sql`DELETE FROM audit_log WHERE subject = 'settings:site_presentation' AND id > ${initialAuditId}`;
  await stopBoss();
  await closeDb();
});

test("default and upgraded settings preserve taxonomy and feature boundaries", async () => {
  assert.equal((await loadPresentationSettings()).updatedAt, null);
  const upgraded = normalizePresentation({ ...DEFAULT_PRESENTATION, navigation: [{ id: "retired", visible: true }, { id: "all", visible: false }], categories: [] }, { leaderboard: false, codexResetMonitor: false });
  assert.equal(upgraded.navigation[0]!.id, "all");
  assert.equal(upgraded.navigation.some(row => row.id as string === "retired"), false);
  for (const id of ["leaderboard", "codexReset"]) assert.equal(upgraded.navigation.find(row => row.id === id)!.visible, false);
  assert.equal(upgraded.navigation.find(row => row.id === "selected")!.visible, true);
  assert.deepEqual(upgraded.categories, DEFAULT_PRESENTATION.categories);
});

test("presentation HTTP requires session and CSRF; save/reload and public meta project only safe configuration", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/settings" })).statusCode, 401);
  const unauthenticated = await app.inject({ method: "GET", url: "/api/admin/settings/presentation" });
  assert.equal(unauthenticated.statusCode, 401);
  assert.match(unauthenticated.headers["cache-control"]!, /no-store/);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/settings/presentation", payload: DEFAULT_PRESENTATION })).statusCode, 401);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/settings/presentation", headers: { cookie }, payload: DEFAULT_PRESENTATION })).statusCode, 403);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/settings/presentation", headers, payload: {} })).statusCode, 400);
  const input = { ...DEFAULT_PRESENTATION, pageSizes: { selected: 7, all: 13, videos: 3 } };
  const response = await app.inject({ method: "PUT", url: "/api/admin/settings/presentation", headers, payload: input });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers["cache-control"]!, /no-store/);
  assert.deepEqual(response.json().presentation, input);
  assert.ok(response.json().updatedAt);
  const reloaded = await app.inject({ method: "GET", url: "/api/admin/settings/presentation", headers: { cookie } });
  assert.equal(reloaded.statusCode, 200, reloaded.body);
  assert.match(reloaded.headers["cache-control"]!, /no-store/);
  assert.deepEqual(reloaded.json(), response.json());
  const publicResponse = await app.inject({ method: "GET", url: "/api/site/meta" });
  assert.equal(publicResponse.statusCode, 200);
  assert.deepEqual(Object.keys(publicResponse.json()).sort(), ["changelogVersion", "presentation"]);
  assert.deepEqual(publicResponse.json().presentation, input);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/site/meta", headers })).json(), publicResponse.json());
});

test("concurrent whole saves retain audit chain and audit failure rolls back settings", async () => {
  const variants = [5, 9, 17].map(size => ({ ...DEFAULT_PRESENTATION, pageSizes: { selected: size, all: size, videos: size } }));
  await Promise.all(variants.map(value => savePresentation(value, actor)));
  const logs = await sql`SELECT before, after FROM audit_log WHERE actor = ${actor} ORDER BY id`;
  assert.equal(logs.length, 3);
  for (let i = 1; i < logs.length; i++) assert.deepEqual(logs[i]!.before, logs[i - 1]!.after);
  const saved = await loadPresentationSettings();
  assert.deepEqual(saved.presentation, logs.at(-1)!.after);
  // actor NOT NULL is enforced by audit_log; the settings update must roll back with it.
  await assert.rejects(savePresentation(DEFAULT_PRESENTATION, null as never));
  assert.deepEqual(await loadPresentationSettings(), saved);
});

test("invalid stored configuration is an admin error while public metadata uses safe defaults", async () => {
  await sql`UPDATE settings SET value = 'null'::jsonb WHERE key = 'site_presentation'`;
  await assert.rejects(loadPresentationSettings());
  await sql`UPDATE settings SET value = '{"navigation":null}'::jsonb WHERE key = 'site_presentation'`;
  await assert.rejects(loadPresentationSettings());
  assert.deepEqual(await loadPublicPresentation(), normalizePresentation(null));
  const invalid = await app.inject({ method: "GET", url: "/api/admin/settings/presentation", headers: { cookie } });
  assert.equal(invalid.statusCode, 500);
  assert.match(invalid.headers["cache-control"]!, /no-store/);
  const general = await app.inject({ method: "GET", url: "/api/admin/settings", headers: { cookie } });
  assert.equal(general.statusCode, 200, general.body);
  assert.match(general.headers["cache-control"]!, /no-store/);
  assert.deepEqual(Object.keys(general.json()).sort(), ["budgetScopes", "budgets", "contact", "targets"]);
  const restored = await savePresentation(DEFAULT_PRESENTATION, actor);
  assert.deepEqual(restored.presentation, normalizePresentation(null));
});

test("HTTP persists labels/custom rows and rejects stale omission without changing the audit or settings", async () => {
  const custom = { id: 'custom-12345678-1234-4234-8234-123456789abc', label: '产品 Agent', visible: false, scope: 'all', category: 'ai-products', tag: 'Agent', pageSize: 7 };
  const input = { ...DEFAULT_PRESENTATION, navigation: [...DEFAULT_PRESENTATION.navigation.map(row => row.id === 'all' ? { ...row, label: '资讯' } : row), custom] };
  const saved = await app.inject({ method: 'PUT', url: '/api/admin/settings/presentation', headers, payload: input });
  assert.equal(saved.statusCode, 200, saved.body);
  const read = await app.inject({ method: 'GET', url: '/api/admin/settings/presentation', headers: { cookie } });
  assert.deepEqual(read.json(), saved.json());
  assert.deepEqual(read.json().presentation, input);
  const [before] = await sql`SELECT count(*)::int AS count FROM audit_log WHERE subject='settings:site_presentation'`;
  const stale = await app.inject({ method: 'PUT', url: '/api/admin/settings/presentation', headers, payload: DEFAULT_PRESENTATION });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.match(stale.body, /刷新/);
  const [after] = await sql`SELECT count(*)::int AS count FROM audit_log WHERE subject='settings:site_presentation'`;
  assert.equal(after!.count, before!.count);
  assert.deepEqual((await loadPresentationSettings()).presentation, input);
  await assert.rejects(savePresentation({ ...input, navigation: [...input.navigation.slice(0, -1), { ...custom, label: '未提交' }] }, null as never));
  assert.deepEqual((await loadPresentationSettings()).presentation, input);
  // Same draft ID can safely retry and edit; blank builtin name restores its default label.
  const retry = { ...input, navigation: [...DEFAULT_PRESENTATION.navigation.map(row => row.id === 'all' ? { ...row, label: ' ' } : row), { ...custom, label: '已改名' }] };
  const retried = await savePresentation(retry, actor);
  assert.equal(retried.presentation.navigation.filter(row => row.id === custom.id).length, 1);
  assert.deepEqual(retried.presentation.navigation.find(row => row.id === 'all'), DEFAULT_PRESENTATION.navigation.find(row => row.id === 'all'));
});

test("retired custom categories remain repairable on read but cannot be saved as valid current taxonomy", async () => {
  const saved = await loadPresentationSettings();
  const retired = { ...saved.presentation, navigation: saved.presentation.navigation.map(row => row.id.startsWith('custom-') ? { ...row, category: 'retired-category' } : row) };
  await sql`UPDATE settings SET value=${sql.json(retired as never)} WHERE key='site_presentation'`;
  assert.deepEqual((await loadPresentationSettings()).presentation, retired);
  await assert.rejects(savePresentation(retired, actor), { statusCode: 400 });
  assert.deepEqual((await loadPresentationSettings()).presentation, retired);
  await savePresentation(saved.presentation, actor);
});

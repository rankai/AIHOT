import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { endSession, passwordLogin, sessionPrincipal } from "@aihot/backend/admin/auth";
import { buildApp } from "../apps/api/src/app.ts";
import { adminHandler } from "../apps/api/src/routes/admin-auth.ts";

const T = tag();
const previousPassword = config.adminPassword;
const previousDevAdmin = config.devAdmin;
let app: Awaited<ReturnType<typeof buildApp>>;
let sessionCookie: string;
let headers: { cookie: string; "x-csrf-token": string };
const source = { id: `test-admin-errors-${T}`, name: "", kind: "rss", config: { feedUrl: `https://example.invalid/${T}/feed` } };

before(async () => {
  config.adminPassword = `synthetic-admin-password-${T}`;
  config.devAdmin = null;
  const login = await passwordLogin(config.adminPassword, "/admin", "invariant-test");
  sessionCookie = `aihot_admin=${login.token}`;
  const principal = await sessionPrincipal(sessionCookie);
  assert.ok(principal && !principal.dev);
  headers = { cookie: sessionCookie, "x-csrf-token": principal.csrf };
  app = await buildApp();
  app.get("/api/admin/test-internal-error", adminHandler(async () => { throw new Error("synthetic internal failure"); }));
});

after(async () => {
  await app?.close();
  if (sessionCookie) await endSession(sessionCookie);
  config.adminPassword = previousPassword;
  config.devAdmin = previousDevAdmin;
  await closeDb();
});

test("invalid admin input remains behind session and CSRF checks", async () => {
  const unauthenticated = await app.inject({ method: "POST", url: "/api/admin/sources", payload: source });
  assert.equal(unauthenticated.statusCode, 401);
  const noCsrf = await app.inject({ method: "POST", url: "/api/admin/sources", headers: { cookie: sessionCookie }, payload: source });
  assert.equal(noCsrf.statusCode, 403);
});

test("an admin can correct rejected input and successfully resubmit", async () => {
  const invalid = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: source });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, "invalid_request");
  assert.match(invalid.json().detail, /name/);
  const corrected = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: { ...source, name: "Synthetic source" } });
  assert.equal(corrected.statusCode, 200);
  assert.equal(corrected.json().created, true);
});

test("source conflicts and internal failures keep distinct error responses", async () => {
  const conflict = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: { ...source, name: "Duplicate ID", config: { feedUrl: `https://example.invalid/${T}/other` } } });
  assert.equal(conflict.statusCode, 409);
  const internal = await app.inject({ method: "GET", url: "/api/admin/test-internal-error", headers });
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.json().code, "internal_error");
});

test("malformed unrelated cookies do not break an authenticated session", async () => {
  for (const cookie of [`unrelated=%; ${sessionCookie}`, `${sessionCookie}; unrelated=%`]) {
    const response = await app.inject({ method: "GET", url: "/api/admin/me", headers: { cookie } });
    assert.equal(response.statusCode, 200);
  }
});

test("malformed session cookies are unauthenticated rather than a service failure", async () => {
  for (const cookie of ["aihot_admin=%", "unrelated=%", "unrelated=%25"]) {
    const response = await app.inject({ method: "GET", url: "/api/admin/me", headers: { cookie } });
    assert.equal(response.statusCode, 401);
  }
});

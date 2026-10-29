import { assertConfiguredTestDatabase, gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import type { AccountMe, SiteUser } from "@aihot/contracts/account";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { endSession, passwordLogin, sessionPrincipal } from "@aihot/backend/admin/auth";
import { createSiteUser, resetSiteUserPassword } from "@aihot/backend/users/accounts";
import { changeOwnPassword, loginSiteUser, userPrincipal, USER_SESSION_DAYS } from "@aihot/backend/users/auth";
import { hashPassword } from "@aihot/backend/users/password";
import { sha256 } from "@aihot/backend/lib/ids";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";
import { registerAccount } from "../apps/api/src/routes/account.ts";
import { registerAdminUsers } from "../apps/api/src/routes/admin-users.ts";

const T = tag();
const password = `synthetic-${T}-password`;
const origin = "https://account.test";
const original = { siteUrl: config.siteUrl, devAdmin: config.devAdmin, adminPassword: config.adminPassword };
const users: number[] = [];
let sequence = 0;
let adminCookie = "";
let adminHeaders: { cookie: string; "x-csrf-token": string; origin: string };
const app = Fastify({ logger: false });

before(async () => {
  const [db] = await sql<{ name: string; port: number }[]>`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
  config.siteUrl = origin;
  config.devAdmin = null;
  config.adminPassword = `synthetic-admin-${T}`;
  const admin = await passwordLogin(config.adminPassword, "/admin", "test");
  adminCookie = `aihot_admin=${admin.token}`;
  const principal = await sessionPrincipal(adminCookie);
  assert.ok(principal);
  adminHeaders = { cookie: adminCookie, "x-csrf-token": principal.csrf, origin };
  registerAdminAuth(app);
  registerAccount(app);
  registerAdminUsers(app);
  await app.ready();
});

after(async () => {
  await app.close();
  if (adminCookie) await endSession(adminCookie);
  // These are only rows created by this file in the independently verified throwaway database.
  if (users.length) await sql`DELETE FROM site_users WHERE id IN ${sql(users)}`;
  Object.assign(config, original);
  await closeDb();
});

async function fixture(suffix = "user") {
  const username = `u${T}${++sequence}${suffix}`.slice(0, 32);
  const user = await createSiteUser({ username, displayName: `${T} ${suffix} ${sequence}`, password }, "test:users");
  users.push(user.id);
  return user;
}

async function signIn(user: SiteUser, givenPassword = password, cookie?: string) {
  const response = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress: `127.0.1.${++sequence}`, headers: { origin, ...(cookie ? { cookie } : {}) }, payload: { username: user.username.toUpperCase(), password: givenPassword } });
  assert.equal(response.statusCode, 200, response.body);
  const me = response.json<AccountMe>();
  const header = String(response.headers["set-cookie"]);
  return { me, response, cookie: header.split(";")[0]!, headers: { cookie: header.split(";")[0]!, "x-csrf-token": me.csrf, origin } };
}

test("admin creates a normalized member account without exposing passwords or admin authority", async () => {
  const input = { username: `Create_${T}`.toUpperCase(), displayName: "  新用户  ", password };
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/users", payload: input })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/users", headers: { cookie: adminCookie }, payload: input })).statusCode, 403);
  const response = await app.inject({ method: "POST", url: "/api/admin/users", headers: adminHeaders, payload: input });
  assert.equal(response.statusCode, 201, response.body);
  const user = response.json<SiteUser>(); users.push(user.id);
  assert.equal(user.username, input.username.toLowerCase());
  assert.equal(user.displayName, "新用户");
  assert.equal(user.role, "member");
  assert.equal(user.status, "active");
  assert.equal(response.body.includes(password), false);
  assert.equal(response.body.includes("password_hash"), false);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/users", headers: adminHeaders, payload: input })).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/users", headers: adminHeaders, payload: { ...input, username: `role_${T}`, role: "admin" } })).statusCode, 400);
  const [stored] = await sql`SELECT password_hash FROM site_users WHERE id = ${user.id}`;
  assert.match(stored!.password_hash, /^scrypt-v1\$/);
  assert.equal(stored!.password_hash.includes(password), false);
  const other = await fixture();
  const [otherStored] = await sql`SELECT password_hash FROM site_users WHERE id = ${other.id}`;
  assert.notEqual(stored!.password_hash, otherStored!.password_hash);
  const signedIn = await signIn(user);
  assert.equal((await app.inject({ url: "/api/admin/users", headers: { cookie: signedIn.cookie } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/account/me", headers: { cookie: adminCookie } })).statusCode, 401);
});

test("admin user search uses stable paged results and rejects invalid cursors", async () => {
  const needle = `${T} paging`;
  const created = await Promise.all([fixture("paging"), fixture("paging"), fixture("paging")]);
  const first = await app.inject({ url: `/api/admin/users?q=${encodeURIComponent(needle)}&limit=2`, headers: adminHeaders });
  assert.equal(first.statusCode, 200, first.body);
  const page = first.json<{ users: SiteUser[]; nextCursor: number | null }>();
  assert.equal(page.users.length, 2);
  assert.ok(page.nextCursor);
  const next = await app.inject({ url: `/api/admin/users?q=${encodeURIComponent(needle)}&limit=2&cursor=${page.nextCursor}`, headers: adminHeaders });
  assert.equal(next.statusCode, 200, next.body);
  const second = next.json<{ users: SiteUser[]; nextCursor: number | null }>();
  assert.equal(second.users.length, 1); assert.equal(second.nextCursor, null);
  assert.deepEqual([...page.users, ...second.users].map(row => row.id).sort(), created.map(row => row.id).sort());
  assert.equal((await app.inject({ url: "/api/admin/users?cursor=-1", headers: adminHeaders })).statusCode, 400);
  const literal = await app.inject({ url: "/api/admin/users?q=%25", headers: adminHeaders });
  assert.equal(literal.json<{ users: SiteUser[] }>().users.length, 0, "search treats % literally");
});

test("sessions are opaque, seven-day, no-store and isolated from existing admin sessions", async () => {
  const user = await fixture();
  const first = await signIn(user);
  assert.equal(USER_SESSION_DAYS, 7);
  const setCookie = String(first.response.headers["set-cookie"]);
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Max-Age=604800"]) assert.ok(setCookie.includes(attribute));
  assert.match(String(first.response.headers["cache-control"]), /no-store/);
  const token = first.cookie.slice("aihot_user=".length);
  const [stored] = await sql`SELECT id_hash, expires_at - created_at AS duration FROM site_sessions WHERE user_id = ${user.id}`;
  assert.equal(stored!.id_hash, sha256(token));
  assert.notEqual(stored!.id_hash, token);
  const me = await app.inject({ url: "/api/account/me", headers: { cookie: `broken=%; ${first.cookie}` } });
  assert.equal(me.statusCode, 200); assert.match(String(me.headers["cache-control"]), /no-store/);
  const second = await signIn(user, password, `${first.cookie}; ${adminCookie}`);
  assert.equal(await userPrincipal(first.cookie), null);
  assert.ok(await userPrincipal(second.cookie));
  assert.ok(await sessionPrincipal(adminCookie));
  await sql`UPDATE site_sessions SET expires_at = now() - interval '1 second' WHERE user_id = ${user.id}`;
  assert.equal((await app.inject({ url: "/api/account/me", headers: second.headers })).statusCode, 401);
  for (const cookie of ["aihot_user=%", "aihot_user=bad", "unrelated=%"]) assert.equal((await app.inject({ url: "/api/account/me", headers: { cookie } })).statusCode, 401);
});

test("registration stays closed and login rejects browser CSRF before creating a session", async () => {
  const user = await fixture();
  const [beforeCount] = await sql`SELECT count(*)::int AS count FROM site_users`;
  const closed = await app.inject({ method: "POST", url: "/api/account/register", payload: { username: `public${T}`, password, displayName: "Public" } });
  assert.equal(closed.statusCode, 403); assert.equal(closed.json().code, "registration_closed");
  const [afterCount] = await sql`SELECT count(*)::int AS count FROM site_users`;
  assert.equal(afterCount!.count, beforeCount!.count);
  for (const headers of [{ origin: "https://other.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/api/account/login", headers, payload: { username: user.username, password } })).statusCode, 403);
  }
  const [sessions] = await sql`SELECT count(*)::int AS count FROM site_sessions WHERE user_id = ${user.id}`;
  assert.equal(sessions!.count, 0);
});

test("profile and logout require CSRF and origin; profile cannot escalate role or change username", async () => {
  const user = await fixture();
  const current = await signIn(user);
  const request = { method: "PATCH" as const, url: "/api/account/profile", payload: { displayName: "Changed" } };
  for (const headers of [{ cookie: current.cookie }, { ...current.headers, "x-csrf-token": "wrong" }, { ...current.headers, origin: "https://other.test" }]) {
    assert.equal((await app.inject({ ...request, headers })).statusCode, 403);
  }
  assert.equal((await app.inject({ ...request, headers: current.headers, payload: { displayName: "Changed", role: "admin" } })).statusCode, 400);
  const changed = await app.inject({ ...request, headers: current.headers });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json<AccountMe>().user.displayName, "Changed");
  assert.equal(changed.json<AccountMe>().user.id, user.id);
  assert.equal((await app.inject({ method: "POST", url: "/api/account/logout", headers: { cookie: current.cookie } })).statusCode, 403);
  const out = await app.inject({ method: "POST", url: "/api/account/logout", headers: current.headers });
  assert.equal(out.statusCode, 200); assert.match(String(out.headers["set-cookie"]), /Max-Age=0/);
  assert.equal(await userPrincipal(current.cookie), null);
});

test("disable, re-enable and password reset revoke old sessions without revealing the login reason", async () => {
  const user = await fixture();
  const one = await signIn(user), two = await signIn(user);
  const wrong = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress: "127.0.2.1", headers: { origin }, payload: { username: user.username, password: "wrong" } });
  const unknown = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress: "127.0.2.2", headers: { origin }, payload: { username: `missing${T}`, password } });
  const disabled = await app.inject({ method: "PATCH", url: `/api/admin/users/${user.id}`, headers: adminHeaders, payload: { status: "disabled" } });
  assert.equal(disabled.statusCode, 200);
  assert.equal(await userPrincipal(one.cookie), null); assert.equal(await userPrincipal(two.cookie), null);
  const blocked = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress: "127.0.2.3", headers: { origin }, payload: { username: user.username, password } });
  assert.equal(wrong.statusCode, 401); assert.equal(unknown.statusCode, 401); assert.equal(blocked.statusCode, 401);
  assert.equal(wrong.json().detail, unknown.json().detail); assert.equal(wrong.json().detail, blocked.json().detail);
  assert.equal((await app.inject({ method: "PATCH", url: `/api/admin/users/${user.id}`, headers: adminHeaders, payload: { status: "active" } })).statusCode, 200);
  assert.equal(await userPrincipal(one.cookie), null);
  const active = await signIn(user);
  const replacement = `replacement-${password}`;
  assert.equal((await app.inject({ method: "POST", url: `/api/admin/users/${user.id}/password`, headers: adminHeaders, payload: { password: replacement } })).statusCode, 200);
  assert.equal(await userPrincipal(active.cookie), null);
  await assert.rejects(loginSiteUser({ username: user.username, password }), { code: "invalid_credentials" });
  await signIn(user, replacement);
});

test("own password change checks current password and revokes every session", async () => {
  const user = await fixture();
  const one = await signIn(user), two = await signIn(user);
  const request = { method: "POST" as const, url: "/api/account/password", headers: one.headers };
  assert.equal((await app.inject({ ...request, payload: { currentPassword: "wrong", newPassword: `new-${password}` } })).statusCode, 400);
  assert.ok(await userPrincipal(one.cookie));
  const changed = await app.inject({ ...request, payload: { currentPassword: password, newPassword: `new-${password}` } });
  assert.equal(changed.statusCode, 200); assert.match(String(changed.headers["set-cookie"]), /Max-Age=0/);
  assert.equal(await userPrincipal(one.cookie), null); assert.equal(await userPrincipal(two.cookie), null);
  await assert.rejects(loginSiteUser({ username: user.username, password }));
  await signIn(user, `new-${password}`);
  const audit = await sql`SELECT before, after FROM audit_log WHERE subject = ${`user:${user.id}`}`;
  const serialized = JSON.stringify(audit);
  for (const secret of [password, `new-${password}`, one.me.csrf, one.cookie.slice("aihot_user=".length), "password_hash"]) assert.equal(serialized.includes(secret), false);
});

async function waitForLoginLock() {
  for (let i = 0; i < 100; i++) {
    const [waiting] = await sql`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%site_users%' AND query LIKE '%FOR UPDATE%'`;
    if (waiting!.count > 0) return;
    await delay(20);
  }
  assert.fail("login did not reach the locked account row");
}

test("a login verified before a concurrent disable or reset cannot create a stale session", async () => {
  for (const mode of ["disable", "reset"] as const) {
    const user = await fixture(mode);
    const locked = gate(), release = gate();
    const newHash = await hashPassword(`concurrent-${password}`);
    const mutation = sql.begin(async tx => {
      await tx`SELECT id FROM site_users WHERE id = ${user.id} FOR UPDATE`;
      if (mode === "disable") await tx`UPDATE site_users SET status = 'disabled' WHERE id = ${user.id}`;
      else await tx`UPDATE site_users SET password_hash = ${newHash} WHERE id = ${user.id}`;
      await tx`DELETE FROM site_sessions WHERE user_id = ${user.id}`;
      locked.open();
      await release.promise;
    });
    await locked.promise;
    const signIn = loginSiteUser({ username: user.username, password });
    const rejected = assert.rejects(signIn, { code: "invalid_credentials" });
    try { await waitForLoginLock(); } finally { release.open(); }
    await mutation;
    await rejected;
    const [sessions] = await sql`SELECT count(*)::int AS count FROM site_sessions WHERE user_id = ${user.id}`;
    assert.equal(sessions!.count, 0);
  }
});

test("concurrent password changes admit only one replacement and invalidate the previous session", async () => {
  const user = await fixture();
  const signedIn = await loginSiteUser({ username: user.username, password });
  const changed = await Promise.allSettled([
    changeOwnPassword(signedIn.principal, { currentPassword: password, newPassword: `first-${password}` }),
    changeOwnPassword(signedIn.principal, { currentPassword: password, newPassword: `second-${password}` }),
  ]);
  assert.equal(changed.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await userPrincipal(`aihot_user=${signedIn.token}`), null);
  await resetSiteUserPassword(user.id, { password }, "test:reset");
});

test("login attempts are bounded across client addresses for the same account", async () => {
  const username = `ratelimit${T}`;
  for (let i = 0; i < 10; i++) {
    const response = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress: `127.0.3.${i + 1}`, headers: { origin }, payload: { username: i % 2 ? username.toUpperCase() : username, password: "wrong" } });
    assert.equal(response.statusCode, 401, response.body);
  }
  const limited = await app.inject({ method: "POST", url: "/api/account/login", remoteAddress: "127.0.4.1", headers: { origin }, payload: { username, password: "wrong" } });
  assert.equal(limited.statusCode, 429); assert.equal(limited.headers["retry-after"], "900");
  assert.match(String(limited.headers["cache-control"]), /no-store/);
});

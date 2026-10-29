import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AccountMe } from "@aihot/contracts/account";
import { sql } from "../db.ts";
import { audit, parseCookies } from "../admin/auth.ts";
import { sha256 } from "../lib/ids.ts";
import { AccountError, DisplayName, Password, Username, lockedUser, userDto, type UserRow } from "./accounts.ts";
import { hashPassword, verifyPassword } from "./password.ts";

export const USER_SESSION_COOKIE = "aihot_user";
export const USER_SESSION_DAYS = 7;
export type UserPrincipal = AccountMe;
export const userActor = (principal: UserPrincipal): string => `user:${principal.user.id}`;
const rejected = () => new AccountError(401, "invalid_credentials", "用户名或密码不正确，或账号已停用");

export async function loginSiteUser(raw: unknown): Promise<{ token: string; principal: UserPrincipal }> {
  const { username, password } = z.object({ username: z.string().max(128), password: z.string().max(128) }).strict().parse(raw);
  const parsedName = Username.safeParse(username);
  const [candidate] = parsedName.success ? await sql<UserRow[]>`SELECT * FROM site_users WHERE username = ${parsedName.data}` : [];
  const valid = await verifyPassword(password, candidate?.password_hash ?? null);
  if (!valid || !candidate || candidate.status !== "active") throw rejected();
  return await sql.begin(async tx => {
    // Serializes login against a password reset or disable. A verified stale hash cannot mint a session.
    const row = await lockedUser(tx, candidate.id);
    if (row.status !== "active" || row.password_hash !== candidate.password_hash) throw rejected();
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    await tx`DELETE FROM site_sessions WHERE user_id = ${row.id} AND expires_at <= now()`;
    await tx`INSERT INTO site_sessions(id_hash, user_id, csrf_token, expires_at)
      VALUES (${sha256(token)}, ${row.id}, ${csrf}, ${new Date(Date.now() + USER_SESSION_DAYS * 86400_000)})`;
    const [updated] = await tx<UserRow[]>`UPDATE site_users SET last_login_at = now() WHERE id = ${row.id} RETURNING *`;
    const principal = { user: userDto(updated!), csrf };
    await audit(userActor(principal), "user.login", `user:${row.id}`, null, null, null, undefined, tx);
    return { token, principal };
  });
}

export async function userPrincipal(cookieHeader: string | undefined): Promise<UserPrincipal | null> {
  const token = parseCookies(cookieHeader)[USER_SESSION_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await sql<(UserRow & { csrf_token: string })[]>`SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at, u.last_login_at, s.csrf_token
    FROM site_sessions s JOIN site_users u ON u.id = s.user_id
    WHERE s.id_hash = ${sha256(token)} AND s.expires_at > now() AND u.status = 'active'`;
  return row ? { user: userDto(row), csrf: row.csrf_token } : null;
}

export async function logoutSiteUser(cookieHeader: string | undefined): Promise<void> {
  const token = parseCookies(cookieHeader)[USER_SESSION_COOKIE];
  if (token) await sql`DELETE FROM site_sessions WHERE id_hash = ${sha256(token)}`;
}

export async function updateOwnProfile(principal: UserPrincipal, raw: unknown): Promise<UserPrincipal> {
  const { displayName } = z.object({ displayName: DisplayName }).strict().parse(raw);
  return await sql.begin(async tx => {
    const before = await lockedUser(tx, principal.user.id);
    if (before.status !== "active") throw rejected();
    const [row] = await tx<UserRow[]>`UPDATE site_users SET display_name = ${displayName}, updated_at = now() WHERE id = ${before.id} RETURNING *`;
    const user = userDto(row!);
    await audit(userActor(principal), "user.profile.update", userActor(principal), null, { displayName: before.display_name }, { displayName }, undefined, tx);
    return { user, csrf: principal.csrf };
  });
}

export async function changeOwnPassword(principal: UserPrincipal, raw: unknown): Promise<void> {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().max(128), newPassword: Password }).strict().parse(raw);
  const [candidate] = await sql<UserRow[]>`SELECT * FROM site_users WHERE id = ${principal.user.id}`;
  const valid = await verifyPassword(currentPassword, candidate?.password_hash ?? null);
  if (!valid || !candidate || candidate.status !== "active") throw new AccountError(400, "invalid_password", "当前密码不正确");
  const passwordHash = await hashPassword(newPassword);
  await sql.begin(async tx => {
    const row = await lockedUser(tx, principal.user.id);
    if (row.status !== "active" || row.password_hash !== candidate.password_hash) throw rejected();
    await tx`UPDATE site_users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${row.id}`;
    await tx`DELETE FROM site_sessions WHERE user_id = ${row.id}`;
    await audit(userActor(principal), "user.password.change", userActor(principal), null, null, { sessionsRevoked: true }, undefined, tx);
  });
}

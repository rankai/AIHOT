import { z } from "zod";
import type { SiteUser, SiteUsersPage } from "@aihot/contracts/account";
import { sql, type Db } from "../db.ts";
import { audit } from "../admin/auth.ts";
import { hashPassword } from "./password.ts";

export const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, "用户名需为 3–32 位字母、数字、点、下划线或横线，并以字母或数字开头");
export const Password = z.string().min(12, "密码至少 12 位").max(128, "密码最多 128 位");
export const DisplayName = z.string().trim().min(1, "请填写显示名称").max(80, "显示名称最多 80 字");
export const UserId = z.number().int().safe().positive();

export class AccountError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: "member";
  status: "active" | "disabled";
  created_at: Date;
  last_login_at: Date | null;
  password_hash: string;
}

export function userDto(row: Omit<UserRow, "password_hash">): SiteUser {
  return {
    id: row.id, username: row.username, displayName: row.display_name, role: row.role,
    status: row.status, createdAt: row.created_at.toISOString(), lastLoginAt: row.last_login_at?.toISOString() ?? null,
  };
}

export async function listSiteUsers(raw: unknown = {}): Promise<SiteUsersPage> {
  const { q, cursor, limit } = z.object({
    q: z.string().trim().max(100).default(""),
    cursor: z.coerce.number().int().safe().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).strict().parse(raw);
  const rows = await sql<UserRow[]>`SELECT id, username, display_name, role, status, created_at, last_login_at FROM site_users
    WHERE (${cursor ?? null}::bigint IS NULL OR id < ${cursor ?? null})
      AND (${q} = '' OR strpos(lower(username), lower(${q})) > 0 OR strpos(lower(display_name), lower(${q})) > 0)
    ORDER BY id DESC LIMIT ${limit + 1}`;
  const users = rows.slice(0, limit).map(userDto);
  return { users, nextCursor: rows.length > limit ? users.at(-1)!.id : null };
}

export async function createSiteUser(raw: unknown, actor: string): Promise<SiteUser> {
  const input = z.object({ username: Username, displayName: DisplayName, password: Password }).strict().parse(raw);
  const passwordHash = await hashPassword(input.password);
  try {
    return await sql.begin(async tx => {
      const [row] = await tx<UserRow[]>`INSERT INTO site_users(username, display_name, password_hash)
        VALUES (${input.username}, ${input.displayName}, ${passwordHash}) RETURNING *`;
      const user = userDto(row!);
      await audit(actor, "user.create", `user:${user.id}`, null, null, user, undefined, tx);
      return user;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new AccountError(409, "conflict", "该用户名已存在");
    throw error;
  }
}

export async function lockedUser(db: Db, id: number): Promise<UserRow> {
  const [row] = await db<UserRow[]>`SELECT * FROM site_users WHERE id = ${UserId.parse(id)} FOR UPDATE`;
  if (!row) throw new AccountError(404, "not_found", "用户不存在");
  return row;
}

export async function updateSiteUser(id: number, raw: unknown, actor: string): Promise<SiteUser> {
  const input = z.object({ displayName: DisplayName.optional(), status: z.enum(["active", "disabled"]).optional() })
    .strict().refine(value => Object.keys(value).length > 0, "请提供要更新的资料").parse(raw);
  return await sql.begin(async tx => {
    const before = await lockedUser(tx, id);
    const [row] = await tx<UserRow[]>`UPDATE site_users SET display_name = ${input.displayName ?? before.display_name},
      status = ${input.status ?? before.status}, updated_at = now() WHERE id = ${id} RETURNING *`;
    if (row!.status === "disabled") await tx`DELETE FROM site_sessions WHERE user_id = ${id}`;
    const user = userDto(row!);
    await audit(actor, "user.update", `user:${id}`, null, userDto(before), user, undefined, tx);
    return user;
  });
}

export async function resetSiteUserPassword(id: number, raw: unknown, actor: string): Promise<void> {
  const { password } = z.object({ password: Password }).strict().parse(raw);
  const passwordHash = await hashPassword(password);
  await sql.begin(async tx => {
    await lockedUser(tx, id);
    await tx`UPDATE site_users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${id}`;
    await tx`DELETE FROM site_sessions WHERE user_id = ${id}`;
    await audit(actor, "user.password.reset", `user:${id}`, null, null, { sessionsRevoked: true }, undefined, tx);
  });
}

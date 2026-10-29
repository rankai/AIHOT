import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "@aihot/backend/config";
import { cookie } from "@aihot/backend/admin/auth";
import {
  changeOwnPassword, loginSiteUser, logoutSiteUser, updateOwnProfile,
  USER_SESSION_COOKIE, USER_SESSION_DAYS,
} from "@aihot/backend/users/auth";
import { accountProblem, requireSameOrigin, userHandler } from "../user-handler.ts";
import { sendProblem } from "../http/respond.ts";

const WINDOW = 15 * 60_000;
const secure = () => config.siteUrl.startsWith("https://");

/** Per-app limits avoid shared test state. The global bucket remains even if individual keys churn. */
export function registerAccount(app: FastifyInstance) {
  const attempts = new Map<string, { count: number; until: number }>();
  let global = { count: 0, until: 0 };
  function limited(req: FastifyRequest, reply: FastifyReply, identity: string): boolean {
    const now = Date.now();
    const over = (key: string, limit: number) => {
      const previous = attempts.get(key);
      const entry = previous && previous.until > now ? previous : { count: 0, until: now + WINDOW };
      entry.count += 1;
      attempts.set(key, entry);
      return entry.count > limit;
    };
    if (global.until <= now) global = { count: 0, until: now + WINDOW };
    global.count += 1;
    const ipLimited = over(`ip:${req.ip}`, 30);
    const accountLimited = over(`account:${identity}`, 10);
    if (attempts.size > 10_000) {
      for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
      while (attempts.size > 10_000) attempts.delete(attempts.keys().next().value!);
    }
    if (global.count <= 200 && !ipLimited && !accountLimited) return false;
    sendProblem(req, reply, { status: 429, code: "too_many_attempts", detail: "尝试次数过多，请 15 分钟后重试", retryAfter: 900 });
    return true;
  }

  app.get("/api/account/me", userHandler(async (_req, _reply, user) => user));

  app.post("/api/account/login", { bodyLimit: 4096 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!requireSameOrigin(req, reply)) return reply;
    const rawName = (req.body as { username?: unknown } | null)?.username;
    const identity = typeof rawName === "string" ? rawName.trim().toLowerCase().slice(0, 128) : "";
    if (limited(req, reply, `login:${identity}`)) return reply;
    try {
      const { token, principal } = await loginSiteUser(req.body);
      // A new login replaces only this browser's previous reader session, never its admin session.
      await logoutSiteUser(req.headers.cookie);
      return reply.header("Set-Cookie", cookie(USER_SESSION_COOKIE, token, USER_SESSION_DAYS * 86400, secure())).send(principal);
    } catch (error) {
      return accountProblem(error, req, reply);
    }
  });

  app.post("/api/account/register", async (req, reply) => sendProblem(req, reply, {
    status: 403, code: "registration_closed", detail: "暂未开放注册，请联系管理员创建账号",
  }));

  app.post("/api/account/logout", userHandler(async (req, reply) => {
    await logoutSiteUser(req.headers.cookie);
    return reply.header("Set-Cookie", cookie(USER_SESSION_COOKIE, "", 0, secure())).send({ ok: true });
  }));

  app.patch("/api/account/profile", { bodyLimit: 4096 }, userHandler(async (req, _reply, user) => updateOwnProfile(user, req.body)));

  app.post("/api/account/password", { bodyLimit: 4096 }, userHandler(async (req, reply, user) => {
    if (limited(req, reply, `password:${user.user.id}`)) return reply;
    await changeOwnPassword(user, req.body);
    return reply.header("Set-Cookie", cookie(USER_SESSION_COOKIE, "", 0, secure())).send({ ok: true });
  }));
}

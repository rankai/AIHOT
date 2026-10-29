import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { config } from "@aihot/backend/config";
import { AccountError } from "@aihot/backend/users/accounts";
import { userPrincipal, type UserPrincipal } from "@aihot/backend/users/auth";
import { sendProblem } from "./http/respond.ts";

export { userActor, type UserPrincipal } from "@aihot/backend/users/auth";
export type UserHandler = (req: FastifyRequest, reply: FastifyReply, user: UserPrincipal) => Promise<unknown>;

/** JSON APIs also reject cross-site browser requests, including login CSRF. */
export function requireSameOrigin(req: FastifyRequest, reply: FastifyReply): boolean {
  const origin = req.headers.origin;
  if (req.headers["sec-fetch-site"] === "cross-site" || (origin !== undefined && origin !== new URL(config.siteUrl).origin)) {
    sendProblem(req, reply, { status: 403, code: "forbidden", detail: "请从本站提交请求" });
    return false;
  }
  return true;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<UserPrincipal | null> {
  reply.header("Cache-Control", "no-store");
  const principal = await userPrincipal(req.headers.cookie);
  if (!principal) {
    sendProblem(req, reply, { status: 401, code: "unauthorized", detail: "请先登录" });
    return null;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (!requireSameOrigin(req, reply)) return null;
    if (req.headers["x-csrf-token"] !== principal.csrf) {
      sendProblem(req, reply, { status: 403, code: "forbidden", detail: "登录校验已失效，请刷新页面后重试" });
      return null;
    }
  }
  return principal;
}

export function accountProblem(error: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AccountError) return sendProblem(req, reply, { status: error.statusCode, code: error.code, detail: error.message });
  if (error instanceof ZodError) return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: error.issues.map(issue => issue.message).join("；").slice(0, 300) });
  // Do not log bodies or database parameters: account commands contain passwords.
  req.log.error({ path: req.url.split("?")[0], errorType: error instanceof Error ? error.name : "unknown" }, "account api error");
  return sendProblem(req, reply, { status: 503, code: "temporarily_unavailable", detail: "暂时无法处理，请稍后重试" });
}

export function userHandler(fn: UserHandler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const principal = await requireUser(req, reply);
      return principal ? await fn(req, reply, principal) : reply;
    } catch (error) {
      return accountProblem(error, req, reply);
    }
  };
}

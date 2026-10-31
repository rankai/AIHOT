import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CostCenterBusyError, costs } from "@aihot/backend/admin/costs";
import { InvalidCursorError } from "@aihot/backend/lib/cursor";
import { adminHandler } from "./admin-auth.ts";
import { sendProblem } from "../http/respond.ts";

export function costReadProblem(error: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof CostCenterBusyError)
    return sendProblem(req, reply, {
      status: 503,
      code: "cost_center_busy",
      detail: error.message,
      retryAfter: error.retryAfter,
    });
  if (error instanceof InvalidCursorError)
    return sendProblem(req, reply, {
      status: 400,
      code: "invalid_cursor",
      detail: "分页游标已失效或不属于当前筛选条件。",
    });
  if (["57014", "55P03", "25P04"].includes(String((error as { code?: unknown }).code)))
    return sendProblem(req, reply, {
      status: 503,
      code: "cost_center_unavailable",
      detail: "成本统计暂时超时，请缩小时间范围后重试。",
      retryAfter: 2,
    });
  if ((error as { statusCode?: number }).statusCode === 404)
    return sendProblem(req, reply, {
      status: 404,
      code: "not_found",
      detail: (error as Error).message,
    });
  throw error;
}

export function registerAdminCosts(app: FastifyInstance) {
  app.get(
    "/api/admin/costs",
    adminHandler(async (req, reply) => {
      const controller = new AbortController();
      const disconnected = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      req.raw.once("aborted", disconnected);
      reply.raw.once("close", disconnected);
      try {
        return await costs(req.query as { start: string; end: string }, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) return reply;
        return costReadProblem(error, req, reply);
      } finally {
        req.raw.off("aborted", disconnected);
        reply.raw.off("close", disconnected);
      }
    }),
  );
}

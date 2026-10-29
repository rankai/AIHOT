import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorOf } from "@aihot/backend/admin/auth";
import { createSiteUser, listSiteUsers, resetSiteUserPassword, updateSiteUser } from "@aihot/backend/users/accounts";
import { accountProblem, requireSameOrigin } from "../user-handler.ts";
import { adminHandler, type AdminHandler } from "./admin-auth.ts";

const userId = (params: unknown) => z.object({ id: z.coerce.number().int().safe().positive() }).parse(params).id;
function accountAdminHandler(fn: AdminHandler) {
  return adminHandler(async (req, reply, admin) => {
    if (req.method !== "GET" && req.method !== "HEAD" && !requireSameOrigin(req, reply)) return reply;
    try { return await fn(req, reply, admin); }
    catch (error) { return accountProblem(error, req, reply); }
  });
}

export function registerAdminUsers(app: FastifyInstance) {
  app.get("/api/admin/users", accountAdminHandler(async req => listSiteUsers(req.query)));
  app.post("/api/admin/users", { bodyLimit: 4096 }, accountAdminHandler(async (req, reply, admin) => {
    const user = await createSiteUser(req.body, actorOf(admin));
    return reply.code(201).send(user);
  }));
  app.patch("/api/admin/users/:id", { bodyLimit: 4096 }, accountAdminHandler(async (req, _reply, admin) => updateSiteUser(userId(req.params), req.body, actorOf(admin))));
  app.post("/api/admin/users/:id/password", { bodyLimit: 4096 }, accountAdminHandler(async (req, _reply, admin) => {
    await resetSiteUserPassword(userId(req.params), req.body, actorOf(admin));
    return { ok: true };
  }));
}

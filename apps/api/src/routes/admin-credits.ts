import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { actorOf } from "@aihot/backend/admin/auth";
import { getCreditPage, grantCredits, listCreditCharges, listToolPrices, reconcileCreditCharge, saveToolPrice } from "@aihot/backend/users/credits";
import { adminHandler, type AdminHandler } from "./admin-auth.ts";
import { accountProblem, requireSameOrigin } from "../user-handler.ts";

const userId = (params: unknown) => z.object({ id: z.coerce.number().int().safe().positive() }).parse(params).id;
const chargeId = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
function creditAdminHandler(fn: AdminHandler) {
  return adminHandler(async (req, reply, admin) => {
    if (req.method !== "GET" && req.method !== "HEAD" && !requireSameOrigin(req, reply)) return reply;
    try { return await fn(req, reply, admin); }
    catch (error) { return accountProblem(error, req, reply); }
  });
}

export function registerAdminCredits(app: FastifyInstance) {
  app.get("/api/admin/users/:id/credits", creditAdminHandler(async req => getCreditPage(userId(req.params), req.query)));
  app.post("/api/admin/users/:id/credits", { bodyLimit: 4096 }, creditAdminHandler(async (req, _reply, admin) => {
    const id = userId(req.params);
    await grantCredits(id, req.body, actorOf(admin), req.headers["idempotency-key"]);
    return getCreditPage(id);
  }));
  app.get("/api/admin/tool-prices", creditAdminHandler(async req => listToolPrices(req.query)));
  app.put("/api/admin/tool-prices", { bodyLimit: 8192 }, creditAdminHandler(async (req, _reply, admin) => saveToolPrice(req.body, actorOf(admin))));
  app.get("/api/admin/credit-charges", creditAdminHandler(async req => listCreditCharges(req.query)));
  app.post("/api/admin/credit-charges/:id/reconcile", { bodyLimit: 4096 }, creditAdminHandler(async (req, _reply, admin) =>
    reconcileCreditCharge(chargeId(req.params), req.body, actorOf(admin), req.headers["idempotency-key"])));
}

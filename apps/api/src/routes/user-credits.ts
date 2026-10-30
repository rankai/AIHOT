import { getMembership } from '@aihot/backend/users/membership';
import { memberPriceCatalog } from '@aihot/backend/users/member-pricing';
import type { FastifyInstance } from "fastify";
import { getCreditPage } from "@aihot/backend/users/credits";
import { userHandler } from "../user-handler.ts";

export function registerUserCredits(app: FastifyInstance) {
  app.get('/api/account/membership', userHandler(async (_req, _reply, user) => { const page = await getMembership(user.user.id); return {...page,payments:page.payments.map(({receiptReference,reason,...payment}) => payment)}; }));
  app.get('/api/account/tool-pricing', userHandler(async () => memberPriceCatalog()));
  app.get("/api/account/credits", userHandler(async (req, _reply, user) => getCreditPage(user.user.id, req.query)));
}

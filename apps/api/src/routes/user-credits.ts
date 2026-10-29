import type { FastifyInstance } from "fastify";
import { getCreditPage } from "@aihot/backend/users/credits";
import { userHandler } from "../user-handler.ts";

export function registerUserCredits(app: FastifyInstance) {
  app.get("/api/account/credits", userHandler(async (req, _reply, user) => getCreditPage(user.user.id, req.query)));
}

import { enqueueMessage, approveQueuedMessage, cancelQueuedMessage, resumeMessageQueue, refreshQueuedQuote } from "@aihot/backend/assistant/message-queue";
import { feeSettings, setFeeAuthorization } from "@aihot/backend/assistant/fees";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { userHandler as baseUserHandler, type UserHandler } from "../user-handler.ts";
import { AccountError } from "@aihot/backend/users/accounts";
const userHandler = (fn: UserHandler) =>
  baseUserHandler(async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (!(error instanceof AccountError) && (error as { code?: string })?.code === "conflict")
        throw new AccountError(409, "conflict", (error as Error).message);
      throw error;
    }
  });
import {
  artifactVersions,
  attachInput,
  assistantOptions,
  createSession,
  listSessions,
  sessionSnapshot,
  quoteTurn,
  submitTurn,
  sessionEvents,
  editArtifact,
} from "@aihot/backend/assistant/sessions";
import { answerTurn, controlTurn, archiveSession, handoff } from "@aihot/backend/assistant/controls";
import { decideCall, refreshCallQuote } from "@aihot/backend/assistant/tools";
const params = (raw: unknown) =>
  z
    .object({
      id: z.string().uuid(),
      turnId: z.string().uuid().optional(),
      callId: z.string().uuid().optional(),
      artifactId: z.string().uuid().optional(),
    })
    .parse(raw);
export function registerUserAssistant(app: FastifyInstance) {
  app.post("/api/assistant/sessions/:id/queue", userHandler(async (req, reply, u) => reply.code(202).send(await enqueueMessage(u.user.id, params(req.params).id, req.body, req.headers["idempotency-key"]))));
  app.post("/api/assistant/sessions/:id/queue/resume", userHandler(async (req, _reply, u) => resumeMessageQueue(u.user.id, params(req.params).id)));
  app.post("/api/assistant/sessions/:id/queue/:entryId/approve", userHandler(async (req, _reply, u) => {
    const p = z.object({ id: z.string().uuid(), entryId: z.string().uuid() }).parse(req.params);
    return approveQueuedMessage(u.user.id, p.id, p.entryId, req.body);
  }));
  app.post("/api/assistant/sessions/:id/queue/:entryId/quote", userHandler(async (req, _reply, u) => {
    const p = z.object({ id: z.string().uuid(), entryId: z.string().uuid() }).parse(req.params);
    return refreshQueuedQuote(u.user.id, p.id, p.entryId, req.body);
  }));
  app.post("/api/assistant/sessions/:id/queue/:entryId/cancel", userHandler(async (req, _reply, u) => {
    const p = z.object({ id: z.string().uuid(), entryId: z.string().uuid() }).parse(req.params);
    return cancelQueuedMessage(u.user.id, p.id, p.entryId);
  }));
  app.get("/api/assistant/sessions/:id/fee-authorization",userHandler(async(req,_reply,u)=>feeSettings(u.user.id,params(req.params).id)));
  app.post("/api/assistant/sessions/:id/fee-authorization",userHandler(async(req,_reply,u)=>setFeeAuthorization(u.user.id,params(req.params).id,req.body)));
  app.post("/api/assistant/sessions/:id/inputs",userHandler(async(req,_reply,u)=>attachInput(u.user.id,params(req.params).id,req.body,req.headers["idempotency-key"])));

  app.get(
    "/api/assistant/options",
    userHandler(async (req, _reply, u) => assistantOptions(u.user.id,req.query)),
  );
  app.post(
    "/api/assistant/sessions",
    userHandler(async (req, reply, u) =>
      reply.code(201).send(await createSession(u.user.id, req.body, req.headers["idempotency-key"])),
    ),
  );
  app.get(
    "/api/assistant/sessions",
    userHandler(async (req, _reply, u) => listSessions(u.user.id, req.query)),
  );
  app.get(
    "/api/assistant/sessions/:id",
    userHandler(async (req, _reply, u) => sessionSnapshot(u.user.id, params(req.params).id)),
  );
  app.post(
    "/api/assistant/sessions/:id/quote",
    userHandler(async (req, _reply, u) => quoteTurn(u.user.id, params(req.params).id, req.body)),
  );
  app.post(
    "/api/assistant/sessions/:id/turns",
    userHandler(async (req, reply, u) =>
      reply
        .code(202)
        .send(await submitTurn(u.user.id, params(req.params).id, req.body, req.headers["idempotency-key"])),
    ),
  );
  app.get(
    "/api/assistant/sessions/:id/events",
    userHandler(async (req, _reply, u) => sessionEvents(u.user.id, params(req.params).id, req.query)),
  );
  app.post(
    "/api/assistant/sessions/:id/turns/:turnId/answer",
    userHandler(async (req, _reply, u) => {
      const p = params(req.params);
      return answerTurn(u.user.id, p.id, p.turnId!, req.body);
    }),
  );
  for (const action of ["stop", "resume"] as const)
    app.post(
      `/api/assistant/sessions/:id/turns/:turnId/${action}`,
      userHandler(async (req, _reply, u) => {
        const p = params(req.params);
        return controlTurn(u.user.id, p.id, p.turnId!, action, req.body);
      }),
    );
  app.post(
    "/api/assistant/sessions/:id/tool-calls/:callId/quote",
    userHandler(async (req, _reply, u) => {
      const p = params(req.params);
      return refreshCallQuote(u.user.id, p.id, p.callId!);
    }),
  );
  for (const action of ["approve", "reject"] as const)
    app.post(
      `/api/assistant/sessions/:id/tool-calls/:callId/${action}`,
      userHandler(async (req, _reply, u) => {
        const p = params(req.params);
        return decideCall(u.user.id, p.id, p.callId!, action === "approve", req.body, req.headers["idempotency-key"]);
      }),
    );
  for (const action of ["archive", "delete"] as const)
    app.post(
      `/api/assistant/sessions/:id/${action}`,
      userHandler(async (req, _reply, u) => archiveSession(u.user.id, params(req.params).id, action === "delete")),
    );
  app.get(
    "/api/assistant/sessions/:id/artifacts/:artifactId/versions",
    userHandler(async (req, _reply, u) => {
      const p = params(req.params);
      return artifactVersions(u.user.id, p.id, p.artifactId!, req.query);
    }),
  );
  app.post(
    "/api/assistant/sessions/:id/artifacts/:artifactId/versions",
    userHandler(async (req, _reply, u) => {
      const p = params(req.params);
      return editArtifact(u.user.id, p.id, p.artifactId!, req.body);
    }),
  );
  app.post(
    "/api/assistant/sessions/:id/handoffs",
    userHandler(async (req, _reply, u) =>
      handoff(u.user.id, params(req.params).id, req.body, req.headers["idempotency-key"]),
    ),
  );
}

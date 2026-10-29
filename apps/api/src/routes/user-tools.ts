import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { AccountError } from "@aihot/backend/users/accounts";
import { userToolOptions, quoteUserTool, submitUserTool, listUserTools, userToolDetail, controlUserTool, exportUserToolResults } from "@aihot/backend/users/tools";
import { ToolKind } from "@aihot/backend/users/tool-input";
import { listToolAssets, ownedToolAsset, toolAssetDto } from "@aihot/backend/users/tool-assets";
import { AssetError, VIDEO_BYTES, UPLOAD_BYTES, deleteAsset } from "@aihot/backend/operations/assets";
import { accountProblem, requireUser, userHandler, userActor, type UserHandler, type UserPrincipal } from "../user-handler.ts";
import { receiveAssetUpload, streamAssetContent } from "../http/asset-transfer.ts";

const id = (params: unknown) => z.object({ id: z.coerce.number().int().safe().positive() }).parse(params).id;
function toolError(error: unknown): unknown {
  if (error instanceof AssetError) return new AccountError(error.statusCode, error.statusCode === 409 ? "conflict" : error.statusCode === 404 ? "not_found" : "invalid_request", error.message);
  if ((error as { code?: string })?.code === "conflict") return new AccountError(409, "conflict", (error as Error).message);
  if ((error as { code?: string })?.code === "unsupported_configuration") return new AccountError(422, "unsupported_configuration", (error as Error).message);
  return error;
}
const toolHandler = (fn: UserHandler) => userHandler(async (...args) => { try { return await fn(...args); } catch (error) { throw toolError(error); } });

export function registerUserTools(app: FastifyInstance) {
  app.get("/api/tools/options", toolHandler(async () => userToolOptions()));
  app.post("/api/tools/quote", toolHandler(async (req, _reply, user) => quoteUserTool(user.user.id, req.body)));
  for (const kind of ToolKind.options) app.post(`/api/tools/${kind}`, toolHandler(async (req, reply, user) => reply.code(202).send(await submitUserTool(user.user.id, kind, req.body, req.headers["idempotency-key"]))));
  app.get("/api/tools/runs", toolHandler(async (req, _reply, user) => listUserTools(userActor(user), req.query)));
  app.get("/api/tools/runs/:id", toolHandler(async (req, _reply, user) => userToolDetail(user.user.id, id(req.params), req.query)));
  app.get("/api/tools/runs/:id/results/export", toolHandler(async (req, reply, user) => {
    const runId = id(req.params), stream = await exportUserToolResults(user.user.id, runId, req.query);
    const disconnect = () => { if (!reply.raw.writableFinished) stream.destroy(); };
    reply.raw.once("close", disconnect);
    stream.once("close", () => reply.raw.removeListener("close", disconnect));
    return reply.header("Content-Disposition", `attachment; filename="tool-${runId}-results.json"`).type("application/json; charset=utf-8").send(stream);
  }));
  for (const action of ["resume", "stop", "abandon"] as const) app.post(`/api/tools/runs/:id/${action}`, toolHandler(async (req, _reply, user) => controlUserTool(user.user.id, id(req.params), action, req.body)));
  app.register(registerUserToolAssets);
}

async function registerUserToolAssets(app: FastifyInstance) {
  app.removeContentTypeParser("multipart/form-data");
  await app.register(multipart, { limits: { fileSize: VIDEO_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 64, fieldSize: 1024, headerPairs: 20 } });
  const principals = new WeakMap<FastifyRequest, UserPrincipal>();
  app.addHook("onRequest", async (req, reply) => {
    const principal = await requireUser(req, reply);
    if (!principal) return reply;
    principals.set(req, principal);
  });
  app.setErrorHandler((error, req, reply) => accountProblem(toolError(error), req, reply));
  const actor = (req: FastifyRequest) => userActor(principals.get(req)!);
  app.get("/api/tools/assets", async req => listToolAssets(actor(req), req.query));
  app.get("/api/tools/assets/:key", async req => toolAssetDto(await ownedToolAsset(actor(req), (req.params as { key: string }).key)));
  app.get("/api/tools/assets/:key/content", async (req, reply) => {
    const key = (req.params as { key: string }).key;
    await ownedToolAsset(actor(req), key);
    return streamAssetContent(req, reply, key);
  });
  app.delete("/api/tools/assets/:key", async req => {
    const key = (req.params as { key: string }).key;
    await ownedToolAsset(actor(req), key);
    return toolAssetDto(await deleteAsset(key, actor(req)));
  });
  app.post("/api/tools/assets", { bodyLimit: UPLOAD_BYTES }, async (req, reply) => receiveAssetUpload(req, reply, actor(req), toolAssetDto));
}

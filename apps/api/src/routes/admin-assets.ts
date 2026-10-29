import { receiveAssetUpload, streamAssetContent } from "../http/asset-transfer.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { actorOf, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { assetUploadOptions, AssetError, VIDEO_BYTES, UPLOAD_BYTES, listAssets, assetMetadata, deleteAsset } from "@aihot/backend/operations/assets";
import { requireAdmin } from "./admin-auth.ts";
import { sendProblem } from "../http/respond.ts";

export async function registerAdminAssets(app: FastifyInstance) {
  // This child scope replaces feedback's buffered parser without changing feedback.
  app.removeContentTypeParser("multipart/form-data");
  await app.register(multipart, { limits: { fileSize: VIDEO_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 64, fieldSize: 1024, headerPairs: 20 } });
  const principals = new WeakMap<FastifyRequest, AdminPrincipal>();
  app.addHook("onRequest", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return reply;
    principals.set(req, admin);
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode <= 599 ? e.statusCode : 500;
    if (status === 500) req.log.error({ err: error }, "asset request failed");
    return sendProblem(req, reply, { status, code: status === 409 ? "conflict" : "invalid_request", detail: status === 500 ? "Asset request failed." : e.message });
  });
  app.get("/api/admin/assets", async req => {
    const after=(req.query as {after?:unknown}).after;
    if (after !== undefined && typeof after !== "string") throw new AssetError(400,"Invalid asset cursor.");
    return listAssets(after);
  });
  app.get("/api/admin/assets/options", async () => assetUploadOptions());
  app.get("/api/admin/assets/:key", async req => assetMetadata((req.params as {key:string}).key));
  app.delete("/api/admin/assets/:key", async req => deleteAsset((req.params as {key:string}).key,actorOf(principals.get(req)!)));
  app.get("/api/admin/assets/:key/content", async (req,reply) => {
    return streamAssetContent(req, reply, (req.params as {key:string}).key);
  });
  app.post("/api/admin/assets", { bodyLimit: UPLOAD_BYTES }, async (req, reply) => {
    return receiveAssetUpload(req, reply, actorOf(principals.get(req)!));
  });
}

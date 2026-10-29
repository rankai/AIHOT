import type { FastifyRequest, FastifyReply } from "fastify";
import { AssetError, VIDEO_BYTES, uploadLimitForMime, UPLOAD_BYTES, UPLOAD_TIMEOUT_MS, uploadKey, prepareUpload, writeUpload, publishUpload, openAsset, type AssetRow } from "@aihot/backend/operations/assets";

/** Both adapters authenticate before consuming bytes; ownership is supplied by the adapter. */
export async function receiveAssetUpload(req: FastifyRequest, reply: FastifyReply, actor: string, project: (asset: AssetRow) => unknown = asset => asset) {
    const key = uploadKey(actor, req.headers["idempotency-key"]);
    if (!req.isMultipart()) throw new AssetError(415, "Expected multipart/form-data.");
    if (Number(req.headers["content-length"] ?? 0) > UPLOAD_BYTES) throw new AssetError(413, "Multipart upload exceeds 50 MB plus 64 KiB overhead.");
    const temp = await prepareUpload(VIDEO_BYTES);
    const controller = new AbortController();
    let failure: Error | undefined;
    const cancel = (error: Error) => {
      if (failure) return;
      failure = error;
      // Stop consuming without destroying the socket which must carry the error response.
      // Multipart listens to request errors and releases its pending iterator/current file.
      req.raw.unpipe();
      req.raw.pause();
      controller.abort(error);
      reply.header("Connection", "close");
      reply.raw.once("finish", () => req.raw.destroy());
      req.raw.emit("error", error);
    };
    const timer = setTimeout(() => cancel(new AssetError(408, "Upload must finish within 60 seconds.")), UPLOAD_TIMEOUT_MS);
    const disconnected = () => { if (!req.raw.complete) cancel(new AssetError(400, "Upload disconnected.")); };
    let total = 0;
    const count = (chunk: Buffer) => { total += chunk.length; if (total > UPLOAD_BYTES) cancel(new AssetError(413, "Multipart upload exceeds 50 MB plus 64 KiB overhead.")); };
    req.raw.on("aborted", disconnected);
    // No await between attaching this listener and starting parts(): both observe the same stream.
    req.raw.on("data", count);
    try {
      let received: { filename: string; mime: string; bytes: number; sha256: string } | undefined;
      for await (const part of req.parts()) {
        if (part.type !== "file" || part.fieldname !== "file" || received) throw new AssetError(400, "Exactly one file field named file is required.");
        const limit=uploadLimitForMime(part.mimetype);
        const content = await writeUpload(part.file, temp.file, controller.signal,limit);
        if (part.file.truncated) throw new AssetError(413, "Media must be at most 50 MB.");
        received = { ...content, filename: part.filename, mime: part.mimetype };
      }
      if (failure) throw failure;
      if (!received) throw new AssetError(400, "A file is required.");
      clearTimeout(timer);
      return reply.code(201).send(project(await publishUpload({ actor: actor, key, file: temp.file, ...received })));
    } catch (error) { throw failure ?? error; }
    finally { clearTimeout(timer); req.raw.off("data", count); req.raw.off("aborted", disconnected); await temp.release(); }
}

export async function streamAssetContent(req: FastifyRequest, reply: FastifyReply, key: string) {
    const {asset,handle}=await openAsset(key);
    let streaming=false;
    try {
      reply.header("Accept-Ranges","bytes").header("X-Content-Type-Options","nosniff").type(asset.content_type);
      let start=0,end=asset.bytes-1;
      const range=req.headers.range;
      if(range) {
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match || (!match[1] && !match[2])) return reply.code(416).header("Content-Range",`bytes */${asset.bytes}`).send();
        if(!match[1]) { const suffix=Number(match[2]); start=Math.max(0,asset.bytes-suffix); if(!Number.isSafeInteger(suffix)||suffix<=0) start=asset.bytes; }
        else { start=Number(match[1]); if(match[2]) end=Math.min(end,Number(match[2])); }
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=asset.bytes) return reply.code(416).header("Content-Range",`bytes */${asset.bytes}`).send();
        reply.code(206).header("Content-Range",`bytes ${start}-${end}/${asset.bytes}`);
      }
      reply.header("Content-Length",end-start+1);
      const stream=handle.createReadStream({start,end});streaming=true;
      reply.raw.once("close",()=>stream.destroy());
      return reply.send(stream);
    } finally { if(!streaming) await handle.close(); }
}

import OSS from "ali-oss";
import { openAsBlob } from "node:fs";
import { credential } from "../../config.ts";
import { sql } from "../../db.ts";
import { assetPath } from "../../operations/assets.ts";
import { guardedFetch } from "../../lib/http-fetch.ts";
import { paidRequest, type PaidRequestOptions } from "../receipts.ts";
import { assertWanConfig } from "./wan-client.ts";
import { assertWanOutbound, type WanConfig } from "./wan-config.ts";
export interface WanObject { fileKey: string; hash: string; objectKey: string; expiresAt: string }
function client(config: WanConfig) {
  const accessKeyId = credential("integrations", "ALIYUN_WAN_OSS_ACCESS_KEY_ID"), accessKeySecret = credential("integrations", "ALIYUN_WAN_OSS_ACCESS_KEY_SECRET");
  if (!accessKeyId || !accessKeySecret) throw new Error("Missing Wan OSS credentials");
  return new OSS({ region: "oss-cn-beijing", bucket: config.bucket, accessKeyId, accessKeySecret, stsToken: credential("integrations", "ALIYUN_WAN_OSS_SECURITY_TOKEN") ?? undefined, endpoint: config.ossBase, cname: true, authorizationV4: true });
}
export async function wanObjectUrl(config: WanConfig, object: WanObject) {
  // Signing happens only immediately before a new submission, never while replaying a receipt.
  return client(config).signatureUrlV4("GET", 86400, undefined, object.objectKey);
}
export async function uploadWanObject(config: WanConfig, runId: number, role: "portrait" | "reference", fileKey: string, hash: string, options: PaidRequestOptions) {
  const legacyKey = `${config.prefix}${runId}/${role}/${hash}`;
  const [file] = await sql`SELECT sha256,bytes,content_type FROM stored_files WHERE key=${fileKey} AND status='available'`;
  if (!file || file.sha256 !== hash) throw new Error("Wan input changed");
  const extensions: Record<string, string> = role === "reference" ? { "video/mp4": "mp4" } : { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };
  const extension = extensions[String(file.content_type)];
  if (!extension) throw new Error("Unsupported Wan input type");
  // Preserve a format-bearing URL for Wan instead of exposing a bare hash.
  const objectKey = `${legacyKey}.${extension}`;
  const result = await paidRequest({ service: "aliyun.wan.media", model: "oss", purpose: "wan.media", identity: { config, runId, role, fileKey, hash }, requestSummary: { base: config.ossBase, runId, role, fileKey, hash, objectKey } }, async () => {
    assertWanOutbound(); assertWanConfig(config);
    const headers = { "Content-Type": String(file.content_type), "x-oss-object-acl": "private", "x-oss-meta-sha256": hash };
    const url = await client(config).signatureUrlV4("PUT", 300, { headers }, objectKey);
    try {
      const response = await guardedFetch(url, { method: "PUT", body: await openAsBlob(assetPath(fileKey)), headers, route: "direct", maxRedirects: 0, timeoutMs: 90000, maxBytes: 64 * 1024 });
      // Only status is needed. OSS error XML may echo signed URLs or credentials.
      return { response: { status: response.status, objectKey, expiresAt: new Date(Date.now() + 86400_000).toISOString() } };
    } catch { throw new Error("Wan OSS upload outcome unknown; inspect original task"); }
  }, options);
  const data = result.response as { status: number; objectKey: string; expiresAt: string };
  // Keep the logical receipt identity stable: legacy receipts must reuse their
  // original object, never silently upload or submit again after this fix.
  if (data.status < 200 || data.status >= 300 || (data.objectKey !== objectKey && data.objectKey !== legacyKey)) throw new Error(`Wan OSS upload rejected; receipt ${result.receiptId}`);
  return { ...result, object: { fileKey, hash, objectKey: data.objectKey, expiresAt: data.expiresAt } };
}

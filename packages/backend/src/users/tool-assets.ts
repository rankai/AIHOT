import { z } from "zod";
import type { ToolAsset, ToolAssetPage } from "@aihot/contracts/user-tools";
import { sql, type Db } from "../db.ts";
import { assetExpired, assetPath, type AssetRow } from "../operations/assets.ts";
import { AccountError } from "./accounts.ts";

const missing = () => new AccountError(404, "not_found", "素材不存在或不可访问");
export function toolAssetDto(row: AssetRow): ToolAsset {
  return {
    key: row.key, filename: row.metadata.filename || "文件", contentType: row.content_type, bytes: Number(row.bytes),
    ...(row.metadata.width ? { width: row.metadata.width } : {}), ...(row.metadata.height ? { height: row.metadata.height } : {}),
    ...(row.metadata.kind ? { kind: row.metadata.kind } : {}), createdAt: row.created_at?.toISOString() ?? "",
    contentUrl: `/api/tools/assets/${encodeURIComponent(row.key)}/content`, status: assetExpired(row) ? "expired" : row.status,
  };
}
/** Upload ownership and generated-result ownership use the same gate, including direct URLs. */
export async function ownedToolAsset(actor: string, key: string, db: Db = sql): Promise<AssetRow> {
  assetPath(key);
  const [row] = await db<AssetRow[]>`SELECT f.* FROM stored_files f WHERE f.key=${key}
    AND (f.owner_actor=${actor} OR EXISTS (SELECT 1 FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.file_key=f.key AND r.actor=${actor}))`;
  if (!row) throw missing();
  return row;
}
export async function assertUsableToolAsset(actor: string, key: string): Promise<void> {
  const row = await ownedToolAsset(actor, key);
  if (row.status !== "available" || assetExpired(row)) throw new AccountError(409, "conflict", "素材已不可用，请重新选择");
}
export async function listToolAssets(actor: string, raw: unknown): Promise<ToolAssetPage> {
  const { after } = z.object({ after: z.string().optional() }).strict().parse(raw);
  if (after) assetPath(after);
  const rows = await sql<AssetRow[]>`SELECT f.* FROM stored_files f WHERE f.key LIKE 'uploads/redfox/%' AND f.status='available'
    AND (f.owner_actor=${actor} OR EXISTS (SELECT 1 FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.file_key=f.key AND r.actor=${actor}))
    AND (${after ?? null}::text IS NULL OR f.key>${after ?? null}) ORDER BY f.key LIMIT 51`;
  const items = rows.slice(0, 50).map(toolAssetDto);
  if (items.length) {
    const uploads = await sql`SELECT z.id,z.file_key,z.created_at FROM operation_results z JOIN operation_runs r ON r.id=z.run_id
      WHERE r.actor=${actor} AND z.kind='media_upload' AND z.file_key IN ${sql(items.map(item => item.key))} ORDER BY z.id DESC`;
    for (const item of items) item.uploads = uploads.filter(row => row.file_key === item.key).map(row => ({ resultId: Number(row.id), createdAt: row.created_at.toISOString() }));
  }
  return { items, nextCursor: rows.length > 50 ? rows[49].key : null };
}

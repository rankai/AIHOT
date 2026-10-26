// Private, immutable operation files. Filesystem publication precedes DB registration:
// an interrupted registration leaves a complete orphan which the same command can recover.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, link, unlink, statfs, open, readdir, lstat, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import path from "node:path";
import { describeVideoMedia, inputMediaOptions, inspectAsset, declaredMediaLimit, MediaValidationError, INPUT_IMAGE_BYTES, INPUT_AUDIO_BYTES, INPUT_VIDEO_BYTES } from "./asset-media.ts";
import {inspectTextAttachment,attachmentTextTypes,type AttachmentTextFormat} from "./attachment-text.ts";
import { audit } from "../admin/auth.ts";
import { config } from "../config.ts";
import { sql, type Tx } from "../db.ts";

export const OUTPUT_IMAGE_BYTES = 64 * 1024 * 1024;
export const OUTPUT_IMAGE_PIXELS = 64_000_000;
export const IMAGE_BYTES = INPUT_IMAGE_BYTES;
export const AUDIO_BYTES = INPUT_AUDIO_BYTES;
export const VIDEO_BYTES = INPUT_VIDEO_BYTES;
export const UPLOAD_BYTES = VIDEO_BYTES + 64 * 1024;
export const UPLOAD_TIMEOUT_MS = 60_000;
export const IMAGE_PIXELS = 16_000_000;
export function assetUploadOptions(){return inputMediaOptions(IMAGE_PIXELS);}
let uploads = 0;
const activeTemps = new Set<string>();
export class AssetError extends Error {
  statusCode: number;
  code?: string;
  constructor(status: number, message: string) { super(message); this.statusCode = status; if(status===409)this.code="conflict"; }
}
export function uploadLimitForMime(mime:string){
  try{return declaredMediaLimit(mime);}catch(error){if(error instanceof MediaValidationError)throw new AssetError(error.status,error.message);throw error;}
}
export function uploadKey(actor: string, key: unknown): string {
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(key)) throw new AssetError(400, "A valid Idempotency-Key is required (1–200 ASCII characters).");
  return `uploads/redfox/${createHash("sha256").update(JSON.stringify([actor, key])).digest("hex")}`;
}
export function assetPath(key: string): string {
  if (!/^uploads\/redfox\/[a-f0-9]{64}$/.test(key)) throw new AssetError(400, "Invalid asset key.");
  return path.join(config.dataDir, key);
}
export interface AssetRow { key: string; content_type: string; bytes: number; purpose: string; status: string; sha256: string; created_at?: Date; expires_at?: Date | null; metadata: { filename: string; origin?: "subscription-video"; kind?: "image"|"audio"|"video"|"text"; validation?: string; width?: number; height?: number; pages?: number }; }
export async function prepareUpload(maxBytes = IMAGE_BYTES) {
  if (uploads >= 2) throw new AssetError(503, "Two uploads are already in progress. Try again shortly.");
  uploads++;
  try {
    const dir = path.join(config.dataDir, "operation-tmp");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const space = await statfs(dir);
    if (space.bavail * space.bsize < 4 * maxBytes) throw new AssetError(507, "Insufficient local space for a media upload.");
    const file = path.join(dir, randomUUID());
    activeTemps.add(file);
    let released = false;
    return { file, async release() { if (released) return; released = true; uploads--; activeTemps.delete(file); await unlink(file).catch(e => { if (e.code !== "ENOENT") throw e; }); } };
  } catch (error) { uploads--; throw error; }
}
export async function writeUpload(stream: Readable, file: string, signal: AbortSignal, maxBytes = IMAGE_BYTES) {
  let bytes = 0;
  const hash = createHash("sha256");
  await pipeline(stream, new Transform({ transform(chunk: Buffer, _enc, cb) {
    bytes += chunk.length;
    if (bytes > maxBytes) return cb(new AssetError(413, `Media exceeds the local ${maxBytes} byte limit.`));
    hash.update(chunk); cb(null, chunk);
  } }), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
  return { bytes, sha256: hash.digest("hex") };
}
async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function imageFormat(file:string) {
  const handle = await open(file, "r");
  const magic = Buffer.alloc(12);
  try { await handle.read(magic, 0, 12, 0); } finally { await handle.close(); }
  const format = magic.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
    : magic[0] === 255 && magic[1] === 216 && magic[2] === 255 ? "jpeg"
    : magic.toString("ascii", 0, 4) === "RIFF" && magic.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
  if(!format)throw new AssetError(415,"Only PNG, JPEG and WebP image bytes are supported.");
  return format;
}
export async function publishUpload(input: { actor: string; key: string; file: string; filename: string; mime: string; bytes: number; sha256: string; purpose?: "operation-input"|"operation-output"; origin?: "subscription-video" }, tx?:Tx) {
  let inspected: Awaited<ReturnType<typeof inspectAsset>> | Awaited<ReturnType<typeof inspectTextAttachment>>;
  try {
    const ext=path.extname(input.filename).slice(1) as AttachmentTextFormat;
    if(input.purpose==="operation-output"&&Object.hasOwn(attachmentTextTypes,ext)){
      if(input.mime!==attachmentTextTypes[ext])throw new AssetError(422,"Text format and MIME differ");
      inspected=await inspectTextAttachment(input.file,ext);
    }else inspected=await inspectAsset(input.file,input.filename,input.mime,input.purpose==="operation-output",input.purpose==="operation-output"?OUTPUT_IMAGE_PIXELS:IMAGE_PIXELS,OUTPUT_IMAGE_BYTES); }
  catch(error){if(error instanceof MediaValidationError)throw new AssetError(error.status,error.message);if(input.purpose==="operation-output"&&Object.hasOwn(attachmentTextTypes,path.extname(input.filename).slice(1)))throw new AssetError(input.bytes>2*1024*1024?413:422,error instanceof Error?error.message:"Invalid text attachment");throw error;}
  if(inspected.bytes!==input.bytes)throw new AssetError(422,"File size changed before publication.");
  if(input.origin && (input.purpose!=="operation-output" || inspected.metadata.kind!=="video"))throw new AssetError(422,"Subscription video publication requires a validated video output");
  const mime=inspected.mime;
  const metadata = { filename: path.posix.basename(input.filename.replaceAll("\\","/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200), ...inspected.metadata, ...(input.origin ? {origin:input.origin} : {}) };
  const publish=async (tx:Tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.key}, 0))`;
    const [existing] = await tx<AssetRow[]>`SELECT * FROM stored_files WHERE key=${input.key} FOR UPDATE`;
    if (existing) {
      if (existing.status !== "available" || assetExpired(existing) || existing.sha256 !== input.sha256) throw new AssetError(409, "This upload command already refers to different content or a deleted asset.");
    }
    const target = assetPath(input.key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try { await link(input.file, target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await fileHash(target) !== input.sha256) throw new AssetError(409, "This upload command already published different content.");
    }
    if(existing)return existing;
    const [asset] = await tx<AssetRow[]>`INSERT INTO stored_files(key,content_type,bytes,purpose,sha256,metadata,expires_at)
      VALUES (${input.key},${mime},${input.bytes},${input.purpose??'operation-input'},${input.sha256},${tx.json(metadata)},CASE WHEN ${input.origin==='subscription-video'} THEN now()+interval '30 days' ELSE NULL END) RETURNING *`;
    await audit(input.actor,input.purpose==="operation-output"?"asset.save":"asset.upload",input.key,null,null,{bytes:input.bytes,contentType:mime,sha256:input.sha256,...inspected.metadata},undefined,tx);
    return asset!;
  };
  return tx?publish(tx):sql.begin(publish);
}

/** Same row locks as deletion. The caller inserts the run in this transaction. */
export async function lockAssetInputs(tx: Tx, input: unknown): Promise<void> {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length > 16 || input.some(key => typeof key !== "string")) throw new AssetError(400, "fileKeys must contain at most 16 asset keys.");
  for (const key of [...new Set(input as string[])].sort()) {
    assetPath(key);
    const [row] = await tx<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key} FOR UPDATE`;
    if (!row || row.status !== "available" || assetExpired(row)) throw new AssetError(409, "An input asset is missing or unavailable.");
  }
}
export function assetExpired(asset: AssetRow, now = new Date()) { return asset.metadata.origin === "subscription-video" && !!asset.expires_at && new Date(asset.expires_at).getTime() <= now.getTime(); }
export async function getAsset(key: string): Promise<AssetRow> {
  assetPath(key);
  const [asset] = await sql<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key}`;
  if (!asset) throw new AssetError(404, "Asset not found.");
  if(assetExpired(asset))throw new AssetError(410,"Automatically saved video has expired.");
  return asset;
}
/** Metadata stays inspectable after expiry; content and new inputs still use getAsset's gate. */
async function assetSources(rows:AssetRow[]) {
  if(!rows.length)return [];
  const origins=await sql`SELECT DISTINCT ON(z.file_key) z.file_key,r.input->>'articleId' AS "articleId",
    r.input->'videoDownloadOwnership'->>'sourceId' AS "sourceId",r.subscription_id AS "subscriptionId",r.id AS "runId"
    FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.file_key IN ${sql(rows.map(r=>r.key))}
      AND r.operation_key='subscription.video.download' ORDER BY z.file_key,z.id`;
  const byKey=new Map(origins.map(({file_key,...origin})=>[file_key,origin]));
  return rows.map(row=>({...row,expired:assetExpired(row),source:byKey.get(row.key)??null}));
}
export async function assetMetadata(key:string) {
  assetPath(key);const rows=await sql<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key}`;
  if(!rows.length)throw new AssetError(404,"Asset not found.");return (await assetSources(rows))[0]!;
}
export async function listAssets(after?: string) {
  if (after) assetPath(after);
  const rows = await sql<AssetRow[]>`SELECT * FROM stored_files WHERE key LIKE 'uploads/redfox/%'
    AND status='available' AND (${after ?? null}::text IS NULL OR key > ${after ?? null}) ORDER BY key LIMIT 51`;
  return { items: await assetSources(rows.slice(0,50)), nextCursor: rows.length > 50 ? rows[49]!.key : null };
}
// Fixed cross-process lock, shared by dump+tar and every formal unlink. New immutable
// publications and temporary cleanup don't take it. Backup holds the session version.
export const ASSET_BACKUP_LOCK = 741904201;
async function hasActiveInput(tx: Tx, key: string): Promise<boolean> {
  const [row] = await tx`SELECT 1 FROM operation_runs WHERE status IN ('active','waiting','needs_review','stopped')
    AND (input->'fileKeys' @> ${tx.json([key])} OR (step_key IN ('redfox.image.save','redfox.video.save','subscription.video.save') AND progress->>'expectedFileKey'=${key}))
    AND NOT (operation_key='subscription.video.download' AND EXISTS (SELECT 1 FROM stored_files f WHERE f.key=${key} AND f.metadata->>'origin'='subscription-video' AND f.expires_at<=now())) LIMIT 1`;
  return !!row;
}
export async function deleteAsset(key: string, actor = "system:asset-retention"): Promise<AssetRow> {
  assetPath(key);
  await sql.begin(async tx => {
    const [asset] = await tx<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key} FOR UPDATE`;
    if (!asset) throw new AssetError(404, "Asset not found.");
    if (asset.status === "deleted") return;
    if (await hasActiveInput(tx,key)) throw new AssetError(409, "An active or recoverable task still uses this asset.");
    if (asset.status === "available") {
      await tx`UPDATE stored_files SET status='deleting' WHERE key=${key}`;
      await audit(actor,"asset.delete_requested",key,null,null,{status:"deleting"},undefined,tx);
    }
  });
  return finishAssetDeletion(key,actor);
}
async function finishAssetDeletion(key: string, actor = "system:asset-retention"): Promise<AssetRow> {
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(${ASSET_BACKUP_LOCK})`;
    const [asset] = await tx<AssetRow[]>`SELECT * FROM stored_files WHERE key=${key} FOR UPDATE`;
    if (!asset) throw new AssetError(404,"Asset not found.");
    if (asset.status !== "deleting") return asset;
    if (await hasActiveInput(tx,key)) throw new AssetError(409,"An active or recoverable task still uses this asset.");
    await unlink(assetPath(key)).catch(error => { if (error.code !== "ENOENT") throw error; });
    const [deleted] = await tx<AssetRow[]>`UPDATE stored_files SET status='deleted' WHERE key=${key} RETURNING *`;
    await audit(actor,"asset.delete",key,null,null,{status:"deleted"},undefined,tx);
    return deleted!;
  });
}
/** Open before returning a stream so a concurrent unlink cannot break an accepted download. */
export async function openAsset(key: string) {
  const asset = await getAsset(key);
  if (asset.status !== "available") throw new AssetError(404,"Asset is unavailable.");
  try { return { asset, handle: await open(assetPath(key), "r") }; }
  catch(error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AssetError(404,"Asset file is missing."); throw error; }
}

// Enumerate names like existing retention, but bound expensive stat/DB/unlink work
// to 200 entries. Persist the name cursor so daily runs still advance across restarts.
async function scanFiles(dir: string, cursorKey: string, valid: RegExp, failures: string[], visit: (file: string, name: string) => Promise<void>) {
  const entries=await readdir(dir,{withFileTypes:true}).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
  const names=entries.filter(e=>e.isFile() && valid.test(e.name)).map(e=>e.name).sort();
  const [cursor]=await sql`SELECT value FROM settings WHERE key=${cursorKey}`;
  const last=typeof cursor?.value === "string" ? cursor.value : "";
  const batch=names.filter(name=>name>last).slice(0,200);
  for(const name of batch) {
    try { await visit(path.join(dir,name),name); }
    catch { failures.push(name); }
  }
  const next=batch.length===200 ? batch[batch.length-1]! : "";
  await sql`INSERT INTO settings(key,value,updated_by) VALUES (${cursorKey},${sql.json(next)},'asset-retention') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
}
let cleaning: Promise<{temporary:number;orphans:number;deleted:number;failures:string[]}> | undefined;
export function cleanupAssets(now = new Date()) {
  // Concurrent retention calls in this process share one cleanup batch.
  cleaning ??= runAssetCleanup(now).finally(()=>{cleaning=undefined;});
  return cleaning;
}
/** Bounded housekeeping, never scans outside this module's two private directories. */
async function runAssetCleanup(now: Date) {
  let temporary=0, orphans=0, deleted=0;
  const failures: string[]=[];
  await scanFiles(path.join(config.dataDir,"operation-tmp"), "assets.temp-cursor", /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, failures, async file => {
    if (activeTemps.has(file)) return;
    const info=await lstat(file).catch(()=>null);
    if (info && now.getTime()-info.mtimeMs > 3600_000) {
      await unlink(file).catch(error=>{if(error.code!=="ENOENT")throw error;}); temporary++;
    }
  });
  await scanFiles(path.join(config.dataDir,"uploads/redfox"), "assets.orphan-cursor", /^[a-f0-9]{64}$/, failures, async (file,name) => {
    if (!/^[a-f0-9]{64}$/.test(name)) return;
    const info=await lstat(file).catch(()=>null);
    if (!info || now.getTime()-info.mtimeMs <= 86400_000) return;
    const key=`uploads/redfox/${name}`;
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(${ASSET_BACKUP_LOCK})`;
      // Publication and orphan recovery serialize on this same key, including absent rows.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
      const [registered]=await tx`SELECT 1 FROM stored_files WHERE key=${key}`;
      if (registered || await hasActiveInput(tx,key)) return;
      const current=await lstat(file).catch(()=>null);
      if (!current?.isFile() || now.getTime()-current.mtimeMs <= 86400_000) return;
      await unlink(file).catch(error=>{if(error.code!=="ENOENT")throw error;}); orphans++;
    });
  });
  const cursorKey="assets.deletion-cursor";
  const [cursor]=await sql`SELECT value FROM settings WHERE key=${cursorKey}`;
  const last=typeof cursor?.value === "string" ? cursor.value : "";
  const eligible=sql`key LIKE 'uploads/redfox/%'
    AND (status='deleting' OR (status='available' AND metadata->>'origin'='subscription-video' AND expires_at<=${now}))`;
  const [boundary]=await sql<{key:string|null}[]>`SELECT max(key) AS key FROM stored_files WHERE ${eligible}`;
  const upper=boundary?.key??"";
  // Finish one finite sweep, resuming at the persisted cursor then wrapping once.
  // Fixed expiry time and upper key keep new expirations for the next pass; failures
  // advance just like successes, so no key is retried within this invocation.
  const ranges:Array<[string,string]>=last<upper?[[last,upper],["",last]]:[["",upper]];
  for(const [lower,limit] of ranges){
    let after=lower;
    while(after<limit){
      const pending=await sql<{key:string;status:string}[]>`SELECT key,status FROM stored_files WHERE ${eligible}
        AND key>${after} AND key<=${limit} ORDER BY key LIMIT 50`;
      if(!pending.length)break;
      for(const {key,status} of pending){
        try{
          if(status==='available'){
            // Close expired automatic saves before normal deletion; unrelated manual input protection stays intact.
            await sql`UPDATE operation_runs SET status='stopped',generation=generation+1,wait_reason='Automatically saved video expired',next_attempt_at=NULL,job_id=NULL WHERE operation_key='subscription.video.download' AND progress->>'expectedFileKey'=${key} AND status IN ('active','waiting','needs_review')`;
            await deleteAsset(key);
          }else await finishAssetDeletion(key);
          deleted++;
        }catch{failures.push(key);}
      }
      after=pending[pending.length-1]!.key;
      await sql`INSERT INTO settings(key,value,updated_by) VALUES (${cursorKey},${sql.json(after)},'asset-retention') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
      if(pending.length<50)break;
    }
  }
  await sql`INSERT INTO settings(key,value,updated_by) VALUES (${cursorKey},${sql.json("")},'asset-retention') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
  return {temporary,orphans,deleted,failures};
}


export function imageOutputKey(runId:number,index:number){
  return `uploads/redfox/${createHash("sha256").update(JSON.stringify(["redfox.image.output",runId,index])).digest("hex")}`;
}
export async function describeGeneratedFile(file:string){
  const info=await stat(file);
  if(!info.isFile()||info.size>OUTPUT_IMAGE_BYTES)throw new AssetError(413,"Generated image exceeds the local 64 MiB limit.");
  const format=await imageFormat(file);
  return {file,filename:`generated.${format}`,mime:`image/${format}`,bytes:info.size,sha256:await fileHash(file),purpose:"operation-output" as const};
}
export async function hasCompleteLocalFile(key:string){
  try {return (await stat(assetPath(key))).isFile();}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
}

export function videoOutputKey(runId:number,index:number){
 return `uploads/redfox/${createHash("sha256").update(JSON.stringify(["redfox.video.output",runId,index])).digest("hex")}`;
}
export async function describeGeneratedVideoFile(file:string){
 let detected;try{detected=await describeVideoMedia(file);}catch(error){if(error instanceof MediaValidationError)throw new AssetError(error.status,error.message);throw error;}
 return {file,filename:`generated.${detected.format}`,mime:detected.mime,bytes:detected.bytes,sha256:await fileHash(file),purpose:"operation-output" as const};
}

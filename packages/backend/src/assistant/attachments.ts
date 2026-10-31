import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { sql, type Db } from "../db.ts";
import { assetExpired, assetPath } from "../operations/assets.ts";
import { ATTACHMENT_TEXT_BYTES, inputTextFormat, parseAttachmentText } from "../operations/attachment-text.ts";
import { AccountError } from "../users/accounts.ts";
import { ownedToolAsset } from "../users/tool-assets.ts";

export const ASSISTANT_ATTACHMENT_CHARACTERS = 30_000;
const unavailable = () => new AccountError(409, "conflict", "材料文件已不可用，请重新添加");

/** Caller holds the asset row lock when persisting a new reference or accepting a turn. */
export async function readAssistantAttachment(actor: string, key: string, db: Db = sql) {
  const row = await ownedToolAsset(actor, key, db);
  if (row.status !== "available" || assetExpired(row)) throw unavailable();
  const format = inputTextFormat(row.metadata.filename, row.content_type);
  if (row.metadata.kind !== "text" || !format) throw new AccountError(422, "invalid_request", "仅支持 UTF-8 TXT 或 MD 文本材料");
  if (Number(row.bytes) > ATTACHMENT_TEXT_BYTES) throw new AccountError(413, "invalid_request", "文本材料不能超过 2 MiB");
  let bytes: Buffer;
  try {
    const handle = await open(assetPath(key), "r");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== Number(row.bytes) || info.size > ATTACHMENT_TEXT_BYTES) throw unavailable();
      // Bound the read even if an out-of-band filesystem change grows the immutable file.
      const buffer = Buffer.alloc(ATTACHMENT_TEXT_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw unavailable();
  }
  if (bytes.length !== Number(row.bytes) || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw unavailable();
  let text: string;
  try { text = parseAttachmentText(bytes, format).text; }
  catch { throw new AccountError(422, "invalid_request", "材料必须是非空 UTF-8 文本"); }
  if (text.length > ASSISTANT_ATTACHMENT_CHARACTERS) throw new AccountError(413, "invalid_request", "材料超过 30000 字符，请缩小范围后重新添加；文件仍保留在私有素材中");
  return { text, source: { kind: "asset" as const, assetKey: row.key, filename: row.metadata.filename, contentType: row.content_type, sha256: row.sha256 } };
}

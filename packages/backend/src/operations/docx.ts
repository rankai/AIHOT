import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Worker } from "node:worker_threads";
export const DOCX_BYTES = 5 * 1024 * 1024;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOCX_VERSION = "docx-text-v1";
export type DocxExtraction = { version: string; sourceSha256: string; text: string; textSha256: string; characters: number; warnings: string[] }
export class DocxError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; }
}
export function isDocx(filename: string, mime: string) {
  return filename.toLowerCase().endsWith(".docx") && [DOCX_MIME, "application/octet-stream", "application/zip", "application/x-zip-compressed"].includes(mime.toLowerCase());
}
export const docxMessages = {
  invalid: "无法读取这份 Word 文件，请取消密码保护，或在 Word/WPS 中另存为 DOCX 后重试。",
  revisions: "请先在 Word/WPS 中接受或拒绝修订，再重新上传。",
  empty: "没有读到可用文字。图片中的文字暂不支持识别，可以粘贴正文。",
  long: "这份材料超过 30,000 字符，请保留本次需要的部分再上传。",
  timeout: "这份文件暂时没读好，可以重试；其他材料已保留。",
  large: "这份 Word 文件超过 5 MiB，请删除不需要的图片或拆分后上传。",
};
export async function inspectDocx(file: string, sourceSha256: string) {
  const info = await stat(file);
  if (info.size > DOCX_BYTES) throw new DocxError(413, docxMessages.large);
  const bytes = await readFile(file);
  if (bytes.length > DOCX_BYTES || createHash("sha256").update(bytes).digest("hex") !== sourceSha256) throw new DocxError(422, docxMessages.invalid);
  const extracted = await new Promise<{ text: string; warnings: string[] }>((resolve, reject) => {
    const worker = new Worker(new URL("./docx-worker.ts", import.meta.url), { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
    let settled = false;
    const finish = (error?: Error, result?: {text:string;warnings:string[]}) => {
      if (settled) return; settled = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new DocxError(503, docxMessages.timeout)), 5000);
    worker.once("message", result => result.error ? finish(new DocxError(result.error === "long" ? 413 : 422, docxMessages[result.error as keyof typeof docxMessages] ?? docxMessages.invalid)) : finish(undefined, result));
    worker.once("error", () => finish(new DocxError(422, docxMessages.invalid)));
    worker.once("exit", () => finish(new DocxError(422, docxMessages.invalid)));
  });
  const extraction: DocxExtraction = { version: DOCX_VERSION, sourceSha256, ...extracted, textSha256: createHash("sha256").update(extracted.text).digest("hex"), characters: extracted.text.length };
  return { bytes: bytes.length, mime: DOCX_MIME, metadata: { kind: "document" as const, format: "docx", extraction } };
}

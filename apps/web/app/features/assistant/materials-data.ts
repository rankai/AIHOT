import type { AssistantOptions } from "@aihot/contracts/assistant";

export interface DraftAttachment {
  id: string;
  name: string;
  file?: File;
  state: "queued" | "uploading" | "processing" | "ready" | "error";
  assetKey?: string;
  contentUrl?: string;
  text?: string;
  inputId?: string;
  error?: string;
  retryable?: boolean;
  format?: string;
  warnings?: string[];
}
export function attachmentBatchIssue(existing: number, added: number, max: number): string | null {
  return existing + added > max ? `最多添加${max}个附件，还可添加${Math.max(0, max - existing)}个。本批文件尚未加入。` : null;
}
export function attachmentIssue(file: Pick<File, "name" | "size">, capabilities: AssistantOptions["inputCapabilities"]): string | null {
  if (!capabilities.fileTypes.some((extension) => file.name.toLowerCase().endsWith(extension))) return "暂不支持这种文件，请另存为 DOCX，或上传 TXT / MD。";
  if (!file.size) return "不能使用空文件。";
  const extension = capabilities.fileTypes.find(type => file.name.toLowerCase().endsWith(type));
  const limit = (extension && capabilities.maxFileBytesByType?.[extension]) || capabilities.maxFileBytes;
  if (file.size > limit) return extension === ".docx" ? `这份 Word 文件超过 ${limit / 1024 / 1024} MiB，请删除不需要的图片或拆分后上传。` : `文件不能超过 ${limit / 1024 / 1024} MiB。`;
  return null;
}
export function attachmentsReady(attachments: readonly DraftAttachment[] = []): boolean {
  return attachments.every((attachment) => attachment.state === "ready");
}
/** A removed card cannot be resurrected by an upload that finishes later. */
export function patchAttachment(attachments: readonly DraftAttachment[] = [], id: string, patch: Partial<DraftAttachment>): DraftAttachment[] {
  return attachments.map((attachment) => attachment.id === id ? { ...attachment, ...patch } : attachment);
}
export function attachmentInputIds(attachments: readonly DraftAttachment[] = [], selected: readonly string[] = []): string[] {
  return [...new Set([...selected, ...attachments.flatMap((attachment) => attachment.inputId ? [attachment.inputId] : [])])];
}
export function attachmentSelectionCount(attachments: readonly DraftAttachment[] = [], selected: readonly string[] = []): number {
  const represented = new Set(attachments.flatMap((card) => card.inputId ? [card.inputId] : []));
  return attachments.length + new Set(selected.filter((id) => !represented.has(id))).size;
}

/** Only confirmed HTTP rejections may supply user-facing details; transport failures are retryable. */
export function attachmentFailure(status?: number | null, detail?: string | null): { error: string; retryable: boolean } {
  const retryable = !status || status >= 500 || status === 408 || status === 429;
  return { retryable, error: retryable ? "这份文件暂时没读好，可以重试；其他材料已保留。" : detail || "无法读取这份材料，请移除并重新选择文件。" };
}

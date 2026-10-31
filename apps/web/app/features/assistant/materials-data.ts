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
}
export function attachmentBatchIssue(existing: number, added: number, max: number): string | null {
  return existing + added > max ? `最多添加${max}个附件，还可添加${Math.max(0, max - existing)}个。本批文件尚未加入。` : null;
}
export function attachmentIssue(file: Pick<File, "name" | "size">, capabilities: AssistantOptions["inputCapabilities"]): string | null {
  if (!capabilities.fileTypes.some((extension) => file.name.toLowerCase().endsWith(extension))) return "仅支持 UTF-8 TXT / MD 文件。";
  if (!file.size) return "不能使用空文件。";
  if (file.size > capabilities.maxFileBytes) return `文件不能超过 ${capabilities.maxFileBytes / 1024 / 1024} MiB。`;
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

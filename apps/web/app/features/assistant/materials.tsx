import { useRef, useState } from "react";
import type { AssistantOptions } from "@aihot/contracts/assistant";
import type { ToolAsset } from "@aihot/contracts/user-tools";
import { useToolCommand } from "../tools/client";
import { readDraft, type AssistantDraft } from "./drafts";
import { attachmentBatchIssue, attachmentFailure, attachmentIssue, attachmentSelectionCount, patchAttachment, type DraftAttachment } from "./materials-data";

type Update = (next: (previous: AssistantDraft) => AssistantDraft) => void;
export function useAssistantMaterials({ csrf, scopeKey, capabilities, update, invalidate }: {
  csrf: string; scopeKey: string; capabilities: AssistantOptions["inputCapabilities"]; update: Update; invalidate: () => void;
}) {
  const command = useToolCommand(csrf, `assistant:assets:${scopeKey}`);
  const [error, setError] = useState<string | null>(null);
  const processing = useRef(false);
  const patch = (id: string, value: Partial<DraftAttachment>) => update((draft) => ({ ...draft, attachments: patchAttachment(draft.attachments, id, value) }));
  async function drain() {
    if (processing.current) return;
    processing.current = true;
    try {
      let next: DraftAttachment | undefined;
      while ((next = readDraft(scopeKey).attachments?.find((item) => item.state === "queued"))) {
        const card = next;
        let failure = attachmentFailure();
        try {
          let assetKey = card.assetKey;
          let contentUrl = card.contentUrl;
          if (!assetKey) {
            if (!card.file) { failure = { error: "文件未保留，请移除后重新选择。", retryable: false }; throw new Error(); }
            patch(card.id, { state: "uploading", error: undefined });
            const body = new FormData(); body.set("file", card.file);
            const asset = await command.run<ToolAsset>("/api/tools/assets", body);
            if (!asset) {
              failure = attachmentFailure(command.failure.current?.status, command.failure.current?.message);
              throw new Error();
            }
            assetKey = asset.key; contentUrl = asset.contentUrl;
          }
          patch(card.id, { state: "processing", assetKey, contentUrl });
          const response = await fetch(`/api/assistant/attachments/${encodeURIComponent(assetKey)}/text`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
          const result = await response.json();
          if (!response.ok) {
            failure = attachmentFailure(response.status, typeof result.detail === "string" ? result.detail : undefined);
            throw new Error();
          }
          patch(card.id, { state: "ready", text: result.text, format: result.format, warnings: result.warnings, assetKey, contentUrl, error: undefined });
        } catch {
          patch(card.id, { state: "error", ...failure });
        }
      }
    } finally { processing.current = false; }
  }
  function add(files: File[]) {
    const current = readDraft(scopeKey);
    const issue = attachmentBatchIssue(attachmentSelectionCount(current.attachments, current.inputIds), files.length, capabilities.maxAttachments);
    if (issue) { setError(issue); return; }
    setError(null); invalidate();
    const cards: DraftAttachment[] = files.map((file) => { const error = attachmentIssue(file, capabilities); return { id: crypto.randomUUID(), name: file.name, file, state: error ? "error" : "queued", ...(error ? { error, retryable: false } : {}) }; });
    update((draft) => ({ ...draft, attachments: [...(draft.attachments ?? []), ...cards] }));
    void drain();
  }
  function retry(card: DraftAttachment) {
    const issue = card.file ? attachmentIssue(card.file, capabilities) : null;
    if (issue) { patch(card.id, { error: issue }); return; }
    invalidate(); patch(card.id, { state: "queued", error: undefined }); void drain();
  }
  return { add, retry, error, remove(id: string) { invalidate(); update((draft) => ({ ...draft, attachments: draft.attachments?.filter((item) => item.id !== id) })); } };
}
export function AssistantAttachmentCards({ attachments, max, disabled, retry, remove, error, count = attachments.length }: {
  attachments: readonly DraftAttachment[]; max: number; disabled: boolean; retry: (card: DraftAttachment) => void; remove: (id: string) => void; error: string | null;
  count?: number;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  return <>
    {count > 0 && <div className="assistant-attachments" aria-label="待发送文件附件">
      <p className="text-[11px] text-ink-4" role="status">已添加{count}/{max}</p>
      <div className="assistant-attachment-list">{attachments.map((card) => <article key={card.id} className="assistant-attachment-card">
        <button type="button" className="assistant-attachment-open" disabled={!card.text && card.state !== "error"} aria-label={`${card.state === "error" ? "查看失败附件" : "预览附件"} ${card.name}`} onClick={() => setPreview(card.id)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="assistant-attachment-icon"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></svg>
          <span className="min-w-0"><span title={card.name} className="block truncate text-[12px] font-medium text-ink">{card.name}</span><span className={`block text-[10px] ${card.state === "error" ? "text-hot" : "text-ink-3"}`} role="status">{card.state === "uploading" && card.name.toLowerCase().endsWith(".docx") ? "上传并读取中" : { queued: "等待上传", uploading: "上传中", processing: "读取文字中", ready: "可用", error: "失败 · 详情" }[card.state]}</span></span>
        </button>
        <button type="button" className="assistant-attachment-remove" disabled={disabled} aria-label={`移除附件 ${card.name}`} title="取消本次引用，私有文件仍保留" onClick={() => remove(card.id)}>×</button>
        {card.state === "error" && card.retryable !== false && <button type="button" className="assistant-material-action" disabled={disabled} aria-label={`重试附件 ${card.name}`} onClick={() => retry(card)}>重试</button>}

      </article>)}</div>
      {attachments.some((card) => card.id === preview) && <AttachmentPreview card={attachments.find((card) => card.id === preview)!} close={() => setPreview(null)} />}

    </div>}
    {error && <p role="alert" className="mb-2 text-[12px] text-hot">{error}</p>}
  </>;
}

function AttachmentPreview({ card, close }: { card: DraftAttachment; close: () => void }) {
  return <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} className="assistant-dialog" aria-label={`${card.state === "error" ? "附件详情" : "附件预览"} ${card.name}`} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 break-words text-[15px] font-medium">{card.name}</h2><button type="button" className="assistant-material-action shrink-0" aria-label="关闭附件预览" onClick={close}>关闭</button></div>
    {card.error && <p role="alert" className="mt-3 break-words [overflow-wrap:anywhere] text-[13px] text-hot">{card.error}</p>}
    {card.retryable === false && <p className="mt-2 text-[12px] text-ink-3">请移除并重新选择文件。</p>}
    {card.text && <p className="mt-3 text-[12px] text-ink-3">助手将使用以下文字 · {card.text.length.toLocaleString()} 字符</p>}
    {card.format === "docx" && <p className="mt-2 text-[12px] text-ink-3">仅读取正文文字，不还原版式；页眉、页脚与批注不在读取范围内。</p>}
    {card.warnings?.includes("embedded_content_omitted") && <p className="mt-2 text-[12px] text-ink-3">已读取文字，图片或其他嵌入内容未读取。</p>}
    {card.text && <pre className="assistant-text-preview mt-3">{card.text}</pre>}
  </dialog>;
}

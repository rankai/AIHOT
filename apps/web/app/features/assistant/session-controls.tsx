import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { AssistantSession } from "@aihot/contracts/assistant";
import { useToolCommand } from "../tools/client";
import { sessionApi } from "./data";
import { Button, Input } from "../admin/ui";
import { useEditorGuard } from "./unsaved";
export function SessionControls({
  active,
  pending,
  archived,
  lifecycle,
  session, csrf, refresh,
}: {
  session: AssistantSession;
  csrf: string;
  refresh: () => Promise<AssistantSession | null>;
  active: boolean;
  pending: boolean;
  archived: boolean;
  lifecycle: (action: "archive" | "delete") => Promise<void>;
}) {
  const guard = useEditorGuard();
  const metadata = useSessionMetadata(session, csrf, refresh);
  const [rename, setRename] = useState<{ originalTitle: string; title: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [canRefreshTitle, setCanRefreshTitle] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const menuSummary = useRef<HTMLElement>(null);
  const renameModal = useRef<HTMLDialogElement>(null);
  const renameWasOpen = useRef(false);
  useEffect(() => {
    if (rename) {
      renameModal.current?.showModal();
      renameWasOpen.current = true;
    } else if (renameWasOpen.current) {
      renameModal.current?.close();
      menuSummary.current?.focus();
      renameWasOpen.current = false;
    }
  }, [!!rename]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmDelete) modal.current?.showModal();
    else modal.current?.close();
  }, [confirmDelete]);
  return (
    <>
      <details ref={menu} className="assistant-session-menu">
        <summary ref={menuSummary} aria-label="会话菜单">···</summary>
        <div>
          <p className="assistant-session-title" aria-label="完整会话标题">{session.title}</p>
          <Button size="sm" disabled={pending || metadata.pending} onClick={() => { if (menu.current) menu.current.open = false; setRename({ originalTitle: session.title, title: session.title }); setRenameError(null); setCanRefreshTitle(false); }}>重命名</Button>
          {!archived && (
            <Button
              size="sm"
              disabled={active || pending}
              onClick={() => guard.request(() => void lifecycle("archive"))}
            >
              归档会话
            </Button>
          )}
          <Button
            size="sm"
            tone="danger"
            disabled={pending}
            onClick={() => guard.request(() => setConfirmDelete(true))}
          >
            删除会话
          </Button>
          <Link to="/account" className="px-3 py-2 text-[12px] text-accent">
            积分明细
          </Link>
        </div>
      </details>
      <dialog ref={renameModal} className="assistant-dialog" aria-labelledby="assistant-rename-title" onCancel={event => { event.preventDefault(); if (!metadata.pending) setRename(null); }}>
        <form onSubmit={async event => {
          event.preventDefault();
          if (!rename || metadata.pending) return;
          const title = rename.title.trim();
          if (!title) { setRenameError("请输入会话标题。"); setCanRefreshTitle(false); return; }
          const error = await metadata.run("rename", { ...rename, title }, current => current.title === title);
          if (error) { setRenameError(error); setCanRefreshTitle(true); } else setRename(null);
        }}>
          <h2 id="assistant-rename-title" className="mb-3 text-[18px] font-semibold">重命名会话</h2>
          <Input autoFocus aria-label="会话标题" maxLength={160} value={rename?.title ?? ""} disabled={metadata.pending} onChange={event => setRename(previous => previous && ({ ...previous, title: event.target.value }))} />
          {renameError && <p role="alert" className="mt-2 text-[13px] text-hot">{renameError}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {canRefreshTitle && <Button disabled={metadata.pending} onClick={async () => { const current = await refresh(); if (current) { setRename(previous => previous && ({ ...previous, originalTitle: current.title })); setRenameError("已读取最新标题，可保留当前输入重新保存。"); } }}>读取最新标题</Button>}
            <Button disabled={metadata.pending} onClick={() => setRename(null)}>取消</Button>
            <Button type="submit" disabled={metadata.pending} busy={metadata.pending}>保存</Button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={modal}
        className="assistant-dialog"
        aria-labelledby="assistant-delete-title"
        onCancel={(event) => {
          event.preventDefault();
          setConfirmDelete(false);
        }}
      >
        <h2 id="assistant-delete-title" className="text-[18px] font-semibold">
          删除此会话？
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          删除将停止当前处理，使此会话不可访问并移除其可见材料与稿件。已转交副本独立保留；不会自动退款，也不承诺删除全部后台记录。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button
            tone="danger"
            disabled={pending}
            onClick={() => {
              setConfirmDelete(false);
              void lifecycle("delete");
            }}
          >
            确认删除此会话
          </Button>
        </div>
      </dialog>
    </>
  );
}

function useSessionMetadata(session: AssistantSession, csrf: string, refresh: () => Promise<AssistantSession | null>) {
  const command = useToolCommand(csrf, `assistant:session:${session.sessionId}:metadata`);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  async function run(action: "rename" | "restore", body: unknown, reached: (current: AssistantSession) => boolean) {
    if (busy.current) return "操作正在进行，请稍候。";
    busy.current = true; setPending(true);
    try {
      const result = await command.run(`${sessionApi(session.sessionId)}/${action}`, body);
      // A lost response is not failure or success: only the persisted snapshot proves the target.
      const current = await refresh();
      if (current && reached(current)) {
        window.dispatchEvent(new Event("assistant-history-changed"));
        return null;
      }
      return result ? "状态尚未确认，请读取最新状态后重试。" : command.failure.current?.status != null ? command.failure.current.message : "连接中断，未能确认操作结果。你的输入已保留，请先读取最新状态。";
    } finally { busy.current = false; setPending(false); }
  }
  return { pending, run };
}

export function ArchivedSessionNotice({ session, csrf, refresh, onRestored }: { session: AssistantSession; csrf: string; refresh: () => Promise<AssistantSession | null>; onRestored: () => void }) {
  const metadata = useSessionMetadata(session, csrf, refresh);
  const [error, setError] = useState<string | null>(null);
  if (!session.archived) return null;
  return <div className="assistant-inline-notice">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px]">会话已归档，消息和作品仍可查看。</p>
      <Button size="sm" disabled={metadata.pending || !session.archivedAt} busy={metadata.pending} onClick={async () => {
        const error = await metadata.run("restore", { archivedAt: session.archivedAt }, current => !current.archived);
        setError(error);
        if (!error) onRestored();
      }}>恢复会话</Button>
    </div>
    {error && <p role="alert" className="mt-2 text-[12px] text-hot">{error} <button type="button" className="underline" onClick={() => void refresh()}>读取最新状态</button></p>}
  </div>;
}

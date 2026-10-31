import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "../admin/ui";
import { useEditorGuard } from "./unsaved";
export function SessionControls({
  active,
  pending,
  archived,
  lifecycle,
}: {
  active: boolean;
  pending: boolean;
  archived: boolean;
  lifecycle: (action: "archive" | "delete") => Promise<void>;
}) {
  const guard = useEditorGuard();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmDelete) modal.current?.showModal();
    else modal.current?.close();
  }, [confirmDelete]);
  return (
    <>
      <details className="assistant-session-menu">
        <summary aria-label="会话菜单">···</summary>
        <div>
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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router";
import { Button } from "../admin/ui";
interface EditorGuard {
  dirty: boolean;
  canSave: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}
const GuardContext = createContext<{
  register: (id: string, guard: EditorGuard | null) => void;
  request: (action: () => void, keepSaved?: boolean) => void;
}>({ register: () => {}, request: (action) => action() });
export const useEditorGuard = () => useContext(GuardContext);
export function AssistantUnsavedGuard({
  children,
  hasDraft,
}: {
  children: ReactNode;
  hasDraft: boolean;
}) {
  const guards = useRef(new Map<string, EditorGuard>());
  const [dirty, setDirty] = useState(false);
  const [request, setRequest] = useState<{
    action: () => void;
    keepSaved: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (dirty || hasDraft) && currentLocation.pathname !== nextLocation.pathname,
  );
  const register = useCallback((id: string, guard: EditorGuard | null) => {
    if (guard) guards.current.set(id, guard);
    else guards.current.delete(id);
    setDirty([...guards.current.values()].some((value) => value.dirty));
  }, []);
  const ask = useCallback((action: () => void, keepSaved = false) => {
    if ([...guards.current.values()].some((value) => value.dirty))
      setRequest({ action, keepSaved });
    else action();
  }, []);
  const open = request !== null || blocker.state === "blocked";
  useEffect(() => {
    if (open) modal.current?.showModal();
    else modal.current?.close();
  }, [open]);
  useEffect(() => {
    if (!dirty && !hasDraft) return;
    const before = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, hasDraft]);
  function cancel() {
    setRequest(null);
    setError(null);
    if (blocker.state === "blocked") blocker.reset();
  }
  function proceed() {
    const action = request?.action;
    setRequest(null);
    setError(null);
    if (blocker.state === "blocked") blocker.proceed();
    else action?.();
  }
  const unsaved = [...guards.current.values()].filter((guard) => guard.dirty);
  return (
    <GuardContext.Provider value={{ register, request: ask }}>
      {children}
      <dialog
        ref={modal}
        aria-labelledby="assistant-unsaved-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!saving) cancel();
        }}
        className="assistant-dialog"
      >
        <h2 id="assistant-unsaved-title" className="text-[18px] font-semibold">
          {dirty ? "稿件还有未保存修改" : "离开当前对话？"}
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          {dirty
            ? "保存后继续，或明确放弃这些修改。取消会留在当前页面。"
            : "未发送草稿只在本次页面会话内保留。整页刷新、重新登录或新标签页不保证恢复；离开不会停止后台任务。"}
        </p>
        {request?.keepSaved && (
          <p className="mt-2 text-[13px] text-ink-3">
            放弃修改会继续使用已保存版本；保存后继续会使用刚保存的新版本。
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-hot">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={saving} onClick={cancel}>
            取消
          </Button>
          {dirty && (
            <Button
              disabled={saving}
              onClick={() => {
                for (const guard of unsaved) guard.discard();
                proceed();
              }}
            >
              {request?.keepSaved ? "放弃修改并使用已保存版" : "放弃修改并继续"}
            </Button>
          )}
          {dirty ? (
            <Button
              tone="primary"
              busy={saving}
              disabled={!unsaved.every((guard) => guard.canSave)}
              onClick={async () => {
                setSaving(true);
                for (const guard of unsaved)
                  if (!(await guard.save())) {
                    setError("保存未完成，修改仍保留，请返回检查。");
                    setSaving(false);
                    return;
                  }
                setSaving(false);
                proceed();
              }}
            >
              保存后继续
            </Button>
          ) : (
            <Button tone="primary" onClick={proceed}>
              保留本次草稿并离开
            </Button>
          )}
        </div>
        {dirty && !unsaved.every((guard) => guard.canSave) && (
          <p className="mt-3 text-[12px] text-ink-4">
            处理进行中或结果待核对时不能保存，可取消或放弃修改。
          </p>
        )}
      </dialog>
    </GuardContext.Provider>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { IconArrowUp } from "../../components/icons";
import { Textarea } from "../admin/ui";
export function AssistantComposer({
  text,
  onChange,
  onSend,
  disabled,
  busy,
  answerMode = false,
  maxLength,
  children,
  hint,
  placeholder,
  controls,
  attachments,
  confirmation,
}: {
  text: string;
  onChange: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
  busy: boolean;
  answerMode?: boolean;
  maxLength: number;
  children?: ReactNode;
  hint?: string;
  placeholder?: string;
  controls?: ReactNode;
  attachments?: ReactNode;
  confirmation?: ReactNode;
}) {
  const composing = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirmation) form.current?.querySelector("textarea")?.focus();
    wasConfirming.current = !!confirmation;
  }, [!!confirmation]);
  return (
    <div className="assistant-composer">
      {confirmation ? <div className="assistant-composer-confirmation">{confirmation}</div> : <>
      {children && <div className="assistant-composer-context">{children}</div>}
      <form ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !busy && text.trim()) onSend();
        }}
      >
        {!answerMode && attachments && <div className="assistant-composer-attachments">{attachments}</div>}
        <label className="sr-only" htmlFor="assistant-composer-input">
          {answerMode ? "回答这个问题" : "材料与创作需求"}
        </label>
        <Textarea
          id="assistant-composer-input"
          rows={3}
          value={text}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            placeholder ??
            (answerMode
              ? "回答这个问题，继续这次创作…"
              : "描述需求、粘贴材料，或继续修改稿件…")
          }
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !composing.current &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (!disabled && !busy && text.trim()) onSend();
            }
          }}
        />
        <div className="assistant-composer-bottom">
          {!answerMode && controls}
          {answerMode && <span className="text-[12px] text-ink-3">补充回答</span>}
          <button
            type="submit"
            className="assistant-send"
            disabled={disabled || busy || !text.trim()}
            aria-label={answerMode ? "提交回答并继续" : "发送需求"}
          >
            <span>{busy ? "处理中" : answerMode ? "回答" : "发送"}</span>
            <IconArrowUp size={17} />
          </button>
        </div>
        <div className="mt-2">
          <p className="text-[11px] leading-relaxed text-ink-4">
            {hint ??
              (answerMode
                ? "补充回答沿用这次请求，不会另取创作报价。"
                : "发送后先确认积分 · Shift+Enter 换行")}
            <span className="ml-2">
              {text.length}/{maxLength}
            </span>
          </p>
        </div>
      </form>
      </>}
    </div>
  );
}

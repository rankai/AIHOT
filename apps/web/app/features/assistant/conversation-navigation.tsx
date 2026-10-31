import { useEffect, useId, useRef, useState } from "react";
import type { AssistantMessage } from "@aihot/contracts/assistant";
import { IconChevronDown, IconList } from "../../components/icons";

export const messageAnchorId = (id: string) => `assistant-message-${id}`;
const previewText = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 100) || "空白消息";

/** One set of persisted user-message targets serves the desktop rail and touch directory. */
export function ConversationNavigation({ messages, activeId, jump }: {
  messages: AssistantMessage[];
  activeId: string | null;
  jump: (messageId: string) => void;
}) {
  const id = useId();
  const nav = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const element = list.current;
    const current = element?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!element?.clientHeight || !current) return;
    const top = current.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + current.offsetHeight > element.scrollTop + element.clientHeight)
      element.scrollTop = top + current.offsetHeight - element.clientHeight;
  }, [activeId, expanded]);
  useEffect(() => {
    if (!expanded) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [expanded]);
  if (!messages.length) return null;
  return (
    <nav ref={nav} className="assistant-conversation-nav" aria-label="对话目录" data-expanded={expanded} onKeyDown={(event) => {
      if (event.key === "Escape" && expanded) {
        event.preventDefault();
        setExpanded(false);
        toggle.current?.focus();
      }
    }}>
      <button ref={toggle} type="button" className="assistant-conversation-nav-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((previous) => !previous)}>
        <IconList size={14} /><span>对话目录</span><span className="text-ink-4">{messages.length}</span><IconChevronDown size={13} />
      </button>
      <ul ref={list} id={id} className="assistant-conversation-nav-list" onKeyDown={(event) => {
        const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) :
          event.key === "ArrowUp" ? Math.max(index - 1, 0) :
          event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
        if (target !== null) {
          event.preventDefault();
          buttons[target]?.focus();
        }
      }}>
        {messages.map((message, index) => {
          const text = previewText(message.text);
          return <li key={message.id}>
            <button type="button" aria-label={`跳到第 ${index + 1} 条需求：${text}`} aria-controls={messageAnchorId(message.id)} aria-current={activeId === message.id ? "location" : undefined}
              onMouseEnter={() => setPreview(text)} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview(text)} onBlur={() => setPreview(null)}
              onClick={() => { jump(message.id); setExpanded(false); setPreview(null); }}>
              <span className="assistant-conversation-tick" aria-hidden="true" />
              <span className="assistant-conversation-nav-text">{index + 1}. {text}</span>
            </button>
          </li>;
        })}
      </ul>
      {preview && <div className="assistant-conversation-preview" aria-hidden="true">{preview}</div>}
    </nav>
  );
}

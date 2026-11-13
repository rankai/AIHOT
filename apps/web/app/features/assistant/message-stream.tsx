import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type {
  AssistantMessage,
  AssistantProfileDto,
  AssistantSession,
  AssistantConfirmationMode,
} from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
import { ResultText } from "../tools/result-text";
import { PHASE_LABELS, materialText } from "./data";
import { CurrentTask } from "./current-task";
import { ConversationNavigation, messageAnchorId } from "./conversation-navigation";
import { artifactDeliveries, indexArtifactDeliveries } from "./artifact-display";
import { AssistantDelivery } from "./delivery";
import { IconCheck, IconCopy } from "../../components/icons";
import { confirmationModeHint } from "./fee-mode";
const scrollPositions = new Map<string, number>();
function messageTopInset(element: HTMLElement): number {
  const toggle = element.parentElement?.querySelector<HTMLElement>(".assistant-conversation-nav-toggle");
  return toggle?.getClientRects().length
    ? Math.max(24, toggle.getBoundingClientRect().bottom - element.getBoundingClientRect().top + 16)
    : 24;
}
export function MessageCopy({ text, role }: { text: string; role: "user" | "assistant" }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  return <div className="assistant-message-actions">
    <button type="button" className="assistant-message-copy" title={result === "copied" ? "已复制" : role === "user" ? "复制需求" : "复制回复"} aria-label={role === "user" ? "复制需求" : "复制回复"} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setResult("copied"); }
      catch { setResult("failed"); }
    }}>
      {result === "copied" ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
    {result === "failed" && <span role="alert" className="text-[12px] text-hot">复制失败，请选择文字后复制。</span>}
    {result === "copied" && <span role="status" className="sr-only">文字已复制</span>}
  </div>;
}
export function AssistantMessageStream({
  session,
  messages,
  profile,
  scopeKey,
  csrf,
  pending,
  reading,
  readError,
  refresh,
  control,
  showArtifacts,
  setView,
  view,
  actions,
  showWelcome,
  actionsStamp = "",
  canQueue = false,
  confirmationMode = "automatic",
}: {
  actions?: ReactNode;
  showWelcome: boolean;
  actionsStamp?: string;
  session: AssistantSession;
  messages: AssistantMessage[];
  profile?: AssistantProfileDto;
  scopeKey: string;
  csrf: string;
  pending: boolean;
  reading: boolean;
  readError: string | null;
  refresh: () => Promise<unknown>;
  control: (action: "stop" | "resume") => Promise<void>;
  showArtifacts: (target?: { artifactId: string; version: number }) => void;
  setView: (view: "chat" | "artifacts") => void;
  view: "chat" | "artifacts";
  canQueue?: boolean;
  confirmationMode?: AssistantConfirmationMode;
}) {
  const persisted = useMemo(
    () => new Set(messages.map((message) => message.id)),
    [messages],
  );
  const savedMessages = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const deliveries = artifactDeliveries(session);
  const { afterMessage: deliveriesAfter, unanchored } = indexArtifactDeliveries(messages, deliveries);
  const imageFiles = new Map(session.artifacts.filter((artifact) => artifact.kind === "image" && !!artifact.content.fileKey).map((artifact) => [`${artifact.artifactId}:${artifact.version}`, artifact.content.fileKey!]));
  const userMessages = useMemo(() => messages.filter((message) => message.role === "user"), [messages]);
  const [activeMessage, setActiveMessage] = useState<string | null>(userMessages[0]?.id ?? null);
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const syncNavigation = useCallback(() => {
    const element = scroll.current;
    if (!element || !element.clientHeight) return;
    const bounds = element.getBoundingClientRect();
    const inset = messageTopInset(element);
    const targets = Array.from(element.querySelectorAll<HTMLElement>('[data-message-role="user"]')).map((node) => ({ node, bounds: node.getBoundingClientRect() }));
    const visible = targets.filter((target) => target.bounds.bottom >= bounds.top && target.bounds.top <= bounds.bottom);
    const nearest = (visible.length ? visible : targets).reduce<(typeof targets)[number] | null>((chosen, target) =>
      !chosen || Math.abs(target.bounds.top - bounds.top - inset) < Math.abs(chosen.bounds.top - bounds.top - inset) ? target : chosen, null);
    setActiveMessage(nearest?.node.dataset.messageId ?? null);
  }, []);
  const pinned = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  useEffect(() => {
    setNewMessages(false);
    const element = scroll.current;
    if (element) {
      const saved = scrollPositions.get(scopeKey);
      element.scrollTop = saved ?? element.scrollHeight;
      pinned.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    }
  }, [scopeKey]);
  const activityStamp = session.turn?.activities?.map((item) => `${item.id}:${item.state}`).join(":") ?? "";
  const messageStamp =
    messages.map((message) => `${message.id}:${message.eventSeq ?? ""}`).join(":") +
    `:${deliveries.map((delivery) => `${delivery.artifactId}:${delivery.version}:${delivery.eventSeq ?? ""}`).join(":")}:${actionsStamp}:${activityStamp}:${session.turn?.phase}:${session.turn?.question?.questionId}:${session.turn?.calls.map((call) => call.state).join(":")}`;
  const previousStamp = useRef({ scopeKey, messageStamp });
  useEffect(() => {
    const changed = previousStamp.current.scopeKey === scopeKey &&
      previousStamp.current.messageStamp !== messageStamp;
    previousStamp.current = { scopeKey, messageStamp };
    const element = scroll.current;
    if (!element) return;
    if (pinned.current && element.clientHeight > 0) {
      element.scrollTop = element.scrollHeight;
      scrollPositions.set(scopeKey, element.scrollTop);
    } else if (changed) setNewMessages(true);
  }, [messageStamp, scopeKey]);

  useEffect(() => {
    if (view === "chat" && pinned.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [view]);

  useEffect(() => {
    const frame = requestAnimationFrame(syncNavigation);
    const observer = new ResizeObserver(syncNavigation);
    if (scroll.current) observer.observe(scroll.current);
    if (column.current) observer.observe(column.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [messageStamp, view, syncNavigation]);

  function jumpToMessage(id: string) {
    const element = scroll.current;
    const target = Array.from(element?.querySelectorAll<HTMLElement>('[data-message-role="user"]') ?? []).find((node) => node.dataset.messageId === id);
    if (!element || !target) return;
    pinned.current = false;
    setActiveMessage(id);
    element.scrollTo({
      top: element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top - messageTopInset(element),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    target.focus({ preventScroll: true });
  }

  return (
    <>
      <div className="assistant-message-area">
        <ConversationNavigation messages={userMessages} activeId={activeMessage} jump={jumpToMessage} />
        <div
        ref={scroll}
        className="assistant-message-scroll"
        onScroll={() => {
          const element = scroll.current;
          if (!element) return;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
          scrollPositions.set(scopeKey, element.scrollTop);
          if (pinned.current) setNewMessages(false);
          syncNavigation();
        }}
      >
        <div ref={column} className="assistant-message-column">
          {readError && (
            <div role="alert" className="assistant-inline-notice text-hot">
              暂时无法获取最新状态，请重新连接。你的输入已保留。上次已知状态：
              {session.turn ? PHASE_LABELS[session.turn.phase] : "尚未开始"}
              。
              <Button
                size="sm"
                disabled={reading}
                onClick={() => void refresh()}
              >
                重新连接
              </Button>
            </div>
          )}
          {!messages.length && showWelcome && (
            <div className="assistant-conversation-welcome">
              <h2 className="text-[24px] font-semibold text-ink">
                开始这次创作
              </h2>
              <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
                {profile?.welcome ?? "此会话的助手当前不可用，请稍后重试。"}
              </p>
              <p className="mt-3 text-[12px] text-ink-4">
                {confirmationModeHint(confirmationMode)}。
              </p>
            </div>
          )}
          {!!session.inputs.length && (
            <details className="assistant-materials">
              <summary>已带入材料 · {session.inputs.length} 份</summary>
              {session.brief && (
                <p className="my-3 whitespace-pre-wrap break-words">
                  创作说明：{session.brief}
                </p>
              )}
              {session.inputs.map((input) => (
                <details key={input.id} className="mt-3">
                  <summary>
                    {typeof input.source.filename === "string" ? input.source.filename : "查看转交材料"}
                    {typeof input.source.version === "number"
                      ? ` · 版本 ${input.source.version}`
                      : ""}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {materialText(input.text)}
                  </p>
                </details>
              ))}
              <p className="mt-3 text-[11px] text-ink-4">
                这些材料保存在当前会话。下一次引用由输入区明确选择；移除引用不会擦除已有历史内容。
              </p>
            </details>
          )}
          <section aria-label="已保存的对话" className="min-w-0 space-y-6">
            <ThreadPrimitive.Messages>
              {({ message }) =>
                persisted.has(message.id) ? (
                  <div key={message.id}>
                  <MessagePrimitive.Root
                    id={messageAnchorId(message.id)}
                    tabIndex={-1}
                    data-message-id={message.id}
                    data-message-role={savedMessages.get(message.id)?.role}
                    className={`assistant-message ${message.role === "user" ? "assistant-message-user" : "assistant-message-response"}`}
                  >
                    <p className="mb-2 text-[11px] font-medium text-ink-4">
                      {message.role === "user"
                        ? "你"
                        : savedMessages.get(message.id)?.role === "tool"
                          ? "检索结果"
                          : session.assistantName}
                    </p>
                    {savedMessages.get(message.id)?.role === "assistant" ? (
                      <MessagePrimitive.Parts components={{ Text: ResultText }} />
                    ) : <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.9] text-ink-2 [overflow-wrap:anywhere]">
                      <MessagePrimitive.Parts />
                    </div>}
                    {savedMessages.get(message.id)?.role !== "tool" && <MessageCopy text={savedMessages.get(message.id)!.text} role={message.role === "user" ? "user" : "assistant"} />}
                  </MessagePrimitive.Root>
                  {deliveriesAfter.has(message.id) && <AssistantDelivery sessionId={session.sessionId} deliveries={deliveriesAfter.get(message.id)!} hasReply={savedMessages.get(message.id)?.role === "assistant"} imageFiles={imageFiles} showArtifacts={showArtifacts} />}
                  </div>
                ) : null
              }
            </ThreadPrimitive.Messages>
          </section>
          {!!unanchored.length && <AssistantDelivery sessionId={session.sessionId} deliveries={unanchored} imageFiles={imageFiles} showArtifacts={showArtifacts} />}
          <CurrentTask
            session={session}
            csrf={csrf}
            pending={pending}
            reading={reading}
            readError={readError}
            refresh={refresh}
            control={control}
            showArtifacts={showArtifacts}
            setView={setView}
            canQueue={canQueue}
          />
          {actions}
        </div>
        </div>
      </div>
      {newMessages && (
        <button
          className="assistant-new-message"
          onClick={() => {
            const element = scroll.current;
            if (element) element.scrollTop = element.scrollHeight;
            syncNavigation();
            pinned.current = true;
            setNewMessages(false);
          }}
        >
          有新进展 ↓
        </button>
      )}
    </>
  );
}

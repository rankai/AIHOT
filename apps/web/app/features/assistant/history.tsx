import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { AssistantId } from "@aihot/contracts/assistant";
import { IconChevronDown, IconRefresh } from "../../components/icons";
import { Input, Select } from "../admin/ui";
import { toolGet } from "../tools/client";
import { sessionHref, type SessionPage } from "./data";

export function AssistantHistory({ initialPage }: { initialPage: SessionPage }) {
  const [page, setPage] = useState(initialPage);
  const [filter, setFilter] = useState<AssistantId | "">("");
  const [archived, setArchived] = useState("false");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { pathname } = useLocation();
  const cancel = () => {
    active.current?.abort();
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => () => cancel(), []);
  async function read(cursor?: string) {
    cancel();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    const query = new URLSearchParams({ archived, title: title.trim() });
    if (filter) query.set("assistantId", filter);
    if (cursor) query.set("cursor", cursor);
    try {
      const next = await toolGet<SessionPage>(`/api/assistant/sessions?${query}`, controller.signal);
      if (controller.signal.aborted) return;
      setPage(previous => cursor ? {
        ...next,
        sessions: [...previous.sessions, ...next.sessions.filter(row => !previous.sessions.some(old => old.sessionId === row.sessionId))],
      } : next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
    } finally {
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }
  useEffect(() => {
    cancel();
    setPage({ sessions: [], nextCursor: null });
    setPending(true);
    timer.current = setTimeout(() => void read(), 250);
    return cancel;
  }, [filter, archived, title]);
  useEffect(() => {
    // SSR updates must never overwrite an active search or restore stale filters.
    if (!filter && archived === "false" && !title) { cancel(); setPage(initialPage); setPending(false); }
  }, [initialPage]);
  useEffect(() => {
    const changed = () => void read();
    window.addEventListener("assistant-history-changed", changed);
    return () => window.removeEventListener("assistant-history-changed", changed);
  }, [filter, archived, title]);
  return (
    <section className="assistant-history" aria-label="会话历史">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-medium text-ink-3">会话历史</h2>
        <button type="button" className="assistant-icon-button" title="刷新会话历史" aria-label="刷新会话历史" disabled={pending} onClick={() => void read()}><IconRefresh size={16} /></button>
      </div>
      <form className="mb-2 flex min-w-0 items-center gap-1" onSubmit={event => { event.preventDefault(); void read(); }}>
        <Input aria-label="搜索会话标题" placeholder="搜索会话标题" maxLength={160} value={title} onChange={event => { cancel(); setTitle(event.target.value); }} />
        {title && <button type="button" className="shrink-0 text-[12px] text-accent" onClick={() => { cancel(); setTitle(""); }}>清空</button>}
      </form>
      <div className="space-y-2">
        <Select aria-label="会话助手筛选" value={filter} onChange={event => { cancel(); setFilter(event.target.value as AssistantId | ""); }}>
          <option value="">全部助手</option><option value="creative">创作助手</option><option value="xiaohongshu">小红书助手</option>
        </Select>
        <Select aria-label="会话归档筛选" value={archived} onChange={event => { cancel(); setArchived(event.target.value); }}>
          <option value="false">未归档</option><option value="true">已归档</option>
        </Select>
      </div>
      <p className="my-2 text-[11px] text-ink-4">按创建时间排列 · 仅搜索标题</p>
      <div className="assistant-history-list">
        {error && <p role="alert" className="py-2 text-[12px] text-hot">{error}</p>}
        {pending && <p role="status" className="py-2 text-[12px] text-ink-3">正在读取会话…</p>}
        {!page.sessions.length && !pending && <p className="py-4 text-[12px] leading-relaxed text-ink-4">{!title && !filter && archived === "false" ? "还没有会话。从新对话开始创作。" : "没有找到相关会话。可清空搜索或切换归档范围。"}</p>}
        <ul className="space-y-1">
          {page.sessions.map(row => <li key={row.sessionId}>
            <Link to={sessionHref(row.sessionId)} aria-current={pathname === sessionHref(row.sessionId) ? "page" : undefined} className={`block min-w-0 rounded-control px-2.5 py-2.5 text-[13px] hover:bg-bg-sunk ${pathname === sessionHref(row.sessionId) ? "bg-accent-soft text-accent" : "text-ink-2"}`}>
              <span className="block truncate" title={row.title}>{row.title}</span>
              <span className="mt-1 block truncate text-[11px] text-ink-4">{row.assistantName} · {row.createdAt.slice(0,10)}</span>
            </Link>
          </li>)}
        </ul>
        {page.nextCursor && <button type="button" className="assistant-icon-button mx-auto" title="加载更早会话" aria-label="加载更早会话" disabled={pending} onClick={() => void read(page.nextCursor!)}><IconChevronDown size={17} /></button>}
      </div>
    </section>
  );
}

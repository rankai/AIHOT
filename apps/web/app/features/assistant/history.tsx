import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { AssistantId } from "@aihot/contracts/assistant";
import { IconChevronDown, IconRefresh } from "../../components/icons";
import { Select } from "../admin/ui";
import { toolGet } from "../tools/client";
import { sessionHref, type SessionPage } from "./data";

export function AssistantHistory({
  initialPage,
}: {
  initialPage: SessionPage;
}) {
  const [page, setPage] = useState(initialPage);
  const [filter, setFilter] = useState<AssistantId | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialPage.sessions.length === 50);
  const active = useRef<AbortController | null>(null);
  const { pathname } = useLocation();
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!filter) {
      setPage(initialPage);
      setHasMore(initialPage.sessions.length === 50);
    }
  }, [initialPage]);
  async function read(nextFilter: AssistantId | "", before?: string) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    const query = new URLSearchParams();
    if (nextFilter) query.set("assistantId", nextFilter);
    if (before) query.set("before", before);
    try {
      const next = await toolGet<SessionPage>(
        `/api/assistant/sessions?${query}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPage((previous) =>
        before
          ? {
              sessions: [
                ...previous.sessions,
                ...next.sessions.filter(
                  (row) =>
                    !previous.sessions.some(
                      (old) => old.sessionId === row.sessionId,
                    ),
                ),
              ],
            }
          : next,
      );
      setHasMore(next.sessions.length === 50);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  useEffect(() => {
    const changed = () => void read(filter);
    window.addEventListener("assistant-history-changed", changed);
    return () =>
      window.removeEventListener("assistant-history-changed", changed);
  }, [filter]);
  return (
    <section className="assistant-history" aria-label="会话历史">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-medium text-ink-3">会话历史</h2>
        <button type="button" className="assistant-icon-button" title="刷新会话历史" aria-label="刷新会话历史"
          disabled={pending} onClick={() => void read(filter)}>
          <IconRefresh size={16} />
        </button>
      </div>
      <Select
        aria-label="会话助手筛选"
        value={filter}
        onChange={(event) => {
          const value = event.target.value as AssistantId | "";
          setFilter(value);
          void read(value);
        }}
      >
        <option value="">全部助手</option>
        <option value="creative">创作助手</option>
        <option value="xiaohongshu">小红书助手</option>
      </Select>
      <p className="my-2 text-[11px] text-ink-4">按创建时间排列</p>
      <div className="assistant-history-list">
        {error && (
          <p role="alert" className="py-2 text-[12px] text-hot">
            {error}
          </p>
        )}
        {pending && (
          <p role="status" className="py-2 text-[12px] text-ink-3">
            正在读取会话…
          </p>
        )}
        {!page.sessions.length && !pending && (
          <p className="py-4 text-[12px] leading-relaxed text-ink-4">
            还没有会话。从新对话开始创作。
          </p>
        )}
        <ul className="space-y-1">
          {page.sessions.map((row) => (
            <li key={row.sessionId}>
              <Link
                to={sessionHref(row.sessionId)}
                aria-current={
                  pathname === sessionHref(row.sessionId) ? "page" : undefined
                }
                className={`block min-w-0 rounded-control px-2.5 py-2.5 text-[13px] hover:bg-bg-sunk ${pathname === sessionHref(row.sessionId) ? "bg-accent-soft text-accent" : "text-ink-2"}`}
              >
                <span className="block truncate" title={row.title}>
                  {row.title}
                </span>
                <span className="mt-1 block truncate text-[11px] text-ink-4">
                  {row.assistantName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {hasMore && (
          <button
            type="button"
            className="assistant-icon-button mx-auto"
            title="加载更早会话"
            aria-label="加载更早会话"
            disabled={pending}
            onClick={() => void read(filter, page.sessions.at(-1)?.createdAt)}
          >
            <IconChevronDown size={17} />
          </button>
        )}
      </div>
    </section>
  );
}

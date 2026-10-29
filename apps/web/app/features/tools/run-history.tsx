import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigation } from "react-router";
import type { ToolRunPage } from "@aihot/contracts/user-tools";
import { Badge, Button, Card, Input, Select, Time } from "../admin/ui";
import { toolGet } from "./client";
import { ToolField } from "./fields";
import { activeRun, TOOL_STATUS } from "./types";
import { parseRunFilters, runDetailHref, runFiltersQuery, RUN_CATEGORIES, RUN_STATUSES, type RunFilters } from "./run-history-data";

export function RunHistory({ initialPage, filters, visible, onFiltersChange }: {
  initialPage: ToolRunPage;
  filters: RunFilters;
  visible: boolean;
  onFiltersChange: (filters: RunFilters) => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [draft, setDraft] = useState(filters);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<"refresh" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const navigation = useNavigation();
  const navigating = navigation.state !== "idle" && navigation.location?.pathname === "/tools";
  const query = runFiltersQuery(filters).toString();
  const filtered = !!(filters.q || filters.category || filters.status);

  useEffect(() => {
    active.current?.abort(); active.current = null;
    setPage(initialPage); setExpanded(false); setPending(null); setError(null);
    return () => { active.current?.abort(); active.current = null; };
  }, [initialPage]);

  const read = useCallback(async (after: number | null = null) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(after ? "more" : "refresh"); setError(null);
    const search = new URLSearchParams(query);
    if (after) search.set("after", String(after));
    try {
      const next = await toolGet<ToolRunPage>(`/api/tools/runs?${search}`, controller.signal);
      if (controller.signal.aborted || active.current !== controller) return;
      setPage(previous => after ? { ...next, rows: [...previous.rows, ...next.rows.filter(row => !previous.rows.some(old => old.id === row.id))] } : next);
      setExpanded(!!after);
    } catch (cause) {
      if (!controller.signal.aborted && active.current === controller) setError(cause instanceof Error ? cause.message : "读取失败，请重试。");
    } finally {
      if (active.current === controller) { active.current = null; setPending(null); }
    }
  }, [query]);

  const hasActiveRuns = page.rows.some(row => activeRun(row.status));
  useEffect(() => {
    if (!visible || expanded || !hasActiveRuns || navigating) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 5000);
    return () => clearInterval(timer);
  }, [visible, expanded, hasActiveRuns, navigating, read]);

  function apply(next: RunFilters) {
    const normalized = parseRunFilters(runFiltersQuery(next));
    setDraft(normalized);
    if (runFiltersQuery(normalized).toString() === query) void read();
    else { active.current?.abort(); active.current = null; onFiltersChange(normalized); }
  }

  return <Card title="我的执行记录" right={<Button size="sm" disabled={!!pending || navigating} busy={pending === "refresh"} onClick={() => void read()}>刷新</Button>}>
    <form className="mb-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_180px_150px_auto]" onSubmit={event => { event.preventDefault(); apply(draft); }}>
      <ToolField label="搜索任务"><Input name="q" value={draft.q} maxLength={120} placeholder="工具名称、查询对象或问题关键词" disabled={navigating} onChange={event => setDraft({ ...draft, q: event.target.value })} /></ToolField>
      <ToolField label="工具类型"><Select name="category" value={draft.category} disabled={navigating} onChange={event => setDraft({ ...draft, category: event.target.value as RunFilters["category"] })}><option value="">全部类型</option>{RUN_CATEGORIES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></ToolField>
      <ToolField label="任务状态"><Select name="status" value={draft.status} disabled={navigating} onChange={event => setDraft({ ...draft, status: event.target.value as RunFilters["status"] })}><option value="">全部状态</option>{RUN_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></ToolField>
      <div className="flex gap-2"><Button tone="primary" type="submit" busy={navigating} disabled={!!pending}>筛选</Button><Button disabled={!!pending || navigating || !(draft.q || draft.category || draft.status || filtered)} onClick={() => apply({ q: "", category: "", status: "" })}>清空</Button></div>
    </form>
    {error && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-control bg-hot-soft p-3 text-[13px] text-hot"><span>{error}</span><Button size="sm" disabled={!!pending || navigating} onClick={() => void read()}>重试</Button></div>}
    <div className="mb-2 flex flex-wrap justify-between gap-2 text-[12px] text-ink-3" aria-live="polite"><span>{navigating ? "正在读取匹配的任务…" : pending === "more" ? "正在加载更早记录…" : `已显示 ${page.rows.length} 条记录`}</span>{hasActiveRuns && !expanded && <span>执行中的任务每 5 秒更新状态</span>}{expanded && <span>已加载更早记录；点击刷新查看最新状态</span>}</div>
    {navigating ? <div role="status" className="py-8 text-center text-[14px] text-ink-3">正在读取匹配的任务…</div> : !page.rows.length ? <div className="py-8 text-center text-[14px] text-ink-3">{filtered ? "没有符合条件的任务，试试其他关键词或清空筛选。" : "还没有执行记录。提交工具任务后，进度与结果会保存在这里。"}</div> : <ul className="divide-y divide-line" aria-label="任务记录">
      {page.rows.map(row => <li key={row.id}><Link to={runDetailHref(row.id, filters)} className="flex min-w-0 items-start justify-between gap-3 rounded-control py-4 transition-colors hover:bg-bg-sunk/50 sm:gap-5">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h3 className="break-words text-[14px] font-medium text-ink">{row.title}</h3><span className="text-[12px] text-ink-4">#{row.id}</span></div><p className="mt-1.5 line-clamp-2 break-words text-[13px] leading-relaxed text-ink-2">{row.summary || "打开查看任务详情"}</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3"><span>{RUN_CATEGORIES.find(option => option.value === row.category)?.label ?? "数据工具"}</span><Time at={row.createdAt} /></div></div>
        <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5"><Badge tone={row.status === "completed" ? "ok" : row.status === "failed" || row.status === "needs_review" ? "warn" : "muted"}>{TOOL_STATUS[row.status] ?? row.status}</Badge><span className="text-[12px] text-accent">{activeRun(row.status) ? "查看进度 →" : "查看结果 →"}</span></div>
      </Link></li>)}
    </ul>}
    {page.nextCursor && !navigating && <div className="mt-4 flex justify-center"><Button disabled={!!pending} busy={pending === "more"} onClick={() => void read(page.nextCursor)}>加载更早的记录</Button></div>}
  </Card>;
}

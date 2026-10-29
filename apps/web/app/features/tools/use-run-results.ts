import { useEffect, useRef, useState } from "react";
import type { ToolResult, ToolRunDetail } from "@aihot/contracts/user-tools";
import { toolGet } from "./client";

/** The live first page and the user's additional pages have independent cursors. */
export function useRunResults(run: ToolRunDetail, section: "results" | "process") {
  const initial = section === "process" ? run.process : run.results;
  const firstCursor = section === "process" ? run.nextProcessCursor : run.nextResultCursor;
  const total = section === "process" ? run.processCount : run.resultCount;
  const [extra, setExtra] = useState<{ items: ToolResult[]; cursor: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const ids = new Set(initial.map(item => item.id));
  const items = [...initial, ...(extra?.items ?? []).filter(item => !ids.has(item.id))];
  // A task can finish after the last loaded page. Let a new page pick up the appended results.
  const cursor = extra ? extra.cursor ?? (total > items.length ? items.at(-1)?.id ?? firstCursor : null) : firstCursor;
  async function loadMore() {
    if (request.current || cursor === null) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    try {
      const next = await toolGet<ToolRunDetail>(`/api/tools/runs/${run.id}?${new URLSearchParams({ section, after: String(cursor) })}`, controller.signal);
      if (controller.signal.aborted) return;
      const rows = section === "process" ? next.process : next.results;
      setExtra(previous => {
        const seen = new Set(previous?.items.map(item => item.id) ?? []);
        return { items: [...(previous?.items ?? []), ...rows.filter(item => !seen.has(item.id))], cursor: section === "process" ? next.nextProcessCursor : next.nextResultCursor };
      });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error && cause.name !== "TypeError" && cause.name !== "TimeoutError" ? cause.message : "暂时无法加载，请重试。");
    } finally {
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  function reset() { request.current?.abort(); request.current = null; setExtra(null); setError(null); setLoading(false); }
  return { items, cursor, loading, error, loadMore, reset };
}

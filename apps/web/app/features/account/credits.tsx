import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { CreditEntry, CreditPage } from "@aihot/contracts/credits";
import { Button } from "../../components/ui/Controls";
import { AccountNotice } from "./fields";

const ENTRY_LABELS: Record<CreditEntry["kind"], string> = {
  grant: "管理员发放", adjustment: "积分调整", reserve: "任务占用", consume: "任务结算", release: "占用退回",
};
const number = (value: number) => value.toLocaleString("zh-CN");

/** Both account and admin views read the same immutable credit-page contract. */
export function useCreditPage(path: string, admin = false) {
  const [page, setPage] = useState<CreditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const read = useCallback(async (before: number | null = null, append = false) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    setLoading(true); setError(null);
    if (!append) setPage(null);
    try {
      const query = new URLSearchParams({ limit: "20", ...(before ? { before: String(before) } : {}) });
      const response = await fetch(`${path}?${query}`, { credentials: "same-origin", cache: "no-store", signal });
      const result = await response.json().catch(() => null);
      if (signal.aborted) return;
      if (response.status === 401) {
        window.location.assign(`${admin ? "/admin/login" : "/login"}?${new URLSearchParams({ return: window.location.pathname + window.location.search })}`);
        return;
      }
      if (!response.ok) throw new Error(result?.detail ?? "暂时无法读取积分，请稍后重试。");
      if (!result?.balance || !Array.isArray(result.entries)) throw new Error("积分响应暂时不可用，请重试。");
      const next = result as CreditPage;
      setPage(previous => append && previous ? { ...next, entries: [...previous.entries, ...next.entries.filter(entry => !previous.entries.some(old => old.id === entry.id))] } : next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "积分读取超时，请重试。");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [path, admin]);
  useEffect(() => { void read(); return () => active.current?.abort(); }, [read]);
  return { page, loading, error, refresh: () => read(), loadMore: () => page?.nextCursor ? read(page.nextCursor, true) : Promise.resolve() };
}

export function CreditBalanceSummary({ page }: { page: CreditPage }) {
  return <div className="grid grid-cols-2 gap-4">
    <div><p className="text-[12.5px] text-ink-3">可用积分</p><p className="num mt-1 text-[28px] font-semibold text-ink">{number(page.balance.available)}</p></div>
    <div><p className="text-[12.5px] text-ink-3">任务占用</p><p className="num mt-1 text-[28px] font-semibold text-ink-2">{number(page.balance.reserved)}</p></div>
  </div>;
}

export function CreditLedger({ entries, admin = false }: { entries: CreditEntry[]; admin?: boolean }) {
  if (!entries.length) return <p className="py-5 text-[13px] text-ink-4">暂无积分记录。</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-[12.5px]">
    <thead><tr className="border-b border-line text-ink-3">{["时间", "事项", "积分", "结余（可用 / 占用）", "说明"].map(label => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
    <tbody>{entries.map(entry => <tr key={entry.id} className="border-b border-line/60 last:border-0">
      <td className="num whitespace-nowrap px-2 py-3 text-ink-3"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></td>
      <td className="px-2 py-3 text-ink-2">{ENTRY_LABELS[entry.kind]}</td>
      <td className="num whitespace-nowrap px-2 py-3 font-medium text-ink">{number(entry.amount)}</td>
      <td className="num whitespace-nowrap px-2 py-3 text-ink-3">{number(entry.availableAfter)} / {number(entry.reservedAfter)}</td>
      <td className="max-w-[280px] px-2 py-3 text-ink-3"><p className="break-words">{entry.reason}</p>{entry.runId !== null && <Link to={`${admin ? "/admin/operations" : "/tools/runs"}/${entry.runId}`} className="mt-1 inline-block text-accent hover:underline">任务 #{entry.runId}</Link>}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function AccountCredits({ csrf }: { csrf: string }) {
  return <AccountCreditPanel key={csrf} />;
}

function AccountCreditPanel() {
  const { page, loading, error, refresh, loadMore } = useCreditPage("/api/account/credits");
  return <section className="card mb-5 p-5 sm:p-6">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-[16px] font-semibold text-ink">我的积分</h2><Button size="sm" disabled={loading} onClick={() => void refresh()}>刷新</Button></div>
    {error && <AccountNotice error message={error} />}
    {page ? <><CreditBalanceSummary page={page} /><p className="mb-4 mt-3 text-[12.5px] leading-relaxed text-ink-3">工具提交时占用积分，任务完成后结算。暂不支持充值，需要补充积分请联系管理员。</p><CreditLedger entries={page.entries} />
      {page.nextCursor && <div className="mt-4 text-center"><Button size="sm" disabled={loading} onClick={() => void loadMore()}>{loading ? "正在加载…" : "查看更早记录"}</Button></div>}</> : loading && <p role="status" className="text-[13px] text-ink-3">正在读取积分…</p>}
  </section>;
}

import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { useAdminAction } from "./action";
import type { OperationResult } from "./operation-types";
import { importSelectedWorks, pageWorkCandidates, workResultTitle } from "./work-result-selection-data";
import { Button, ReasonDialog } from "./ui";

export function WorkResultSelection({ results }: { results: OperationResult[] }) {
  const ownership = useWorkSource();
  const candidates = pageWorkCandidates(results), actions = useAdminAction(), refresh = useRevalidator(), location = useLocation();
  const [selected, setSelected] = useState<number[]>([]), [open, setOpen] = useState(false), [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null), [report, setReport] = useState<{ succeeded: number[]; remaining: number[]; failedId: number | null } | null>(null);
  const alive = useRef(true), submitting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const close = useCallback(() => setOpen(false), []);
  const eligible = new Set(candidates.map(result => result.id)), currentSelected = selected.filter(id => eligible.has(id)), busy = running || !!actions.pending;
  const resultLink = (id: number) => `${location.pathname}${location.search}#result-${id}`;
  if (!candidates.length && !report && !running) return null;
  return <section aria-label="本页作品多选导入" className="mb-4 min-w-0 space-y-3 rounded-control border border-line p-3">
    <p className="text-[13px] text-ink-2">本页可多选导入 {candidates.length} 项，已选 {currentSelected.length} 项；沿用共同所属信源及其当前参与方式，不请求供应商或提高权限。</p>
    <p className="text-[12px] text-ink-3">仅列出已有校验可确认无需补证的作品。账号、研究、过期、附件和文件不参与；视频号、快手及需逐条核实的作品请使用各条结果的操作。范围仅限本页，切换任务或结果页会清空选择。</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !candidates.length} onClick={() => { setSelected(candidates.map(result => result.id)); setError(null); }}>全选本页可导入项</Button><Button size="sm" disabled={busy || !currentSelected.length || !ownership.ready} onClick={() => { setSelected([]); setError(null); }}>清空选择</Button><Button size="sm" tone="primary" disabled={busy || !currentSelected.length || !ownership.ready} onClick={() => { setError(null); setOpen(true); }}>导入所选作品（{currentSelected.length}）</Button></div>
    {candidates.length > 0 && <ul className="space-y-2 text-[13px]">{candidates.map(result => <li key={result.id} className="flex min-w-0 flex-wrap items-start gap-2"><label className="inline-flex min-w-0 items-start gap-2"><input aria-label={`选择结果 #${result.id}`} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" disabled={busy} checked={currentSelected.includes(result.id)} onChange={event => { const checked = event.target.checked; setSelected(previous => checked ? [...new Set([...previous, result.id])] : previous.filter(id => id !== result.id)); setError(null); }} /><span className="break-all">#{result.id} · {workResultTitle(result)}</span></label><Link className="shrink-0 text-accent" to={resultLink(result.id)}>查看此结果</Link></li>)}</ul>}
    {running && <p role="status" className="text-[12px] text-ink-3">正在依次提交；首个失败即停止，不自动重试。页面切换后不再发送下一项，已在途的本地提交仍可能完成，不会回滚。</p>}
    {report && <div className="space-y-1 text-[12px] text-ink-3"><p>本次已成功 {report.succeeded.length} 项，保留未完成选择 {report.remaining.length} 项。</p>{report.failedId !== null && <p>在<Link className="text-accent" to={resultLink(report.failedId)}>结果 #{report.failedId}</Link>停止，请逐条核对或修正；不会自动继续。原因与未尝试选择保留。</p>}</div>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-[13px] text-hot">{error}</p>}
    <ReasonDialog open={open} title="导入本页所选作品" description={`将依次本地导入所选 ${currentSelected.length} 项，仅提交同一个操作原因，沿用已确认的所属信源及其当前参与方式，不提高权限。首个失败停止；已成功项不回滚，失败与未尝试项保留选择。需补证的记录请逐条处理。`} busy={busy} onClose={close} onSubmit={async reason => {
      if (submitting.current) return false;
      submitting.current = true; setRunning(true); setError(null);
      try {
        const outcome = await importSelectedWorks({ results, selectedIds: currentSelected, reason, source: ownership.body(), isCurrent: () => alive.current, submit: async (id, body) => await actions.run("POST", `/api/admin/operations/results/${id}/import`, body, { label: `work-selection-import:${id}`, revalidate: false }) !== null });
        if (!alive.current) return false;
        setSelected(outcome.remaining); setReport(outcome);
        if (outcome.succeeded.length) refresh.revalidate();
        if (outcome.failedId !== null) setError(`结果 #${outcome.failedId} 未确认成功，已停止。请查看该条结果；失败与未尝试项保留选择，未自动重试。`);
        return outcome.remaining.length === 0;
      } catch (error) { if (alive.current) setError((error as Error).message); return false; }
      finally { submitting.current = false; if (alive.current) setRunning(false); }
    }}><WorkSourceNotice />{error && <p role="alert" className="whitespace-pre-wrap break-words text-[13px] text-hot">{error}</p>}</ReasonDialog>
  </section>;
}

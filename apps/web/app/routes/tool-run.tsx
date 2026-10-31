import { ToolSubmit } from '../features/tools/tool-submit';
import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator, useSearchParams, type LoaderFunctionArgs } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import type { ToolQuote } from "@aihot/contracts/credits";
import type { ToolRunDetail } from "@aihot/contracts/user-tools";
import { SITE } from "@aihot/industry/site";
import { accountGet } from "../lib/account.server";
import { ACCOUNT_HEADERS } from "../features/account/data";
import { Badge, Button, ButtonLink, Textarea, Time } from "../features/admin/ui";
import { ToolField } from "../features/tools/fields";
import { ToolResults, ToolProcessResults } from "../features/tools/results";
import { TOOL_STATUS, activeRun } from "../features/tools/types";
import { useToolCommand } from "../features/tools/client";
import { QuoteDialog } from "../features/tools/quote-dialog";
import { usePrivateAccount } from "../features/account/use-private-account";
import { useRunResults } from "../features/tools/use-run-results";
import { parseRunFilters, runHistoryHref, runDetailHref } from "../features/tools/run-history-data";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const [me, run] = await Promise.all([accountGet<AccountMe>(request, "/api/account/me"), accountGet<ToolRunDetail>(request, `/api/tools/runs/${encodeURIComponent(params.id ?? "")}`)]);
  return { me, run };
}
export const headers = () => ACCOUNT_HEADERS;
export const meta = () => [{ title: `执行记录 · ${SITE.name}` }, { name: "robots", content: "noindex, nofollow" }];
const ACTION_LABELS: Record<string, string> = { stop: "停止后续执行", resume: "恢复任务", abandon: "结束并放弃任务" };

export default function ToolRun() {
  const data = useLoaderData<typeof loader>();
  usePrivateAccount(data.me);
  return <ToolRunContent key={`${data.me.user.id}:${data.me.csrf}:${data.run.id}`} {...data} />;
}

function ToolRunContent({ me, run }: Awaited<ReturnType<typeof loader>>) {
  const revalidator = useRevalidator();
  const command = useToolCommand(me.csrf);
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const history = parseRunFilters(new URLSearchParams(search.get("history") ?? ""));
  const [quote, setQuote] = useState<ToolQuote | null>(null);
  const [reason, setReason] = useState("");
  const results = useRunResults(run, "results");
  const process = useRunResults(run, "process");
  const [showProcess, setShowProcess] = useState(false);
  useEffect(() => {
    if (!activeRun(run.status)) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate(); }, 5000);
    return () => clearInterval(timer);
  }, [run.id, run.status, revalidator]);
  function refresh() { results.reset(); process.reset(); revalidator.revalidate(); }
  return <div className="space-y-5 pb-8 pt-5 lg:pt-1">
    <Link to={runHistoryHref(history)} className="text-[13px] text-accent">← 我的执行记录</Link>
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h1 className="break-words text-[23px] font-semibold text-ink">{run.title} <span className="text-[16px] font-normal text-ink-4">#{run.id}</span></h1>{run.summary && <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{run.summary}</p>}<p className="mt-2 text-[12px] text-ink-4">创建于 <Time at={run.createdAt} /></p><p className="mt-2 text-[13px] leading-relaxed text-ink-3">{run.message}</p></div><Badge tone={run.status === "completed" ? "ok" : run.status === "needs_review" || run.status === "failed" ? "warn" : "muted"}>{TOOL_STATUS[run.status] ?? run.status}</Badge></header>
    {(run.originRunId || run.continuationRunId) && <nav aria-label="关联执行记录" className="card flex flex-wrap items-center gap-3 p-4"><span className="text-[13px] text-ink-3">此任务关联原积分占用。</span>{run.originRunId && <ButtonLink to={runDetailHref(run.originRunId, history)}>查看原任务 #{run.originRunId}</ButtonLink>}{run.continuationRunId && <ButtonLink tone="primary" to={runDetailHref(run.continuationRunId, history)}>查看续查结果 #{run.continuationRunId}</ButtonLink>}</nav>}
    <div className="flex flex-wrap items-center gap-3"><Button disabled={revalidator.state !== "idle"} busy={revalidator.state !== "idle"} onClick={refresh}>刷新进度</Button><Link to="/account" className="text-[13px] text-accent">查看积分明细</Link></div>
    {run.charge && <section className="card p-4 text-[13px] text-ink-2"><span className="font-medium">任务积分</span><span className="ml-3">{({ reserved: "占用中", review: "待核对", settled: "已结算", released: "已退回" })[run.charge.state]}</span><p className="mt-2 text-ink-3">原占用 {run.charge.amount} 积分 · 已扣除 {run.charge.consumed} · 已退回 {run.charge.released}</p></section>}
    {activeRun(run.status) && <p role="status" className="text-[13px] text-ink-3">任务在后台执行中。可以离开此页，稍后从执行记录查看结果。</p>}
    <section aria-label="任务成果" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[17px] font-semibold text-ink">任务成果 <span className="text-[13px] font-normal text-ink-3">{run.resultCount} 条</span></h2>{run.resultCount > 0 && <a href={`/api/tools/runs/${run.id}/results/export`} className="text-[13px] text-accent underline">导出全部结果（JSON）</a>}</div>
      {run.resultCount > 0 && <p className="text-[12px] text-ink-4">导出包含下载开始时已保存的全部成果，不受页面加载数量限制。</p>}
      {!results.items.length ? <div className="card p-8 text-center text-[14px] leading-relaxed text-ink-3">{run.continuationRunId ? "请打开上方的续查结果，查看后续任务已保存的成果。" : run.status === "completed" ? "任务已完成，没有返回可展示的成果。" : activeRun(run.status) ? "成果准备中，保存完成后会显示在这里。执行过程可在下方展开查看。" : "暂未保存可展示的成果，请查看下方的任务处理选项。"}</div> : <ToolResults category={run.category} results={results.items} />}
      {results.error && <p role="alert" className="text-[13px] text-hot">{results.error}</p>}
      {results.cursor !== null && <Button busy={results.loading} onClick={() => void results.loadMore()}>加载更多成果</Button>}
    </section>
    {run.processCount > 0 && <details className="card p-4" onToggle={event => setShowProcess(event.currentTarget.open)}><summary className="cursor-pointer text-[13px] font-medium text-ink-2">执行过程（{run.processCount} 条）</summary>{showProcess && <div className="mt-4 space-y-3"><ToolProcessResults results={process.items} />{process.error && <p role="alert" className="text-[13px] text-hot">{process.error}</p>}{process.cursor !== null && <Button busy={process.loading} onClick={() => void process.loadMore()}>加载更多过程记录</Button>}</div>}</details>}
    {run.recoveryKind && <section className="card space-y-3 p-4"><p className="text-[13px] leading-relaxed text-ink-3">可以继续查询这次任务的供应商结果。续查关联原积分占用，不重复收取生成费用。</p><ToolSubmit selection={{kind:run.recoveryKind,free:true}} disabled={command.pending} onClick={async () => { const result = await command.run<ToolQuote>("/api/tools/quote", { kind: run.recoveryKind, input: { runId: run.id } }); if (result) setQuote(result); }}>提交续查</ToolSubmit></section>}
    {!!run.actions.length && <section className="card space-y-3 p-4"><ToolField label="操作说明" hint="恢复与停止沿用原任务记录。停止后续调度不代表供应商取消或立即退回积分。"><Textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="简要说明本次操作的原因" /></ToolField><div className="flex flex-wrap gap-2">{run.actions.map(action => <div key={action} className="flex flex-wrap items-center gap-3"><Button tone={action === "abandon" ? "danger" : "secondary"} disabled={command.pending || !reason.trim()} busy={command.pending} onClick={async () => {
      const result = await command.run(`/api/tools/runs/${run.id}/${action}`, { stepVersion: run.stepVersion, generation: run.generation, reason: reason.trim() });
      if (result) { setReason(""); refresh(); }
    }}>{ACTION_LABELS[action] ?? action}</Button>{action === "resume" && <span className="text-[12.5px] text-ink-3">额外消耗 0 积分</span>}</div>)}</div></section>}
    {command.error && !quote && <p role="alert" className="rounded-control bg-hot-soft p-3 text-[13px] text-hot">{command.error}</p>}
    {quote && run.recoveryKind && <QuoteDialog quote={quote} pending={command.pending} error={command.error} close={() => setQuote(null)} confirm={async () => { const result = await command.run<{ runId: number }>(`/api/tools/${run.recoveryKind}`, { input: { runId: run.id }, quoteId: quote.quoteId }); if (result) { setQuote(null); navigate(runDetailHref(result.runId, history)); } }} />}
  </div>;
}

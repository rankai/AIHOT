import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { billParameterText, billRecordPage, redfoxCostBasis, redfoxCostEnvironment, redfoxCostInputKey, redfoxCostQuery, redfoxCostText } from "./redfox-cost-data";
import type { RedfoxCostInput, RedfoxCostInterval, RedfoxCostsData, RedfoxSelectedBill } from "./redfox-cost-types";
import { Button, Card, DataTable, Empty, Field, Input, Json, KV, Select, Time } from "./ui";
const services: Record<string, string> = { "redfox.collect": "Redfox 采集", "redfox.query": "Redfox 单次查询", "redfox.account": "Redfox 账户查询", "redfox.media": "Redfox 媒体处理 / 上传", "redfox.image": "Redfox 图片创作", "redfox.video": "Redfox 视频创作", "redfox.poll": "Redfox 任务查询", "redfox.transcript": "Redfox 语音转写", "redfox.ai_search": "Redfox AI 搜索", "agentkey.collect": "AgentKey 采集", "agentkey.query": "AgentKey 单次查询" };
export function RedfoxCosts({ initialInterval }: { initialInterval: RedfoxCostInterval }) {
  const [input, setInput] = useState<RedfoxCostInput>(() => ({ ...initialInterval, billRunId: "" }));
  const [snapshot, setSnapshot] = useState<{ key: string; data: RedfoxCostsData } | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef<{ sequence: number; controller?: AbortController }>({ sequence: 0 });
  useEffect(() => () => request.current.controller?.abort(), []);
  const change = (patch: Partial<RedfoxCostInput>) => { request.current.controller?.abort(); request.current.sequence += 1; setLoading(false); setError(null); setInput(previous => ({ ...previous, ...patch })); };
  const current = snapshot?.key === redfoxCostInputKey(input);
  return <div className="min-w-0 space-y-5">
    <Card title="费用与账单（已存数据）">
      <p className="mb-4 text-[13px] text-ink-3">读取本地已存数据不触发 Redfox 或 AgentKey。要更新 Redfox 上游账单，请到<Link className="text-accent" target="_blank" rel="noreferrer" to="/admin/redfox?view=platforms">平台查询 ↗</Link>选择 Redfox 账户并显式查询账单；本页不发起供应商请求。</p>
      <form aria-label="已存费用查询条件" className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (loading) return;
        let url: string;
        try { url = redfoxCostQuery(input); setError(null); } catch (error) { setError((error as Error).message); return; }
        request.current.controller?.abort(); const controller = new AbortController(), sequence = ++request.current.sequence; request.current.controller = controller; setLoading(true);
        const key = redfoxCostInputKey(input);
        try {
          const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
          if (response.status === 401) { window.location.href = `/admin/login?${new URLSearchParams({ return: window.location.pathname + window.location.search })}`; return; }
          const data = await response.json();
          if (!response.ok) throw new Error(data?.detail ?? `读取失败（${response.status}）`);
          if (!controller.signal.aborted && sequence === request.current.sequence) setSnapshot({ key, data });
        } catch (error) { if (!controller.signal.aborted && sequence === request.current.sequence) setError((error as Error).message); }
        finally { if (sequence === request.current.sequence) setLoading(false); }
      }}>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field label="开始时间（ISO，含时区）" hint="范围按外发尝试开始时间：含开始，不含结束。"><Input aria-label="开始时间（ISO，含时区）" required value={input.start} onChange={event => change({ start: event.target.value })} /></Field><Field label="结束时间（ISO，含时区）" hint="例如 2026-10-21T00:00:00Z 或 +08:00 偏移。"><Input aria-label="结束时间（ISO，含时区）" required value={input.end} onChange={event => change({ end: event.target.value })} /></Field></div>
        {snapshot && <Field label="已存账单页" hint="最近已存清单最多 50 个任务，不是该时段全部账单；同 receipt 表示同一响应。"><Select aria-label="已存账单页" value={input.billRunId} onChange={event => change({ billRunId: event.target.value })}><option value="">只读取本地费用分组</option>{snapshot.data.billPages.map(page => <option key={page.runId} value={page.runId}>任务 #{page.runId} · 回执 #{page.receiptId} · pageNum {billParameterText(page.parameters, "pageNum")} · pageSize {billParameterText(page.parameters, "pageSize")}</option>)}</Select></Field>}
        {input.billRunId && snapshot && (() => { const page = snapshot.data.billPages.find(page => String(page.runId) === input.billRunId); return page ? <div className="text-[12px] text-ink-3"><p className="break-all">{page.responseIdentity} · 同回执表示同一供应商响应</p><p className="whitespace-pre-wrap break-all">pageNum：{billParameterText(page.parameters, "pageNum")} · pageSize：{billParameterText(page.parameters, "pageSize")}</p><p>查询任务创建：<Time at={page.queriedAt} /> · 收到：<Time at={page.receivedAt} /></p></div> : null; })()}
        <Button type="submit" tone="primary" busy={loading} disabled={loading}>读取已存费用数据</Button>
        {error && <p role="alert" className="break-words text-[13px] text-hot">{error}</p>}
      </form>
    </Card>
    {snapshot && !current && <p className="text-[13px] text-ink-3">条件已更改，旧结果已收起。请显式读取新条件；输入与已存清单保持。</p>}
    {snapshot && current && <RedfoxCostReport data={snapshot.data} />}
  </div>;
}

export function RedfoxCostReport({ data }: { data: RedfoxCostsData }) {
  return <div className="min-w-0 space-y-5">
    <Card title="本地登记的外发尝试" pad={false}>
      <div className="space-y-2 border-b border-line p-4 text-[12.5px] text-ink-3"><p className="break-all">本次读取范围：{data.local.interval.start} 至 {data.local.interval.end}（外发尝试开始时间，含开始、不含结束）。</p><p>登记的外发尝试不证明上游收到。live 只是来源标记，不等于真实付费；分组按服务、模型、来源、地址、环境、币种与成本依据分别展示，不混加。AgentKey 积分来自已存响应，缺失值显示未知。</p></div>
      <DataTable rows={data.local.groups} rowKey={row => JSON.stringify([row.service, row.model, row.origin, row.base, row.currency, row.costBasis])} empty="所选本地时间范围没有登记的 Redfox 或 AgentKey 外发尝试。" columns={[
        { key: "service", label: "服务 / 模型", render: row => <div className="space-y-1"><p>{services[row.service] ?? row.service}</p><p className="break-all text-[11px] text-ink-4">{row.service} · {row.model ?? "模型未知"}</p></div> },
        { key: "origin", label: "来源 / 环境 / 地址", render: row => <div className="max-w-64 space-y-1 whitespace-normal break-all"><p>{row.origin}</p><p className="text-[12px] text-ink-3">{redfoxCostEnvironment(row.environment)}</p><p className="text-[11px] text-ink-4">{row.base ?? "base 未记录"}</p></div> },
        { key: "basis", label: "币种 / 依据", render: row => <div><p>{row.currency ?? "币种未知"}</p><p className="text-[12px] text-ink-3">{redfoxCostBasis(row.costBasis)}</p></div> },
        { key: "cost", label: "成本 / 积分", render: row => <div className="max-w-56 break-all"><p>{redfoxCostText(row.knownCost)}</p><p className="text-[12px] text-ink-3">未知成本 {row.unknownCostCount} 条</p>{row.service.startsWith("agentkey.") && <><p className="mt-1">估价 {redfoxCostText(row.estimatedCredits)} credits</p><p className="text-[12px] text-ink-3">实扣 {redfoxCostText(row.chargedCredits)} credits · 未知 {row.unknownEstimatedCreditsCount}/{row.unknownChargedCreditsCount} 条</p></>}</div> },
        { key: "attempts", label: "尝试 / 登记状态", render: row => <div><p>{row.attempts} 次</p><p className="text-[12px] text-ink-3">待定 {row.statusCounts.pending} · 收到 {row.statusCounts.received}<br />失败 {row.statusCounts.failed} · 未知 {row.statusCounts.unknown}</p></div> },
      ]} />
    </Card>
    {data.selectedBill ? <BillPage key={`${data.selectedBill.runId}:${data.selectedBill.receiptId}`} bill={data.selectedBill} /> : <Card title="上游已存账单页"><Empty>可从已存清单单选一页，再点“读取已存费用数据”；不会自动查询上游。</Empty></Card>}
    <Card title="核对边界"><p className="text-[13px] text-ink-3">当前不能逐笔匹配或计算精确差额：账单无唯一请求标识、gmtCreate 未声明时区、动态分页未证明完整覆盖时段，且本地尝试不证明已送达。本地时间范围与所选单页账单不可视为同一完整范围，不判断漏扣、多扣或退款。</p><Json value={data.comparison} label="不可直接比较的依据" /></Card>
  </div>;
}
function BillPage({ bill }: { bill: RedfoxSelectedBill }) {
  const [requestedPage, setRequestedPage] = useState(0), page = billRecordPage(bill.records, requestedPage);
  return <Card title="所选上游账单页" right={<Link className="text-accent" to={`/admin/operations/${bill.runId}`}>查看查询任务 #{bill.runId}</Link>}>
    <div className="space-y-4"><p className="break-all text-[12px] text-ink-3">回执 #{bill.receiptId} · {bill.responseIdentity}（同回执表示同一响应） · {redfoxCostEnvironment(bill.environment)} · base {bill.base ?? "未记录"}</p>
      <KV items={[["请求 pageNum", <span className="whitespace-pre-wrap break-all">{billParameterText(bill.parameters, "pageNum")}</span>], ["请求 pageSize", <span className="whitespace-pre-wrap break-all">{billParameterText(bill.parameters, "pageSize")}</span>], ["查询任务创建", <Time at={bill.queriedAt} />], ["收到时间", <Time at={bill.receivedAt} />], ["保存时间", <Time at={bill.savedAt} />], ["实际记录 count", bill.count], ["上游 total / pages", <span className="break-all">{String(bill.total)} / {String(bill.pages)}</span>]]} />
      <p className="text-[12px] text-ink-3">所选仅一份已存响应，count、total、pages 各按实收展示，不代表该本地时段全部账单。下方 gmtCreate 为原串、时区未知，不转换成本地日期或归入时间范围。</p>
      <KV items={[["积分带符号合计", <span className="break-all">{bill.summary.signedPoints} points</span>], ["已确认 API 扣除积分", <span className="break-all">{bill.summary.knownApiConsumptionPoints} points（仅 api_consume 负值的绝对量）</span>], ["其他分类记录", bill.summary.otherRecords], ["积分面值折算（非实际扣款）", <span className="break-all">{bill.summary.nominalCny.amount} CNY</span>]]} />
      <p className="text-[12px] text-ink-3">每 {bill.summary.nominalCny.pointsPerCny} points 面值对应 1 CNY（1 point = 0.1 CNY，仅面值）。不是实际现金扣款，不将正值解释为退款，也不把未知分类计作 API 扣费。</p>
      <details className="min-w-0 rounded-control border border-line p-3"><summary className="cursor-pointer text-[13px] text-ink-3">本页原始记录（{bill.records.length} 条，同秒重复行分别保留）</summary><div className="mt-3 space-y-3"><DataTable rows={page.rows} rowKey={row => row.index} empty="此响应实际返回 0 条记录。" columns={[
        { key: "points", label: "原 points", render: row => <span className="break-all">{row.points}</span> },
        { key: "reason", label: "reason / reasonDesc", render: row => <div className="max-w-72 whitespace-pre-wrap break-all"><p>{row.reason}</p><p className="text-[12px] text-ink-3">{row.reasonDesc}</p></div> },
        { key: "time", label: "原 gmtCreate（时区未知）", render: row => <span className="whitespace-pre-wrap break-all">{row.gmtCreate}</span> },
      ]} />{page.pages > 1 && <div className="flex flex-wrap items-center gap-3"><Button size="sm" disabled={page.page === 0} onClick={() => setRequestedPage(page.page - 1)}>上一组账单记录</Button><span className="text-[12px] text-ink-3">本地分组 {page.page + 1} / {page.pages}，不是上游翻页</span><Button size="sm" disabled={page.page + 1 >= page.pages} onClick={() => setRequestedPage(page.page + 1)}>下一组账单记录</Button></div>}</div></details>
      <Json value={{ parameters: bill.parameters, rawTimeRange: bill.rawTimeRange, summary: bill.summary, operationId: bill.operationId }} label="所选账单原始参数与核对诊断" />
    </div>
  </Card>;
}

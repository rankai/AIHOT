import type { OperationResult } from "./operation-types";
import { kuaishouResultData } from "./kuaishou-result-data";
import { ManualWorkActions } from "./manual-work-actions";
import { Badge, Json, KV } from "./ui";

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "未提供";
}
export function KuaishouResult({ result: r }: { result: OperationResult }) {
  const facts = kuaishouResultData(r.kind, r.data), record = facts.record;
  const body = facts.account ? record.signature : record.caption;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title)}</span><Badge>{facts.account ? "快手账号查询结果" : "快手作品查询结果"}</Badge></div>
    <KV items={[["作者称呼 / 昵称", text(record.nickname)], ...(facts.account ? [["展示号 kwaiId", text(record.kwaiId)]] as Array<[string, string]> : [["响应 photoId", facts.photoId ?? "未提供"], ["作品类型原串", text(record.workType)]] as Array<[string, string]>)]} />
    <p className="text-[12px] text-ink-4">昵称、kwaiId 与 threeXId 是展示或定位信息，不证明永久作者身份，也不推定彼此永久等价。{facts.account ? "账号结果仅供查询查看，未提供账号绑定入口。" : "作品可在逐项核实原文及作者关系后人工导入隔离信源，不按昵称自动归属。"}</p>
    {facts.work && <>
      {facts.requestedWorkId !== null && <KV items={[["请求 photoId（仅输入）", facts.requestedWorkId]]} />}
      <KV items={[["原始发布时间", text(record.publishTime)], ["时长（毫秒）", facts.duration === null ? "未提供" : String(facts.duration)]]} />
      <p className="text-[12px] text-ink-4">只展示响应实际收到的 photoId，请求参数不补作已收作品身份；发布时间按上游原串保留，不推断时区或今天。</p>
    </>}
    {typeof body === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p>}
    {facts.media.length > 0 && <div className="space-y-1"><p className="text-[12px] text-ink-3">上游媒体链接（不是原文，不表示已下载）</p><div className="flex flex-wrap gap-3 text-[12px]">{facts.media.map(item => <a key={item.field} className="break-all text-accent" href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a>)}</div></div>}
    {facts.missing.length > 0 && <div><p className="mb-1 text-[12px] text-ink-3">上游原始缺项事实（人工核实不改写上游字段）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{facts.missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {facts.work && <ManualWorkActions result={r} />}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="查询字段与溯源诊断" />
  </article>;
}

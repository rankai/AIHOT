import type { OperationResult } from "./operation-types";
import { shipinhaoResultData } from "./shipinhao-result-data";
import { ManualWorkActions } from "./manual-work-actions";
import { Badge, Json, KV } from "./ui";

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "未提供";
}
export function ShipinhaoResult({ result: r }: { result: OperationResult }) {
  const facts = shipinhaoResultData(r.kind, r.data), record = facts.record;
  const body = facts.account ? record.signature : record.description;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title)}</span><Badge>{facts.account ? "视频号账号查询结果" : "视频号作品查询结果"}</Badge></div>
    <KV items={[["作者称呼 / 昵称", text(record.nickname)], ...(facts.account ? [["展示定位 findName", text(record.findName)]] as Array<[string, string]> : [["响应 videoId", facts.videoId ?? "未提供"], ["响应 exportId", facts.exportId ?? "未提供"]] as Array<[string, string]>)]} />
    <p className="text-[12px] text-ink-4">昵称与 findName 只作展示或定位，不是已确认永久作者身份。{facts.account ? "账号结果仅供查询查看，未提供账号绑定入口。" : "作品可在逐项核实原文及作者关系后人工导入隔离信源，不按昵称自动归属。"}</p>
    {facts.work && <>
      <p className="text-[12px] text-ink-3">videoId 与 exportId 是不同种类的响应字段，保留各自原串，不互相转换或视为同一身份。</p>
      {facts.requestedWorkId !== null && <KV items={[["请求 videoId（仅输入）", facts.requestedWorkId]]} />}
      <KV items={[["原始发布时间", text(record.publishTime)], ["上游时长（单位未核实）", facts.duration ?? "未提供"], ["话题", text(record.topic)], ["地点", text(record.location)]]} />
      <p className="text-[12px] text-ink-4">发布时间按上游原串展示，不推断时区、相对日期或今天；时长不换算成秒或毫秒。</p>
    </>}
    {typeof body === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p>}
    {facts.inputUrl && <div className="space-y-1"><p className="text-[12px] text-ink-3">分享地址仅为本次查询输入，不作为已收到的作品原文证据。</p><a className="break-all text-[13px] text-accent" href={facts.inputUrl} target="_blank" rel="noreferrer">查看查询输入的分享链接 ↗</a></div>}
    {facts.media.length > 0 && <div className="space-y-1"><p className="text-[12px] text-ink-3">上游媒体链接（不是原文，不表示已下载）</p><div className="flex flex-wrap gap-3 text-[12px]">{facts.media.map(item => <a key={item.field} className="break-all text-accent" href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a>)}</div></div>}
    {facts.missing.length > 0 && <div><p className="mb-1 text-[12px] text-ink-3">上游原始缺项事实（人工核实不改写上游字段）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{facts.missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {facts.work && <ManualWorkActions result={r} />}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="查询字段与溯源诊断" />
  </article>;
}

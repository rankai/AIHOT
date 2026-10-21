import type { OperationResult } from "./operation-types";
import { researchFactText, researchObject, researchScalarRows } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { safeExternalUrl } from "./platform-types";
import { serviceXMedia } from "./service-research-data";
import { XSearchImport } from "./x-search-import";
import { Badge, Json } from "./ui";
export function XDetailResult({ result: r }: { result: OperationResult }) {
  const record = researchObject(r.data.record), author = researchObject(record.author), context = researchObject(r.data.context);
  const url = safeExternalUrl(record.url ?? record.tweetUrl), media = serviceXMedia(record);
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>X 推文详情</span><Badge>实收作品</Badge></div>
    <ResearchFacts items={[["已收到 tweetId", researchFactText(record.tweetId)], ["实际作者 userId", researchFactText(author.userId)], ["实收原始时间 createdAt", researchFactText(record.createdAt)], ...(Object.hasOwn(r.data, "originResultId") ? [["来源结果", `#${researchFactText(r.data.originResultId)}`]] as Array<[string, string]> : [])]} />
    <div className="space-y-2"><p className="text-[12px] text-ink-3">本次实收原始 author 字段</p><ResearchFacts items={researchScalarRows(author)} /></div>
    {Object.hasOwn(context, "username") && <div className="space-y-2"><p className="text-[12px] text-ink-3">后台核实的作者上下文（不改写原始 author）</p><ResearchFacts items={[["上下文 username", researchFactText(context.username)]]} /><p className="text-[12px] text-ink-4">原始 username 缺失时，后台仅在相同稳定 userId 的来源证据通过核实时使用；不按 handle 推断作者。</p></div>}
    {["text", "content"].map(key => typeof record[key] === "string" ? <div key={key}><p className="text-[12px] text-ink-3">实收 {key}（纯文本）</p><p className="whitespace-pre-wrap break-words text-[13px] text-ink-2">{String(record[key])}</p></div> : null)}
    {url ? <a className="inline-block break-all text-[13px] text-accent" href={url} target="_blank" rel="noreferrer">本次实收原文地址 ↗</a> : <p className="text-[12px] text-ink-4">本记录未提供可点击的实收原文地址；不从上下文猜造链接。</p>}
    {media.map((item, index) => <div className="space-y-2 rounded-control bg-bg-sunk p-3" key={index}><p className="text-[12px] text-ink-3">实收媒体 {index + 1}（未自动下载）</p><ResearchFacts items={item.fields} />{item.links.map((link, i) => { const address = safeExternalUrl(link.value); return address ? <a key={i} className="block break-all text-[12px] text-accent" href={address} target="_blank" rel="noreferrer">{link.label} ↗</a> : <p key={i} className="break-all text-[12px] text-ink-4">{link.label}：{researchFactText(link.value)}（未生成链接）</p>; })}</div>)}
    <p className="text-[12px] text-ink-4">发布时间保留实收原串；最终有效性、原文去重和归属由后台核实。详情不会自动导入或覆盖原材料。</p>
    <XSearchImport result={r} />
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="X 详情原始记录与溯源诊断" />
  </article>;
}

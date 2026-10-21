import { DetailQueryActions } from "./detail-query-actions";
import type { OperationResult } from "./operation-types";
import { platformLabels } from "./platform-labels";
import { safeExternalUrl } from "./platform-types";
import { researchBodyFields, researchCaution, researchFactText, researchLinks, researchObject, researchRecordRows, researchScalarRows, researchSummaryRows } from "./research-platform-data";
import { Badge, Json, KV } from "./ui";
import { ResearchLocalImport } from "./research-local-import";

export function ResearchPlatformResult({ result: r }: { result: OperationResult }) {
  const name = typeof r.data.platform === "string" ? platformLabels[r.data.platform] ?? "平台" : "平台";
  const summary = r.kind === "query_summary", account = r.kind.endsWith("_account"), record = researchObject(r.data.record);
  const identity = researchScalarRows(r.data.identity), scope = researchScalarRows(r.data.workNamespace ?? r.data.identityNamespace);
  const context = researchScalarRows(r.data.accountContext), nestedAuthor = researchScalarRows(record.authorInfo);
  const original = safeExternalUrl(r.data.url), links = researchLinks(r.data);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{summary ? `${name}查询摘要` : researchFactText(r.data.title)}</span><Badge>{summary ? "分页事实" : account ? `${name}账号` : `${name}作品`}</Badge></div>
    {summary ? <>
      <ResearchFacts items={researchSummaryRows(r.data)} />
      {r.data.count === 0 && <p className="text-[13px] text-ink-3">本次返回 0 项，没有创建文章。</p>}
      <p className="text-[12px] text-ink-4">只显示本次实际返回数和已收分页字段，保留 null、false、数字与字符串的区别。不推算总量、hasMore 或游标，不自动翻页。</p>
    </> : <>
      <div className="space-y-2"><p className="text-[12px] text-ink-3">收到的本操作身份字段（最终归属由后台重新核实）</p>{identity.length ? <ResearchFacts items={identity} /> : <p className="text-[12px] text-ink-4">未收到本操作身份字段。</p>}</div>
      {!account && <ResearchFacts items={[["本操作已收作品 ID", researchFactText(r.data.workId)], ...(Object.hasOwn(r.data, "requestedWorkId") ? [["冻结请求作品 ID（仅输入）", researchFactText(r.data.requestedWorkId)]] as Array<[string, string]> : [])]} />}
      {scope.length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">标识与作品类型适用范围</p><ResearchFacts items={scope} /></div>}
      <p className="text-[12px] text-ink-4">{researchCaution(r.data.platform)}</p>
      {context.length > 0 && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[12px] text-ink-3">同页已收账号上下文（导入时由后台核实归属）</p><ResearchFacts items={context} /></div>}
      <ResearchFacts items={researchRecordRows(r.data)} />
      {nestedAuthor.length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">响应嵌套 authorInfo（与顶层 authorId 分开）</p><ResearchFacts items={nestedAuthor} /></div>}
      {researchBodyFields(r.data).map(([key, body]) => <div key={key}><p className="mb-1 text-[12px] text-ink-3">响应 {key}（纯文本查看）</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p></div>)}
      {Object.hasOwn(r.data, "url") && <div className="min-w-0 space-y-1 text-[12.5px]"><p className="text-ink-3">本条响应原文地址</p>{original ? <a className="break-all text-accent" href={original} target="_blank" rel="noreferrer">{researchFactText(r.data.url)} ↗</a> : <p className="break-all text-ink-4">{researchFactText(r.data.url)}（未作为可点击原文）</p>}</div>}
      {Object.hasOwn(r.data, "inputUrl") && <div className="min-w-0 space-y-1 text-[12.5px]"><p className="text-ink-3">冻结查询地址（仅输入，不补作响应原文）</p><p className="break-all text-ink-4">{researchFactText(r.data.inputUrl)}</p></div>}
      {links.length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">实际收到的链接字段（只提供链接，不主动加载或下载）</p>{links.map(item => <div key={item.key} className="min-w-0 text-[12px]"><p className="text-ink-4">{item.label} · {item.role}</p>{item.url ? <a className="break-all text-accent" href={item.url} target="_blank" rel="noreferrer">{researchFactText(item.value)} ↗</a> : <p className="break-all text-ink-3">{researchFactText(item.value)}（未生成链接）</p>}</div>)}</div>}
      <p className="text-[12px] text-ink-4">时间按字段原值展示；未说明的单位、相对日期或时区不换算为今天，不把查询发现时间当作发表时间。请求参数及 requestedWorkId 不补作收到的作者身份。</p>
      {missing.length > 0 && <div><p className="mb-1 text-[12px] text-ink-3">上游缺项与待核实事实</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {!r.articleId && !r.sourceId && Object.hasOwn(r.data, "pendingReason") && <div className="text-[12.5px] text-amber"><p>本地处理待核实原因</p><p className="whitespace-pre-wrap break-all">{researchFactText(r.data.pendingReason)}</p></div>}
      <ResearchLocalImport result={r} />
      <DetailQueryActions result={r} />
    </>}
    <p className="text-[12px] text-ink-3">作品可显式本地导入，账号仅在本操作收到稳定身份时可绑定。采集订阅以已接通的操作能力为准；研究摘要不会自动成为文章。{["qichezhijia", "dongchedi", "yiche", "baijiahao"].includes(String(r.data.platform)) ? "可显式查看已确认的作品或作者账号详情接口，返回后仍须核实与导入。" : "此平台尚未开放同作品详情补全。"}</p>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="原始字段、冻结请求与溯源诊断" />
  </article>;
}

export function ResearchFacts({ items }: { items: Array<[string, string]> }) {
  return <KV items={items.map(([label, value]) => [<span className="inline-block max-w-[9rem] break-all align-top">{label}</span>, <span className="whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{value}</span>])} />;
}

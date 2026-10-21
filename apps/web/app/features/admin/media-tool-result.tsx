import type { OperationResult } from "./operation-types";
import { researchFactText, researchObject, researchScalarRows } from "./research-platform-data";
import { ResearchFacts } from "./research-platform-result";
import { mediaToolFormats, mediaToolGroupLabels, mediaToolMetadataBodies, mediaToolMetadataLinks, mediaToolMetadataRows, mediaToolResourceLinks, mediaToolResourceRows, mediaToolSpec, mediaToolTextView } from "./media-tool-data";
import type { MediaToolLink } from "./media-tool-types";
import { Badge, Json } from "./ui";
import { ResultAttachmentActions } from "./result-attachment";

export function MediaToolResult({ result: r }: { result: OperationResult }) {
  const spec = mediaToolSpec(r.data.operationId)!, summary = r.kind === "query_summary", check = r.kind === "text_check";
  const metadata = researchObject(r.data.reportedMetadata), formats = mediaToolFormats(r.data), text = mediaToolTextView(r.data);
  const diagnostics = Array.isArray(r.data.diagnostics) ? r.data.diagnostics.filter((item): item is string => typeof item === "string") : [];
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  return <article id={`result-${r.id}`} className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 break-all">{summary ? `${mediaToolGroupLabels[spec.group]}摘要` : check ? "文本检查结果" : r.kind === "subtitle_track" ? researchFactText(r.data.languageName) : "媒体资源地址"}</span><Badge>{summary ? "实际元数据" : r.kind === "subtitle_track" ? "字幕轨道" : check ? "文本研究" : "媒体资源"}</Badge></div>
    {summary ? <>
      <ResearchFacts items={[[spec.group === "subtitle" ? "本次实际轨道数" : "本次实际资源数", researchFactText(r.data.count)], ...mediaToolMetadataRows(r.data)]} />
      {r.data.count === 0 && <p className="text-[12px] text-ink-3">本次未解析出{spec.group === "subtitle" ? "字幕轨道" : "资源地址"}，仍保留收到的元数据，不据此认定请求失败。</p>}
      {mediaToolMetadataBodies(r.data).map(([key, body]) => <div className="space-y-1" key={key}><p className="text-[12px] text-ink-3">{key}{spec.group === "subtitle" ? " · 视频描述，不是字幕正文" : " · 上游描述"}</p><p className="whitespace-pre-wrap break-all text-[13px] text-ink-2">{body}</p></div>)}
      {mediaToolMetadataLinks(r.data).map(link => <ToolLink key={link.label} link={link} />)}
      {spec.group === "subtitle" && <p className="text-[12px] text-ink-3">本次查询只取得轨道与格式地址，附件是否已保存以各轨道的附件记录为准。文件内字幕段结构、时间单位及 URL 有效期未由此确定；元数据 duration 明确为秒，createdAt 保留上游原串。</p>}
    </> : check ? <>
      <div className="space-y-1"><p className="text-[12px] text-ink-3">上游原始纯文本 originalContent</p><p className="whitespace-pre-wrap break-all text-[13px] leading-relaxed text-ink-2">{text.original ?? "上游未提供原始纯文本"}</p></div>
      <div className="space-y-2"><p className="text-[12px] text-ink-3">上游命中类型（按原数组保留）</p>{text.types.length ? <ol className="list-inside list-decimal space-y-1 text-[13px] text-ink-2">{text.types.map((type, index) => <li className="break-all" key={index}>{researchFactText(type)}</li>)}</ol> : <p className="text-[12px] text-ink-4">{Array.isArray(r.data.prohibitedWordsType) ? "上游返回 0 项命中类型。" : "上游未提供命中类型。"}</p>}</div>
      {text.highlightHtml !== null ? <section aria-label="文本安全高亮" className="min-w-0 space-y-2 rounded-control bg-bg-sunk p-3"><p className="text-[12px] text-ink-3">服务端安全处理后的标注</p><div className="whitespace-pre-wrap break-all text-[13px] leading-relaxed text-ink-2 [&_.banned-word]:bg-hot/15 [&_.banned-word]:text-hot [&_.industry-banned-word]:bg-amber/15 [&_.industry-banned-word]:text-amber" dangerouslySetInnerHTML={{ __html: text.highlightHtml }} /></section> : <p className="text-[12px] text-ink-4">未提供可显示的安全标注，以上使用原始纯文本查看。</p>}
    </> : r.kind === "subtitle_track" ? <>
      <ResearchFacts items={[["语言名称 languageName", researchFactText(r.data.languageName)], ["语言标签 languageTag", researchFactText(r.data.languageTag)], ...["id", "site", "title"].flatMap(key => Object.hasOwn(metadata, key) ? [[`视频元数据 ${key}`, researchFactText(metadata[key])]] as Array<[string, string]> : [])]} />
      {formats.map((format, index) => <div className="min-w-0 space-y-2 rounded-control bg-bg-sunk p-3" key={index}><p className="break-all text-[12px] text-ink-3">实际格式：{format.format}</p><ToolLink link={format.link} /></div>)}
      <p className="text-[12px] text-ink-3">这里只展示收到的字幕轨道与格式，不代表文件已下载，也不推定文件内字幕段的时间单位或有效期。</p>
    </> : <>
      <ResearchFacts items={mediaToolResourceRows(r.data)} />
      {mediaToolResourceLinks(r.data).map(link => <ToolLink key={link.label} link={link} />)}
      <p className="text-[12px] text-ink-3">资源类型保持上游原值，不按工具名称推定为视频；收到地址本身不表示已保存，可查看下方附件记录。媒体和封面不是作品原文或作者身份依据。</p>
    </>}
    {(diagnostics.length > 0 || missing.length > 0) && <ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{[...diagnostics, ...missing].map((item, index) => <li className="break-all" key={index}>{item}</li>)}</ul>}
    <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">冻结输入（与响应 ID / 平台分别保留）</summary><div className="mt-2"><ResearchFacts items={researchScalarRows(r.data.requestedInput)} /></div></details>
    {!summary && !check && <ResultAttachmentActions result={r} />}
    <p className="text-[12px] text-ink-4">本次工具结果不自动下载、导入材料或绑定账号。支持的媒体与字幕格式可显式保存为私有附件；文本附件可在其结果中关联已有材料，媒体附件仅本地使用。</p>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="工具原始字段与回执诊断" />
  </article>;
}
function ToolLink({ link }: { link: MediaToolLink }) {
  return <div className="min-w-0 space-y-1 text-[12px]"><p className="break-all text-ink-3">{link.label}</p><p className="whitespace-pre-wrap break-all text-ink-4">上游报告：{researchFactText(link.reportedValue)}</p>{link.url ? <a className="break-all text-accent" href={link.url} target="_blank" rel="noreferrer">HTTP(S) 资源地址：{researchFactText(link.resourceValue)} ↗</a> : <p className="text-ink-4">没有可展示的安全 HTTP(S) 资源链接；保留上游原值。</p>}</div>;
}

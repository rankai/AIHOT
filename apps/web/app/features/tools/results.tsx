import { Link } from "react-router";
import type { ToolResult, ToolRunCategory, ToolRunRow } from "@aihot/contracts/user-tools";
import { Badge, Card, Time } from "../admin/ui";
import { aiSearchProducts } from "../admin/ai-search-data";
import { AiSearchProductResults } from "../admin/ai-search-result";
import { TOOL_STATUS, toolTitle } from "./types";
import { availableResultFile, citationSources, processStage, resultDetails, resultLinks, resultStatus, resultTitle } from "./result-data";
import { ToolImageResults, ToolVideoResults } from "./result-media";
import { ResultCopyButton, ResultText } from "./result-text";

export function ToolRunList({ rows }: { rows: ToolRunRow[] }) {
  if (!rows.length) return <p className="py-8 text-center text-[14px] text-ink-3">还没有执行记录。提交工具任务后，进度与结果会保存在这里。</p>;
  return <ul className="divide-y divide-line">{rows.map(row => <li key={row.id}><Link to={`/tools/runs/${row.id}`} className="flex items-center justify-between gap-4 py-4 hover:text-accent"><div className="min-w-0"><div className="text-[14px] font-medium">{row.title || toolTitle(row.operationKey)} <span className="ml-1 text-[12px] font-normal text-ink-4">#{row.id}</span></div>{row.summary && <p className="mt-1 truncate text-[12px] text-ink-3">{row.summary}</p>}<div className="mt-1 text-[12px] text-ink-3"><Time at={row.createdAt} /></div></div><Badge tone={row.status === "completed" ? "ok" : row.status === "failed" || row.status === "needs_review" ? "warn" : "muted"}>{TOOL_STATUS[row.status] ?? "执行记录"}</Badge></Link></li>)}</ul>;
}

function ResultLinks({ result }: { result: ToolResult }) {
  const links = resultLinks(result), file = availableResultFile(result);
  if (!links.length && !file) return null;
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
    {file && <a href={file.contentUrl} download={file.filename} className="text-accent underline underline-offset-2">下载文件</a>}
    {links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" title={link.host} className="break-all text-accent underline underline-offset-2">{link.label}</a>)}
  </div>;
}

function ResultDetails({ result, metricsOnly = false }: { result: ToolResult; metricsOnly?: boolean }) {
  const details = resultDetails(result, metricsOnly);
  if (!details.length) return null;
  return <dl className={metricsOnly ? "flex flex-wrap gap-x-5 gap-y-2" : "grid gap-x-5 gap-y-2 sm:grid-cols-2"}>{details.map(({ key, label, value }) => <div key={key} className={metricsOnly ? "flex items-baseline gap-1.5 text-[12px]" : "flex min-w-0 gap-2 text-[12px]"}><dt className="shrink-0 text-ink-3">{label}</dt><dd className={`${metricsOnly ? "font-medium text-ink" : "break-all text-ink-2"} min-w-0`}>{key === "status" ? resultStatus(value) : value}</dd></div>)}</dl>;
}

function ResultBody({ result }: { result: ToolResult }) {
  const subtitle = result.details.textMeaning === "video-description";
  const body = <div className="whitespace-pre-wrap break-words text-[14px] leading-7 text-ink-2 [overflow-wrap:anywhere]">{result.text}</div>;
  return <>
    {subtitle && <p className="text-[13px] leading-6 text-ink-3">{result.text ? "以下为视频说明。" : ""}字幕正文请通过下方字幕文件链接查看或下载。</p>}
    {result.text && (result.text.length > 700 && result.kind !== "transcription" ? <>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-7 text-ink-2">{result.text.slice(0, 300)}…</p>
      <details><summary className="cursor-pointer text-[13px] text-accent">展开完整{subtitle ? "视频说明" : "正文"}</summary><div className="mt-3">{body}</div></details>
    </> : body)}
  </>;
}

/** Also retained for callers displaying an individual auxiliary-tool result. */
export function ToolResultCard({ result }: { result: ToolResult }) {
  if (result.kind === "media_upload") return <article className="card space-y-3 p-4 sm:p-5"><h3 className="font-semibold text-ink">素材上传结果</h3>{availableResultFile(result)?.contentType.startsWith("image/") && <ToolImageResults results={[result]} />}{availableResultFile(result)?.contentType.startsWith("video/") && <ToolVideoResults results={[result]} />}{availableResultFile(result)?.contentType.startsWith("audio/") && <audio src={result.file!.contentUrl} controls preload="metadata" className="w-full" />}<ResultLinks result={result} /></article>;
  if (result.kind === "image" || result.file?.contentType.startsWith("image/")) return <ToolImageResults results={[result]} lastFrames={result.details.role === "last_frame"} />;
  if (result.kind === "video" || result.file?.contentType.startsWith("video/")) return <ToolVideoResults results={[result]} />;
  const file = availableResultFile(result), details = resultDetails(result);
  return <article className="card space-y-3 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 break-words text-[15px] font-semibold text-ink">{resultTitle(result)}</h3>{result.kind === "transcription" && result.text && <ResultCopyButton text={result.text} />}</div>
    {file?.contentType.startsWith("audio/") && <audio src={file.contentUrl} controls preload="metadata" className="w-full">当前浏览器不支持音频播放，请下载文件查看。</audio>}
    {result.file && !file && <p className="text-[13px] text-ink-3">文件已删除或不可用，以下保留任务结果记录。</p>}
    <ResultBody result={result} />
    <ResultDetails result={result} metricsOnly />
    {!!details.length && <details><summary className="cursor-pointer text-[12px] text-ink-3">查看详细信息</summary><div className="mt-3"><ResultDetails result={result} /></div></details>}
    <ResultLinks result={result} />
  </article>;
}

function QuerySummary({ result }: { result: ToolResult }) {
  const details = resultDetails(result), metrics = resultDetails(result, true);
  return <div className="rounded-control bg-bg-sunk px-4 py-3 text-[13px] text-ink-3"><p className="mb-2 font-medium text-ink-2">查询摘要</p>{result.text && <p className="mb-2 whitespace-pre-wrap break-words leading-6">{result.text}</p>}<ResultDetails result={result} metricsOnly />{details.some(item => !metrics.some(metric => metric.key === item.key)) && <details className="mt-2"><summary className="cursor-pointer text-[12px]">分页与其他信息</summary><div className="mt-2"><ResultDetails result={result} /></div></details>}<div className="mt-2"><ResultLinks result={result} /></div></div>;
}

function AiSearchResults({ results }: { results: ToolResult[] }) {
  const answers = results.filter(result => result.kind !== "ai_search_citation" && result.kind !== "query_summary");
  const sources = citationSources(results);
  const citationsWithoutLinks = results.filter(result => result.kind === "ai_search_citation" && !resultLinks(result).length);
  return <div className="space-y-5">
    {answers.map(result => {
      const products = result.products ? aiSearchProducts({ family: result.details.family, result: result.products }) : null;
      return <Card key={result.id} title={resultTitle(result, "AI 搜索回答")} right={result.text ? <ResultCopyButton text={result.text} label="复制回答" /> : undefined}>
      {result.text ? <ResultText text={result.text} /> : <p className="text-[14px] text-ink-3">本次未返回答案正文，可查看下方参考来源。</p>}
      {products && <AiSearchProductResults products={products} />}
    </Card>; })}
    {!answers.length && <p className="text-[14px] text-ink-3">已取得参考来源，当前暂无答案正文。</p>}
    {(sources.length > 0 || citationsWithoutLinks.length > 0) && <Card title={`参考来源 · ${sources.length + citationsWithoutLinks.length} 条`}>
      <ol className="space-y-4">{sources.map((source, index) => <li key={source.url} className="flex min-w-0 gap-3"><span className="num pt-0.5 text-[12px] text-ink-4">{index + 1}.</span><div className="min-w-0"><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words text-[14px] font-medium text-accent underline-offset-2 hover:underline">{source.label}</a><p className="mt-0.5 break-all text-[12px] text-ink-4">{source.host}</p>{source.text && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-ink-3">{source.text}</p>}</div></li>)}{citationsWithoutLinks.map((result, index) => <li key={result.id} className="flex min-w-0 gap-3"><span className="num pt-0.5 text-[12px] text-ink-4">{sources.length + index + 1}.</span><div className="min-w-0 text-[13px] leading-6 text-ink-3"><p className="font-medium text-ink-2">{resultTitle(result, "参考来源")}</p>{result.text && <p className="whitespace-pre-wrap break-words">{result.text}</p>}<p className="text-[12px] text-ink-4">未提供可打开的来源链接</p></div></li>)}</ol>
    </Card>}
  </div>;
}

export function ToolResults({ category, results }: { category: ToolRunCategory; results: ToolResult[] }) {
  if (!results.length) return null;
  const summaries = results.filter(result => result.kind === "query_summary");
  const content = results.filter(result => result.kind !== "query_summary");
  let view;
  if (category === "ai-search") view = <AiSearchResults results={content} />;
  else if (category === "images") {
    const images = content.filter(result => result.kind === "image" || result.file?.contentType.startsWith("image/"));
    view = <><ToolImageResults results={images} />{content.filter(result => !images.includes(result)).map(result => <ToolResultCard key={result.id} result={result} />)}</>;
  } else if (category === "videos") {
    const videos = content.filter(result => result.kind === "video" || result.file?.contentType.startsWith("video/"));
    const frames = content.filter(result => result.details.role === "last_frame" || result.kind === "image");
    view = <><ToolVideoResults results={videos} />{frames.length > 0 && <section className="space-y-3"><h3 className="text-[14px] font-medium text-ink">视频末帧</h3><ToolImageResults results={frames} lastFrames /></section>}{content.filter(result => !videos.includes(result) && !frames.includes(result)).map(result => <ToolResultCard key={result.id} result={result} />)}</>;
  } else view = content.map(result => <ToolResultCard key={result.id} result={result} />);
  const emptyQuery = category === "query" && content.length === 0 && summaries.length > 0 && summaries.every(result => (result.details.actualCount ?? result.details.count ?? result.details.received) === 0);
  return <div className="space-y-4">{emptyQuery && <p className="py-4 text-center text-[14px] text-ink-3">未查询到符合条件的数据，可调整条件后重新查询。</p>}{view}{summaries.map(result => <QuerySummary key={result.id} result={result} />)}</div>;
}

export function ToolProcessResults({ results }: { results: ToolResult[] }) {
  return <ol className="divide-y divide-line">{results.map((result, index) => <li key={result.id} className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
    <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-sunk text-[11px] text-ink-3">{index + 1}</span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium text-ink-2">{processStage(result)}</span><Badge tone={resultStatus(result.details.status) === "失败" ? "warn" : "muted"}>{resultStatus(result.details.status)}</Badge>{result.details.progress !== undefined && result.details.progress !== null && <span className="text-[12px] text-ink-3">进度：{String(result.details.progress)}</span>}</div>{result.text && <p className="mt-1 break-words text-[12px] leading-6 text-ink-3">{result.text.length > 240 ? `${result.text.slice(0, 240)}…` : result.text}</p>}</div>
  </li>)}</ol>;
}

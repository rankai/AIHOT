import { Link } from "react-router";
import { operationFileAsset } from "./asset-data";
import { assetSize } from "./image-types";
import { PrivateAssetView } from "./private-asset";
import { ResearchFacts } from "./research-platform-result";
import { researchFactText, researchObject } from "./research-platform-data";
import { safeExternalUrl } from "./platform-types";
import { lowerBitrateSaved, videoDownloadReason, type VideoDownloadInput } from "./subscription-video-data";
import type { OperationResult } from "./operation-types";
import { Json } from "./ui";
export function SubscriptionVideoResult({ result: r }: { result: OperationResult }) {
  const d = r.data, selected = researchObject(d.selectedCandidate), resolver = researchObject(d.resolver);
  const original = safeExternalUrl(d.originalUrl), parse = r.kind === "subscription_video_parse", summary = r.kind === "subscription_video_summary";
  const facts: Array<[string, string]> = parse ? [["实际解析供应商", researchFactText(d.provider)], ["解析操作", researchFactText(d.operationId)], ["次数预算", researchFactText(d.budget)], ["解析尝试", researchFactText(d.attempt)], ["实收视频资源", researchFactText(d.videoResources)], ["去重视频候选", researchFactText(d.uniqueVideoCandidates)]] : [["已保存", researchFactText(d.saved)], ["未保存", researchFactText(d.notSaved)], ["文件传输量（非供应商费用）", typeof d.transferredBytes === "number" ? `${assetSize(d.transferredBytes)}（${d.transferredBytes} 字节）` : "未记录"]];
  if (!parse && !summary) facts.push(["采集供应商", researchFactText(d.collector)], ["可用解析供应商", resolver.provider ? `${resolver.provider} · ${researchFactText(resolver.operationId)} · ${researchFactText(resolver.budget)}` : "无固定解析器"], ["本轮已收解析", d.resolverUsed === true ? "是，详见解析记录与回执" : "未记录已收解析"], ["处理结果", videoDownloadReason(d.reason)]);
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 text-[13px] last:border-0"><p className="font-medium">{parse ? "视频媒体解析记录" : summary ? "本轮视频保存摘要" : "订阅视频保存结果"}</p>
    <ResearchFacts items={facts} />
    {!parse && !summary && (r.file ? <PrivateAssetView asset={operationFileAsset(r.file)} options={null} /> : <div className="flex min-h-32 items-center justify-center rounded-control bg-bg-sunk p-5 text-center text-ink-3"><div><p>{videoDownloadReason(d.reason)}</p>{d.reason === "too_large" && <p className="mt-2 text-[12px]">{d.versionConclusion === "no_provided_version_within_limit" ? "当前接口无 50 MB 内可用版本" : "其它版本无法验证"}</p>}</div></div>)}
    {lowerBitrateSaved(d) && <p className="text-ink-3">已在较高码率版本尝试失败后保存同一视频的较低码率版本。</p>}
    {Object.keys(selected).length > 0 && <ResearchFacts items={[["选用候选", researchFactText(selected.index)], ["版本码率", typeof selected.bitrate === "number" ? `${selected.bitrate} bps` : "未知，不能据此判断清晰度"], ["候选供应商 / 字段", `${researchFactText(selected.provider)} · ${researchFactText(selected.field)}`]]} />}
    {d.mediaRole === "quoted" && <p className="text-ink-3">此视频来自材料中引用的原视频作品；父文章作者与信源归属保持原样，原站链接指向视频真实来源。</p>}
    <div className="flex flex-wrap gap-3 text-accent">{r.articleId && <Link to={`/admin/content/${encodeURIComponent(r.articleId)}`}>查看父材料</Link>}{r.sourceId && <Link to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看信源</Link>}{typeof d.parentRunId === "number" && <Link to={`/admin/operations/${d.parentRunId}${typeof d.parentResultId === "number" ? `?cursor=${Math.max(0, d.parentResultId - 1)}#result-${d.parentResultId}` : "#results"}`}>原采集记录{typeof d.parentResultId === "number" ? ` · 结果 #${d.parentResultId}` : ""}</Link>}{original && <a href={original} target="_blank" rel="noreferrer">视频原站 ↗</a>}</div>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, data: d }} label="视频保存事实与尝试摘要" />
  </article>;
}
export function SubscriptionVideoProgress({ input: v, progress, ended = false }: { input: VideoDownloadInput; progress: Record<string, unknown>; ended?: boolean }) {
  return <div className="mb-4 space-y-3 border-b border-line pb-4 text-[13px] text-ink-3"><p>对成功入库的确认视频私有保存，单文件 ≤ {v.maxBytes / 1_000_000} MB；首次保存起 {v.retentionDays} 天到期，复用不续期。视频保存单独执行，不改变文章入库结果。</p><ResearchFacts items={[["原采集供应商", v.collector], ["可用解析供应商 / 操作", v.resolver ? `${v.resolver.provider} · ${v.resolver.operationId}` : "无固定解析器"], ["本轮已收解析", v.resolverUsed ? "是，查看解析记录与回执" : "未记录已收解析"], ["解析次数预算", v.resolver?.budget ?? "无需 / 无可用解析器"], ...(v.resolver ? [["自动解析次数", `正常 ${v.normalParserAttempts} 次；未知或可重试响应合计最多 ${v.maxParserAttempts} 次，可能再次计费`] as [string, string]] : [["额外解析", "没有对应解析接口；采集地址不可用时记录未保存原因"] as [string, string]]), ...([['targetsTotal', '视频目标数'], ['saved', '已保存'], ['notSaved', '未保存'], ['transferAttempts', '当前候选传输尝试'], ['transferredBytes', '本轮传输字节（非费用）']] as const).filter(([key]) => !ended || key !== 'transferAttempts').map(([key, label]): [string, string] => [label, researchFactText(progress[key])])]} /><div className="flex flex-wrap gap-3 text-accent"><Link to={`/admin/content/${encodeURIComponent(v.articleId)}`}>查看父材料</Link><Link to={`/admin/operations/${v.parentRunId}?cursor=${Math.max(0, v.parentResultId - 1)}#result-${v.parentResultId}`}>原采集记录 · 结果 #{v.parentResultId}</Link></div></div>;
}

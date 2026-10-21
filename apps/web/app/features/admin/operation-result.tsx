import { researchFactText } from "./research-platform-data";
import { XDetailResult } from "./x-detail-result";
import { isXDetailWork } from "./x-search-import-data";
import { collectionPageSummary } from "./collection-subscription-data";
import { ResultAttachment } from "./result-attachment";
import { isXhsCommentResult } from "./xhs-comment-data";
import { XhsCommentResult } from "./xhs-comment-result";
import { isVideoResult } from "./video-data";
import { VideoResult } from "./video-result";
import { imageParameterRows, imageProviderStatuses } from "./image-model-data";
import { ResearchFacts } from "./research-platform-result";
import { isAiSearchResult } from "./ai-search-data";
import { AiSearchResult } from "./ai-search-result";
import { MediaUploadResult } from "./media-upload-result";
import { isMediaToolResult } from "./media-tool-data";
import { MediaToolResult } from "./media-tool-result";
import { isTranscriptionResult } from "./transcription-data";
import { TranscriptionResult } from "./transcription-result";
import { isSocialResearchResult } from "./social-research-data";
import { SocialResearchResult } from "./social-research-result";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useAdminAction } from "./action";
import { isServiceResearchResult } from "./service-research-data";
import { ServiceResearchResult } from "./service-research-result";
import { isResearchResult } from "./research-platform-data";
import { ResearchPlatformResult } from "./research-platform-result";
import { ToutiaoResult, ToutiaoQuerySummary } from "./toutiao-result";
import { ShipinhaoResult } from "./shipinhao-result";
import { KuaishouResult } from "./kuaishou-result";
import { InstagramResult } from "./instagram-result";
import { YoutubeResult } from "./youtube-result";
import { BilibiliResult } from "./bilibili-result";
import { TiktokResult } from "./tiktok-result";
import { XiaohongshuResult } from "./xiaohongshu-result";
import { DouyinResult } from "./douyin-result";
import { WechatResult } from "./wechat-result";
import { WeiboResult } from "./weibo-result";
import { safeExternalUrl } from "./platform-types";
import { platformLabels } from "./platform-labels";
import { PrivateAssetView } from "./private-asset";
import { operationFileAsset } from "./asset-data";
import type { ImageOptions } from "./image-types";
import type { OperationResult } from "./operation-types";
import { MODE_LABEL } from "./labels";
import { mpLibrary, mpLibraryLabel } from "./operation-switch-data";
import { Button, Empty, Field, Json, ReasonDialog, Select } from "./ui";
const resultLabels: Record<string, string> = { account: "账号", article: "文章", page: "分页摘要", filtered: "已过滤", control: "处理记录", image: "生成图片", image_reference: "参考图片", image_task: "生成进度记录" };
const filterReasons: Record<string, string> = { reply: "回复内容已按配置排除" };
export interface BindingSource { id: string; name: string; participation_mode: string }
interface ResultProps { result: OperationResult; bindingSources?: BindingSource[]; imageOptions?: ImageOptions | null }
/** Route list item preserves stable result fragments without duplicating existing parent/child IDs. */
export function OperationResultItem(props: ResultProps) {
  const r = props.result;
  const ownAnchor = r.kind === "result_attachment" || isTranscriptionResult(r.kind, r.data) || isMediaToolResult(r.kind, r.data);
  return <div id={ownAnchor ? undefined : `result-${r.id}`} className="min-w-0 [&>article:last-child]:border-b [&>article:last-child]:pb-4 [&:last-child>article:last-child]:border-0 [&:last-child>article:last-child]:pb-0"><OperationResultView {...props} /></div>;
}
export function OperationResultView(props: ResultProps) {
  if (props.result.kind === "result_expired") {
    const r = props.result;
    return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
      <p className="text-[14px] font-medium">结果内容已过期</p>
      <ResearchFacts items={[["原结果类型", researchFactText(r.data.originalKind)], ["实际过期时间", researchFactText(r.data.expiredAt)]]} />
      <p className="text-[13px] text-ink-3">本行仅保留本地元数据与溯源，不能导入或下载，也不会自动重新购买。原任务状态、回执与成本仍在原位置保留。</p>
      <p className="text-[12px] text-ink-3">如需新的查询，请到<Link className="text-accent" to="/admin/redfox?view=platforms">平台查询入口</Link>显式选择条件并提交；会按当前预算与费用规则执行。</p>
      <Json value={{ resultId: r.id, receiptId: r.receiptId, originalKind: r.data.originalKind, expiredAt: r.data.expiredAt }} label="本地保留元数据" />
    </article>;
  }
  const collection = collectionPageSummary(props.result.kind, props.result.data);
  if (collection) return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <p className="text-[14px] font-medium">{platformLabels[String(props.result.data.platform)] ?? "平台"}采集页摘要</p>
    <ResearchFacts items={collection.rows} />
    {collection.window.length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">本轮冻结查询窗口</p><ResearchFacts items={collection.window} /></div>}
    <div className="space-y-2"><p className="text-[12px] text-ink-3">本页已收分页事实（returnedPage）</p>{collection.returned.length ? <ResearchFacts items={collection.returned} /> : <p className="text-[12px] text-ink-4">本页未记录分页字段。</p>}</div>
    <div className="space-y-2"><p className="text-[12px] text-ink-3">本页记录的下一页参数（nextParameters）</p>{collection.next.length ? <ResearchFacts items={collection.next} /> : <p className="text-[12px] text-ink-4">本页未记录下一页参数。</p>}</div>
    {collection.stop !== null && <ResearchFacts items={[["本页停止原因", collection.stop]]} />}
    <p className="text-[12px] text-ink-3">以上是本页采集与处理事实；后续执行以任务状态为准。作品候选与研究记录分别保留，具体文章 / 信源处理成功与归属请查看各条结果的实际关联。</p>
    <Json value={{ resultId: props.result.id, receiptId: props.result.receiptId, kind: props.result.kind, data: props.result.data }} label="采集页原始字段与溯源诊断" />
  </article>;
  if (isXDetailWork(props.result.kind, props.result.data)) return <XDetailResult result={props.result} />;
  if (props.result.kind === "result_attachment") return <ResultAttachment result={props.result} />;
  if (isXhsCommentResult(props.result.kind, props.result.data)) return <XhsCommentResult result={props.result} />;
  if (isVideoResult(props.result.kind, props.result.data)) return <VideoResult result={props.result} imageOptions={props.imageOptions ?? null} />;
  if (props.result.kind === "media_upload" && props.result.data.operationId === "6L178PZD") return <MediaUploadResult result={props.result} imageOptions={props.imageOptions ?? null} />;
  if (isAiSearchResult(props.result.kind, props.result.data)) return <AiSearchResult result={props.result} />;
  if (isMediaToolResult(props.result.kind, props.result.data)) return <MediaToolResult result={props.result} />;
  if (isTranscriptionResult(props.result.kind, props.result.data)) return <TranscriptionResult result={props.result} />;
  if (isSocialResearchResult(props.result.kind, props.result.data)) return <SocialResearchResult result={props.result} />;
  if (isServiceResearchResult(props.result.kind, props.result.data)) return <ServiceResearchResult result={props.result} />;
  if (isResearchResult(props.result.kind, props.result.data)) return <ResearchPlatformResult result={props.result} />;
  if (props.result.kind === "query_summary") {
    return props.result.data.platform === "toutiao" ? <ToutiaoQuerySummary result={props.result} /> : <QuerySummary result={props.result} />;
  }
  if (props.result.kind === "toutiao_work" || props.result.kind === "toutiao_account") return <ToutiaoResult result={props.result} />;
  if (props.result.kind === "shipinhao_work" || props.result.kind === "shipinhao_account") return <ShipinhaoResult result={props.result} />;
  if (props.result.kind === "kuaishou_work" || props.result.kind === "kuaishou_account") return <KuaishouResult result={props.result} />;
  if (props.result.kind === "instagram_work" || props.result.kind === "instagram_account") return <InstagramResult result={props.result} />;
  if (props.result.kind === "youtube_work") return <YoutubeResult result={props.result} />;
  if (props.result.kind.startsWith("bilibili_")) return <BilibiliResult result={props.result} />;
  if (props.result.kind.startsWith("tiktok_")) return <TiktokResult result={props.result} />;
  if (props.result.kind.startsWith("xiaohongshu_")) return <XiaohongshuResult result={props.result} />;
  if (props.result.kind.startsWith("douyin_")) return <DouyinResult result={props.result} />;
  if (props.result.kind.startsWith("wechat_")) return <WechatResult result={props.result} />;
  return props.result.kind.startsWith("weibo_") ? <WeiboResult result={props.result} /> : <StandardOperationResult {...props} />;
}
function StandardOperationResult({ result: r, bindingSources, imageOptions = null }: ResultProps) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const close = useCallback(() => setOpen(false), []);
  const count = r.data.count ?? r.data.found;
  const title = r.kind === "page"
    ? typeof count === "number" ? `${r.data.scope === "latest-first-page" ? "本页返回" : "本页处理"} ${count} 项` : "本页处理摘要"
    : r.kind === "filtered" ? "已过滤"
    : r.kind === "image_task" ? typeof r.data.status === "string" ? `${imageProviderStatuses[r.data.status] ?? "查询已记录"}${typeof r.data.progress === "number" ? ` · ${r.data.progress}%` : ""}` : "生成任务已提交"
    : (r.kind === "image" || r.kind === "image_reference") && r.file?.filename ? r.file.filename
    : String((r.articleId ? r.articleTitle : null) ?? r.data.title ?? r.data.displayName ?? r.data.username ?? r.data.tweetId ?? resultLabels[r.kind] ?? "处理结果");
  const filterReason = r.kind === "filtered" && typeof r.data.reason === "string" ? filterReasons[r.data.reason] ?? r.data.reason : null;
  const text = r.data.excerpt ?? r.data.text ?? r.data.content;
  const url = safeExternalUrl(r.data.url);
  const library = mpLibrary(r.data.library);
  return <article className="border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="font-medium">{title}</span><span className="text-ink-4">{resultLabels[r.kind] ?? "处理结果"}</span></div>
    {r.kind === "image_task" && <ResearchFacts items={imageParameterRows(r.data)} />}
    {(r.kind === "image" || r.kind === "image_reference") && <PrivateAssetView asset={operationFileAsset(r.file)} options={imageOptions} />}
    {library && <p className="mt-1 text-[12px] text-ink-3">采集库：{mpLibraryLabel[library]}{r.data.authorEvidence === "account-list-context" ? " · 作者依据：已核实账号的同库列表上下文" : ""}</p>}
    {r.kind === "page" && r.data.scope === "latest-first-page" && <p className="mt-1 text-[12px] text-ink-3">范围为最新第一页；本轮最多处理 {typeof r.data.limit === "number" ? r.data.limit : "—"} 条需要处理的材料，不表示已覆盖全部历史。</p>}
    {r.kind === "article" && r.data.bodyMissing === true && <p className="mt-1 text-[12px] text-amber">本次正文仍缺失；结果已保留，请以文章页的当前材料状态为准。</p>}
    {filterReason && <p className="mt-1 text-[13px] text-ink-3">{filterReason}</p>}
    {r.kind === "account" && <p className="mt-1 text-[13px] text-ink-3">@{String(r.data.username ?? "")} · 账号 ID {String(r.data.userId ?? "—")}</p>}
    {typeof text === "string" && <p className="mt-2 whitespace-pre-wrap text-[13px] text-ink-2">{text}</p>}
    <div className="my-2 flex flex-wrap gap-3 text-[13px]">
      {r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>查看已关联文章</Link>}
      {r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看信源</Link>}
      {url && <a className="text-accent" href={url} target="_blank" rel="noreferrer">原文 ↗</a>}
    </div>
    {bindingSources !== undefined && !r.sourceId && <div className="my-3 rounded-control bg-bg-sunk p-3 text-[13px]">
      <p className="mb-2 text-ink-3">仅绑定已存在且完整查询为此账号的 X 信源；保留该信源当前权限。绑定后请到信源页预检并显式切换采集器。</p>
      {bindingSources.length ? <div className="flex flex-wrap items-end gap-2"><div className="min-w-56 flex-1"><Field label="对应信源（显示当前参与方式）"><Select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">请选择信源</option>{bindingSources.map(s => <option key={s.id} value={s.id}>{s.name} · {MODE_LABEL[s.participation_mode] ?? s.participation_mode} · {s.id}</option>)}</Select></Field></div><Button disabled={!sourceId || !!pending} onClick={() => setOpen(true)}>绑定账号</Button></div> : <Empty>当前没有匹配的单账号信源。请先在信源页建立完整的 from:账号 查询，再刷新此页。</Empty>}
    </div>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, fileKey: r.fileKey, data: r.data }} label="结果字段与记录信息" />
    <ReasonDialog open={open} title="绑定账号到现有信源" description="服务端将核对完整单账号查询与稳定账号身份；绑定不会修改参与方式、公开权限，也不会自动切换采集器。" busy={!!pending} onClose={close} onSubmit={async reason => {
      if (!sourceId) return false;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { sourceId, reason }, { label: `bind:${r.id}`, success: "账号已绑定，可在信源页继续预检" }) !== null;
    }} />
  </article>;
}

function QuerySummary({ result: r }: { result: OperationResult }) {
  const platform = typeof r.data.platform === "string" ? platformLabels[r.data.platform] ?? "平台" : "平台";
  return <article className="space-y-2 border-b border-line pb-4 text-[13px] last:border-0"><div className="font-medium">{platform}{r.data.platform === "tiktok" || r.data.platform === "bilibili" || r.data.platform === "youtube" || r.data.platform === "instagram" || r.data.platform === "shipinhao" || r.data.platform === "kuaishou" ? "查询摘要" : "查询与采集摘要"}</div><p className="text-ink-3">返回 {typeof r.data.count === "number" ? r.data.count : "—"} 项{typeof r.data.selectedCount === "number" ? `，选取 ${r.data.selectedCount} 项` : ""}{typeof r.data.processedCount === "number" ? `，处理 ${r.data.processedCount} 项` : ""}。</p>{r.data.count === 0 && <p className="text-ink-3">此页没有结果，未创建文章。</p>}{(r.data.truncated === true || (typeof r.data.unprocessedDueToLimit === "number" && r.data.unprocessedDueToLimit > 0)) && <p className="text-amber">已达到本轮数量上限{typeof r.data.unprocessedDueToLimit === "number" ? `，有 ${r.data.unprocessedDueToLimit} 项未继续处理` : ""}；不能据此认为所有上游结果已覆盖。</p>}{r.data.platform === "tiktok" && <div className="space-y-1 break-words text-ink-3">{["cursor", "nextCursor"].map(key => (typeof r.data[key] === "string" || typeof r.data[key] === "number") ? <p key={key}>收到的 {key}：{String(r.data[key])}</p> : null)}<p>上游是否还有结果：{r.data.hasMore === 1 ? "有" : r.data.hasMore === 0 ? "无" : "未提供"}</p>{typeof r.data.cursorMapping === "string" && <p className="text-amber">{r.data.cursorMapping}</p>}<p>仅展示本次返回的分页事实，不自动发起下一页或将游标推算为 offset。</p></div>}{r.data.platform === "bilibili" && <div className="space-y-1 break-words text-ink-3">{([["page", "上游页码"], ["pageSize", "上游每页条数"], ["total", "上游总条数"]] as const).map(([key, label]) => <p key={key}>{label}：{typeof r.data[key] === "number" || typeof r.data[key] === "string" ? String(r.data[key]) : "未提供"}</p>)}<p>仅展示本次返回的分页事实，不自动翻页或采集全部历史。</p></div>}{r.data.platform === "youtube" && <div className="space-y-1 break-all text-ink-3">{([["query", "上游查询"], ["videoCount", "上游视频数"], ["estimatedResults", "上游估计结果数"], ["continuationToken", "上游 continuationToken"]] as const).map(([key, label]) => <p key={key}>{label}：{typeof r.data[key] === "number" || typeof r.data[key] === "string" ? r.data[key] === "" ? "空字符串" : String(r.data[key]) : "未提供"}</p>)}<p>空页不创建文章；仅保存本次查询结果，不自动发起下一页或导入。</p></div>}{r.data.platform === "instagram" && <div className="space-y-1 break-all text-ink-3"><p>上游 reportedCount：{typeof r.data.reportedCount === "number" ? r.data.reportedCount : "未提供"}（不据此推定总量或本次已处理数）</p><p>上游 paginationToken：<span className="whitespace-pre-wrap">{typeof r.data.paginationToken === "string" ? r.data.paginationToken === "" ? "空字符串" : r.data.paginationToken : "未提供"}</span></p><p>返回项数以上方本次实际 count 为准。空页不创建文章，不自动下一页或导入。</p></div>}{(r.data.platform === "shipinhao" || r.data.platform === "kuaishou") && <div className="space-y-1 break-words text-ink-3">{([["total", "上游 total"], ["page", "已收页码 page"], ["size", "已收页大小 size"], ["pageSize", "已收页大小 pageSize"]] as const).map(([key, label]) => typeof r.data[key] === "number" || typeof r.data[key] === "string" ? <p key={key}>{label}：{String(r.data[key])}</p> : null)}<p>本次实际返回数与上游 total 分别保留。仅展示已收分页字段，不据此推算 hasMore 或完整覆盖，不自动翻页。</p></div>}<Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data }} label="摘要与溯源诊断" /></article>;
}

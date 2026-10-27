import { researchFactText, researchObject } from "./research-platform-data";
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
import { Link } from "react-router";
import { isAgentKeyXResearch, isServiceResearchResult } from "./service-research-data";
import { ServiceResearchResult } from "./service-research-result";
import { isResearchResult } from "./research-platform-data";
import { ResearchPlatformResult } from "./research-platform-result";
import { ToutiaoResult, ToutiaoQuerySummary } from "./toutiao-result";
import { ShipinhaoResult } from "./shipinhao-result";
import { KuaishouResult } from "./kuaishou-result";
import { InstagramResult } from "./instagram-result";
import { YoutubeResult } from "./youtube-result";
import { BilibiliResearchResult, BilibiliResult } from "./bilibili-result";
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
import { mpLibrary, mpLibraryLabel } from "./operation-switch-data";
import { Json } from "./ui";
import { SubscriptionVideoResult } from "./subscription-video-result";
import { videoDownloadRunIds } from "./subscription-video-data";
import { XAccountBinding } from "./x-search-import";
const resultLabels: Record<string, string> = { search_suggestion: "搜索建议", account: "账号", article: "文章", page: "分页摘要", filtered: "已过滤", control: "处理记录", image: "生成图片", image_reference: "参考图片", image_task: "生成进度记录" };
const filterReasons: Record<string, string> = { reply: "回复内容已按配置排除" };
export interface BindingSource { id: string; name: string; participation_mode: string }
interface ResultProps { result: OperationResult; bindingSources?: BindingSource[]; imageOptions?: ImageOptions | null }
/** Route list item preserves stable result fragments without duplicating existing parent/child IDs. */
export function OperationResultItem(props: ResultProps) {
  const r = props.result;
  const ownAnchor = r.kind === "result_attachment" || isTranscriptionResult(r.kind, r.data) || isMediaToolResult(r.kind, r.data);
  return <div id={ownAnchor ? undefined : `result-${r.id}`} className="min-w-0 [&>article:last-child]:border-b [&>article:last-child]:pb-4 [&:last-child>article:last-child]:border-0 [&:last-child>article:last-child]:pb-0"><OperationResultView {...props} />{r.kind !== "result_expired" && videoDownloadRunIds(r).length > 0 && <div className="my-3 flex flex-wrap gap-3 text-[13px]">{videoDownloadRunIds(r).map(id => <Link key={id} className="text-accent" to={`/admin/operations/${id}`}>视频保存记录 #{id}</Link>)}</div>}</div>;
}
export function OperationResultView(props: ResultProps) {
  if (props.result.kind === "result_expired") {
    const r = props.result;
    return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
      <p className="text-[14px] font-medium">结果内容已过期</p>
      <ResearchFacts items={[["原结果类型", researchFactText(r.data.originalKind)], ["实际过期时间", researchFactText(r.data.expiredAt)]]} />
      <p className="text-[13px] text-ink-3">本行仅保留本地元数据与溯源，不能导入或下载，也不会自动重新购买。原执行状态、回执与成本仍在原位置保留。</p>
      <p className="text-[12px] text-ink-3">如需新的查询，请到<Link className="text-accent" to="/admin/data-tools?view=platforms">平台查询入口</Link>显式选择条件并提交；会按当前预算与费用规则执行。</p>
      <Json value={{ resultId: r.id, receiptId: r.receiptId, originalKind: r.data.originalKind, expiredAt: r.data.expiredAt }} label="本地保留元数据" />
    </article>;
  }
  if (["subscription_video", "subscription_video_parse", "subscription_video_summary"].includes(props.result.kind)) return <SubscriptionVideoResult result={props.result} />;
  if (isAgentKeyXResearch(props.result.data) && isServiceResearchResult(props.result.kind, props.result.data)) return <ServiceResearchResult result={props.result} bindingSources={props.bindingSources} />;
  if (props.result.data.provider === "agentkey" && props.result.data.platform === "bilibili" && (props.result.kind === "bilibili_dynamic" || props.result.kind === "query_summary" && props.result.data.operationId === "bilibili.relation_stats")) return <BilibiliResearchResult result={props.result} />;
  const collection = collectionPageSummary(props.result.kind, props.result.data);
  if (collection) return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <p className="text-[14px] font-medium">{platformLabels[String(props.result.data.platform)] ?? "平台"}采集页摘要</p>
    <ResearchFacts items={collection.rows} />
    {collection.window.length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">本轮冻结查询窗口</p><ResearchFacts items={collection.window} /></div>}
    <div className="space-y-2"><p className="text-[12px] text-ink-3">本页已收分页事实（returnedPage）</p>{collection.returned.length ? <ResearchFacts items={collection.returned} /> : <p className="text-[12px] text-ink-4">本页未记录分页字段。</p>}</div>
    <div className="space-y-2"><p className="text-[12px] text-ink-3">本页记录的下一页参数（nextParameters）</p>{collection.next.length ? <ResearchFacts items={collection.next} /> : <p className="text-[12px] text-ink-4">本页未记录下一页参数。</p>}</div>
    {collection.stop !== null && <ResearchFacts items={[["本页停止原因", collection.stop]]} />}
    {props.result.data.provider === "agentkey" && props.result.data.operationId === "douyin.following" && props.result.data.bootstrap === true && <p className="text-[12px] text-ink-3">本次是关注初始化空页，不能据此判断没有关注或已到末页；本轮不自动请求第二次。</p>}
    <p className="text-[12px] text-ink-3">以上是本页采集与处理事实；后续执行以本轮执行状态为准。作品候选与研究记录分别保留，具体文章 / 信源处理成功与归属请查看各条结果的实际关联。</p>
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
  if (isServiceResearchResult(props.result.kind, props.result.data)) return <ServiceResearchResult result={props.result} bindingSources={props.bindingSources} />;
  if (isResearchResult(props.result.kind, props.result.data)) return <ResearchPlatformResult result={props.result} />;
  if (props.result.kind === "query_summary" && props.result.data.provider === "agentkey" && props.result.data.platform === "weibo") return <WeiboResult result={props.result} />;
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
    {r.kind === "search_suggestion" && <p className="mt-1 text-[13px] text-ink-3">这是关键词联想建议，仅供研究，不作为文章导入或自动创建采集订阅。</p>}
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
    <XAccountBinding result={r} bindingSources={bindingSources} />
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, fileKey: r.fileKey, data: r.data }} label="结果字段与记录信息" />

  </article>;
}

function QuerySummary({ result: r }: { result: OperationResult }) {
  const platform = typeof r.data.platform === "string" ? platformLabels[r.data.platform] ?? "平台" : "平台";
  if (r.data.provider === "agentkey" && r.data.operationId === "XUT4CECZ" && r.data.accountState === "deleted") return <article className="space-y-2 border-b border-line pb-4 text-[13px] last:border-0"><p className="font-medium">抖音账号注销状态</p><p>{typeof r.data.displayName === "string" ? r.data.displayName : "已注销账号"}</p><p className="text-amber">账号已注销 / 删除；本次未返回可用的正常账号资料，不能绑定信源、导入文章或创建采集订阅。</p><Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data }} label="状态与溯源诊断" /></article>;
  const bootstrap = r.data.provider === "agentkey" && r.data.operationId === "douyin.following" && r.data.bootstrap === true;
  const biliPagination = researchObject(r.data.pagination);
  const biliPagingRows: Array<[string, string]> = [];
  if (r.data.platform === "bilibili" && r.data.provider === "agentkey") {
    for (const [key, label] of [["page", "上游页码"], ["pages", "上游总页数"], ["next", "收到的下一页值"], ["prev", "收到的上一页值"], ["is_begin", "游标是否起始"], ["is_end", "游标是否结束"], ["offset", "收到的动态偏移"], ["has_more", "上游是否还有动态"], ["total", "上游动态总数"], ["lastReceivedIdx", "最后实收推荐索引（非排名）"]] as const) {
      if (Object.hasOwn(biliPagination, key)) biliPagingRows.push([`${label} · pagination.${key}`, researchFactText(biliPagination[key])]);
    }
    const reply = researchObject(biliPagination.pagination_reply);
    if (Object.hasOwn(reply, "next_offset")) biliPagingRows.push(["评论下一偏移 · pagination.pagination_reply.next_offset", researchFactText(reply.next_offset)]);
    if (Object.hasOwn(r.data, "accountTotal")) biliPagingRows.push(["账号作品总数 · accountTotal（非本次返回数）", researchFactText(r.data.accountTotal)]);
  }
  return <article className="space-y-2 border-b border-line pb-4 text-[13px] last:border-0"><div className="font-medium">{platform}{r.data.stopReason === "single-request" || r.data.platform === "tiktok" || r.data.platform === "bilibili" || r.data.platform === "youtube" || r.data.platform === "instagram" || r.data.platform === "shipinhao" || r.data.platform === "kuaishou" ? "查询摘要" : "查询与采集摘要"}</div><p className="text-ink-3">返回 {typeof r.data.count === "number" ? r.data.count : "—"} 项{typeof r.data.selectedCount === "number" ? `，选取 ${r.data.selectedCount} 项` : ""}{typeof r.data.processedCount === "number" ? `，处理 ${r.data.processedCount} 项` : ""}。</p>{bootstrap ? <p className="text-ink-3">本次是关注初始化空页，未返回成员；不能据此判断没有关注或已到末页，不自动发起第二次请求。</p> : r.data.count === 0 && <p className="text-ink-3">此页没有结果，未创建文章。</p>}{(r.data.truncated === true || (typeof r.data.unprocessedDueToLimit === "number" && r.data.unprocessedDueToLimit > 0)) && <p className="text-amber">已达到本轮数量上限{typeof r.data.unprocessedDueToLimit === "number" ? `，有 ${r.data.unprocessedDueToLimit} 项未继续处理` : ""}；不能据此认为所有上游结果已覆盖。</p>}{r.data.platform === "tiktok" && <div className="space-y-1 break-words text-ink-3">{["cursor", "nextCursor"].map(key => (typeof r.data[key] === "string" || typeof r.data[key] === "number") ? <p key={key}>收到的 {key}：{String(r.data[key])}</p> : null)}<p>上游是否还有结果：{r.data.hasMore === 1 ? "有" : r.data.hasMore === 0 ? "无" : "未提供"}</p>{typeof r.data.cursorMapping === "string" && <p className="text-amber">{r.data.cursorMapping}</p>}<p>仅展示本次返回的分页事实，不自动发起下一页或将游标推算为 offset。</p></div>}{r.data.platform === "bilibili" && <div className="space-y-1 break-words text-ink-3">{r.data.provider === "agentkey" ? biliPagingRows.length > 0 ? <ResearchFacts items={biliPagingRows} /> : <p>本次未提供分页或账号总量字段。</p> : ([["page", "上游页码"], ["pageSize", "上游每页条数"], ["total", "上游总条数"]] as const).map(([key, label]) => <p key={key}>{label}：{typeof r.data[key] === "number" || typeof r.data[key] === "string" ? String(r.data[key]) : "未提供"}</p>)}<p>仅展示本次返回的分页事实，不自动翻页或采集全部历史。</p></div>}{r.data.platform === "youtube" && <div className="space-y-1 break-all text-ink-3">{([["query", "上游查询"], ["videoCount", "上游视频数"], ["estimatedResults", "上游估计结果数"], ["continuationToken", "上游 continuationToken"]] as const).map(([key, label]) => <p key={key}>{label}：{typeof r.data[key] === "number" || typeof r.data[key] === "string" ? r.data[key] === "" ? "空字符串" : String(r.data[key]) : "未提供"}</p>)}<p>空页不创建文章；仅保存本次查询结果，不自动发起下一页或导入。</p></div>}{r.data.platform === "instagram" && <div className="space-y-1 break-all text-ink-3"><p>上游 reportedCount：{typeof r.data.reportedCount === "number" ? r.data.reportedCount : "未提供"}（不据此推定总量或本次已处理数）</p><p>上游 paginationToken：<span className="whitespace-pre-wrap">{typeof r.data.paginationToken === "string" ? r.data.paginationToken === "" ? "空字符串" : r.data.paginationToken : "未提供"}</span></p><p>返回项数以上方本次实际 count 为准。空页不创建文章，不自动下一页或导入。</p></div>}{(r.data.platform === "shipinhao" || r.data.platform === "kuaishou") && <div className="space-y-1 break-words text-ink-3">{([["total", "上游 total"], ["page", "已收页码 page"], ["size", "已收页大小 size"], ["pageSize", "已收页大小 pageSize"]] as const).map(([key, label]) => typeof r.data[key] === "number" || typeof r.data[key] === "string" ? <p key={key}>{label}：{String(r.data[key])}</p> : null)}<p>本次实际返回数与上游 total 分别保留。仅展示已收分页字段，不据此推算 hasMore 或完整覆盖，不自动翻页。</p></div>}<Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data }} label="摘要与溯源诊断" /></article>;
}

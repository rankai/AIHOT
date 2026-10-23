import { collectionSubscriptionsHref } from "../../features/admin/collection-subscription-data";
import { RedfoxCosts } from "../../features/admin/redfox-costs";
import { redfoxCostDefaults } from "../../features/admin/redfox-cost-data";
import { XhsCommentForm } from "../../features/admin/xhs-comment-form";
import type { XhsCommentOptions } from "../../features/admin/xhs-comment-types";
import { VideoForm } from "../../features/admin/video-form";
import type { VideoOptions } from "../../features/admin/video-types";
import { AiSearchForm } from "../../features/admin/ai-search-form";
import type { AiSearchOptions } from "../../features/admin/ai-search-types";
import type { MediaUploadOptions } from "../../features/admin/media-upload-data";
import { AssetLibrary } from "../../features/admin/asset-library";
import { mergeAssetRows } from "../../features/admin/asset-data";
import type { AssetUploadOptions } from "../../features/admin/asset-types";
import { MediaToolForm } from "../../features/admin/media-tool-form";
import { TranscriptionForm } from "../../features/admin/transcription-form";
import type { TranscriptionOptions } from "../../features/admin/transcription-types";
import { SITE } from "@aihot/industry/site";
import { useCallback, useState } from "react";
import { redirect, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/redfox";
import { adminGet } from "../../lib/admin.server";
import { PlatformQuery } from "../../features/admin/platform-query";
import type { PlatformOperation } from "../../features/admin/platform-types";
import { ImageForm } from "../../features/admin/image-form";
import type { AssetPage, ImageOptions, PrivateAsset } from "../../features/admin/image-types";
import { useAdminAction } from "../../features/admin/action";
import type { OperationAccepted } from "../../features/admin/operation-types";
import { AdminPage, Button, ButtonLink, Card, Field, Input, Select } from "../../features/admin/ui";
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (url.pathname === "/admin/redfox") return redirect(`/admin/data-tools${url.search}`, 308);
  if (url.searchParams.get("view") === "subscriptions") return redirect(collectionSubscriptionsHref(Number(url.searchParams.get("subscription")) || null));
  const costInterval = redfoxCostDefaults(new Date());
  const after = url.searchParams.get("after");
  const key = url.searchParams.get("reference");
  const [options, assets, reference, operations, transcriptionOptions, assetUploadOptions, aiSearchOptions, supplierUploadOptions, videoOptions, xhsCommentOptions] = await Promise.all([
    adminGet<ImageOptions>(request, "/api/admin/redfox/images/options"),
    adminGet<AssetPage>(request, `/api/admin/assets${after ? `?after=${encodeURIComponent(after)}` : ""}`),
    key ? adminGet<PrivateAsset>(request, `/api/admin/assets/${encodeURIComponent(key)}`).then(asset => ({ asset, error: null })).catch(() => ({ asset: null, error: "无法读取此参考素材，可能已删除或暂不可用。" })) : Promise.resolve({ asset: null, error: null }),
    adminGet<PlatformOperation[]>(request, "/api/admin/redfox/operations"),
    adminGet<TranscriptionOptions>(request, "/api/admin/redfox/transcriptions/options"),
    adminGet<AssetUploadOptions>(request, "/api/admin/assets/options"),
    adminGet<AiSearchOptions>(request, "/api/admin/redfox/ai-searches/options"),
    adminGet<MediaUploadOptions>(request, "/api/admin/redfox/media/uploads/options"),
    adminGet<VideoOptions>(request, "/api/admin/redfox/videos/options"),
    adminGet<XhsCommentOptions>(request, "/api/admin/redfox/xiaohongshu/comments/options"),
  ]);
  return { costInterval, xhsCommentOptions, xhsCommentTaskId: url.searchParams.get("xhsCommentTaskId") ?? "", videoOptions, videoTaskId: url.searchParams.get("videoTaskId") ?? "", imageModel: url.searchParams.get("imageModel") ?? "gptImage2", referenceUploadResult: url.searchParams.get("referenceUploadResult") ?? "", aiSearchOptions, supplierUploadOptions, aiSearchFamily: url.searchParams.get("aiSearchFamily") ?? "", aiSearchTaskId: url.searchParams.get("aiSearchTaskId") ?? "", options, assets, operations, transcriptionOptions, assetUploadOptions, transcriptionTaskId: url.searchParams.get("transcriptionTaskId") ?? "", transcriptionPlatform: url.searchParams.get("transcriptionPlatform") ?? "", reference: reference.asset, referenceError: reference.error, initialView: url.searchParams.get("view") === "costs" ? "costs" : url.searchParams.get("view") === "videos" ? "videos" : url.searchParams.get("view") === "ai-search" ? "ai-search" : url.searchParams.get("view") === "assets" ? "assets" : url.searchParams.get("view") === "tools" ? "tools" : url.searchParams.get("view") === "platforms" ? "platforms" : url.searchParams.get("view") === "images" || key || url.searchParams.has("taskId") ? "images" : "x", taskId: url.searchParams.get("taskId") ?? "" };
}
export const meta: Route.MetaFunction = () => [{ title: `数据工具 · ${SITE.name} 后台` }];
export default function Redfox({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedView = searchParams.get("view");
  const view = selectedView && ["x", "platforms", "ai-search", "images", "videos", "tools", "assets", "costs"].includes(selectedView) ? selectedView : loaderData.initialView;
  const setView = (next: string) => setSearchParams(previous => { const params = new URLSearchParams(previous); params.set("view", next); return params; }, { preventScrollReset: true });
  const [assetUpdates, setAssetUpdates] = useState<PrivateAsset[]>([]);
  const onAssetChange = useCallback((asset: PrivateAsset) => setAssetUpdates(previous => mergeAssetRows(previous, [asset])), []);
  const navigate = useNavigate();
  const { run, pending } = useAdminAction();
  const [accountType, setAccountType] = useState<"screenName" | "restId">("screenName");
  const [account, setAccount] = useState("");
  const [tweetId, setTweetId] = useState("");
  return <AdminPage title="数据工具" subtitle="查询与创作提交后会自动进入对应执行记录，查看进度与结果；本地素材上传后在私有素材库查看。费用受现有预算控制。定时采集在采集订阅中配置，已有信源的主订阅与公开权限仍在信源详情管理。" actions={<><ButtonLink tone="primary" to="/admin/operations">进度与结果</ButtonLink><ButtonLink to={collectionSubscriptionsHref()}>采集订阅</ButtonLink></>}>
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="数据工具工作区">{[["x", "X 查询"], ["platforms", "平台查询"], ["ai-search", "AI 搜索"], ["images", "图片创作"], ["videos", "视频创作"], ["tools", "辅助工具"], ["assets", "私有素材"], ["costs", "费用与账单"]].map(([key, label]) => <Button key={key} tone={view === key ? "primary" : "secondary"} aria-pressed={view === key} onClick={() => setView(key)}>{label}</Button>)}</div>
    <div hidden={view !== "costs"}><div className="mb-4 flex flex-wrap gap-2"><ButtonLink to="/admin/settings">预算设置</ButtonLink><ButtonLink to="/admin/runs">运行与回执</ButtonLink></div><RedfoxCosts initialInterval={loaderData.costInterval} /></div>
    <div hidden={view !== "ai-search"}><AiSearchForm options={loaderData.aiSearchOptions} initialFamily={loaderData.aiSearchFamily} initialTaskId={loaderData.aiSearchTaskId} /></div>
    <div hidden={view !== "assets"}><AssetLibrary supplierUploadOptions={loaderData.supplierUploadOptions} initialPage={loaderData.assets} uploadOptions={loaderData.assetUploadOptions} imageOptions={loaderData.options} updates={assetUpdates} onAssetChange={onAssetChange} /></div>
    <div hidden={view !== "tools"}><div className="grid gap-5 xl:grid-cols-2"><div className="min-w-0"><TranscriptionForm options={loaderData.transcriptionOptions} initialTaskId={loaderData.transcriptionTaskId} initialPlatform={loaderData.transcriptionPlatform} /></div><div className="min-w-0"><MediaToolForm operations={loaderData.operations} /></div><div className="min-w-0 xl:col-span-2"><XhsCommentForm options={loaderData.xhsCommentOptions} initialTaskId={loaderData.xhsCommentTaskId} /></div></div></div>
    <div hidden={view !== "platforms"}><PlatformQuery operations={loaderData.operations.filter(operation => operation.platform !== "tools")} /></div>
    <div hidden={view !== "videos"}><VideoForm options={loaderData.videoOptions} imageOptions={loaderData.options} assets={loaderData.assets} uploadOptions={loaderData.assetUploadOptions} updates={assetUpdates} onAssetChange={onAssetChange} reference={loaderData.initialView === "videos" ? loaderData.reference : null} referenceError={loaderData.initialView === "videos" ? loaderData.referenceError : null} initialUploadResult={loaderData.initialView === "videos" ? loaderData.referenceUploadResult : ""} initialTaskId={loaderData.videoTaskId} /></div>
    <div hidden={view !== "images"}><ImageForm initialModel={loaderData.imageModel} initialReferenceUploadResult={loaderData.initialView === "images" ? loaderData.referenceUploadResult : ""} uploadOptions={loaderData.assetUploadOptions} assetUpdates={assetUpdates} onAssetChange={onAssetChange} options={loaderData.options} assets={loaderData.assets} reference={loaderData.initialView === "images" ? loaderData.reference : null} referenceError={loaderData.initialView === "images" ? loaderData.referenceError : null} initialTaskId={loaderData.taskId} /></div>
    <div hidden={view !== "x"}><div className="grid gap-5 lg:grid-cols-2">
      <Card title="X 账号查询"><form className="space-y-4" onSubmit={async e => { e.preventDefault(); const result = await run<OperationAccepted>("POST", "/api/admin/redfox/x/accounts/query", { [accountType]: account.trim() }, { label: "account", revalidate: false }); if (result) navigate(`/admin/operations/${result.runId}`); }}>
        <Field label="账号标识类型" hint="账号名与稳定 ID 二选一"><Select value={accountType} onChange={e => { setAccountType(e.target.value as typeof accountType); setAccount(""); }}><option value="screenName">账号名（不含 @）</option><option value="restId">稳定账号 ID（数字）</option></Select></Field>
        <Field label={accountType === "screenName" ? "账号名" : "稳定账号 ID"}><Input required value={account} onChange={e => setAccount(e.target.value)} pattern={accountType === "screenName" ? "[A-Za-z0-9_]{1,15}" : "[0-9]{1,30}"} maxLength={accountType === "screenName" ? 15 : 30} placeholder={accountType === "screenName" ? "OpenAI" : "数字 ID"} /></Field>
        <p className="text-[12.5px] text-ink-3">结果可显式绑定到对应的已有 X 信源，保留原权限，再由信源页预检切换。</p><Button type="submit" tone="primary" disabled={!!pending || !account.trim()} busy={pending === "account"}>查询账号</Button>
      </form></Card>
      <Card title="X 推文详情查询"><form className="space-y-4" onSubmit={async e => { e.preventDefault(); const result = await run<OperationAccepted>("POST", "/api/admin/redfox/x/tweets/query", { tweetId: tweetId.trim() }, { label: "tweet", revalidate: false }); if (result) navigate(`/admin/operations/${result.runId}`); }}>
        <Field label="推文 ID" hint="只填数字 ID，保留完整精度"><Input required value={tweetId} onChange={e => setTweetId(e.target.value)} pattern="[0-9]{1,30}" maxLength={30} placeholder="推文数字 ID" /></Field>
        <p className="text-[12.5px] text-ink-3">查询结果保存在执行记录中；已关联文章可直接查看。此入口不会自动授予发布权限。</p><Button type="submit" tone="primary" disabled={!!pending || !tweetId.trim()} busy={pending === "tweet"}>查询详情</Button>
      </form></Card>
    </div></div>
  </AdminPage>;
}

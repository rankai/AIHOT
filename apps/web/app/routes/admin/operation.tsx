import { agentKeyXAccountUsername } from "../../features/admin/x-search-import-data";
import { WorkResultSelection } from "../../features/admin/work-result-selection";
import { collectionSubscriptionsHref, isCollectionOperationKey } from "../../features/admin/collection-subscription-data";
import { isXhsCommentOperation, xhsCommentEmptyMessage } from "../../features/admin/xhs-comment-data";
import { XhsCommentProgress } from "../../features/admin/xhs-comment-progress";
import { isVideoOperation } from "../../features/admin/video-data";
import { VideoProgress } from "../../features/admin/video-progress";
import { AiSearchProgress } from "../../features/admin/ai-search-progress";
import { isAiSearchOperation, isAiSearchResult } from "../../features/admin/ai-search-data";
import { isTranscriptionOperation, isTranscriptionResult } from "../../features/admin/transcription-data";
import { TranscriptionProgress } from "../../features/admin/transcription-progress";
import { socialResearchPlatform } from "../../features/admin/social-research-data";
import { SITE } from "@aihot/industry/site";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/operation";
import { adminGet } from "../../lib/admin.server";
import type { ExternalCandidates } from "../../features/admin/weibo-result";
import { ImageProgress } from "../../features/admin/image-progress";
import type { ImageOptions } from "../../features/admin/image-types";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Button, ButtonLink, Card, DataTable, Empty, Json, KV, ReasonDialog, Time } from "../../features/admin/ui";
import { OperationResultItem, type BindingSource } from "../../features/admin/operation-result";
import { operationAction, operationLabel, operationEnded, type OperationDetail, type OperationResult } from "../../features/admin/operation-types";
import { mpCollectionCost, mpLibrary, mpLibraryLabel } from "../../features/admin/operation-switch-data";
import { OperationBadge, useOperationPolling } from "../../features/admin/operation-ui";
import { platformLabels } from "../../features/admin/platform-labels";
export async function loader({ request, params }: Route.LoaderArgs) {
  const base = `/api/admin/operations/runs/${encodeURIComponent(params.id)}`;
  const cursor = new URL(request.url).searchParams.get("cursor");
  const [detail, page] = await Promise.all([
    adminGet<OperationDetail>(request, base),
    cursor && /^\d+$/.test(cursor)
      ? adminGet<{ results: OperationResult[]; nextCursor: number | null }>(request, `${base}/results?cursor=${cursor}&limit=100`)
      : Promise.resolve(null),
  ]);
  const run = page ? { ...detail, results: page.results, nextResultCursor: page.nextCursor } : detail;
  const redfoxAccount = run.provider === "redfox" && run.operationKey === "redfox.x.account";
  const agentkeyAccount = run.provider === "agentkey" && run.operationKey === "agentkey.x.account_profile";
  const accounts = run.results.filter(r => r.kind === "account" && !r.sourceId && (redfoxAccount || agentkeyAccount && agentKeyXAccountUsername(r.kind, r.data)));
  const bindingSources: Record<string, BindingSource[]> = {};
  await Promise.all(accounts.map(async result => {
    const username = agentkeyAccount ? agentKeyXAccountUsername(result.kind, result.data) ?? "" : typeof result.data.username === "string" ? result.data.username : "";
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return;
    const list = await adminGet<{ rows: BindingSource[] }>(request, `/api/admin/sources?${new URLSearchParams({ kind: "x_search", q: username })}`);
    const details = await Promise.all(list.rows.map(s => adminGet<{ source: BindingSource & { config: Record<string, unknown> } }>(request, `/api/admin/sources/${encodeURIComponent(s.id)}`)));
    bindingSources[String(result.id)] = details.flatMap(({ source }) => {
      const query = source.config.query;
      const match = typeof query === "string" ? /^from:([A-Za-z0-9_]{1,15})(?:\s+(-filter:replies))?$/i.exec(query.trim()) : null;
      return match?.[1]?.toLowerCase() === username.toLowerCase() ? [{ id: source.id, name: source.name, participation_mode: source.participation_mode }] : [];
    });
  }));
  const imageOptions = (run.operationKey.startsWith("redfox.image.") || run.operationKey === "redfox.media.upload" || isVideoOperation(run.operationKey)) ? await adminGet<ImageOptions>(request, "/api/admin/redfox/images/options") : null;
  const url = new URL(request.url);
  const externalQ = url.searchParams.get("externalQ")?.trim();
  const externalPage = Math.max(1, Number(url.searchParams.get("externalPage")) || 1);
  const candidateKind = url.searchParams.get("candidateKind") === "mp_account" ? "mp_account" : "external";
  const externalCandidates = externalQ ? await adminGet<ExternalCandidates>(request, `/api/admin/sources?${new URLSearchParams({ kind: candidateKind, q: externalQ, page: String(externalPage) })}`) : null;
  return { ...run, bindingSources, imageOptions, externalCandidates, resultCursor: page ? cursor! : "0" };
}
export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `执行记录 #${loaderData?.id ?? ""} · ${SITE.name} 后台` }];
export default function Operation({ loaderData: r }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const [command, setCommand] = useState<"resume" | "stop" | "abandon" | null>(null);
  const close = useCallback(() => setCommand(null), []);
  const [showRecords, setShowRecords] = useState(false);
  const collectionTask = isCollectionOperationKey(r.operationKey, r.provider, r.inputs.mode);
  const xhsCommentTask = isXhsCommentOperation(r.operationKey);
  const videoTask = isVideoOperation(r.operationKey);
  const aiSearchTask = isAiSearchOperation(r.operationKey);
  const mediaUploadTask = r.operationKey === "redfox.media.upload";
  const imageTask = r.operationKey.startsWith("redfox.image.");
  const transcriptionTask = isTranscriptionOperation(r.operationKey);
  const mpCollection = r.operationKey === "redfox.wechat.collection";
  const mpSource = mpCollection ? r.inputs.sources?.[0] : undefined;
  const library = mpLibrary(mpSource?.config?.redfoxLibrary);
  const records = r.results.filter(result => xhsCommentTask && result.kind === "xhs_comment_task" || videoTask && ["video_task", "video_reference"].includes(result.kind) || ["image_task", "image_reference"].includes(result.kind) || transcriptionTask && result.kind === "transcription_task" && isTranscriptionResult(result.kind, result.data) || aiSearchTask && result.kind === "ai_search_task" && isAiSearchResult(result.kind, result.data));
  const recordIds = new Set(records.map(result => result.id));
  const primaryResults = r.results.filter(result => !recordIds.has(result.id));
  const invalidatedSubscription = collectionTask && r.status === "stopped" && r.waitReason === "Subscription execution configuration changed";
  const ended = operationEnded(r.status);
  const refresh = useOperationPolling(!ended && r.status !== "stopped" && command === null);
  const platform = r.inputs.platform ?? "";
  const platformLabel = platformLabels[platform];
  const socialQuery = socialResearchPlatform(r.inputs.operationId) === platform && !!socialResearchPlatform(r.inputs.operationId);
  const querySubtitle = platform === "tools" ? "工具查询" : socialQuery ? `${platformLabel ?? platform} 评论 / 关注研究` : platformLabel ? `${platformLabel}${platform === "youtube" ? " 视频查询" : platform === "instagram" ? " 查询" : platform === "shipinhao" || platform === "kuaishou" ? "查询" : platform === "tiktok" ? " 平台查询" : "平台查询"}` : "平台查询";
  return <AdminPage title={<span className="flex flex-wrap items-center gap-2">执行记录 #{r.id}<OperationBadge status={r.status} /></span>} subtitle={`${r.provider} · ${r.operationKey === "redfox.sync.query" ? querySubtitle : operationLabel[r.operationKey] ?? r.operationKey}`} actions={<><Button busy={refresh.state !== "idle"} onClick={() => refresh.revalidate()}>刷新</Button><ButtonLink to="/admin/operations">执行记录列表</ButtonLink></>}>
    <Card title="当前进度" className="mb-5">
      {collectionTask && <p className="mb-4 border-b border-line pb-4 text-[13px] text-ink-3">{platformLabel ?? platform}采集订阅 · {ended ? "本轮已结束，可查看结果" : r.step.endsWith(".page") ? "查询本页候选与研究记录" : r.step.endsWith(".detail") ? "补全已接通的必要详情" : "按真实身份处理作品或保留待核实结果"}。研究记录与作品候选分别保留，结果不表示全部已入库；权限不因订阅提高。</p>}
      {xhsCommentTask && <XhsCommentProgress operation={r} />}
      {videoTask && <VideoProgress operation={r} />}
      {aiSearchTask && <AiSearchProgress operation={r} />}
      {mediaUploadTask && <div className="mb-4 space-y-2 border-b border-line pb-4 text-[13px] text-ink-3"><p>{ended ? "本轮上传处理已结束，可查看已保存回执。" : "将本地私有素材上传到 Redfox；使用 media 次数预算。"}</p><p>停止只停止本地后续处理，不取消已发出的上传，也不保证退款。结果未知时需要人工核对，不自动重新上传。</p></div>}
      {(aiSearchTask || mediaUploadTask) && <Json value={r.inputs.parameters} label="冻结提交 / 查询参数" />}
      {imageTask && <ImageProgress operation={r} options={r.imageOptions} />}
      {transcriptionTask && <TranscriptionProgress operation={r} />}
      {mpCollection && <div className="mb-4 space-y-2 text-[13px] text-ink-3">
        <KV items={[["本轮选库", library ? mpLibraryLabel[library] : "冻结参数未提供"], ["当前步骤", ended ? "本轮已结束，可查看已保存结果" : r.step === "redfox.wechat.page" ? "读取所选库的最新第一页" : r.step === "redfox.wechat.detail" ? "补全同库必要正文并保存材料" : "等待当前步骤处理"], ["原采集周期", mpSource?.interval_minutes ? `${mpSource.interval_minutes} 分钟` : "查看信源配置"]]} />
        <p>文章列表 T+1；本轮只处理最新第一页中最多 8 条需要处理的材料，不自动跨库或失败回退。已知链接的实时详情不等于实时发现。</p>
        <p>{mpCollectionCost}</p><p>新增材料缺少可信时区或发表时间时按历史/回填语义处理，不把发现时间当作发表时间。{r.inputs.mode === "preview" ? "本轮为预览，不保存材料或推进主订阅。" : ""}</p>
      </div>}
      <KV items={[["固定工具 / 上游", [r.receipt?.model??r.inputs.tool,r.inputs.upstream].filter(Boolean).join(" · ")||"—"], ["等待 / 停止原因", r.waitReason || "—"], ["下一动作", invalidatedSubscription ? "返回订阅，按当前配置运行新轮次" : operationAction[r.nextAction] ?? r.nextAction], ["下次尝试", <Time at={r.nextAttemptAt} />], [r.currentReceiptId ? "当前回执" : r.receipt ? "最近已收回执" : "当前步骤回执", r.receipt ? <Link className="text-accent" to="/admin/runs">#{r.receiptId} · {r.receipt.status} · {r.receipt.attempts} 次尝试</Link> : "尚未创建"], ["创建", <Time at={r.createdAt} />]]} />
      {collectionTask && r.subscriptionId && <div className="my-3 text-[13px]"><Link className="text-accent" to={collectionSubscriptionsHref(r.subscriptionId)}>返回采集订阅 #{r.subscriptionId}</Link>{invalidatedSubscription && <p className="mt-2 text-amber">此轮因订阅执行配置变化已停止，旧响应保留；不能恢复成新配置。请回信源页的采集订阅视图按当前配置开启新轮次。</p>}</div>}
      {["weibo", "wechat", "douyin", "xiaohongshu", "tiktok", "bilibili", "youtube", "instagram", "toutiao", "qichezhijia", "dongchedi", "yiche", "baijiahao", "zhihu", "x-research", "hot-research", "redfox-account", "tools"].includes(r.inputs.platform ?? "") && <details className="my-3 rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">{platformLabel}{socialQuery ? "评论 / 关注研究" : "操作与查询"}参数</summary><div className="mt-2"><Json value={{ operationId: r.inputs.operationId, parameters: r.inputs.parameters }} label="冻结查询参数" /></div></details>}
      {r.inputs.sources?.length ? <div className="mt-3 flex flex-wrap gap-3 text-[13px]">{r.inputs.sources.map(s => r.inputs.draft ? <span key={s.id}>草稿 {s.id}（未保存）</span> : <Link key={s.id} className="text-accent" to={`/admin/sources/${encodeURIComponent(s.id)}`}>{s.name ?? s.id}</Link>)}</div> : null}
      {r.nextAction === "review-unknown" && <p className="mt-3 text-[13px] text-amber">供应商结果未知。请先到<Link className="text-accent" to="/admin/runs">运行页核对回执</Link>；重新发送可能再次计费。{imageTask && ["redfox.image.upload", "redfox.image.submit"].includes(r.step) ? "上传或生成提交不会通过通用放行自动重发，请按任务 ID 核对。" : ""}</p>}
      {!ended && <div className="mt-4 flex flex-wrap items-center gap-2">
        {["needs_review", "stopped"].includes(r.status) && <Button disabled={!!pending || !!r.inputs.recoveryUnavailable || invalidatedSubscription} onClick={() => setCommand("resume")}>恢复本轮执行</Button>}
        {r.status !== "stopped" && <Button disabled={!!pending} onClick={() => setCommand("stop")}>停止本轮执行</Button>}
        <Button tone="danger" disabled={!!pending} onClick={() => setCommand("abandon")}>放弃本轮</Button>
        {r.inputs.recoveryUnavailable && <span className="text-[12px] text-amber">旧请求输入已不可恢复，请核对回执或放弃本轮。</span>}
      </div>}
    </Card>
    <Card title="结果" className="mb-5" right={<div className="flex flex-wrap items-center justify-end gap-3"><span>本页 {r.results.length} 项</span><a data-testid="operation-results-export" className="text-accent text-[13px]" href={`/api/admin/operations/runs/${r.id}/results/export?cursor=${encodeURIComponent(r.resultCursor)}`} download>下载本页结果 JSON</a></div>}>
      <p className="mb-3 text-[12px] text-ink-3">下载范围为当前页；其余结果请翻页后下载。</p>
      <WorkResultSelection key={`${r.id}:${r.resultCursor}`} results={r.results} />
      {primaryResults.length ? <div className="space-y-4">{primaryResults.map(result => <OperationResultItem key={result.id} result={result} bindingSources={r.bindingSources[String(result.id)]} imageOptions={r.imageOptions} />)}</div> : <Empty>{xhsCommentTask ? xhsCommentEmptyMessage(r.results) : videoTask ? "本页还没有已保存视频或末帧。可查看上方进度、展开历史记录，或继续查看结果分页。" : aiSearchTask ? "本页还没有已保存答案或引用。可查看上方当前进度、展开提交与轮询历史，或继续查看结果分页。" : transcriptionTask ? "还没有已保存的完整转写文本。可查看上方当前进度或展开转写历史记录，刷新后续看。" : imageTask ? "还没有已保存到本地的图片。可查看上方进度或展开处理记录，刷新后续看。" : "还没有已保存结果。本轮执行后可刷新续看。"}</Empty>}
      {records.length > 0 && <details className="mt-4 rounded-control bg-bg-sunk/50 p-3 ring-1 ring-line" onToggle={e => setShowRecords(e.currentTarget.open)}><summary className="cursor-pointer text-[13px] text-ink-3">{xhsCommentTask ? "小红书评论提交与轮询记录（历史事实）" : videoTask ? "视频参考上传、提交与轮询记录（历史事实）" : aiSearchTask ? "AI 搜索提交与轮询记录（历史事实）" : transcriptionTask ? "转写提交与轮询记录（历史事实）" : "参考上传与生成查询记录"}（本页 {records.length} 项）</summary>{showRecords && <div className="mt-4 space-y-4">{(transcriptionTask || aiSearchTask || videoTask || xhsCommentTask ? records.toReversed() : records).map(result => <OperationResultItem key={result.id} result={result} imageOptions={r.imageOptions} />)}</div>}</details>}
      <div className="mt-4 flex gap-3 text-[13px]"><Link className="text-accent" to={`/admin/operations/${r.id}`}>首批结果</Link>{r.nextResultCursor !== null && <Link className="text-accent" to={`?cursor=${r.nextResultCursor}`}>下一批结果</Link>}</div>
    </Card>
    <details className="rounded-panel bg-surface p-4 ring-1 ring-line"><summary className="cursor-pointer text-[13px] text-ink-3">诊断：参数、执行版本与回执尝试</summary><div className="mt-4 space-y-3"><Json value={{ inputs: r.inputs, progress: r.progress, operationKey: r.operationKey, step: r.step, stepVersion: r.stepVersion, generation: r.generation, jobState: r.jobState }} label="执行详情" /><DataTable dense rows={r.attempts} rowKey={a => a.id} empty="尚无回执尝试" columns={[
      { key: "n", label: "尝试", render: a => a.attempt }, { key: "s", label: "状态", render: a => a.status }, { key: "at", label: "开始", render: a => <Time at={a.started_at} /> }, { key: "response", label: "响应已保留", render: a => a.has_retained_response ? "是" : "否" }, { key: "e", label: "错误", render: a => a.error ?? "—" },
    ]} /></div></details>
    <ReasonDialog open={command !== null} title={command === "stop" ? "停止本轮执行" : command === "abandon" ? "放弃本轮" : "恢复本轮执行"} description={command === "stop" ? collectionTask ? "停止本轮采集，保留恢复能力与订阅占用；已发请求仍可能完成和计费，不保证远端取消或退款。" : xhsCommentTask ? "停止本地后续查询，保留恢复能力；不会取消远端评论任务，也不保证退款。本轮期限仍从创建时起算，预算等待计入。" : videoTask ? "停止本地后续处理，保留恢复与本轮素材占用；不会取消远端视频生成或保证退款，已发请求仍可能完成和计费。" : aiSearchTask || mediaUploadTask ? "停止本地后续处理，保留本轮恢复能力；不会取消供应商已受理的搜索或上传，也不保证退款。已发请求仍可能完成和计费。" : imageTask ? "停止本地后续步骤，保留恢复能力与本轮参考素材占用；不会取消远端生成，已发请求仍可能完成和计费。" : transcriptionTask ? "停止本地后续处理与轮询，保留本轮恢复能力；不会取消供应商已受理的转写，也不保证退款。" : "停止后保留恢复能力与正式订阅占用。已发出的请求仍可能完成和计费。" : command === "abandon" ? collectionTask ? "放弃本轮将释放订阅占用，不能恢复该轮；已收结果保留，不会取消供应商已受理请求，也不保证退款。" : xhsCommentTask ? "放弃本轮将结束本地查询与恢复，不能恢复该轮；不会取消供应商评论任务，也不保证退款。任务 ID 和已收结果保留，可显式新建只查任务核对。" : videoTask ? "放弃本轮将结束本地恢复并释放本轮参考素材占用，不能恢复该轮；不会取消供应商已受理请求，也不保证退款。" : aiSearchTask || mediaUploadTask ? "放弃本轮将结束本地恢复，不能恢复该轮；如有本轮素材占用会释放。不会取消供应商已受理的请求，也不保证退款。" : imageTask ? "放弃本轮将结束本地恢复并释放本轮参考素材占用，不能恢复该轮；不会取消远端生成或已受理请求，也不保证退款。" : transcriptionTask ? "放弃本轮将结束本地轮询与恢复，不能恢复该轮；不会取消供应商转写，也不保证退款。" : "放弃本轮将释放正式订阅占用，不能恢复该轮；不会取消供应商已受理的请求，也不保证退款。" : collectionTask ? "按本轮原冻结配置恢复，优先处理已收响应；配置已失效的旧轮不能恢复成新配置，请返回订阅开启新轮。请求仍受 collect 次数预算控制。" : xhsCommentTask ? "按当前步骤恢复，优先处理已收响应；提交未知须人工核对，不自动重发。本轮期限不延长，到期请用保留的任务 ID 显式新建只查任务；查询请求仍计次数预算。" : videoTask ? "按当前视频步骤恢复，已收响应和保存步骤继续处理原任务，不重新生成；上传或提交未知时先人工核对。仍需下载时受模型与 Redfox 双阀控制，完整本地文件可继续登记。" : aiSearchTask || mediaUploadTask ? "按当前步骤恢复，优先处理已收响应。未知提交或上传必须先核对，恢复不会绕过该阻断重新发送；查询仍受冻结轮次、时限和预算约束。" : imageTask ? "按当前图片步骤恢复；已收响应和保存步骤继续处理原任务。上传或生成提交的未知回执须先人工核对，恢复不会绕过该阻断重新购买。" : transcriptionTask ? "按当前步骤恢复；已收响应优先本地处理，不重新提交已受理转写。提交未知时先核对回执；后续查询仍受轮询上限、时限及预算约束。" : "按当前步骤恢复。已有响应优先本地处理；如需重新请求，仍受预算和供应商计费规则约束。"} danger={command === "abandon"} busy={pending !== null} onClose={close} onSubmit={async reason => {
      if (!command) return false;
      return await run("POST", `/api/admin/operations/runs/${r.id}/${command}`, { stepVersion: r.stepVersion, generation: r.generation, reason }, { label: command, success: "执行状态已更新" }) !== null;
    }} ><Button size="sm" busy={refresh.state !== "idle"} disabled={!!pending} onClick={() => refresh.revalidate()}>刷新执行状态（保留原因）</Button></ReasonDialog>
  </AdminPage>;
}

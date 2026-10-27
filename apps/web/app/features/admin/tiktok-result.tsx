import { DetailQueryActions } from "./detail-query-actions";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { tiktokImportFields, tiktokImportSupplement, tiktokPublicationTime } from "./tiktok-result-data";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";
export function TiktokResult({ result }: { result: OperationResult }) {
  return result.kind === "tiktok_topic" ? <TiktokTopic result={result} /> : <TiktokIdentityResult result={result} />;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "未提供";
}
function TiktokTopic({ result: r }: { result: OperationResult }) {
  const record = object(r.data.record);
  const url = safeExternalUrl(r.data.url);
  const image = safeExternalUrl(record.profileImageUri);
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title)}</span><Badge>话题研究</Badge></div>
    <p className="text-[12.5px] text-ink-3">话题只作研究，不绑定账号或作为文章导入；可显式查询话题作品。</p>
    <KV items={[["话题 ID", text(record.topicId)], ["使用数", text(record.usageCount)], ["参与人数", text(record.participantCount)], ["浏览数", text(record.viewCount)]]} />
    {typeof record.description === "string" && <p className="whitespace-pre-wrap break-words text-[13px] text-ink-2">{record.description}</p>}
    <div className="flex flex-wrap gap-3 text-[12px]">{url && <a className="break-all text-accent" href={url} target="_blank" rel="noreferrer">上游话题链接 ↗</a>}{image && <a className="break-all text-accent" href={image} target="_blank" rel="noreferrer">上游话题图片 ↗</a>}</div>
    {Array.isArray(r.data.missing) && <ul className="space-y-1 text-[12px] text-ink-3">{r.data.missing.filter((item): item is string => typeof item === "string").map(item => <li key={item}>{item}</li>)}</ul>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, record }} label="话题字段与溯源诊断" />
  </article>;
}
function TiktokIdentityResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [identityType, setIdentityType] = useState<"userId" | "secUserId">("userId");
  const [identityValue, setIdentityValue] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = tiktokImportFields(r.kind, r.data, url);
  const record = r.data.record && typeof r.data.record === "object" && !Array.isArray(r.data.record) ? r.data.record as Record<string, unknown> : {};
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const author = fields.account ? record : object(record.authorData);
  const video = object(record.videoData);
  const body = record.content;
  const time = record.publishTime;
  const publishedTime = tiktokPublicationTime(time);
  const upstream = fields.receivedNative?.url ?? safeExternalUrl(fields.receivedUrl);
  const media = [...new Set([author.avatarImage, video.coverImage, video.originCoverImage, video.dynamicCoverImage, video.playAddress, video.downloadAddress, video.downloadNoMarkAddress].map(safeExternalUrl).filter((address): address is string => address !== null))];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external"); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const imported = !!r.sourceId || !!r.articleId;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{typeof r.data.title === "string" ? r.data.title : "TikTok 查询结果"}</span><Badge>{fields.account ? "TikTok 账号" : "TikTok 作品"}</Badge></div>
    <KV items={[["已收到作者 userId", fields.userId ?? "未提供"], ["已收到安全 ID（secUserId）", fields.secUserId ?? "未提供"], ["展示 handle", text(author.userHandle)], ["上游昵称", text(author.userName)], ...(fields.work ? [["已收到作品 ID", fields.workId ?? "未提供"], ["原生链接可确认作品 ID", fields.native?.id ?? "未确认"]] as Array<[string, string]> : [])]} />
    {fields.work && !fields.workId && fields.receivedNative && <p className="text-[12px] text-ink-3">接口未单列已确认作品 ID；本原生链接含作品 ID，可由服务端据此核实。handle 不用于推算作者身份。</p>}
    <p className="text-[12px] text-ink-4">userId 与 secUserId 分类型保留完整字符串；昵称与 handle 不证明稳定身份。作品按实际作者归属，不归被查询的收藏者。</p>
    {typeof author.userSignature === "string" && <p className="whitespace-pre-wrap break-words text-[12.5px] text-ink-3">账号简介：{author.userSignature}</p>}
    {typeof body === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p>}
    {(typeof time === "string" || typeof time === "number") && <p className="text-[12px] text-ink-3">上游发布时间（Unix 秒）：{String(time)}{publishedTime ? ` · ${publishedTime}（UTC）` : " · 未能确认有效时间"}</p>}
    {fields.work && <p className="text-[12px] text-ink-4">缺少有效秒时间时，不把发现时间当作发表时间或今天发生；新增材料按既有历史/回填语义处理。</p>}
    {upstream && <a className="inline-block break-all text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.receivedNative ? "原生作品原文" : "收到的上游地址（不作为入库原文）"} ↗</a>}
    {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((address, index) => <a key={address} className="break-all text-accent" href={address} target="_blank" rel="noreferrer">上游媒体或主页 {index + 1} ↗</a>)}</div>}
    {missing.length > 0 && <div><p className="mb-1 text-[12px] text-ink-4">上游缺项记录（导入仍由服务端据原文复核）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看作者绑定信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!fields.canImport || !!pending} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {!imported && fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须收到 userId 或 secUserId 才可绑定，不允许手补账号身份；请显式查询并核实稳定账号身份。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, identity: r.data.identity, record }} label="原始字段与溯源诊断" />
    <DetailQueryActions result={r} />
    <ReasonDialog open={open} title={fields.account ? "绑定 TikTok 账号身份" : "本地导入 TikTok 作品"} description={fields.account ? "仅使用已收到的稳定 userId 或 secUserId，按绑定复用，否则新建隔离 external 信源并关闭全文权限。可显式选择已核实为同一账号的 external 信源，不按昵称匹配。此命令不请求供应商。" : "作品按真实作者身份归属，不指定任意目标信源。收到的身份、作品 ID 和地址不可替换；只补缺失项并记录证据。人工作者身份不能继承已有非隔离权限，文章去重后保留原归属。此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (!fields.canImport) { setError(fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实"); return false; }
      if (fields.account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      const command = tiktokImportSupplement(fields, { url, identityType, identityValue, evidence });
      if (command.error) { setError(command.error); return false; }
      const supplement = command.supplement;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `tiktok-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      <KV items={[["已收到 userId", fields.userId ?? "未提供"], ["已收到安全 ID", fields.secUserId ?? "未提供"], ...(fields.work ? [["已收到作品 ID", fields.workId ?? "未提供"], ["已收到上游地址", fields.receivedUrl ?? "未提供"]] as Array<[string, string]> : [])]} />
      {fields.account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} disabled={!!pending} onChange={e => setTarget(e.target.value)}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>{target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="名称或 ID，人工核实同一账号" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", list.rows) ? e.target.value : "")}><option value="">请选择并核实</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{list.rows.length === 0 && <p className="text-[12px] text-ink-3">没有匹配候选，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {fields.needsUrl && <Field label="补充原生作品原文链接" hint={<span className="break-all">例如 https://www.tiktok.com/@account.name/video/1234567890123456789；短链、photo 地址与主页不接受。</span>}><Input aria-label="补充原生作品原文链接" type="url" required value={url} disabled={!!pending} onChange={e => setUrl(e.target.value)} /></Field>}
      {fields.needsIdentity && <><Field label="补充一种已核实作者身份"><Select aria-label="补充作者身份类型" value={identityType} disabled={!!pending} onChange={e => { setIdentityType(e.target.value as typeof identityType); setIdentityValue(""); }}><option value="userId">作者 userId</option><option value="secUserId">已确认安全 ID（secUserId）</option></Select></Field><Field label="已核实身份原串" hint="只填所选类型；不把昵称、handle 或被查询的收藏者当作实际作者身份。"><Input aria-label="已核实身份原串" required maxLength={500} value={identityValue} disabled={!!pending} onChange={e => setIdentityValue(e.target.value)} /></Field></>}
      {(fields.needsUrl || fields.needsIdentity) && <Field label="缺失字段的核实依据"><Textarea aria-label="缺失字段的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

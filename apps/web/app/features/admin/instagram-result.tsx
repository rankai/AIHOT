import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { MODE_LABEL } from "./labels";
import type { OperationAccepted, OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { instagramDetailRequest, instagramImportFields, instagramImportSupplement, instagramMediaLinks } from "./instagram-result-data";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = "未提供"): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}
export function InstagramResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const ownership = useWorkSource();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = instagramImportFields(r.kind, r.data, url);
  const record = object(r.data.record);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const author = fields.account ? record : object(record.user);
  const body = fields.account ? record.biography : record.captionText;
  const upstream = fields.receivedNative?.url ?? safeExternalUrl(fields.receivedUrl);
  const detailRequest = instagramDetailRequest(r.id, r.kind, r.data);
  const searchResult = fields.work && r.data.operationId === "GM0TISWI";
  const carousel = Array.isArray(record.carouselItems) ? record.carouselItems.map(object) : [];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external"); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const imported = !!r.sourceId || !!r.articleId;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title, "Instagram 查询结果")}</span><Badge>{fields.account ? "Instagram 账号" : "Instagram 作品"}</Badge></div>
    <KV items={[["已收用户 userId", fields.userId ?? "未提供"], ["用户名", text(author.username)], ["显示名称", text(author.fullName)], ...(fields.work ? [["已收帖子短码", fields.workId ?? "未提供"], ["mediaId", text(record.mediaId)], ["postId", text(record.postId)], ["mediaFormat", text(record.mediaFormat)], ["mediaType", text(record.mediaType)], ["productType", text(record.productType)]] as Array<[string, string]> : [])]} />
    <p className="text-[12px] text-ink-4">userId、帖子短码、mediaId/postId 和轮播子项 ID 各自保留完整字符串；用户名和显示名称只作定位展示，不证明作者身份。</p>
    {typeof body === "string" && <div><p className="mb-1 text-[12px] text-ink-3">{fields.account ? "账号简介" : "帖子正文（captionText）"}</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p></div>}
    {fields.work && typeof record.accessibilityCaption === "string" && <div><p className="mb-1 text-[12px] text-ink-3">辅助说明（accessibilityCaption）</p><p className="whitespace-pre-wrap break-words text-[13px] text-ink-2">{record.accessibilityCaption}</p></div>}
    {fields.work && <><KV items={[["takenAt（秒）", text(record.takenAt)], ["takenAtDate 原串", text(record.takenAtDate)]]} /><p className="text-[12px] text-ink-4">时间冲突、无效或未来时间由服务端按既有规则判定，不据此推断今天。缺少可信发表时间的新增材料按历史/回填语义处理，不把发现时间当作发表时间。</p></>}
    {upstream && <a className="inline-block break-all text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.receivedNative ? "已收帖子对应的原生原文" : "收到的上游地址（不作为导入原文）"} ↗</a>}
    <InstagramMedia record={record} label={fields.account ? "账号头像链接" : "帖子媒体链接"} />
    {fields.work && <InstagramMedia record={author} label="作者头像链接" />}
    {carousel.length > 0 && <div className="space-y-2"><p className="text-[12px] text-ink-3">轮播子项目（实际收到 {carousel.length} 项；上游 carouselMediaCount：{text(record.carouselMediaCount)}）</p>{carousel.map((item, index) => <div className="min-w-0 space-y-2 rounded-control bg-bg-sunk p-3" key={index}><KV items={[["轮播子项 ID", text(item.id)], ["媒体类型", text(item.mediaType)], ["isVideo", typeof item.isVideo === "boolean" ? item.isVideo ? "是" : "否" : "未提供"]]} /><InstagramMedia record={item} label={`子项目 ${index + 1} 媒体链接`} /></div>)}</div>}
    {missing.length > 0 && <details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史上游缺项记录（不决定当前导入资格）</summary><div><p className="mb-1 text-[12px] text-ink-4">上游缺项记录（导入仍由服务端据原文复核）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></div></details>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    {typeof r.data.originResultId === "number" && Number.isSafeInteger(r.data.originResultId) && r.data.originResultId > 0 && <p className="text-[12px] text-ink-3">来源结果 #{r.data.originResultId}；原发现时间由服务端冻结保留。</p>}
    {searchResult && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><Button size="sm" disabled={!detailRequest || !!pending} busy={pending === `instagram-detail:${r.id}`} onClick={async () => {
      if (!detailRequest) return;
      const accepted = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", detailRequest, { label: `instagram-detail:${r.id}`, revalidate: false });
      if (accepted) navigate(`/admin/operations/${accepted.runId}`);
    }}>查询此帖子详情</Button><p className="text-[12px] text-ink-3">新建普通只读查询任务，文档基价 0.06 元/请求，实际实扣未核对；使用 query 次数预算，原结果不改写，不自动导入。</p>{!detailRequest && <p className="text-[12px] text-amber">尚无合法的已收帖子短码，不能发起同帖子详情补全，请先核实输入。</p>}</div>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看所属信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!fields.canImport || !!pending || fields.work && !ownership.ready} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {!imported && fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须收到稳定 userId 才可绑定，不能人工补账号身份，也不按用户名或显示名称猜测归属。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, identity: r.data.identity, originResultId: r.data.originResultId, record }} label="原始字段与溯源诊断" />
    <ReasonDialog open={open} title={fields.account ? "绑定 Instagram 账号身份" : "本地导入 Instagram 作品"} description={fields.account ? "仅使用已收到的稳定 userId，按绑定复用，否则新建隔离 external 信源并关闭全文权限。可显式选择已核实为同一账号的 external 信源，不按昵称匹配。此命令不请求供应商。" : "作品归入已确认的所属信源，沿用其当前参与方式；作者 ID 仅作溯源，不是导入门槛。只补缺失原文等必要作品证据，已收作品与原文不可替换。文章去重保留原归属，此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (fields.work && !ownership.ready) { setError("请先在结果区确认所属信源。"); return false; }
      if (!fields.canImport) { setError(fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实"); return false; }
      if (fields.account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      const command = instagramImportSupplement(fields, { url, evidence });
      if (command.error) { setError(command.error); return false; }
      const supplement = command.supplement;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.work ? ownership.body() : {}), ...(fields.account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `instagram-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      {fields.work && <WorkSourceNotice />}
      <KV items={[["已收到 userId", fields.userId ?? "未提供"], ...(fields.work ? [["已收到帖子短码", fields.workId ?? "未提供"], ["已收到上游地址", fields.receivedUrl ?? "未提供"]] as Array<[string, string]> : [])]} />
      {fields.account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} disabled={!!pending} onChange={e => setTarget(e.target.value)}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>{target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="名称或 ID，人工核实同一账号" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", list.rows) ? e.target.value : "")}><option value="">请选择并核实</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{list.rows.length === 0 && <p className="text-[12px] text-ink-3">没有匹配候选，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {fields.needsUrl && <Field label="补充已核实的帖子原文" hint={<span className="break-all">例如 https://www.instagram.com/p/AbC_123-note/ 或 https://www.instagram.com/reel/AbC_123-note/；{fields.workId ? "须与已收帖子短码一致" : "从已核实的原生原文确认帖子，需记录依据"}。不接受短链、主页、Stories、媒体地址、凭证、端口或片段。</span>}><Input aria-label="补充已核实的帖子原文" type="url" required value={url} disabled={!!pending} onChange={event => setUrl(event.target.value)} /></Field>}
      {fields.needsUrl && <Field label="缺失字段的核实依据"><Textarea aria-label="缺失字段的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

function InstagramMedia({ record, label }: { record: Record<string, unknown>; label: string }) {
  const links = instagramMediaLinks(record);
  return links.length > 0 ? <div className="space-y-1"><p className="text-[12px] text-ink-3">{label}（不是原文，不表示已下载）</p><div className="flex flex-wrap gap-3 text-[12px]">{links.map(item => <a className="break-all text-accent" key={item.field} href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a>)}</div></div> : null;
}

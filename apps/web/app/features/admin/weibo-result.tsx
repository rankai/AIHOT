import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { researchScalarRows } from "./research-platform-data";
import { weiboDetailSeed, weiboImportFields, weiboReceivedRows, weiboTextNote } from "./weibo-result-data";
import { DetailQueryActions } from "./detail-query-actions";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { candidateSelectionValid } from "./candidate-selection";
import { useAdminAction } from "./action";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import { Badge, Button, DataTable, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";
interface ExternalSource { id: string; name: string; participation_mode: string }
export interface ExternalCandidates { rows: ExternalSource[]; page: number }
export function WeiboResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const ownership = useWorkSource();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("auto");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const { account, work, receivedUid, receivedUrl, missingUrl, canImport, agentkey, allowSupplement } = weiboImportFields(r.kind, r.data), trend = r.kind === "weibo_trend";
  const original = safeExternalUrl(receivedUrl);
  const detailSeed = work ? weiboDetailSeed(r.data) : null;
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((value): value is string => typeof value === "string") : [];
  const media = [...new Set([...(Array.isArray(r.data.images) ? r.data.images : []), ...(Array.isArray(r.data.picUrl) ? r.data.picUrl : []), r.data.videoUrl, r.data.cover, r.data.avatar, r.data.profileImageUrl].map(safeExternalUrl).filter((value): value is string => value !== null))];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external"); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const summary = r.kind === "query_summary";
  return <article className="space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium">{summary ? "查询与采集摘要" : trend ? "微博热搜研究快照" : account ? String(r.data.name ?? r.data.nickname ?? "微博账号") : "微博作品"}<Badge>{summary ? "摘要" : trend ? "研究快照" : account ? "账号" : "作品"}</Badge></div>
    {summary ? <div className="space-y-2 text-[13px] text-ink-3"><p>返回 {typeof r.data.count === "number" ? r.data.count : "—"} 项{typeof r.data.selectedCount === "number" ? `，选取 ${r.data.selectedCount} 项` : ""}{typeof r.data.processedCount === "number" ? `，处理 ${r.data.processedCount} 项` : ""}。</p>{r.data.count === 0 && <p>此页没有结果，未创建文章。</p>}{(r.data.truncated === true || (typeof r.data.unprocessedDueToLimit === "number" && r.data.unprocessedDueToLimit > 0)) && <p className="text-amber">已达到本轮数量上限{typeof r.data.unprocessedDueToLimit === "number" ? `，有 ${r.data.unprocessedDueToLimit} 项未继续处理` : ""}；不能据此认为所有上游结果已覆盖。</p>}</div> : trend ? <><p className="text-[13px] text-ink-3">仅保存研究快照，不作为文章或作者身份导入。{typeof r.data.updateTime === "string" ? `上游原始时间：${r.data.updateTime}` : ""}</p><DataTable dense rows={Array.isArray(r.data.list) ? (r.data.list as Array<{ topSearchName: string; topSearchNum: string; tag?: string }>).map((item, index) => ({ ...item, index })) : []} rowKey={item => item.index} columns={[{ key: "name", label: "热搜", render: item => item.topSearchName }, { key: "heat", label: "上游热度", render: item => item.topSearchNum }, { key: "tag", label: "标签", render: item => item.tag || "—" }]} /></> : <>
      <KV items={[[account ? "账号 UID" : "作者 UID", receivedUid ?? "未提供（可选溯源）"], ...(work ? [["作品 ID", typeof r.data.opusId === "string" ? r.data.opusId : "缺失"], ["收到的链接 ID（mblogid）", typeof r.data.mblogid === "string" ? r.data.mblogid : "—"]] as Array<[string, string]> : [])]} />
      {agentkey && <KV items={weiboReceivedRows(r.data)} />}
      {agentkey && work && <p className="text-[12px] text-ink-3">{weiboTextNote(r.data)}{r.data.role === "outer-status-unparsed-retweet" ? "转发结构未验证，仅研究外层微博，不能导入。" : ""}</p>}
      {typeof r.data.text === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{r.data.text}</p>}
      {typeof r.data.publishTime === "string" && <p className="text-[12px] text-ink-3">上游原始时间：{r.data.publishTime}</p>}
      {agentkey && typeof r.data.publishedAt === "string" && <p className="text-[12px] text-ink-3">已按原始时区转换的时间：{r.data.publishedAt}</p>}
      {original && <a className="inline-block text-[13px] text-accent" href={original} target="_blank" rel="noreferrer">{agentkey && r.data.urlSource === "derived-canonical-permalink" ? "由实收身份组成的规范原文" : "原文链接"} ↗</a>}
      {receivedUrl && !original && <p className="text-[12px] text-amber">上游原文地址不是可打开的无凭证 HTTP(S) 链接，保留在诊断中。</p>}
      {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((href, index) => <a key={href} href={href} className="text-accent" target="_blank" rel="noreferrer">上游媒体 {index + 1} ↗</a>)}</div>}
      {missing.length > 0 && <details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史上游缺项记录（不决定当前导入资格）</summary><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></details>}
    </>}
    {summary && agentkey && <div className="space-y-2 text-[12px] text-ink-3"><p>本次仅查询首页或单个对象，不自动翻页；返回数不代表全部历史覆盖。</p><KV items={researchScalarRows(r.data.pagination)} /></div>}
    {!r.sourceId && !r.articleId && typeof r.data.pendingReason === "string" && <details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史处理提示（当前资格以作品与原文为准）</summary><p>{r.data.pendingReason}</p></details>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看实际信源</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已导入文章"}</Link>}{(account || work) && !r.sourceId && !r.articleId && <Button size="sm" disabled={!canImport || !!pending || work && !ownership.ready} onClick={() => setOpen(true)}>{account ? "绑定或新建隔离信源" : "本地导入材料"}</Button>}</div>
    {!canImport && (account || work) && !r.sourceId && <p className="text-[12px] text-amber">{agentkey ? "本条缺少已核实的作品 ID、匹配原文或可导入角色；不能人工补 ID 或地址。后台仍须复核原始回执。" : account ? "缺少已收到的稳定 UID，账号结果暂不能绑定；请查询详情核实。" : "缺少作品数字 ID，不能导入；请查询作品详情核实。"}</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, kind: r.kind, data: r.data }} label="结果字段与溯源诊断" />
    {agentkey ? detailSeed && <p className="text-[12px] text-ink-3">需显式查询详情：<Link className="text-accent" to="/admin/data-tools?view=platforms" state={{ weiboDetailSeed: detailSeed }}>带入已收微博 ID 到平台查询</Link>。只预填；确认提交后才产生独立付费查询。</p> : <DetailQueryActions result={r} />}
    <ReasonDialog open={open} title={account ? "导入微博账号身份" : "本地导入微博作品"} description={account ? "仅按实收稳定 UID 复用或绑定账号信源，否则新建隔离 external 信源；不按昵称匹配，不提高权限。此命令不请求供应商。" : "作品沿用已确认的所属信源及其当前参与方式，作者 UID 仅作可选溯源。后台复核原回执、作品与原文，文章去重保留原归属；此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (work && !ownership.ready) { setError("请先在结果区确认所属信源。"); return false; }
      if (!canImport) { setError("当前结果不满足本地导入条件，请重新核实结果。"); return false; }
      if (account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      if (allowSupplement && missingUrl && !evidence.trim()) { setError("请填写补充字段的核实依据"); return false; }
      if (allowSupplement && missingUrl && !safeExternalUrl(url.trim())) { setError("请填写无账号密码的 HTTP(S) 原文地址"); return false; }
      const supplement = allowSupplement && missingUrl ? { ...(missingUrl ? { url: url.trim() } : {}), evidence: evidence.trim() } : undefined;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(work ? ownership.body() : {}), ...(account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `weibo-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      {work && <WorkSourceNotice />}
      <KV items={[["已收到 UID", receivedUid ?? "缺失"], ...(work ? [["已收到原文", receivedUrl ?? "缺失"]] as Array<[string, string]> : [])]} />
      {account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} onChange={e => setTarget(e.target.value)}><option value="auto">按 UID 复用，否则新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>{target === "existing" && <div className="space-y-2"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入名称或 ID" /></Field><Button size="sm" disabled={!query.trim()} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", list?.rows) ? e.target.value : "")}><option value="">请选择并核实账号</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" onClick={() => search(list.page + 1)}>下一批</Button>}</div>{!list.rows.length && <p className="text-[12px] text-ink-3">没有匹配的 external 信源，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {allowSupplement && missingUrl && <Field label="补充已核实原文地址"><Input aria-label="补充已核实原文地址" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://weibo.com/作者UID/作品ID" /></Field>}
      {allowSupplement && missingUrl && <Field label="补充字段的核实依据"><Textarea aria-label="补充字段的核实依据" required maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

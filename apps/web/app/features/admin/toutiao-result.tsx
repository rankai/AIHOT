import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { MODE_LABEL } from "./labels";
import type { OperationAccepted, OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { toutiaoDetailRequest, toutiaoImportFields, toutiaoImportSupplement, toutiaoMediaLinks, toutiaoPageFacts, toutiaoTargetCandidates, toutiaoWorkFacts } from "./toutiao-result-data";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";

function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : "未提供"; }
function boolean(value: unknown): string { return typeof value === "boolean" ? value ? "是（true）" : "否（false）" : "未提供"; }

export function ToutiaoResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation(), navigate = useNavigate();
  const [open, setOpen] = useState(false), [target, setTarget] = useState("auto"), [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState(""), [identityKind, setIdentityKind] = useState("uid"), [identityValue, setIdentityValue] = useState("");
  const [url, setUrl] = useState(""), [evidence, setEvidence] = useState(""), [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const fields = toutiaoImportFields(r.kind, r.data), facts = toutiaoWorkFacts(r.data), record = fields.record;
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const upstream = safeExternalUrl(fields.receivedUrl), avatar = safeExternalUrl(record.avatarUrl), media = toutiaoMediaLinks(record);
  const detailRequest = toutiaoDetailRequest(r.id, r.kind, r.data), detailEligible = fields.work && ["28CFGF5I", "R1IGR09H"].includes(String(r.data.operationId));
  const imported = !!r.sourceId || !!r.articleId;
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const rows = toutiaoTargetCandidates(list?.rows, fields.work);
  const search = (page = 1) => {
    setSourceId("");
    const params = new URLSearchParams(location.search);
    params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external");
    candidates.load(`${location.pathname}?${params}`);
  };
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title)}</span><Badge>{fields.account ? "今日头条账号" : "今日头条作品"}</Badge></div>
    <KV items={[["已收 / 同作品确认 uid", fields.uid ?? "未提供"], ["已收 / 同作品确认 secUid", fields.secUid ?? "未提供"], ["作者称呼 / 昵称", text(record.nickname ?? record.authorName)], ...(fields.account ? [["粉丝数原串", text(record.fansNum)], ["认证说明", text(record.verify)]] as Array<[string, string]> : [])]} />
    <p className="text-[12px] text-ink-4">uid 与 secUid 是不同类型的作者身份，不互换；名称及查询输入的主页 token 仅作定位，不证明作者身份。</p>
    {fields.account && typeof record.introduction === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{record.introduction}</p>}
    {fields.work && <>
      <KV items={[["已确认作品 ID（响应或原文）", fields.workId ?? "未提供"], ["响应 opusId", text(record.opusId)], ["响应 workId", text(record.workId)], ...(fields.requestedWorkId ? [["请求作品 ID（仅输入）", fields.requestedWorkId]] as Array<[string, string]> : []), ["作品类型 workType", facts.workType === undefined ? "未提供" : facts.workType ? "视频（true）" : "图文（false）"], ["hasVideo", boolean(facts.hasVideo)], [`原始发布时间（${facts.publishTimeUnit}）`, text(record.publishTime)], ["原始更新时间", text(record.updateTime)], [`时长（${facts.durationUnit}）`, text(record.duration)]]} />
      {r.data.operationId === "28CFGF5I" && <KV items={[["本项上游 pageCount", text(record.pageCount)], ["本项上游 hasNext", boolean(facts.hasNext)]]} />}
      <p className="text-[12px] text-ink-4">请求 ID 与响应字段分别保留。缺少可信时区或发表时间的新增材料按历史/回填语义处理，不把发现时间当作发表时间。搜索结果的 pageCount / hasNext 属于各项，不合成为整页是否还有结果。</p>
      {r.data.operationId === "PAB6Z75Y" && typeof record.content === "string" && <div><p className="mb-1 text-[12px] text-ink-3">作品详情正文（纯文本查看）</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{record.content}</p></div>}
    </>}
    {upstream && <a className="inline-block break-all text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.account ? "账号主页（仅定位）" : fields.native ? "查看已收头条原生原文" : "收到的上游地址（不作为导入原文）"} ↗</a>}
    {avatar && <a className="inline-block text-[12px] text-accent" href={avatar} target="_blank" rel="noreferrer">账号头像链接 ↗</a>}
    {media.length > 0 && <div className="space-y-1"><p className="text-[12px] text-ink-3">实际收到的媒体链接（不是原文，不表示已下载）</p><div className="flex flex-wrap gap-3 text-[12px]">{media.map(item => <a className="break-all text-accent" key={item.key} href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a>)}</div></div>}
    {missing.length > 0 && <ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    {typeof r.data.originResultId === "number" && Number.isSafeInteger(r.data.originResultId) && r.data.originResultId > 0 && <p className="text-[12px] text-ink-3">来源结果 #{r.data.originResultId}；原发现时间由服务端冻结保留。</p>}
    {detailEligible && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><Button size="sm" disabled={!detailRequest || !!pending} busy={pending === `toutiao-detail:${r.id}`} onClick={async () => {
      if (!detailRequest) return;
      const accepted = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", detailRequest, { label: `toutiao-detail:${r.id}`, revalidate: false });
      if (accepted) navigate(`/admin/operations/${accepted.runId}`);
    }}>查询此作品详情</Button><p className="text-[12px] text-ink-3">新建普通只读查询任务，文档基价 0.06 元/请求，实际实扣未核对；使用 query 次数预算，原结果不改写，不自动导入。</p>{!detailRequest && <p className="text-[12px] text-amber">尚无可核实的数字作品 ID，不能发起同作品详情，请先核实输入。</p>}</div>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看作者绑定信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!fields.canImport || !!pending} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须实收 uid 才可绑定，不能人工补账号身份或按昵称猜测归属。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, requestedWorkId: r.data.requestedWorkId, identity: r.data.identity, originResultId: r.data.originResultId, record }} label="原始字段与溯源诊断" />
    <ReasonDialog open={open} title={fields.account ? "绑定今日头条账号" : "本地导入今日头条作品"} description={fields.account ? "仅按已收到的 uid 复用绑定，否则新建隔离 external 信源并关闭全文。可显式选择已核实的同账号信源，不按昵称匹配。此命令不请求供应商。" : "默认按已收或同作品确认的作者身份归属。可凭核实依据显式关联已有隔离 external 信源；收到的身份、作品 ID 和原文不可替换。人工新增或关联不继承非隔离权限，不提高全文或参与方式；文章去重保留原归属。此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (!fields.canImport) { setError(fields.blockedReason ?? "此结果缺少可绑定的已收身份"); return false; }
      if (target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择" : "请从当前候选列表选择已核实的信源；作品只接受隔离目标"); return false; }
      const command = toutiaoImportSupplement(fields, { uid: identityKind === "uid" ? identityValue : "", secUid: identityKind === "secUid" ? identityValue : "", url, evidence, manualTarget: fields.work && target === "existing" });
      if (command.error) { setError(command.error); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(target === "existing" ? { sourceId } : {}), ...(command.supplement ? { supplement: command.supplement } : {}) }, { label: `toutiao-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      <KV items={[["已收 / 同作品确认 uid", fields.uid ?? "未提供"], ["已收 / 同作品确认 secUid", fields.secUid ?? "未提供"], ...(fields.work ? [["已确认作品 ID", fields.workId ?? "未提供"], ["已收到上游地址", fields.receivedUrl ?? "未提供"], ["请求作品 ID（仅输入）", fields.requestedWorkId ?? "未提供"]] as Array<[string, string]> : [])]} />
      <Field label="信源目标"><Select aria-label="信源目标" value={target} disabled={!!pending} onChange={e => { setTarget(e.target.value); setSourceId(""); }}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">{fields.account ? "选择已核实的同账号 external 信源" : "凭依据关联已核实的隔离 external 信源"}</option></Select></Field>
      {target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="名称或 ID；人工核实同一作者" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实的候选信源"><Select aria-label="已核实的候选信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", rows) ? e.target.value : "")}><option value="">请选择并核实</option>{rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex flex-wrap gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{rows.length === 0 && <p className="text-[12px] text-ink-3">本批没有{fields.work ? "隔离" : "匹配"}候选，可修改搜索、翻页或使用默认隔离目标。</p>}</>}{fields.work && <p className="text-[12px] text-ink-3">只显示隔离候选；不按昵称自动匹配。服务端仍会复核已有绑定、启用状态和同类型身份冲突。</p>}</div>}
      {fields.needsUrl && <Field label="补充已核实的头条原文" hint={<span className="break-all">例如 https://www.toutiao.com/article/1234567890123456789/；支持 /aID、/group/ID、/article/ID、/video/ID。{fields.requestedWorkId ? "须对应本次请求的作品 ID" : fields.workId ? "须与已确认作品 ID 一致" : "从核实的原文确认作品，需记录依据"}；不接受短链、主页、媒体、凭证、端口或片段。</span>}><Input aria-label="补充已核实的头条原文" type="url" required disabled={!!pending} value={url} onChange={e => setUrl(e.target.value)} /></Field>}
      {fields.needsIdentity && <><Field label="补充作者身份类型"><Select aria-label="补充作者身份类型" value={identityKind} disabled={!!pending} onChange={e => { setIdentityKind(e.target.value); setIdentityValue(""); }}><option value="uid">数字 uid</option><option value="secUid">安全 ID secUid</option></Select></Field><Field label="已核实作者身份" hint="只补缺失作者身份；uid 与 secUid 不互换，不使用昵称、作品 ID 或主页 token。"><Input aria-label="已核实作者身份" required value={identityValue} disabled={!!pending} inputMode={identityKind === "uid" ? "numeric" : "text"} pattern={identityKind === "uid" ? "[0-9]+" : undefined} maxLength={identityKind === "secUid" ? 500 : undefined} onChange={e => setIdentityValue(e.target.value)} /></Field></>}
      {(fields.needsUrl || fields.needsIdentity || fields.work && target === "existing") && <Field label="缺项或人工关联的核实依据"><Textarea aria-label="缺项或人工关联的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

export function ToutiaoQuerySummary({ result: r }: { result: OperationResult }) {
  const facts = toutiaoPageFacts(r.data);
  return <article className="min-w-0 space-y-2 border-b border-line pb-4 text-[13px] last:border-0"><div className="font-medium">今日头条查询摘要</div><p className="text-ink-3">本次实际返回 {typeof r.data.count === "number" ? r.data.count : "未提供"} 项。</p>{r.data.count === 0 && <p className="text-ink-3">此页没有结果，未创建文章，不自动发起下一页。</p>}{facts.length > 0 && <div className="space-y-1 break-all text-ink-3">{facts.map(([label, value]) => <p key={label}>{label}：<span className="whitespace-pre-wrap">{value}</span></p>)}</div>}<p className="text-[12px] text-ink-4">只展示本次收到的分页事实，不自动翻页；作品搜索各项的 pageCount / hasNext 不合成为整页 hasMore。</p><Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data }} label="摘要与溯源诊断" /></article>;
}

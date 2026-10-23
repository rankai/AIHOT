import { DetailQueryActions } from "./detail-query-actions";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { bilibiliDetailSeed, bilibiliImportFields, bilibiliImportSupplement } from "./bilibili-result-data";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = "未提供"): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}
export function BilibiliResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [mid, setMid] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = bilibiliImportFields(r.kind, r.data, url);
  const record = object(r.data.record);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const body = record.description ?? (fields.account ? record.sign : undefined);
  const detailSeed = bilibiliDetailSeed(r.data);
  const rawTimes = object(record.rawTimes);
  const time = fields.account ? record.lastCreated : record.created;
  const upstream = fields.receivedNative?.url ?? safeExternalUrl(fields.receivedUrl);
  const media = [...new Set([record.picUrl, record.face].map(safeExternalUrl).filter((address): address is string => address !== null))];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external"); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const imported = !!r.sourceId || !!r.articleId;
  return <article className="min-w-0 space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span className="min-w-0 max-w-full break-words">{text(r.data.title, "B站查询结果")}</span><Badge>{fields.account ? "B站账号" : r.data.role === "provider_recommendation" ? "B站推荐研究（非排名）" : "B站作品"}</Badge></div>
    <KV items={[["已收到作者 MID", fields.mid ?? "未提供"], ["上游账号名称", text(record.name ?? record.author)], ...(fields.work ? [["已收到 AV", text(r.data.avId ?? record.avId)], ["已收到 BV", fields.workId ?? "未提供"], ["原文可确认 BV", fields.native?.id ?? "未确认"]] as Array<[string, string]> : [])]} />
    {fields.work && fields.workId && fields.receivedNative && <p className="text-[12px] text-ink-3">原文地址对应已收到的 BV；封面图不作为原文。作品按实际作者 MID 归属，不指定任意目标信源。</p>}
    <p className="text-[12px] text-ink-4">MID 与 BV 保留完整字符串，昵称不证明稳定身份。</p>
    {typeof body === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{fields.agentkey && fields.work && "视频说明："}{body}</p>}
    {(typeof time === "string" || typeof time === "number") && <p className="text-[12px] text-ink-3">{fields.account ? "最近发文时间（上游原串）" : "上游原始时间"}：{String(time)}</p>}
    {fields.agentkey && Object.entries(rawTimes).map(([key, value]) => <p key={key} className="text-[12px] text-ink-3">原始 {key}（单位 / 时区未确认）：{text(value)}</p>)}
    {fields.work && <p className="text-[12px] text-ink-4">上游时间未注明时区或缺少可信时间时，不把发现时间当作发表时间或今天发生；新增材料按既有历史/回填语义处理。</p>}
    {upstream && <a className="inline-block break-all text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.receivedNative ? "已收 BV 对应原文" : "收到的上游地址（不作为入库原文）"} ↗</a>}
    {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((address, index) => <a key={address} className="text-accent" href={address} target="_blank" rel="noreferrer">上游封面或头像 {index + 1} ↗</a>)}</div>}
    {missing.length > 0 && <div><p className="mb-1 text-[12px] text-ink-4">上游缺项记录（导入仍由服务端据原文复核）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看作者绑定信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && (!fields.agentkey || fields.canImport) && <Button size="sm" disabled={!fields.canImport || !!pending} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {!imported && fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须收到稳定 MID 才可绑定，不能人工补账号身份；请显式查询并核实账号 MID。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, identity: r.data.identity, accountMid: r.data.accountMid, record }} label="原始字段与溯源诊断" />
    {fields.agentkey ? detailSeed && <p className="text-[12px] text-ink-3">需显式查询详情：<Link className="text-accent" to="/admin/redfox?view=platforms" state={{ bilibiliDetailSeed: detailSeed }}>带入已收 AV / BV 到平台查询</Link>。只预填；确认提交后才产生独立付费查询。</p> : <DetailQueryActions result={r} />}
    <ReasonDialog open={open} title={fields.account ? "绑定B站账号身份" : "本地导入B站作品"} description={fields.account ? "仅使用已收到的稳定 MID，按绑定复用，否则新建隔离 external 信源并关闭全文权限。可显式选择已核实为同一账号的 external 信源，不按昵称匹配。此命令不请求供应商。" : "作品按真实作者身份归属，不指定任意目标信源。收到的身份、作品 ID 和地址不可替换；只补缺失项并记录证据。人工作者身份不能继承已有非隔离权限，文章去重后保留原归属。此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (!fields.canImport) { setError(fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实"); return false; }
      if (fields.account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      const command = bilibiliImportSupplement(fields, { mid, url, evidence });
      if (command.error) { setError(command.error); return false; }
      const supplement = command.supplement;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `bilibili-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      <KV items={[["已收到 MID", fields.mid ?? "未提供"], ...(fields.work ? [["已收到 BV", fields.workId ?? "未提供"], ["已收到上游地址", fields.receivedUrl ?? "未提供"]] as Array<[string, string]> : [])]} />
      {fields.account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} disabled={!!pending} onChange={e => setTarget(e.target.value)}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>{target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="名称或 ID，人工核实同一账号" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", list.rows) ? e.target.value : "")}><option value="">请选择并核实</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{list.rows.length === 0 && <p className="text-[12px] text-ink-3">没有匹配候选，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {fields.needsUrl && <Field label="补充原生 BV 原文链接" hint={<span className="break-all">例如 https://www.bilibili.com/video/BV1ghJg6hEWV；{fields.workId ? "须与已收到的 BV 一致" : "从已核实的原生 BV 原文确认作品，需记录核实依据"}。b23 只能用于显式详情查询，不接受短链、AV 地址或封面作为人工补充原文。</span>}><Input aria-label="补充原生 BV 原文链接" type="url" required value={url} disabled={!!pending} onChange={e => setUrl(e.target.value)} /></Field>}
      {fields.needsIdentity && <Field label="补充已核实作者 MID" hint="只补缺失的稳定作者 MID，不按昵称或封面推断身份。"><Input aria-label="补充已核实作者 MID" inputMode="numeric" pattern="[0-9]+" required value={mid} disabled={!!pending} onChange={e => setMid(e.target.value)} /></Field>}
      {(fields.needsUrl || fields.needsIdentity) && <Field label="缺失字段的核实依据"><Textarea aria-label="缺失字段的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

export function BilibiliResearchResult({ result: r }: { result: OperationResult }) {
  const record = object(r.data.record), author = object(record.author);
  const stats = r.kind === "query_summary";
  const rows: Array<[string, string]> = stats
    ? [["实际 MID", text(record.mid)], ["关注数 following", text(record.following)], ["粉丝数 follower", text(record.follower)]]
    : [["动态 ID", text(record.id_str)], ["动态类型", text(record.type)], ["当前作者 MID", text(author.mid)], ["当前作者名称", text(author.name)], ["原始 pub_ts（未确认单位 / 时区）", text(author.pub_ts)], ["原动态类型（仅类型）", text(record.originalType)]];
  return <article className="min-w-0 space-y-3 border-b border-line pb-4"><div className="text-[14px] font-medium">{stats ? "B站关系统计快照" : text(r.data.title, "B站动态研究")}</div><KV items={rows} />{stats && <KV items={[["候选条数", text(r.data.count)], ["本轮选取数", text(r.data.selectedCount)], ["限额未选数", text(r.data.unprocessedDueToLimit)], ["停止原因", text(r.data.stopReason)]]} />}{!stats && typeof record.description === "string" && <p className="whitespace-pre-wrap break-words text-[13px]">当前动态说明：{record.description}</p>}<p className="text-[12px] text-ink-3">{stats ? "统计值按实际响应保留，缺失不补零；候选条数不代表统计为空。" : "动态与转发仅供研究；转发只展示当前说明和原动态类型，不借用原作者或原文。"}单次快照，不自动翻页，不导入材料或绑定账号。</p><Json value={{ resultId: r.id, receiptId: r.receiptId, data: r.data }} label="研究摘要与溯源诊断" /></article>;
}

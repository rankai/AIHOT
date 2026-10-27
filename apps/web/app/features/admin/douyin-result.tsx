import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { DetailQueryActions } from "./detail-query-actions";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { douyinImportFields, douyinNativeVideo } from "./douyin-result-data";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";
export function DouyinResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const ownership = useWorkSource();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = douyinImportFields(r.kind, r.data, url);
  const record = r.data.record && typeof r.data.record === "object" && !Array.isArray(r.data.record) ? r.data.record as Record<string, unknown> : {};
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const body = record.content ?? record.aweme_desc ?? record.desc;
  const time = record.publishTime ?? record.create_time_str ?? record.create_time ?? record.gmtCreate;
  const upstream = safeExternalUrl(fields.receivedUrl);
  const media = [...new Set([...(Array.isArray(record.imageUrlList) ? record.imageUrlList : []), record.coverUrl, record.cover_url, record.audioUrl, record.avatarUrl, record.authorLink, record.authorUrl, record.accountLink].map(safeExternalUrl).filter((address): address is string => address !== null))];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external"); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const imported = !!r.sourceId || !!r.articleId;
  return <article className="space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>{typeof r.data.title === "string" ? r.data.title : "抖音查询结果"}</span><Badge>{r.kind === "douyin_account_rank" ? "账号研究榜单" : fields.account ? "抖音账号" : "抖音作品"}</Badge></div>
    {r.kind === "douyin_account_rank" && <p className="text-[12.5px] text-ink-3">账号榜单只作研究，主页和昵称不能证明稳定身份，也不能作为文章导入；请显式查询账号信息核实。</p>}
    <KV items={[["已收到作者 UID", fields.uid ?? "未提供"], ["已收到安全 ID（secUserId）", fields.secUserId ?? "未提供"], ...(fields.work ? [["已收到作品 ID", fields.workId ?? "未提供"], ["原生链接中的作品 ID", fields.native?.id ?? "未确认"]] as Array<[string, string]> : [])]} />
    {fields.account && r.data.provider === "agentkey" && <KV items={[["响应昵称", typeof record.nickname === "string" ? record.nickname : "未提供"], ["响应粉丝数", typeof record.follower_count === "number" ? String(record.follower_count) : "未提供"]]} />}
    {r.kind === "douyin_account_rank" && <KV items={[["上游排名", typeof record.accountRanking === "number" ? String(record.accountRanking) : "未提供"], ["上游榜单日期原串", typeof record.rankDate === "string" ? record.rankDate : "未提供"], ["上游榜单周期", typeof record.rankPeriod === "string" ? record.rankPeriod : "未提供"]]} />}
    {r.data.provider!=="agentkey" && fields.work && !fields.workId && fields.receivedNative && <p className="text-[12px] text-ink-3">接口未单列已确认作品 ID；本原生链接含作品 ID，可由服务端据此核实。AI photoId 不参与身份确认。</p>}
    <p className="text-[12px] text-ink-4">UID 与安全 ID 分类型保留完整字符串；展示抖音号、AI authorId/photoId 和未确认的 secUid 不作为稳定作者或作品身份。</p>
    {typeof body === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p>}
    {(typeof time === "string" || typeof time === "number") && <p className="text-[12px] text-ink-3">上游原始时间：{String(time)}</p>}
    {fields.work && <p className="text-[12px] text-ink-4">未知时区或缺少可信时间时，不把发现时间当作发表时间或今天发生；新增材料按既有历史/回填语义处理。</p>}
    {upstream && <a className="inline-block text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.receivedNative ? "原生作品原文" : "收到的上游地址（不作为入库原文）"} ↗</a>}
    {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((address, index) => <a key={address} className="text-accent" href={address} target="_blank" rel="noreferrer">上游媒体或主页 {index + 1} ↗</a>)}</div>}
    {missing.length > 0 && <details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史上游缺项记录（不决定当前导入资格）</summary><div><p className="mb-1 text-[12px] text-ink-4">上游缺项记录（导入仍由服务端据原文复核）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></div></details>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看所属信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && r.kind !== "douyin_account_rank" && <Button size="sm" disabled={!fields.canImport || !!pending || fields.work && !ownership.ready} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {!imported && fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须收到 UID 或已确认安全 ID 才可绑定，不允许手补账号身份；请显式查询账号详情。</p>}
    {r.data.provider!=="agentkey" && <DetailQueryActions result={r} />}
    {!imported && typeof r.data.pendingReason==="string"&&<details className="text-[12px] text-ink-4"><summary className="cursor-pointer">历史处理提示（当前资格以作品与原文为准）</summary><p>{r.data.pendingReason}</p></details>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, identity: r.data.identity, record }} label="原始字段与溯源诊断" />
    <ReasonDialog open={open} title={fields.account ? "绑定抖音账号身份" : "本地导入抖音作品"} description={fields.account ? "仅使用已收到的稳定 UID 或安全 ID，按绑定复用，否则新建隔离 external 信源并关闭全文权限。可显式选择已核实为同一账号的 external 信源，不按昵称匹配。此命令不请求供应商。" : "作品归入已确认的所属信源，沿用其当前参与方式；作者 ID 仅作溯源，不是导入门槛。只补缺失原文等必要作品证据，已收作品与原文不可替换。文章去重保留原归属，此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (fields.work && !ownership.ready) { setError("请先在结果区确认所属信源。"); return false; }
      if (!fields.canImport) { setError(fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实"); return false; }
      if (fields.account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      if (fields.needsUrl) {
        const native = douyinNativeVideo(url.trim());
        if (!native) { setError("请填写无凭证、端口或片段的 douyin.com/video/数字ID 或 iesdouyin.com/share/video/数字ID 原文链接"); return false; }
        if (fields.workId && fields.workId !== native.id) { setError("补充链接中的作品 ID 必须与已收到的作品 ID 完全一致"); return false; }
      }
      if (fields.needsUrl && !evidence.trim()) { setError("请填写缺失字段的核实依据"); return false; }
      const supplement = fields.needsUrl ? { ...(fields.needsUrl ? { url: url.trim() } : {}), evidence: evidence.trim() } : undefined;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.work ? ownership.body() : {}), ...(fields.account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `douyin-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      {fields.work && <WorkSourceNotice />}
      <KV items={[["已收到 UID", fields.uid ?? "未提供"], ["已收到安全 ID", fields.secUserId ?? "未提供"], ...(fields.work ? [["已收到作品 ID", fields.workId ?? "未提供"], ["已收到上游地址", fields.receivedUrl ?? "未提供"]] as Array<[string, string]> : [])]} />
      {fields.account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} disabled={!!pending} onChange={e => setTarget(e.target.value)}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>{target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="名称或 ID，人工核实同一账号" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", list.rows) ? e.target.value : "")}><option value="">请选择并核实</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{list.rows.length === 0 && <p className="text-[12px] text-ink-3">没有匹配候选，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {fields.needsUrl && <Field label="补充原生作品原文链接" hint="例如 https://www.douyin.com/video/1234567890123456789 或 https://www.iesdouyin.com/share/video/1234567890123456789；短链与主页不接受。"><Input aria-label="补充原生作品原文链接" type="url" required value={url} disabled={!!pending} onChange={e => setUrl(e.target.value)} /></Field>}
      {fields.needsUrl && <Field label="缺失字段的核实依据"><Textarea aria-label="缺失字段的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

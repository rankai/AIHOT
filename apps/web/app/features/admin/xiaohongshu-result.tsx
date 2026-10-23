import { DetailQueryActions } from "./detail-query-actions";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { xiaohongshuImportFields, xiaohongshuNativeNote, xiaohongshuRoleLabel } from "./xiaohongshu-result-data";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = "未提供"): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}
function XiaohongshuResearch({ result: r }: { result: OperationResult }) {
  const record = object(r.data.record);
  const topics = Array.isArray(record.hotTopics) ? record.hotTopics.map(object) : [];
  const searches = Array.isArray(record.relatedSearches) ? record.relatedSearches.map(object) : [];
  return <article className="space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>小红书话题与相关搜索</span><Badge>洞察研究</Badge></div>
    <p className="text-[12.5px] text-ink-3">此处只保存研究信息，不作为文章导入。主查询结果与上游推荐候选已分别列为作品；未指定关键词时，主结果为上游热门结果。</p>
    <KV items={[["主结果数", text(r.data.matchedCount, "0")], ["推荐候选数", text(r.data.recommendedCount, "0")], ["查询关键词", text(record.keyword, "未指定（热门主结果）")], ["上游总数", text(record.total)], ["上游页码", text(record.pageNum)]]} />
    {typeof record.tips === "string" && <p className="whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3 text-[13px] text-ink-2">上游提示：{record.tips}</p>}
    <div className="space-y-2"><p className="text-[13px] font-medium">热门话题</p>{topics.length ? <ul className="space-y-2 text-[13px] text-ink-2">{topics.map((topic, index) => <li className="break-words rounded-control bg-bg-sunk p-3" key={index}>{text(topic.topic)}<span className="ml-2 text-[12px] text-ink-3">笔记数 {text(topic.articleCount)} · 互动数 {text(topic.totalInteractiveCount)}</span></li>)}</ul> : <p className="text-[12px] text-ink-3">本次没有热门话题。</p>}</div>
    <div className="space-y-2"><p className="text-[13px] font-medium">相关搜索</p>{searches.length ? <ul className="space-y-2 text-[13px] text-ink-2">{searches.map((search, index) => <li className="break-words rounded-control bg-bg-sunk p-3" key={index}>{text(search.keyword)}<span className="ml-2 text-[12px] text-ink-3">笔记数 {text(search.articleCount)}</span></li>)}</ul> : <p className="text-[12px] text-ink-3">本次没有相关搜索。</p>}</div>
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, record }} label="研究字段与溯源诊断" />
  </article>;
}

export function XiaohongshuResult({ result }: { result: OperationResult }) {
  return result.kind === "xiaohongshu_research" ? <XiaohongshuResearch result={result} /> : <XiaohongshuIdentityResult result={result} />;
}
function XiaohongshuIdentityResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = xiaohongshuImportFields(r.kind, r.data, url);
  const record = object(r.data.record);
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const body = record.workDesc ?? record.description ?? record.desc;
  const time = record.workPublishTime ?? record.publicTime ?? record.createTime ?? record.gmtCreate;
  const upstream = fields.receivedNative?.url ?? safeExternalUrl(fields.receivedUrl);
  const media = [...new Set([record.coverUrl, record.cover, record.accountAvatar, record.accountLink, record.userJumpUrl].map(safeExternalUrl).filter((address): address is string => address !== null))];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external"); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const imported = !!r.sourceId || !!r.articleId;
  const role = xiaohongshuRoleLabel(r.data.role);
  const rank = r.kind === "xiaohongshu_account_rank";
  return <article className="space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>{text(r.data.title, "小红书查询结果")}</span><Badge>{rank ? "账号研究榜单" : fields.account ? "小红书账号" : "小红书作品"}</Badge>{role && <Badge>{role}</Badge>}</div>
    {rank && <p className="text-[12.5px] text-ink-3">账号榜单只作研究，不作为文章导入；主页与昵称不自动证明稳定作者身份，请显式查询账号详情核实。</p>}
    <KV items={[["已收到作者 userId", fields.userId ?? "未提供"], ["展示小红书号", text(record.accountId ?? record.red_id)], ["上游账号名称", text(record.accountName ?? record.accountNickname ?? record.authorNickname ?? record.userName ?? record.authorName ?? record.name)], ...(fields.work ? [["已收到作品 ID", fields.workId ?? "未提供"], ["原生链接可确认作品 ID", fields.native?.id ?? "未确认"]] as Array<[string, string]> : []), ...(rank ? [["上游排名", text(record.accountRanking)]] as Array<[string, string]> : [])]} />
    {fields.agentKey && fields.account && <KV items={Object.entries(object(record.stats)).flatMap(([key, value]): Array<[string,string]> => key === "note_num_stat" ? Object.entries(object(value)).map(([name,count]) => [({liked:"点赞过的笔记数",collected:"收藏过的笔记数",posted:"发布笔记数"} as Record<string,string>)[name] ?? `note_num_stat.${name}`,text(count)]) : [[({fans:"粉丝数",follows:"关注数",liked:"获赞数",collected:"被收藏数"} as Record<string,string>)[key] ?? key, text(value)]])} />}
    {fields.work && !fields.workId && fields.receivedNative && <p className="text-[12px] text-ink-3">接口未单列已确认作品 ID；服务端可据原生链接核实笔记 ID。AI photoId 不直接作为原生身份。</p>}
    {!rank && <p className="text-[12px] text-ink-4">userId 与作品 ID 保留完整字符串；展示号、昵称、AI authorId/photoId 不用于自行推断身份。</p>}
    {typeof body === "string" && <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p>}
    {fields.agentKey && fields.work && typeof body === "string" && <p className="text-[12px] text-ink-4">以上为笔记自带文字说明，不是视频转写或字幕。</p>}
    {(typeof time === "string" || typeof time === "number") && <p className="text-[12px] text-ink-3">上游原始时间：{String(time)}</p>}
    {fields.agentKey && Object.keys(object(record.rawTimes)).length > 0 && <KV items={Object.entries(object(record.rawTimes)).map(([key,value]) => [`原始 ${key}（单位未确认）`,text(value)])} />}
    {fields.work && <p className="text-[12px] text-ink-4">未知时区或缺少可信时间时，不把发现时间当作发表时间或今天发生；新增材料按既有历史/回填语义处理。</p>}
    {upstream && <a className="inline-block break-all text-[13px] text-accent" href={upstream} target="_blank" rel="noreferrer">{fields.receivedNative ? "原生笔记原文" : "收到的上游地址（不作为入库原文）"} ↗</a>}
    {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((address, index) => <a key={address} className="text-accent" href={address} target="_blank" rel="noreferrer">上游媒体或主页 {index + 1} ↗</a>)}</div>}
    {missing.length > 0 && <div><p className="mb-1 text-[12px] text-ink-4">上游缺项记录（导入仍由服务端据原文复核）</p><ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {fields.blockedReason && <p className="rounded-control bg-amber/10 p-3 text-[13px] text-amber">{fields.blockedReason}</p>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看作者绑定信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && !rank && !fields.recommendation && <Button size="sm" disabled={!fields.canImport || !!pending} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {!imported && fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须在详情中收到稳定 userId 才可绑定，不能人工补账号身份；请用展示小红书号显式查询账号详情。</p>}
    {fields.agentKey ? !fields.recommendation && <p className="text-[12px] text-ink-3">如需单独查询，请到<Link className="text-accent" to="/admin/redfox?view=platforms">平台查询</Link>显式选择 AgentKey 的统一笔记详情或账号资料并填写已收 ID。此操作会创建独立查询；采集订阅可显式开启同轮有界详情。</p> : <DetailQueryActions result={r} />}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, workId: r.data.workId, identity: r.data.identity, role: r.data.role, record }} label="原始字段与溯源诊断" />
    <ReasonDialog open={open} title={fields.account ? "绑定小红书账号身份" : "本地导入小红书作品"} description={fields.account ? "仅使用已收到的稳定 userId，按绑定复用，否则新建隔离 external 信源并关闭全文权限。可显式选择已核实为同一账号的 external 信源，不按昵称匹配。此命令不请求供应商。" : fields.agentKey ? "仅使用原回执中已核实的作者、笔记 ID 和原生链接，不接受手工补证或替换。新作者先隔离并关闭全文权限，重复文章保留原归属。此命令不请求供应商。" : "作品按真实作者身份归属，不指定任意目标信源。收到的身份、作品 ID 和地址不可替换；只补缺失项并记录证据。人工作者身份不能继承已有非隔离权限，文章去重后保留原归属。此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (!fields.canImport) { setError(fields.blockedReason ?? "此结果暂不能导入，请显式查询并核实"); return false; }
      if (fields.account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, "external", "external", list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      if (fields.needsUrl) {
        const native = xiaohongshuNativeNote(url.trim());
        if (!native) { setError("请填写无凭证、端口或片段的 xiaohongshu.com/explore/笔记ID 原文链接"); return false; }
        if (fields.workId && fields.workId !== native.id) { setError("补充链接中的笔记 ID 必须与已收到的作品 ID 完全一致"); return false; }
      }
      if (fields.needsIdentity && (!userId.trim() || userId.trim().length > 500)) { setError("请填写已核实作者 userId 的完整原串"); return false; }
      if ((fields.needsUrl || fields.needsIdentity) && !evidence.trim()) { setError("请填写缺失字段的核实依据"); return false; }
      const supplement = fields.needsUrl || fields.needsIdentity ? { ...(fields.needsUrl ? { url: url.trim() } : {}), ...(fields.needsIdentity ? { userId: userId.trim() } : {}), evidence: evidence.trim() } : undefined;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `xiaohongshu-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      <KV items={[["已收到 userId", fields.userId ?? "未提供"], ...(fields.work ? [["已收到作品 ID", fields.workId ?? "未提供"], ["已收到上游地址", fields.receivedUrl ?? "未提供"]] as Array<[string, string]> : [])]} />
      {fields.account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} disabled={!!pending} onChange={e => setTarget(e.target.value)}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">显式选择已核实的 external 信源</option></Select></Field>{target === "existing" && <div className="space-y-3"><Field label="搜索已有 external 信源"><Input aria-label="搜索已有 external 信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="名称或 ID，人工核实同一账号" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", list.rows) ? e.target.value : "")}><option value="">请选择并核实</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{list.rows.length === 0 && <p className="text-[12px] text-ink-3">没有匹配候选，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {fields.needsUrl && <Field label="补充原生笔记原文链接" hint="例如 https://www.xiaohongshu.com/explore/AbC_123-note；可保留签名查询参数，短链与主页不接受。"><Input aria-label="补充原生笔记原文链接" type="url" required value={url} disabled={!!pending} onChange={e => setUrl(e.target.value)} /></Field>}
      {fields.needsIdentity && <Field label="补充已核实作者 userId" hint="只补缺失的稳定作者身份，不把展示号、昵称或 AI authorId 当作 userId。"><Input aria-label="补充已核实作者 userId" required maxLength={500} value={userId} disabled={!!pending} onChange={e => setUserId(e.target.value)} /></Field>}
      {(fields.needsUrl || fields.needsIdentity) && <Field label="缺失字段的核实依据"><Textarea aria-label="缺失字段的核实依据" required maxLength={1000} value={evidence} disabled={!!pending} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

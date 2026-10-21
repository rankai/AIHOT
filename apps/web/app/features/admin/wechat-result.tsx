import { DetailQueryActions } from "./detail-query-actions";
import { useCallback, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { candidateSelectionValid } from "./candidate-selection";
import { useAdminAction } from "./action";
import { MODE_LABEL } from "./labels";
import type { OperationResult } from "./operation-types";
import { safeExternalUrl } from "./platform-types";
import type { ExternalCandidates } from "./weibo-result";
import { wechatArticleLink, wechatImportFields } from "./wechat-result-data";
import { Badge, Button, Field, Input, Json, KV, ReasonDialog, Select, Textarea } from "./ui";
export function WechatResult({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [target, setTarget] = useState("auto");
  const [sourceKind, setSourceKind] = useState("external");
  const [searchedKind, setSearchedKind] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [identityType, setIdentityType] = useState<"wxId" | "bizInfo">("wxId");
  const [identityValue, setIdentityValue] = useState("");
  const [url, setUrl] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fields = wechatImportFields(r.kind, r.data, url);
  const record = r.data.record && typeof r.data.record === "object" && !Array.isArray(r.data.record) ? r.data.record as Record<string, unknown> : {};
  const missing = Array.isArray(r.data.missing) ? r.data.missing.filter((item): item is string => typeof item === "string") : [];
  const body = record.articleContent ?? record.content;
  const summary = record.articleSummary ?? record.summary;
  const published = record.publishDate ?? record.publishTime ?? record.publicTime;
  const media = [...new Set([...(Array.isArray(record.imageUrls) ? record.imageUrls : []), ...(Array.isArray(record.picList) ? record.picList.map(item => item && typeof item === "object" ? item.picUrl : null) : []), record.avatarUrl, record.coverUrl, record.coverImageUrl, record.videoLink].map(safeExternalUrl).filter((address): address is string => address !== null))];
  const search = (page = 1) => { setSourceId(""); const params = new URLSearchParams(location.search); params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", sourceKind); setSearchedKind(sourceKind); candidates.load(`${location.pathname}?${params}`); };
  const list = candidates.state === "idle" && searchedKind === sourceKind ? candidates.data?.externalCandidates : null;
  const imported = !!r.sourceId || !!r.articleId;
  return <article className="space-y-3 border-b border-line pb-4 last:border-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium"><span>{typeof r.data.title === "string" ? r.data.title : "公众号查询结果"}</span><Badge>{r.kind === "wechat_account_rank" ? "账号研究榜单" : fields.account ? "公众号账号" : "公众号作品"}</Badge></div>
    {r.kind === "wechat_account_rank" && <p className="text-[12.5px] text-ink-3">这是账号研究结果，只可按已收到的稳定身份绑定账号，不能当作文章。明确的代表作品单独显示为作品结果。</p>}
    <KV items={[["已收到原始 gh_ ID", fields.wxId ?? "未提供"], ["已收到账号采集 ID", fields.bizInfo ?? "未提供"], ...(fields.account && typeof record.account === "string" ? [["展示微信号", record.account]] as Array<[string, string]> : [])]} />
    {typeof summary === "string" && <p className="whitespace-pre-wrap break-words text-[13px] text-ink-3">{summary}</p>}
    {typeof body === "string" && <details className="rounded-control bg-bg-sunk p-3"><summary className="cursor-pointer text-[12px] text-ink-3">正文原始文本（不执行 HTML）</summary><p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{body}</p></details>}
    {typeof published === "string" && <p className="text-[12px] text-ink-3">上游原始时间：{published}</p>}
    {!fields.account && <p className="text-[12px] text-ink-4">缺少可信时间的新增材料按既有历史/回填语义处理；发现时间不会冒充发表时间。</p>}
    {fields.original && <a className="inline-block text-[13px] text-accent" href={fields.original} target="_blank" rel="noreferrer">公众号原文 ↗</a>}
    {media.length > 0 && <div className="flex flex-wrap gap-3 text-[12px]">{media.map((address, index) => <a key={address} className="text-accent" href={address} target="_blank" rel="noreferrer">上游媒体 {index + 1} ↗</a>)}</div>}
    {missing.length > 0 && <ul className="space-y-1 rounded-control bg-amber/10 p-3 text-[12.5px] text-amber">{missing.map(item => <li key={item}>{item}</li>)}</ul>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>{fields.account ? "查看已绑定信源" : "查看作者绑定信源"}</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!fields.canImport || !!pending} onClick={() => setOpen(true)}>{fields.account ? "绑定账号信源" : "本地导入作品"}</Button>}</div>
    {!imported && fields.account && !fields.canImport && <p className="text-[12px] text-amber">账号必须收到稳定 wxId 或 bizInfo 才可绑定；不使用昵称或供应商榜单数字 ID 补身份，也不隐式请求付费详情。</p>}
    <Json value={{ resultId: r.id, receiptId: r.receiptId, operationId: r.data.operationId, identity: r.data.identity, record }} label="原始字段与溯源诊断" />
    <DetailQueryActions result={r} />
    <ReasonDialog open={open} title={fields.account ? "绑定公众号账号身份" : "本地导入公众号作品"} description={fields.account ? "按已收到的稳定身份复用绑定，否则新建隔离 external 信源并关闭全文权限。也可显式选择已核实为同一账号的 external 或公众号信源；不按昵称匹配，不自动切换主采集器。此命令不请求供应商。" : "作品按真实作者身份绑定，不指定任意目标信源。收到的身份与原文不可替换，只补缺失项并记录证据；人工身份不能继承已有非隔离权限。文章去重后保留原文章归属。此命令不请求供应商。"} busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (fields.account && target === "existing" && !candidateSelectionValid(sourceId, candidates.state, sourceKind, searchedKind, list?.rows)) { setError(candidates.state !== "idle" ? "请等待候选搜索完成后重新选择信源" : "请从当前候选列表重新选择已核实为同一账号的信源"); return false; }
      if (fields.needsUrl && !wechatArticleLink(url.trim())) { setError("请填写无账号密码的 mp.weixin.qq.com 原文地址"); return false; }
      if (fields.needsIdentity && (identityType === "wxId" ? !/^gh_[A-Za-z0-9]+$/.test(identityValue.trim()) || identityValue.trim().length > 100 : !identityValue.trim() || identityValue.trim().length > 500)) { setError("请填写符合所选类型的稳定身份原串"); return false; }
      if ((fields.needsUrl || fields.needsIdentity) && !evidence.trim()) { setError("请填写缺失字段的核实依据"); return false; }
      const supplement = fields.needsUrl || fields.needsIdentity ? { ...(fields.needsUrl ? { url: url.trim() } : {}), ...(fields.needsIdentity ? { [identityType]: identityValue.trim() } : {}), evidence: evidence.trim() } : undefined;
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, { reason, ...(fields.account && target === "existing" ? { sourceId } : {}), ...(supplement ? { supplement } : {}) }, { label: `wechat-import:${r.id}`, success: "本地导入已完成" }) !== null;
    }}>
      <KV items={[["已收到 gh_ ID", fields.wxId ?? "未提供"], ["已收到 bizInfo", fields.bizInfo ?? "未提供"], ...(!fields.account ? [["已收到原文", fields.original ?? "未提供"]] as Array<[string, string]> : [])]} />
      {fields.account && <><Field label="账号信源目标"><Select aria-label="账号信源目标" value={target} disabled={!!pending} onChange={e => setTarget(e.target.value)}><option value="auto">按稳定身份复用，否则新建隔离信源</option><option value="existing">显式选择已核实的已有信源</option></Select></Field>{target === "existing" && <div className="space-y-3"><Field label="候选信源类型"><Select aria-label="候选信源类型" value={sourceKind} disabled={!!pending} onChange={e => { setSourceKind(e.target.value); setSourceId(""); }}><option value="external">external 外部信源</option><option value="mp_account">公众号主采集信源</option></Select></Field><p className="text-[12px] text-ink-3">公众号源优先核对 ghid；没有 ghid 时，才核对完整配置 wxid 与收到的展示微信号相同。最终匹配由服务端完成。</p><Field label="搜索已有信源"><Input aria-label="搜索已有信源" value={query} disabled={!!pending} onChange={e => setQuery(e.target.value)} placeholder="输入名称或 ID，人工核实同一账号" /></Field><Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>{candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，已清除上次选择。</p>}{list && <><Field label="已核实为同一账号的信源"><Select aria-label="已核实为同一账号的信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, sourceKind, searchedKind, list?.rows) ? e.target.value : "")}><option value="">请选择并核实</option>{list.rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · {MODE_LABEL[source.participation_mode] ?? source.participation_mode}</option>)}</Select></Field><div className="flex gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{list.rows.length === 0 && <p className="text-[12px] text-ink-3">没有匹配候选，请修改搜索或使用默认隔离目标。</p>}</>}</div>}</>}
      {fields.needsUrl && <Field label="补充公众号原文地址" hint="例如 https://mp.weixin.qq.com/s/短链标识，或 /s?__biz=…&mid=123&idx=1；最终文章形状与身份由服务端核验。"><Input aria-label="补充公众号原文地址" type="url" required disabled={!!pending} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mp.weixin.qq.com/s/..." /></Field>}
      {fields.needsIdentity && <><Field label="补充一种已核实稳定身份"><Select aria-label="补充身份类型" value={identityType} disabled={!!pending} onChange={e => { setIdentityType(e.target.value as typeof identityType); setIdentityValue(""); }}><option value="wxId">原始 gh_ ID（wxId）</option><option value="bizInfo">账号采集 ID（bizInfo / __biz）</option></Select></Field><Field label="已核实身份原串" hint="已有任一稳定身份即可，不以展示微信号或昵称代替。"><Input aria-label="已核实身份原串" required maxLength={identityType === "wxId" ? 100 : 500} pattern={identityType === "wxId" ? "gh_[A-Za-z0-9]+" : undefined} disabled={!!pending} value={identityValue} onChange={e => setIdentityValue(e.target.value)} /></Field></>}
      {!fields.account && fields.urlIdentity && !fields.hasIdentity && <p className="text-[12px] text-ink-3">原文长链接含账号身份，由服务端核实；无需另填备用 ID。</p>}
      {(fields.needsUrl || fields.needsIdentity) && <Field label="补充字段的核实依据"><Textarea aria-label="补充字段的核实依据" required maxLength={1000} disabled={!!pending} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </article>;
}

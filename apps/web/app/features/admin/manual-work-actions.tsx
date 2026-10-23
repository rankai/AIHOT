import { useCallback, useEffect, useState } from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { candidateSelectionValid } from "./candidate-selection";
import { manualWorkCandidates, manualWorkDefaultUrl, manualWorkDetailRequest, manualWorkImportRequest, manualWorkPlatform } from "./manual-work-data";
import type { OperationAccepted, OperationResult } from "./operation-types";
import type { ExternalCandidates } from "./weibo-result";
import { Button, Field, Input, ReasonDialog, Select, Textarea } from "./ui";

export function ManualWorkActions({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const candidates = useFetcher<{ externalCandidates: ExternalCandidates | null }>();
  const location = useLocation(), navigate = useNavigate();
  const [open, setOpen] = useState(false), [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState(""), [url, setUrl] = useState(() => manualWorkDefaultUrl(r.data));
  const [evidence, setEvidence] = useState(""), [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { if (candidates.state !== "idle") setSourceId(""); }, [candidates.state]);
  const platform = manualWorkPlatform(r.kind, r.data);
  if (!platform) return null;
  const name = platform === "shipinhao" ? "视频号" : "快手";
  const detail = manualWorkDetailRequest(r.id, r.kind, r.data);
  const detailEligible = ["E7G00COY", "OVUTOTCV", "27DQ6SF9", "ZWR31P2A"].includes(String(r.data.operationId));
  const imported = !!r.sourceId || !!r.articleId;
  const list = candidates.state === "idle" ? candidates.data?.externalCandidates : null;
  const rows = manualWorkCandidates(list?.rows);
  const search = (page = 1) => {
    setSourceId("");
    const params = new URLSearchParams(location.search);
    params.set("externalQ", query.trim()); params.set("externalPage", String(page)); params.set("candidateKind", "external");
    candidates.load(`${location.pathname}?${params}`);
  };
  return <div className="min-w-0 space-y-3">
    {typeof r.data.originResultId === "number" && Number.isSafeInteger(r.data.originResultId) && r.data.originResultId > 0 && <p className="text-[12px] text-ink-3">来源结果 #{r.data.originResultId}；服务端保留原发现时间。来源证据不补作详情实际收到的作品 ID。</p>}
    {detailEligible && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><Button size="sm" disabled={!detail || !!pending} busy={pending === `manual-work-detail:${r.id}`} onClick={async () => {
      if (!detail) return;
      const accepted = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", detail, { label: `manual-work-detail:${r.id}`, revalidate: false });
      if (accepted) navigate(`/admin/operations/${accepted.runId}`);
    }}>查询此作品详情</Button><p className="text-[12px] text-ink-3">新建普通只读查询任务，文档基价 0.04 元/请求，实际实扣未核对；使用 query 次数预算。原任务和结果不改写，不自动导入。</p>{!detail && <p className="text-[12px] text-amber">此项没有实际收到的{platform === "shipinhao" ? " videoId" : " photoId"}，不能用请求 ID、其他种类 ID 或昵称发起同作品详情。</p>}</div>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看人工归属的作者信源</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!!pending} onClick={() => setOpen(true)}>逐项人工导入作品</Button>}</div>
    {!imported && <p className="text-[12px] text-ink-3">结果保留在此；只有人工选择隔离信源、核实本项原文及作者关系并明确导入，才进入材料链。不建立稳定账号绑定，不继承其他权限。</p>}
    <ReasonDialog open={open} title={`人工导入${name}作品`} description="必须显式选择已启用的隔离 external 信源，并核实此项作品原文与所选作者的关系。不会按昵称自动匹配或绑定永久账号，也不提高参与方式、全文或一手权限；旧文章去重保留原归属。此命令不请求供应商。" busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      const command = manualWorkImportRequest(r.kind, r.data, { sourceId, url, evidence, reason }, candidates.state, rows);
      if (command.error) { setError(command.error); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, command.body, { label: `manual-work-import:${r.id}`, success: "人工导入已完成" }) !== null;
    }}>
      <p className="text-[12px] text-ink-3">没有合适信源时，可先<Link className="text-accent" to="/admin/sources/new?template=isolated-external" target="_blank" rel="noreferrer">在新标签页新建隔离 external 信源</Link>，填写名称与 ID 并明确创建后，再回此处搜索；本页输入保留。</p>
      <Field label="搜索隔离 external 信源"><Input aria-label="搜索隔离 external 信源" disabled={!!pending} value={query} onChange={e => { setQuery(e.target.value); setSourceId(""); }} placeholder="名称或 ID，逐项核实作者关系" /></Field>
      <Button size="sm" disabled={!query.trim() || !!pending} busy={candidates.state !== "idle"} onClick={() => search()}>搜索候选</Button>
      {candidates.state !== "idle" && <p role="status" className="text-[12px] text-ink-3">正在搜索，旧选择已失效。</p>}
      {list && <><Field label="人工确认的作者信源"><Select aria-label="人工确认的作者信源" value={sourceId} disabled={!!pending || candidates.state !== "idle"} onChange={e => setSourceId(candidateSelectionValid(e.target.value, candidates.state, "external", "external", rows) ? e.target.value : "")}><option value="">必须明确选择</option>{rows.map(source => <option key={source.id} value={source.id}>{source.name} · {source.id} · 隔离</option>)}</Select></Field><div className="flex flex-wrap gap-2">{list.page > 1 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page - 1)}>上一批</Button>}{list.rows.length === 100 && <Button size="sm" busy={candidates.state !== "idle"} onClick={() => search(list.page + 1)}>下一批</Button>}</div>{!rows.length && <p className="text-[12px] text-ink-3">本批没有隔离候选，请修改搜索或翻页。</p>}</>}
      <p className="text-[12px] text-ink-4">仅显示当前候选页的隔离信源；启用状态、类型与权限仍由服务端重新检查。</p>
      <Field label="已核实的作品原文" hint={<span className="break-all">{platform === "shipinhao" ? "仅支持 https://weixin.qq.com/sph/原文标识；不把 videoId 与 exportId 互换。" : "仅支持 https://www.kuaishou.com/short-video/原文标识；供应商 photoId 不一定等于原文路径 ID。"} 不接受短链、主页、媒体、凭证、端口或片段。</span>}><Input aria-label="已核实的作品原文" type="url" required value={url} disabled={!!pending} onChange={e => setUrl(e.target.value)} /></Field>
      {r.data.operationId === "MH5YA9DL" && <p className="break-all text-[12px] text-amber">已预填本次查询的分享地址：{typeof r.data.inputUrl === "string" ? r.data.inputUrl : "未提供"}。只能导入该输入对应的原文；换成其他作品会被服务端拒绝。仍须人工核实并填写依据。</p>}
      <Field label="本项原文与作者关系的核实依据" hint="说明如何确认这条作品、原文和所选信源属于同一作者；昵称或媒体 CDN 地址本身不构成依据。"><Textarea aria-label="本项原文与作者关系的核实依据" required maxLength={1000} disabled={!!pending} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </div>;
}

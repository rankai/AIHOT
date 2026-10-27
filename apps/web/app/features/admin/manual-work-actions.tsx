import { useWorkSource, WorkSourceNotice } from "./source-ownership";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAdminAction } from "./action";
import { manualWorkDefaultUrl, manualWorkDetailRequest, manualWorkImportRequest, manualWorkPlatform } from "./manual-work-data";
import type { OperationAccepted, OperationResult } from "./operation-types";
import { Button, Field, Input, ReasonDialog, Textarea } from "./ui";

export function ManualWorkActions({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const ownership = useWorkSource(), navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(() => manualWorkDefaultUrl(r.data));
  const [evidence, setEvidence] = useState(""), [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const platform = manualWorkPlatform(r.kind, r.data);
  if (!platform) return null;
  const name = platform === "shipinhao" ? "视频号" : "快手";
  const detail = manualWorkDetailRequest(r.id, r.kind, r.data);
  const detailEligible = ["E7G00COY", "OVUTOTCV", "27DQ6SF9", "ZWR31P2A"].includes(String(r.data.operationId));
  const imported = !!r.sourceId || !!r.articleId;
  const receivedUrl = manualWorkDefaultUrl(r.data);
  return <div className="min-w-0 space-y-3">
    {typeof r.data.originResultId === "number" && Number.isSafeInteger(r.data.originResultId) && r.data.originResultId > 0 && <p className="text-[12px] text-ink-3">来源结果 #{r.data.originResultId}；服务端保留原发现时间。来源证据不补作详情实际收到的作品 ID。</p>}
    {detailEligible && <div className="space-y-2 rounded-control bg-bg-sunk p-3"><Button size="sm" disabled={!detail || !!pending} busy={pending === `manual-work-detail:${r.id}`} onClick={async () => {
      if (!detail) return;
      const accepted = await run<OperationAccepted>("POST", "/api/admin/redfox/queries", detail, { label: `manual-work-detail:${r.id}`, revalidate: false });
      if (accepted) navigate(`/admin/operations/${accepted.runId}`);
    }}>查询此作品详情</Button><p className="text-[12px] text-ink-3">新建普通只读查询任务，文档基价 0.04 元/请求，实际实扣未核对；使用 query 次数预算。原任务和结果不改写，不自动导入。</p>{!detail && <p className="text-[12px] text-amber">此项没有实际收到的{platform === "shipinhao" ? " videoId" : " photoId"}，不能用请求 ID、其他种类 ID 或昵称发起同作品详情。</p>}</div>}
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看所属信源</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!imported && <Button size="sm" disabled={!!pending || !ownership.ready} onClick={() => setOpen(true)}>逐项人工导入作品</Button>}</div>
    {!imported && <p className="text-[12px] text-ink-3">作品归入结果区确认的所属信源；已收原文可直接导入，缺原文时仅补本项原文与作品对应的核实依据。</p>}
    <ReasonDialog open={open} title={`人工导入${name}作品`} description="沿用已确认的所属信源及其当前参与方式；作者 ID 仅作可选溯源，不要求核实作者关系或建立账号绑定。已收原文无需补证，缺原文才补原文与核实依据。旧文章去重保留原归属。入库在本地执行；若关联有效订阅已开启自动保存视频，必要时可产生 Redfox 媒体解析费用，受既有预算控制。" busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      if (!ownership.ready) { setError("请先在结果区确认所属信源。"); return false; }
      const command = manualWorkImportRequest(r.kind, r.data, { ...ownership.body(), url, evidence, reason });
      if (command.error) { setError(command.error); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, command.body, { label: `manual-work-import:${r.id}`, success: "人工导入已完成" }) !== null;
    }}>
      <WorkSourceNotice />
      {receivedUrl ? <p className="break-all text-[13px] text-ink-3">已收到原文：<a className="text-accent" href={receivedUrl} target="_blank" rel="noreferrer">{receivedUrl}</a>。无需再补原文或核验依据。</p> : <>
      <Field label="已核实的作品原文" hint={<span className="break-all">{platform === "shipinhao" ? "仅支持 https://weixin.qq.com/sph/原文标识；不把 videoId 与 exportId 互换。" : "仅支持 https://www.kuaishou.com/short-video/原文标识；供应商 photoId 不一定等于原文路径 ID。"} 不接受短链、主页、媒体、凭证、端口或片段。</span>}><Input aria-label="已核实的作品原文" type="url" required value={url} disabled={!!pending} onChange={e => setUrl(e.target.value)} /></Field>
      <Field label="本项原文的核实依据" hint="说明如何确认该原文对应本项作品；不要求证明作者与所选信源的关系。"><Textarea aria-label="本项原文的核实依据" required maxLength={1000} disabled={!!pending} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field>
      </>}
      {error && <p role="alert" className="text-[13px] text-hot">{error}</p>}
    </ReasonDialog>
  </div>;
}

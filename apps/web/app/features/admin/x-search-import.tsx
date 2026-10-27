import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useAdminAction } from "./action";
import type { OperationResult } from "./operation-types";
import { xSearchImportBody, xSearchImportState } from "./x-search-import-data";
import { Button, ReasonDialog } from "./ui";

export function XSearchImport({ result: r }: { result: OperationResult }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []), state = xSearchImportState(r);
  if (!state.supported) return null;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3 text-[13px]">{r.sourceId && <Link className="text-accent" to={`/admin/sources/${encodeURIComponent(r.sourceId)}`}>查看作者绑定信源</Link>}{r.articleId && <Link className="text-accent" to={`/admin/content/${encodeURIComponent(r.articleId)}`}>{r.articleTitle || "查看已关联文章"}（保留文章原归属）</Link>}{!state.linked && <Button size="sm" disabled={!state.canImport || !!pending} onClick={() => setOpen(true)}>本地导入作品</Button>}</div>
    {!state.linked && state.issues.length > 0 && <p className="whitespace-pre-wrap break-words text-[12px] text-amber">{state.issues.join("；")}。请先核实上游结果，本入口不补造身份、正文或时间；后台仍会重新校验。</p>}
    {!state.linked && Object.hasOwn(r.data, "pendingReason") && <div className="text-[12px] text-amber"><p>本地处理待核实原因</p><p className="whitespace-pre-wrap break-all">{typeof r.data.pendingReason === "string" ? r.data.pendingReason : JSON.stringify(r.data.pendingReason)}</p></div>}
    <ReasonDialog open={open} title="本地导入 X 作品" description="仅按实收稳定作者 userId 的既有绑定归属；新作者新建隔离 external 信源并关闭全文，已有作者权限保留。详情缺少 handle 时，仅可由后台核实的同 userId 上下文补足；原始作者字段仍保留。此操作不请求供应商，不按 handle 猜身份，也不提高参与或全文权限。身份冲突、需全文的 X Article 等情况由后台阻断，旧文章去重保留原归属。" busy={!!pending} onClose={close} onSubmit={async reason => {
      setError(null);
      let body: ReturnType<typeof xSearchImportBody>;
      try { body = xSearchImportBody(r, reason); } catch (error) { setError((error as Error).message); return false; }
      return await run("POST", `/api/admin/operations/results/${r.id}/import`, body, { label: `x-search-import:${r.id}`, success: "作品已本地导入" }) !== null;
    }}>{error && <p role="alert" className="text-[13px] text-hot">{error}</p>}</ReasonDialog>
  </div>;
}

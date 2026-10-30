import { AdminMembership } from '../account/membership';
import { useState } from "react";
import { useAdminAction } from "./action";
import { Button, Card, Input, Select, Textarea } from "./ui";
import { CreditBalanceSummary, CreditLedger, useCreditPage } from "../account/credits";
import { AccountNotice } from "../account/fields";

export function AdminUserCredits({ userId }: { userId: number }) {
  return <UserCreditPanel key={userId} userId={userId} />;
}

function UserCreditPanel({ userId }: { userId: number }) {
  const { page, loading, error, refresh, loadMore } = useCreditPage(`/api/admin/users/${userId}/credits`, true);
  const { run, pending } = useAdminAction();
  const [kind, setKind] = useState<"grant" | "adjustment">("grant");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  return <Card title="用户积分" right={<Button size="sm" disabled={loading || !!pending} onClick={() => void refresh()}>刷新</Button>}>
    <AdminMembership userId={userId} onChanged={refresh}/>{error && <AccountNotice error message={error} />}
    {page ? <CreditBalanceSummary page={page} /> : loading && <p className="text-[13px] text-ink-3">正在读取积分…</p>}
    <form className="my-5 space-y-4 border-y border-line py-5" onSubmit={async event => {
      event.preventDefault(); setNotice(null);
      const result = await run("POST", `/api/admin/users/${userId}/credits`, { kind, amount: Number(amount), reason: reason.trim() }, { label: "user-credit-change", success: "积分已更新" });
      if (result) { setAmount(""); setReason(""); setNotice("积分已更新，操作已写入流水与审计。"); await refresh(); }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-[12.5px] text-ink-2"><span>操作</span><Select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setAmount(""); }}><option value="grant">发放积分</option><option value="adjustment">人工纠错调整</option></Select></label>
        <label className="space-y-1.5 text-[12.5px] text-ink-2"><span>{kind === "grant" ? "发放数量" : "调整数量（正数增加，负数减少）"}</span><Input type="number" required min={kind === "grant" ? 1 : undefined} step={1} value={amount} onChange={event => setAmount(event.target.value)} /></label>
      </div>
      <label className="block space-y-1.5 text-[12.5px] text-ink-2"><span>原因（记录在积分流水与审计中）</span><Textarea required maxLength={500} rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder={kind === "grant" ? "例如：发放本次试用额度" : "说明原始记录与纠错依据"} /></label>
      <p className="text-[12px] leading-relaxed text-ink-4">调整会追加记录，不会改写历史流水；减少积分不能超过当前可用余额。</p>
      <AccountNotice message={notice} />
      <Button type="submit" tone="primary" busy={!!pending} disabled={!reason.trim() || !amount || !Number.isSafeInteger(Number(amount)) || Number(amount) === 0 || kind === "grant" && Number(amount) < 1}>{kind === "grant" ? "发放积分" : "保存调整"}</Button>
    </form>
    {page && <><CreditLedger entries={page.entries} admin />{page.nextCursor && <div className="mt-4 text-center"><Button size="sm" disabled={loading} onClick={() => void loadMore()}>{loading ? "正在加载…" : "查看更早记录"}</Button></div>}</>}
  </Card>;
}

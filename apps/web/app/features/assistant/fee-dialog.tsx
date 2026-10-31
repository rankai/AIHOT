import { useEffect, useRef, useState } from "react";
import type { AssistantFeeAuthorization, AssistantFeeSettings } from "@aihot/contracts/assistant";
import { Button, Input } from "../admin/ui";
import { toolGet, useToolCommand } from "../tools/client";
import { sessionApi } from "./data";

export function AssistantFeeDialog({ sessionId, csrf, initial, close, changed }: {
  sessionId: string; csrf: string; initial: AssistantFeeAuthorization | null; close: () => void; changed: (authorization: AssistantFeeAuthorization | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<AssistantFeeSettings | null>(null);
  const [authorization, setAuthorization] = useState(initial);
  const [total, setTotal] = useState(initial ? String(initial.totalLimit) : "");
  const [allowSearch, setAllowSearch] = useState(initial?.allowSearch ?? false);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const command = useToolCommand(csrf, `assistant:fees:${sessionId}`);
  const alive = useRef(true);
  const amount = Number(total);
  const valid = /^\d+$/.test(total) && Number.isSafeInteger(amount) && amount > 0;
  async function read(signal?: AbortSignal) {
    setReading(true); setError(null);
    try {
      const value = await toolGet<AssistantFeeSettings>(`${sessionApi(sessionId)}/fee-authorization`, signal);
      if (!alive.current) return;
      setSettings(value); setAuthorization(value.authorization);
      setTotal(value.authorization ? String(value.authorization.totalLimit) : "");
      setAllowSearch(value.authorization?.allowSearch ?? false);
      setUncertain(false); changed(value.authorization);
    } catch (cause) { if (alive.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : "无法读取费用设置。"); }
    finally { if (alive.current) setReading(false); }
  }
  useEffect(() => {
    alive.current = true; dialog.current?.showModal();
    const controller = new AbortController(); void read(controller.signal);
    return () => { alive.current = false; controller.abort(); };
  }, []);
  async function save() {
    if (command.pending || reading || uncertain || (!valid || !settings)) return;
    const body = {
      enabled: true, expectedVersion: authorization?.version ?? 0, totalLimit: amount,
      allowSearch, turnPrice: settings!.prices.turn,
      searchPrice: allowSearch ? settings!.prices.search : null,
    };
    const result = await command.run<{ authorization: AssistantFeeAuthorization | null }>(`${sessionApi(sessionId)}/fee-authorization`, body);
    if (!alive.current) return;
    if (result) { changed(result.authorization); close(); }
    else { setUncertain(true); setError("费用设置结果需要重新读取核对，再决定是否更改；不会重复授权。"); }
  }
  const prices = settings?.prices;
  return <dialog ref={dialog} className="assistant-dialog" aria-labelledby="assistant-fee-title" onCancel={(event) => { event.preventDefault(); if (!command.pending) close(); }}>
    <h2 id="assistant-fee-title" className="text-[18px] font-semibold">额度内自动</h2>
    <p className="mt-2 text-[12px] text-ink-3">仅本会话，超额再询问。</p>
    {reading && <p role="status" className="mt-3 text-[12px] text-ink-3">正在读取价格…</p>}
    <label className="mt-4 block text-[13px] text-ink-2">总额度（积分）<Input className="mt-2" type="text" inputMode="numeric" pattern="[0-9]*" value={total} placeholder="输入额度" disabled={reading || command.pending || uncertain} onChange={(event) => setTotal(event.target.value)} /></label>
    {prices && <p className="mt-2 text-[12px] text-ink-3">创作 {prices.turn.amount.toLocaleString()} 积分/次{authorization ? ` · 历史已用/占用 ${authorization.used.toLocaleString()}` : ""}</p>}
    <label className="mt-4 flex items-start gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={allowSearch} disabled={!prices?.search || reading || command.pending || uncertain} onChange={(event) => setAllowSearch(event.target.checked)} /><span>每次创作可自动查询 1 次{prices?.search ? `（${prices.search.amount} 积分）` : "（暂不可用）"}</span></label>
    <details className="mt-3 text-[12px] leading-relaxed text-ink-3"><summary className="cursor-pointer">费用详情</summary>
      {prices && <p className="mt-2">单次自动确认最高 {(prices.turn.amount + (allowSearch ? prices.search?.amount ?? 0 : 0)).toLocaleString()} 积分，额外查询单独确认。</p>}
      <p className="mt-2">总额度包含历次自动费用及未释放占用，重新开启不重置。人工额外授权另计，实际执行仍受钱包余额限制。只影响之后发送的需求，不会批准已有待确认请求。新会话不继承，关闭不会停止已批准任务或退款。</p>
    </details>
    {(error || command.error) && <div className="mt-3"><p role="alert" className="text-[12px] text-hot">{error ?? command.error}</p><Button size="sm" disabled={reading || command.pending} onClick={() => void read()}>重新读取</Button></div>}
    <div className="mt-5 flex justify-end gap-2">
      <Button disabled={command.pending} onClick={close}>取消</Button>
      <Button tone="primary" disabled={!settings || !valid || reading || command.pending || uncertain || (allowSearch && !prices?.search)} busy={command.pending} onClick={() => void save()}>{authorization?.enabled ? "保存" : "开启"}</Button>
    </div>
  </dialog>;
}

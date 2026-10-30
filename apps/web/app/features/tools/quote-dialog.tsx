import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { ToolQuote } from "@aihot/contracts/credits";
import { Button } from "../admin/ui";

export function QuoteDialog({ quote, pending, error, close, confirm }: { quote: ToolQuote; pending: boolean; error: string | null; close: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby="tool-quote-title" onCancel={event => { event.preventDefault(); if (!pending) close(); }} className="m-auto w-[calc(100%-32px)] max-w-md rounded-panel bg-surface p-6 text-ink shadow-lg backdrop:bg-black/35">
    <h2 id="tool-quote-title" className="text-[19px] font-semibold">确认本次工具任务</h2>
    <p className="mt-5 text-[13px] text-ink-3">本次所需积分</p><p className="mt-1 text-[32px] font-semibold tabular-nums">{quote.amount.toLocaleString()} <span className="text-[14px] font-normal text-ink-3">积分</span></p>
    <p className="mt-2 text-[13px] text-ink-3">当前可用 {quote.available.toLocaleString()} 积分</p>
    <p className="mt-4 text-[13px] leading-relaxed text-ink-3">个人积分与共享服务容量独立：积分充足仍可能等待会员池或全站预算恢复。提交后先占用积分，完成后结算。明确失败且没有交付结果时退回；结果未知或部分完成时由管理员核对。</p>
    {!quote.affordable && <p role="alert" className="mt-4 text-[13px] text-hot">积分不足，请联系管理员补充积分。<Link to="/account" className="ml-1 underline">查看积分</Link></p>}
    {error && <p role="alert" className="mt-4 text-[13px] text-hot">{error}</p>}
    <div className="mt-6 flex justify-end gap-3"><Button disabled={pending} onClick={close}>返回修改</Button><Button tone="primary" disabled={pending || !quote.affordable} busy={pending} onClick={confirm}>确认并执行</Button></div>
  </dialog>;
}

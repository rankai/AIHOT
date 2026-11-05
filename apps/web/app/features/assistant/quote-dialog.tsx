import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { AssistantTurnQuote } from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
/** Both quote surfaces expire at the same timestamp without polling. */
export function useQuoteExpired(expiresAt?: string) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (!(remaining > 0)) return;
    const timer = setTimeout(() => refresh(n => n + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return !expiresAt || !(Date.parse(expiresAt) > Date.now());
}

/** An explicit UI action card: this is never rendered as an assistant message. */
export function TurnQuoteDialog({
  quote,
  message,
  pending,
  requiresRequote = false,
  requote,
  error,
  close,
  confirm,
}: {
  quote: AssistantTurnQuote;
  message: string;
  pending: boolean;
  requiresRequote?: boolean;
  requote?: () => void;
  error: string | null;
  close: () => void;
  confirm: () => void;
}) {
  const titleId = useId();
  const search = quote.additionalFeeKinds?.includes("search");
  const image = quote.additionalFeeKinds?.includes("image");
  const feeNotice = quote.task ? "完成或停止后按实际执行结算，未执行部分释放。" : quote.additionalFeeKinds?.includes("vision") ? `如需${quote.additionalFeeKinds.map(kind=>({search:"查询参考",vision:"视觉分析",image:"图片生成"})[kind]).join("、")}，将分别报价并确认。` : quote.additionalFeeKinds === undefined
    ? "额外服务费用以执行前的报价为准。"
    : search && image ? "如需检索或生成图片，将另行计费；图片生成前会单独确认。"
    : search ? "如需查询参考，将另行报价并确认。"
    : image ? "图片生成另行计费，生成前会单独确认。" : null;
  const expired = useQuoteExpired(quote.expiresAt);
  return (
    <section
      aria-labelledby={titleId}
      className="assistant-quote-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={titleId}
            className="text-[13px] font-medium text-ink"
          >
            {quote.task?.label ?? "本次创作"} · {quote.task ? "预计最多 " : ""}{quote.amount.toLocaleString()} 积分
          </h2>
          <p role="status" className="mt-1 text-[12px] text-ink-3">
            {expired ? "报价已过期，刷新后查看最新费用和余额。原需求已保留。" : requiresRequote ? "请重新获取报价，查看最新费用和余额。" : `报价时可用 ${quote.available.toLocaleString()} 积分 · 报价有效`}
          </p>
        </div>

      </div>
      {feeNotice && <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{feeNotice}</p>}
      <details className="mt-2 text-[12px] text-ink-3">
        <summary className="cursor-pointer">费用与需求详情</summary>
        <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message}
        </p>
        {(expired || requiresRequote) && <p className="mt-2">报价时余额：{quote.available.toLocaleString()} 积分。</p>}
        {quote.task?.items.map(item=><p key={item.key} className="mt-1">{item.label} × {item.units}：最多 {item.amount*item.units} 积分</p>)}
        <p className="mt-2">确认后冻结上限并开始任务。未知或部分结果需要核对。</p>
      </details>
      {!expired && !requiresRequote && !quote.affordable && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          积分不足，还差 {Math.max(0,quote.amount-quote.available).toLocaleString()} 积分。
          <Link to="/account" className="ml-1 underline">
            查看积分
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {(expired || requiresRequote) && requote && <Button size="sm" disabled={pending} onClick={requote}>重新获取报价</Button>}
        <Button size="sm" disabled={pending} onClick={close}>
          取消
        </Button>
        <Button
          size="sm"
          tone="primary"
          busy={pending}
          disabled={requiresRequote || expired || !quote.affordable || pending}
          onClick={confirm}
        >
          确认开始
        </Button>
      </div>
    </section>
  );
}

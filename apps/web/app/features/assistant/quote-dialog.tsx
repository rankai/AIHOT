import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { AssistantTurnQuote } from "@aihot/contracts/assistant";
import { Button, ButtonLink } from "../admin/ui";

/** Only the frozen research policy supports stopping without a writing charge. */
function researchFeeNotice(quote: AssistantTurnQuote): string | null {
  if (!quote.task) return null;
  try {
    const scope = JSON.parse(quote.task.scope);
    const queryKey = scope.research?.policy === "xhs-empty-window@1" ? "search-xhs-notes@1"
      : scope.research?.policy === "wechat-low-raw-window@1" ? "search-wechat-hot@1" : null;
    const query = quote.task.items.find(item => item.key === queryKey);
    const creation = quote.task.items.find(item => item.key === "creation");
    if (scope.delivery !== "writing" || !query || !creation || quote.task.items.length !== 2 || creation.units !== 1 ||
      ![1, 2].includes(query.units) || query.units !== scope.research.maximumQueries ||
      ![query.amount, creation.amount].every(amount => Number.isInteger(amount) && amount >= 0) ||
      query.amount * query.units + creation.amount !== quote.amount) return null;
    return `查询每次 ${query.amount.toLocaleString()} 积分，最多 ${query.units} 次；没搜到只收查询费。`;
  } catch { return null; }
}
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
  showRequest = true,
  pending,
  requiresRequote = false,
  requote,
  error,
  close,
  confirm,
}: {
  quote: AssistantTurnQuote;
  message: string;
  showRequest?: boolean;
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
  const feeNotice = researchFeeNotice(quote) ?? (quote.task ? "完成或停止后按实际执行结算，未执行部分释放。" : quote.additionalFeeKinds?.includes("vision") ? `如需${quote.additionalFeeKinds.map(kind=>({search:"查询参考",vision:"视觉分析",image:"图片生成"})[kind]).join("、")}，将分别报价并确认。` : quote.additionalFeeKinds === undefined
    ? "额外服务费用以执行前的报价为准。"
    : search && image ? "如需检索或生成图片，将另行计费；图片生成前会单独确认。"
    : search ? "如需查询参考，将另行报价并确认。"
    : image ? "图片生成另行计费，生成前会单独确认。" : null);
  const expired = useQuoteExpired(quote.expiresAt);
  return (
    <section
      aria-labelledby={titleId}
      className="assistant-quote-card"
    >
      {showRequest && <p className="mb-3 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-ink-2 [overflow-wrap:anywhere]">{message}</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={titleId}
            className="text-[13px] font-medium text-ink"
          >
            {quote.task?.label ?? "本次创作"} · {quote.task ? "最多 " : ""}{quote.amount.toLocaleString()} 积分
          </h2>
          {(expired || requiresRequote) && <p role="status" className="mt-1 text-[12px] text-ink-3">
            {expired ? "报价已过期，请重新获取最新费用和余额。原需求已保留。" : "请重新获取报价，查看最新费用和余额。"}
          </p>}
        </div>

      </div>
      {feeNotice && <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{feeNotice}</p>}
      <details className="mt-2 text-[12px] text-ink-3">
        <summary className="cursor-pointer">费用与需求详情</summary>
        <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message}
        </p>
        <p className="mt-2">报价时余额：{quote.available.toLocaleString()} 积分。</p>
        {quote.task?.items.map(item=><p key={item.key} className="mt-1">{item.label} × {item.units}：最多 {item.amount*item.units} 积分</p>)}
        <p className="mt-2">确认后冻结上限并开始任务。未知或部分结果需要核对。</p>
      </details>
      {!expired && !requiresRequote && !quote.affordable && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          积分不足，还差 {Math.max(0,quote.amount-quote.available).toLocaleString()} 积分。
          {requote && <Link to="/account" className="ml-1 underline">查看积分</Link>}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={close}>
          取消
        </Button>
        {(expired || requiresRequote || !quote.affordable) && requote && <Button size="sm" tone="primary" busy={pending} onClick={requote}>重新获取报价</Button>}
        {!expired && !requiresRequote && !quote.affordable && !requote && <ButtonLink to="/account" size="sm" tone="primary">查看积分</ButtonLink>}
        {!expired && !requiresRequote && quote.affordable && <Button
          size="sm"
          tone="primary"
          busy={pending}
          disabled={pending}
          onClick={confirm}
        >
          确认开始
        </Button>}
      </div>
    </section>
  );
}

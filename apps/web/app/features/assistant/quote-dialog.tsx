import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { AssistantTurnQuote } from "@aihot/contracts/assistant";
import { Button, ButtonLink } from "../admin/ui";
import { assistantCreditsHref } from "../account/data";
import { useQuoteBalance } from "./use-quote-balance";

// Queue snapshots currently expose the server's error text rather than its error code.
export const isInsufficientCreditsNotice = (message?: string | null) =>
  !!message && /^本次预计需要 [\d,]+ 积分，当前可用 [\d,]+ 积分，还差 [\d,]+ 积分。$/.test(message);
const isServiceBudgetNotice = (message?: string | null) => !!message &&
  (/^图片服务额度暂不可用/.test(message) || /^(?:助手模型|笔记检索|服务)(?:会员|全站)预算暂不可用$/.test(message) || /^Budget for \S+ exhausted \(/.test(message));

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
  continueAutomatically = false,
  showRejectedBalance = false,
  balanceUnavailable = false,
  serviceUnavailable = false,
  returnTo,
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
  continueAutomatically?: boolean;
  showRejectedBalance?: boolean;
  balanceUnavailable?: boolean;
  serviceUnavailable?: boolean;
  returnTo?: string;
  requote?: () => void;
  error: string | null;
  close: () => void;
  confirm: () => void;
}) {
  const titleId = useId();
  const search = quote.additionalFeeKinds?.includes("search");
  const image = quote.additionalFeeKinds?.includes("image");
  const feeNotice = researchFeeNotice(quote) ?? (quote.task ? "完成或停止后按实际执行结算，未用积分退回可用余额。" : quote.additionalFeeKinds?.includes("vision") ? `如需${quote.additionalFeeKinds.map(kind=>({search:"查询参考",vision:"视觉分析",image:"图片生成"})[kind]).join("、")}，将分别报价并确认。` : quote.additionalFeeKinds === undefined
    ? "额外服务费用以执行前的报价为准。"
    : search && image ? "如需检索或生成图片，将另行计费；图片生成前会单独确认。"
    : search ? "如需查询参考，将另行报价并确认。"
    : image ? "图片生成另行计费，生成前会单独确认。" : null);
  const expired = useQuoteExpired(quote.expiresAt);
  const needsUpdate = expired || requiresRequote;
  const serviceBlocked = serviceUnavailable || isServiceBudgetNotice(error);
  const needsBalance = !serviceBlocked && (!quote.affordable || showRejectedBalance || balanceUnavailable);
  const { read, refresh } = useQuoteBalance(quote.quoteId, needsBalance);
  const available = read?.status === "ready" ? read.available! : read?.status === "error" || balanceUnavailable || showRejectedBalance ? null : quote.available;
  const insufficient = !serviceBlocked && available !== null && available < quote.amount;
  const balanceFailed = read?.status === "error" || balanceUnavailable && !read;
  const balanceLabel = available === null ? null : `${read?.status === "ready" ? "刚更新：可用" : "报价时可用"} ${available.toLocaleString()} 积分${needsUpdate ? "（仅供参考）" : ""}`;
  const errorNotice = error && !isInsufficientCreditsNotice(error) && !serviceBlocked ? error : null;
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
            {quote.task?.label ?? "本次创作"} · {needsUpdate ? "上次预计" : "本次最多"} {quote.amount.toLocaleString()} 积分
          </h2>
          {balanceLabel && <p className="mt-1 text-[12px] text-ink-3">{balanceLabel}</p>}
          {needsUpdate && <p role="status" className="mt-1 text-[12px] text-ink-3">
            费用需要更新，需求已保留。
          </p>}
        </div>

      </div>
      {feeNotice && <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{feeNotice}</p>}
      <details className="mt-2 text-[12px] text-ink-3">
        <summary className="cursor-pointer">费用与需求详情</summary>
        <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message}
        </p>
        {quote.task?.items.map(item=><p key={item.key} className="mt-1">{item.label} × {item.units}：最多 {item.amount*item.units} 积分</p>)}
        <p className="mt-2">确认后预留本次上限并开始任务。未知或部分结果需要核对。</p>
      </details>
      {!needsUpdate && insufficient && available !== null && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          还差 {Math.max(0, quote.amount - available).toLocaleString()} 积分。{read?.status === "ready" ? "按刚更新的可用积分计算。" : "按报价时可用积分计算，可刷新余额核对。"}
        </p>
      )}
      {balanceFailed && <p role="status" className="mt-2 text-[12px] text-ink-3">{read?.error ?? "暂时无法读取积分。"}</p>}
      {read?.status === "loading" && <p role="status" className="mt-2 text-[12px] text-ink-3">正在读取积分…</p>}
      {serviceBlocked && <p role="status" className="mt-2 text-[12px] text-ink-3">服务暂时不可用，需求已保留。可稍后再试或<Link to="/feedback" target="_blank" rel="noopener noreferrer" className="ml-1 underline">联系管理员（新页面）</Link>。</p>}
      {errorNotice && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          {errorNotice}
        </p>
      )}
      {needsUpdate && requote && continueAutomatically && <p className="mt-2 text-[12px] text-ink-3">更新后按本次费用上限开始。</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {insufficient && (pending ? <Button size="sm" tone="primary" disabled>补充积分</Button> : <ButtonLink to={assistantCreditsHref(returnTo)} size="sm" tone="primary">补充积分</ButtonLink>)}
        {needsBalance && <Button size="sm" tone={available === null ? "primary" : "secondary"} disabled={pending || read?.status === "loading"} onClick={() => void refresh()}>{balanceFailed ? "重试读取" : "刷新余额"}</Button>}
        {available === null && !serviceBlocked && (pending ? <Button size="sm" disabled>查看积分</Button> : <ButtonLink to={assistantCreditsHref(returnTo)} size="sm">查看积分</ButtonLink>)}
        {needsUpdate && requote && <Button size="sm" tone={insufficient || available === null ? "secondary" : "primary"} busy={pending} onClick={requote}>{continueAutomatically ? "更新费用并继续" : "更新费用"}</Button>}
        {!needsUpdate && !insufficient && available !== null && !serviceBlocked && <Button
          size="sm" tone="primary" busy={pending} disabled={pending || read?.status === "loading"} onClick={confirm}
        >{continueAutomatically ? "继续这次任务" : "确认开始"}</Button>}
        <Button size="sm" disabled={pending} onClick={close}>
          取消
        </Button>
      </div>
    </section>
  );
}

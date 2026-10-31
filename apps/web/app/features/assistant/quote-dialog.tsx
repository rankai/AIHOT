import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ToolQuote } from "@aihot/contracts/credits";
import { Button } from "../admin/ui";
/** An explicit UI action card: this is never rendered as an assistant message. */
export function TurnQuoteDialog({
  quote,
  message,
  pending,
  error,
  close,
  confirm,
}: {
  quote: ToolQuote;
  message: string;
  pending: boolean;
  error: string | null;
  close: () => void;
  confirm: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.focus(); }, []);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const check = () => setExpired(Date.parse(quote.expiresAt) <= Date.now());
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [quote.expiresAt]);
  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-labelledby="assistant-turn-quote-title"
      className="assistant-quote-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="assistant-turn-quote-title"
            className="text-[14px] font-semibold text-ink"
          >
            本次 {quote.amount.toLocaleString()} 积分
          </h2>
          <p role="status" className="mt-1 text-[12px] text-ink-3">
            可用 {quote.available.toLocaleString()} 积分 ·{" "}
            {expired ? "报价已过期" : "报价有效"}
          </p>
        </div>

      </div>
      <details className="mt-2 text-[12px] text-ink-3">
        <summary className="cursor-pointer">费用与需求详情</summary>
        <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message}
        </p>
        <p className="mt-2">确认后占用积分并开始创作。额外检索另行报价和批准；未知或部分结果需要核对。</p>
      </details>
      {expired && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          报价已过期，请返回重新获取。输入会保留。
        </p>
      )}
      {!quote.affordable && (
        <p role="alert" className="mt-2 text-[12px] text-hot">
          积分不足，请联系管理员补充。
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
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button size="sm" disabled={pending} onClick={close}>
          取消
        </Button>
        <Button
          size="sm"
          tone="primary"
          busy={pending}
          disabled={expired || !quote.affordable || pending}
          onClick={confirm}
        >
          开始
        </Button>
      </div>
    </section>
  );
}

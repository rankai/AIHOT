import { useEffect, useState } from "react";
import type {
  AssistantCall,
  AssistantSession,
} from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
import { useToolCommand } from "../tools/client";
import { SEARCH_STATE_LABELS, researchResults, sessionApi } from "./data";

export function SearchCallCard({
  call,
  session,
  csrf,
  refresh,
  statusUnknown = false,
  activityState,
}: {
  call: AssistantCall;
  session: AssistantSession;
  csrf: string;
  refresh: () => Promise<unknown>;
  statusUnknown?: boolean;
  activityState?: string;
}) {
  const command = useToolCommand(
    csrf,
    `assistant:session:${session.sessionId}`,
  );
  const proposed =
    call.state === "proposed" &&
    session.turn?.phase === "waiting_approval" &&
    session.turn.status === "waiting";
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!proposed) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [proposed]);
  const expired =
    !!call.quote && now !== null && Date.parse(call.quote.expiresAt) <= now;
  const research = researchResults(call.result);
  async function decide(action: "approve" | "reject" | "quote") {
    await command.run(
      `${sessionApi(session.sessionId)}/tool-calls/${call.callId}/${action}`,
      action === "quote" ? {} : { proposalRevision: call.proposalRevision },
    );
    await refresh();
  }
  return (
    <article
      className="assistant-search-call"
      data-call-id={call.callId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink">小红书检索</h3>
        <span className="text-[12px] text-ink-3">{statusUnknown ? "上次已知：" : ""}{(activityState && { preparing: "准备检索", waiting: proposed ? "等待批准" : "等待检索处理", running: "正在检索", stopped: "检索已停止", needs_review: "检索需要核对", failed: "检索失败" }[activityState]) || SEARCH_STATE_LABELS[call.state] || "状态待确认"}</span>
      </div>
      <dl className="space-y-1 break-words text-[13px] text-ink-2">
        <div>
          <dt className="inline text-ink-4">关键词：</dt>
          <dd className="inline">{String(call.input.keyword ?? "")}</dd>
        </div>
        <div>
          <dt className="inline text-ink-4">日期：</dt>
          <dd className="inline">
            {String(call.input.startDate ?? "")} 至{" "}
            {String(call.input.endDate ?? "")}
          </dd>
        </div>
      </dl>
      {call.quote && (
        <p className="text-[13px] text-ink-2">
          {proposed ? "独立检索费用：" : "当时检索报价："}
          <strong>{call.quote.amount.toLocaleString()} 积分</strong>
          {proposed && <> · 可用 {call.quote.available.toLocaleString()}
            {expired && <span className="ml-2 text-hot">报价已过期</span>}
          </>}
        </p>
      )}
      {proposed && (
        <>
          <p className="text-[12px] leading-relaxed text-ink-3">
            批准后将关键词和日期发送至外部检索服务，
            检索小红书笔记，只查本页，不自动翻页。此检索单独计费，不包含在本次创作费用内。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              tone="primary"
              disabled={
                command.pending ||
                !!call.approvalBlockedReason ||
                !call.quote?.affordable ||
                expired ||
                now === null
              }
              onClick={() => void decide("approve")}
            >
              批准检索并占用积分
            </Button>
            <Button
              size="sm"
              disabled={command.pending}
              onClick={() => void decide("reject")}
            >
              拒绝此次检索
            </Button>
            <Button
              size="sm"
              disabled={command.pending}
              onClick={() => void decide("quote")}
            >
              刷新报价
            </Button>
          </div>
          {call.quote && !call.quote.affordable && (
            <p className="text-[12px] text-hot">
              积分不足。可拒绝检索，或补充积分后刷新报价。
            </p>
          )}
          {call.approvalBlockedReason && <p role="alert" className="text-[12px] text-hot">{call.approvalBlockedReason}。恢复后可刷新报价重新核对。</p>}
        </>
      )}
      {call.state === "completed" && (
        <p className="text-[12px] text-ink-3">
          检索结果已交回助手，稿件引用会展示可读来源。
        </p>
      )}
      {call.state === "completed" && (
        <details className="assistant-search-results">
          <summary className="cursor-pointer text-[13px] text-ink-2">
            查看已保存的检索结果（{research.rows.length} 条）
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {research.rows.map((row, index) => (
              <li key={`${row.id}:${index}`} className="min-w-0 py-3">
                <p className="break-words text-[13px] font-medium text-ink">
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {row.title}
                    </a>
                  ) : (
                    row.title
                  )}
                </p>
                {row.text && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-3 [overflow-wrap:anywhere]">
                    {row.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {research.limited && (
            <p className="mt-2 text-[12px] text-ink-4">
              展示前 50 条已保存结果，未自动翻页。
            </p>
          )}
          {!research.rows.length && (
            <p className="mt-3 text-[12px] text-ink-3">
              本次没有可展示的检索结果。
            </p>
          )}
        </details>
      )}
      {command.error && (
        <p role="alert" className="text-[13px] text-hot">
          {command.error}
        </p>
      )}
    </article>
  );
}

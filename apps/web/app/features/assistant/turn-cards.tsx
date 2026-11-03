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
  const vision = call.name === "analyze_xhs_covers";
  const covers = call.name === "search_xhs_covers";
  const image = call.name === "generate_image";
  const imageParameters = image ? call.imageParameters : null;
  const imageSpecMissing = image && !imageParameters;
  const label = vision ? "封面视觉分析" : image ? "图片生成" : call.name === "search_xhs_covers" ? "封面查询" : call.name === "search_wechat_articles" ? "公众号查询" : "小红书检索";
  const proposed =
    !session.turn?.credits && call.state === "proposed" &&
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
        <h3 className="text-[13px] font-medium text-ink">{label}</h3>
        <span className="text-[12px] text-ink-3">{statusUnknown ? "上次已知：" : ""}{(activityState && { preparing: "准备处理", waiting: proposed ? "等待批准" : "等待处理", running: "正在处理", stopped: "已停止", needs_review: "需要核对", failed: "处理失败" }[activityState]) || SEARCH_STATE_LABELS[call.state] || "状态待确认"}</span>
      </div>
      <dl className="space-y-1 break-words text-[13px] text-ink-2">
        <div>
          <dt className="inline text-ink-4">{vision ? "样本：" : image ? "提示词：" : "关键词："}</dt>
          <dd className="inline">
            {vision ? `${Array.isArray(call.input.samples)?call.input.samples.length:0} 张已查询封面` : image
              ? imageParameters?.prompt ?? "暂无可信记录"
              : String(call.input.keyword ?? "")}
          </dd>
        </div>
        <div>
          <dt className="inline text-ink-4">{vision ? "范围：" : image ? "规格：" : "日期："}</dt>
          <dd className="inline">
            {vision ? "最多20张，每批最多5张，最多4批" : image
              ? imageParameters
                ? `${imageParameters.resolution.toUpperCase()} · ${imageParameters.count} 张 · ${imageParameters.size}`
                : "暂无可信记录"
              : call.name === "search_xhs_covers" ? `${String(call.input.startDate ?? "")} 起（供应商 T+1 数据，无指定截止日）` : `${String(call.input.startDate ?? "")} 至 ${String(call.input.endDate ?? "")}`}
          </dd>
        </div>
      </dl>
      {session.turn?.credits ? <p className="text-[13px] text-ink-2">已包含在本次任务中</p> : call.quote && (
        <p className="text-[13px] text-ink-2">
          {proposed
            ? vision ? "独立分析费用：" : image
              ? "独立生成费用："
              : covers || call.name === "search_wechat_articles"
                ? "独立查询费用："
                : "独立检索费用："
            : vision ? "当时分析报价：" : image
              ? "当时生成报价："
              : covers || call.name === "search_wechat_articles"
                ? "当时查询报价："
                : "当时检索报价："}
          <strong>{call.quote.amount.toLocaleString()} 积分</strong>
          {proposed && <> · 可用 {call.quote.available.toLocaleString()}
            {expired && <span className="ml-2 text-hot">报价已过期</span>}
          </>}
        </p>
      )}
      {proposed && (
        <>
          <p className="text-[12px] leading-relaxed text-ink-3">
            {vision ? "批准后将所选封面图片发送至视觉模型分析；此费用单独计费，不包含图片生成。仅按实际可观察图片交付。" : imageSpecMissing
              ? "图片规格尚未取得可信记录。请刷新报价，核对提示词、比例、清晰度和张数后再批准。"
              : image
              ? "批准后将提示词发送至图片生成服务，生成单张图片；此费用不包含在本次创作费用内。"
              : call.name === "search_xhs_covers"
                ? "批准后将关键词和起始日期发送至外部封面查询服务；每回合一次，不自动补查。候选元数据不是视觉分析，此查询单独计费。"
                : call.name === "search_wechat_articles"
                ? "批准后将关键词和日期发送至外部查询服务，只查本次范围，不自动扩期或翻页。此查询单独计费。"
                : "批准后将关键词和日期发送至外部检索服务，检索小红书笔记，只查本页，不自动翻页。此检索单独计费，不包含在本次创作费用内。"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              tone="primary"
              disabled={
                imageSpecMissing ||
                command.pending ||
                !!call.approvalBlockedReason ||
                !call.quote?.affordable ||
                expired ||
                now === null
              }
              onClick={() => void decide("approve")}
            >
              批准{vision ? "分析" : image ? "生成" : covers || call.name === "search_wechat_articles" ? "查询" : "检索"}并占用积分
            </Button>
            <Button
              size="sm"
              disabled={command.pending}
              onClick={() => void decide("reject")}
            >
              拒绝此次{vision ? "分析" : image ? "生成" : covers || call.name === "search_wechat_articles" ? "查询" : "检索"}
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
              积分不足。可拒绝此次建议，或补充积分后刷新报价。
            </p>
          )}
          {call.approvalBlockedReason && <p role="alert" className="text-[12px] text-hot">{call.approvalBlockedReason}。恢复后可刷新报价重新核对。</p>}
        </>
      )}
      {call.state === "completed" && (
        <p className="text-[12px] text-ink-3">
          {image ? "图片已保存，可在作品栏查看和下载。" : vision ? "封面视觉分析已保存，封面方案会保留实际观察记录。" : covers ? "封面候选已交回助手，后续视觉分析只使用实际下载的图片。" : "查询结果已交回助手，稿件引用会展示可读来源。"}
        </p>
      )}
      {!image && !vision && !covers && call.state === "completed" && (
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

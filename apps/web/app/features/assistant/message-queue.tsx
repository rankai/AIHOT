import type { AssistantSession } from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
import { TaskClarification } from "./composer-controls";
import { isInsufficientCreditsNotice, TurnQuoteDialog } from "./quote-dialog";
export function AssistantMessageQueue({ queue, pending, approve, cancel, resume, requote, profile, returnTo, recovering = false }: {
  returnTo?: string;
  recovering?: boolean;
  profile?: import("@aihot/contracts/assistant").AssistantProfileDto;
  queue: AssistantSession["queue"]; pending: boolean;
  approve: (id: string, quoteId: string) => void; cancel: (id: string) => void;
  resume: () => void; requote: (id: string, choice?: import("@aihot/contracts/assistant").AssistantTaskChoice) => void;
}) {
  const entries = queue?.entries.filter(entry => ['pending','quoted'].includes(entry.state)) ?? [];
  if (!entries.length) return null;
  const first = entries[0]!;
  const quotingFirst = first.state === "quoted" && !!first.quote && !queue?.paused && !recovering;
  return <section className="assistant-message-queue" aria-label="排队消息">
    <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-medium">{queue?.paused ? "排队已暂停" : "已排队"} · {entries.length} 条</p>
      {queue?.paused && <Button size="sm" disabled={pending} onClick={resume}>继续排队消息</Button>}
    </div>
    <ol className="mt-2 space-y-2">{entries.map((entry, index) => <li key={entry.id} className="flex items-start gap-2 text-[12px]">
      <span className="text-ink-4">{index + 1}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 break-words [overflow-wrap:anywhere]">{entry.message}</p>{entry.error && !(index === 0 && quotingFirst) && <p role="status" className="mt-1 text-hot">{entry.error}</p>}</div>
      {!(index === 0 && quotingFirst) && <button type="button" className="shrink-0 underline text-ink-3" disabled={pending} onClick={() => cancel(entry.id)}>取消</button>}
    </li>)}</ol>
    {first.taskSelectionRequired && profile && !queue?.paused && <TaskClarification key={first.id} profile={profile} selection={first.skillSelection??null} taskHint={first.taskHint} disabled={pending} confirm={choice=>requote(first.id,choice)} />}
    {first.state === "pending" && first.error && !first.taskSelectionRequired && !queue?.paused && !recovering && <div className="mt-3">
      <p className="mb-2 text-[12px] text-ink-3">费用需要更新，需求已保留。{first.confirmationMode === "automatic" ? "更新后按本次费用上限开始。" : ""}</p>
      <Button size="sm" tone="primary" disabled={pending} onClick={() => requote(first.id)}>{first.confirmationMode === "automatic" ? "更新费用并继续" : "更新费用"}</Button>
    </div>}
    {quotingFirst && <div className="mt-3">
      <TurnQuoteDialog key={first.quote!.quoteId} returnTo={returnTo} quote={first.quote!} message={first.message} showRequest={false} pending={pending} error={first.error} requiresRequote={!!first.error && !isInsufficientCreditsNotice(first.error)} showRejectedBalance={isInsufficientCreditsNotice(first.error)} continueAutomatically={first.confirmationMode === "automatic"} requote={() => requote(first.id)} close={() => cancel(first.id)} confirm={() => approve(first.id, first.quote!.quoteId)} />
    </div>}
    <p className="mt-2 text-[11px] text-ink-4">排队和取消不扣积分，轮到时按发送时的费用模式处理。</p>
  </section>;
}

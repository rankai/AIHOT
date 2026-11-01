import type { AssistantSession } from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
import { TurnQuoteDialog } from "./quote-dialog";
export function AssistantMessageQueue({ queue, pending, approve, cancel, resume, requote }: {
  queue: AssistantSession["queue"]; pending: boolean;
  approve: (id: string, quoteId: string) => void; cancel: (id: string) => void;
  resume: () => void; requote: (id: string) => void;
}) {
  const entries = queue?.entries.filter(entry => ['pending','quoted'].includes(entry.state)) ?? [];
  if (!entries.length) return null;
  const first = entries[0]!;
  return <section className="assistant-message-queue" aria-label="排队消息">
    <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-medium">{queue?.paused ? "排队已暂停" : "已排队"} · {entries.length} 条</p>
      {(queue?.paused || first.error && first.state === 'pending') && <Button size="sm" disabled={pending} onClick={resume}>继续排队消息</Button>}
    </div>
    <ol className="mt-2 space-y-2">{entries.map((entry, index) => <li key={entry.id} className="flex items-start gap-2 text-[12px]">
      <span className="text-ink-4">{index + 1}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 break-words [overflow-wrap:anywhere]">{entry.message}</p>{entry.error && <p role="status" className="mt-1 text-hot">{entry.error}</p>}</div>
      <button type="button" className="shrink-0 underline text-ink-3" disabled={pending} onClick={() => cancel(entry.id)}>取消</button>
    </li>)}</ol>
    {first.state === 'quoted' && first.quote && !queue?.paused && <div className="mt-3">
      <TurnQuoteDialog quote={first.quote} message={first.message} pending={pending} error={first.error} close={() => cancel(first.id)} confirm={() => approve(first.id, first.quote!.quoteId)} />
      <button type="button" className="mt-2 text-[12px] underline text-ink-3" disabled={pending} onClick={() => requote(first.id)}>重新获取报价</button>
    </div>}
    <p className="mt-2 text-[11px] text-ink-4">排队和取消不扣积分，轮到时再核对本次费用。</p>
  </section>;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantEvent,
  AssistantSession,
} from "@aihot/contracts/assistant";
import { toolGet } from "../tools/client";
import { sessionApi } from "./data";
import { shouldReadSnapshot } from "./snapshot-poll";

/** SSR watermarks resume only reads. Each mounted conversation owns its abort scope. */
export function useAssistantSnapshot(initial: AssistantSession) {
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const current = useRef(initial);
  const readFailed = useRef(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const accept = useCallback(
    (next: AssistantSession) => {
      if (
        !mounted.current ||
        next.sessionId !== initial.sessionId ||
        next.eventSeq < current.current.eventSeq
      )
        return;
      current.current = next;
      setSnapshot(next);
      readFailed.current = false;
      setError(null);
    },
    [initial.sessionId],
  );
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setReading(true);
    try {
      const next = await toolGet<AssistantSession>(
        sessionApi(initial.sessionId),
        controller.signal,
      );
      if (!controller.signal.aborted) accept(next);
      return controller.signal.aborted ? null : next;
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {
        readFailed.current = true;
        setError(cause instanceof Error ? cause.message : "读取中断，请重试。");
      }
      return null;
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (mounted.current) setReading(false);
      }
    }
  }, [initial.sessionId, accept]);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!mounted.current) return;
      if (!active.current && document.visibilityState === "visible") {
        const controller = new AbortController();
        active.current = controller;
        try {
          const page = await toolGet<{ events: AssistantEvent[] }>(
            `${sessionApi(initial.sessionId)}/events?after=${current.current.eventSeq}`,
            controller.signal,
          );
          // Receipts and model-step preparation may change without an assistant event.
          // Keep the same single read/abort scope; no execution endpoint is polled.
          if (!controller.signal.aborted && shouldReadSnapshot(
            current.current.turn, page.events.length > 0, readFailed.current,
          )) {
            const next = await toolGet<AssistantSession>(
              sessionApi(initial.sessionId),
              controller.signal,
            );
            if (!controller.signal.aborted) accept(next);
          }
        } catch (cause) {
          if (!controller.signal.aborted && mounted.current) {
            readFailed.current = true;
            setError(
              cause instanceof Error
                ? cause.message
                : "连接中断，将继续尝试读取。",
            );
          }
        } finally {
          if (active.current === controller) active.current = null;
        }
      }
      if (mounted.current) timer = setTimeout(poll, 2500);
    };
    const foreground = () => {
      if (document.visibilityState === "visible") void refresh();
      else active.current?.abort();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    timer = setTimeout(poll, 2500);
    return () => {
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", foreground);
      mounted.current = false;
      clearTimeout(timer);
      active.current?.abort();
      active.current = null;
    };
  }, [initial.sessionId, accept, refresh]);
  return { snapshot, refresh, error, reading };
}

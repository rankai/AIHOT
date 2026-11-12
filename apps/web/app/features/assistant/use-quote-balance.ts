import { useCallback, useEffect, useRef, useState } from "react";
import { toolGet, ToolReadAuthError } from "../tools/client";

type BalanceRead = { quoteId: string; status: "loading" | "ready" | "error"; available?: number; error?: string };

/** Balance reads never update a quote or authorize a task. Late results belong only to their card. */
export function useQuoteBalance(quoteId: string, needsBalance: boolean) {
  const [read, setRead] = useState<BalanceRead | null>(null);
  const active = useRef<{ quoteId: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const currentId = useRef(quoteId);
  currentId.current = quoteId;
  const refresh = useCallback(() => {
    if (active.current?.quoteId === quoteId) return active.current.promise;
    active.current?.controller.abort();
    const controller = new AbortController();
    setRead({ quoteId, status: "loading" });
    const promise = (async () => {
      try {
        const result = await toolGet<{ balance: { available: number } }>("/api/account/credits", controller.signal, { redirectOnUnauthorized: false });
        if (!Number.isSafeInteger(result?.balance?.available) || result.balance.available < 0) throw new Error("Invalid balance");
        if (!controller.signal.aborted && currentId.current === quoteId) setRead({ quoteId, status: "ready", available: result.balance.available });
      } catch (cause) {
        if (!controller.signal.aborted && currentId.current === quoteId) setRead({ quoteId, status: "error",
          error: cause instanceof ToolReadAuthError ? "登录已过期，请重新登录后再读取积分。" : undefined,
        });
      } finally {
        if (active.current?.controller === controller) active.current = null;
      }
    })();
    active.current = { quoteId, controller, promise };
    return promise;
  }, [quoteId]);
  useEffect(() => {
    if (needsBalance) void refresh();
    const focused = () => { if (needsBalance) void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") focused(); };
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", visible);
      active.current?.controller.abort();
      active.current = null;
    };
  }, [needsBalance, refresh]);
  return { read: read?.quoteId === quoteId ? read : null, refresh };
}

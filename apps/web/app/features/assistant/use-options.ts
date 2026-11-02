import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantOptions, AssistantProfileDto } from "@aihot/contracts/assistant";
import { toolGet } from "../tools/client";

/** Options reads are independent of route/session revalidation and never change drafts. */
export function useAssistantOptions(initial: AssistantOptions) {
  const [options, setOptions] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const flight = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (!mounted.current || document.visibilityState === "hidden" || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    void toolGet<AssistantOptions>("/api/assistant/options", controller.signal).then(value => {
      if (mounted.current && flight.current === controller && !controller.signal.aborted) { setOptions(value); setError(null); }
    }).catch(() => {
      if (mounted.current && flight.current === controller && !controller.signal.aborted) setError("技能状态暂未更新，已保留上次结果；发送时会再次校验。");
    }).finally(() => { if (flight.current === controller) flight.current = null; });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const cancel = () => { flight.current?.abort(); flight.current = null; };
    const visibility = () => { if (document.visibilityState === "hidden") cancel(); else refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      mounted.current = false; cancel(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
    };
  }, [refresh]);
  return { options, refresh, error };
}
export function unavailableSelection(profile: AssistantProfileDto | undefined, actionId: string | null) {
  return !!actionId && !profile?.actions.some(action => action.actionId === actionId && action.available);
}

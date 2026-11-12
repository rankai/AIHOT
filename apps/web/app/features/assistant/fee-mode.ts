import { useEffect, useState } from "react";
import type { AssistantConfirmationMode } from "@aihot/contracts/assistant";

const choices = new Map<string, AssistantConfirmationMode>();
export const confirmationModeHint = (mode: AssistantConfirmationMode) => mode === "automatic"
  ? "发送后自动开始，结束后按实际费用结算"
  : "发送后先确认本次费用上限";
/** A composer preference, never authority to start a restored quote or change an accepted task. */
export function useConfirmationMode(identity: string) {
  const key = `assistant-confirmation-mode:${encodeURIComponent(identity)}`;
  const [mode, setMode] = useState<AssistantConfirmationMode>("automatic");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => {
      let value = choices.get(identity) ?? "automatic";
      try { const saved = localStorage.getItem(key); if (saved === "automatic" || saved === "manual") value = saved; } catch { /* The in-memory choice still survives route navigation. */ }
      choices.set(identity, value); setMode(value); setReady(true);
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === key) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [identity, key]);
  function choose(value: AssistantConfirmationMode) {
    choices.set(identity, value); setMode(value);
    try { localStorage.setItem(key, value); } catch { /* No task is authorized by this preference alone. */ }
  }
  return { mode, ready, choose };
}

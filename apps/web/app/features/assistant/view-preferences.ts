import { useEffect, useState } from "react";

/** Read-only view preferences, scoped by session and exact saved version; never authorize a task. */
export function useAssistantViewPreference(scope: string) {
  const key = `assistant-view:1:${scope}`;
  const [saved, setSaved] = useState<{ key: string; value: string | null } | null>(null);
  useEffect(() => {
    let value: string | null = null;
    try { value = sessionStorage.getItem(key); } catch { /* In-memory viewing still works. */ }
    setSaved({ key, value });
  }, [key]);
  function choose(value: string | null) {
    setSaved({ key, value });
    try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* No execution depends on this preference. */ }
  }
  return [saved?.key === key ? saved.value : null, choose] as const;
}

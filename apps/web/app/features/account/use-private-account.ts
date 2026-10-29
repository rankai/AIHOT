import { useEffect, useRef } from "react";
import type { AccountMe } from "@aihot/contracts/account";

/** Re-enter private routes when another tab changes the cookie, dropping every old local draft/result. */
export function usePrivateAccount(me: AccountMe): void {
  const reloading = useRef(false);
  useEffect(() => {
    let active: AbortController | null = null;
    const refresh = async () => {
      if (reloading.current || document.visibilityState === "hidden") return;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      try {
        const response = await fetch("/api/account/me", { credentials: "same-origin", cache: "no-store", signal });
        if (signal.aborted) return;
        let changed = response.status === 401;
        if (response.ok) {
          const current = await response.json() as AccountMe;
          if (signal.aborted) return;
          changed = current.user.id !== me.user.id || current.csrf !== me.csrf;
        }
        // An unavailable API is not evidence of logout. Never create an outage/reload loop.
        if (changed && !reloading.current) { reloading.current = true; window.location.reload(); }
      } catch {
        // Keep the loaded view during connectivity loss; every API operation still authenticates.
      }
    };
    const check = () => { void refresh(); };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("account-updated", check);
    window.addEventListener("account-identity-changed", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active?.abort();
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("account-updated", check);
      window.removeEventListener("account-identity-changed", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [me.user.id, me.csrf]);
}

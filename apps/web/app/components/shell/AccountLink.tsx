import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import { IconUsers } from "../icons";

/** The public shell is shared-cache HTML; identity is fetched only after hydration. */
export function AccountLink({ className = "" }: { className?: string }) {
  const { pathname } = useLocation();
  const [account, setAccount] = useState<AccountMe | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const knownIdentity = useRef<string | null>(null);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      const identity = (value: string) => {
        const previous = knownIdentity.current;
        knownIdentity.current = value;
        if (previous !== null && previous !== value) window.dispatchEvent(new Event("account-identity-changed"));
      };
      try {
        const response = await fetch("/api/account/me", { credentials: "same-origin", cache: "no-store", signal });
        if (signal.aborted) return;
        if (response.status === 401) { setAccount(null); setUnavailable(false); identity("anonymous"); return; }
        if (!response.ok) { setAccount(null); setUnavailable(true); return; }
        const result = await response.json() as AccountMe;
        if (!signal.aborted) { setAccount(result); setUnavailable(false); identity(`${result.user.id}:${result.csrf}`); }
      } catch {
        if (!signal.aborted) { setAccount(null); setUnavailable(true); }
      }
    };
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener("account-updated", update);
    window.addEventListener("focus", update);
    return () => { controller?.abort(); window.removeEventListener("account-updated", update); window.removeEventListener("focus", update); };
  }, [pathname]);
  return <Link to={account || unavailable ? "/account" : "/login"} className={`flex min-w-0 items-center gap-2.5 text-[14px] font-medium text-ink-3 hover:text-ink ${className}`}>
    <IconUsers size={17} className="shrink-0" />
    <span className="min-w-0 truncate">{account?.user.displayName ?? (unavailable ? "我的账号" : "登录")}</span>
  </Link>;
}

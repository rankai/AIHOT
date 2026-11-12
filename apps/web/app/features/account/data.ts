/** Keep sign-in destinations on reader pages of this origin. */
export function safeAccountReturn(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/tools";
  try {
    const url = new URL(value, "https://account.local");
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== "https://account.local" || /[\\\u0000-\u0020]/.test(path) || path.startsWith("//") || /^\/(?:api|admin|login|register)(?:\/|$)/i.test(path)) return "/tools";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/tools";
  }
}

/** Top-up navigation carries only an assistant destination, never request content or credentials. */
export function safeAssistantReturn(value: string | null | undefined): string | null {
  if (!value || value.length > 300 || /[\\\u0000-\u0020]/.test(value)) return null;
  return /^\/assistant(?:\/xiaohongshu|\/sessions\/[A-Za-z0-9_-]+)?(?:#assistant-fees)?$/.test(value) ? value : null;
}
export function assistantCreditsHref(returnTo?: string): string {
  const destination = safeAssistantReturn(returnTo);
  return `/account${destination ? `?${new URLSearchParams({ assistantReturn: destination })}` : ""}#account-credits`;
}

export const ACCOUNT_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Accel-Expires": "0",
  "X-Robots-Tag": "noindex, nofollow",
};

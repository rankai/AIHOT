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

export const ACCOUNT_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Accel-Expires": "0",
  "X-Robots-Tag": "noindex, nofollow",
};

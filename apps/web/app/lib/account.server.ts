import { data, redirect } from "react-router";
import { ACCOUNT_HEADERS, safeAccountReturn } from "../features/account/data";

const API_BASE = process.env.API_BASE_URL || "http://127.0.0.1:3001";

/** Authenticated reader requests use the visitor's cookie and are never shared-cache data. */
export async function accountGet<T>(request: Request, path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { accept: "application/json", cookie: request.headers.get("cookie") ?? "" },
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    cache: "no-store",
  });
  if (response.status === 401) {
    const url = new URL(request.url);
    throw redirect(`/login?${new URLSearchParams({ return: safeAccountReturn(url.pathname + url.search) })}`, { headers: ACCOUNT_HEADERS });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw data({ message: body?.detail ?? "暂时无法加载，请稍后重试。" }, { status: response.status >= 500 ? 503 : response.status, headers: ACCOUNT_HEADERS });
  }
  return await response.json() as T;
}

import { safeAccountReturn } from "./data";

export class AccountError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function accountRequest<T>(method: "POST" | "PATCH", path: string, body?: unknown, csrf?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AccountError(0, "网络暂时不可用，请稍后重试。");
  }
  const result = await response.json().catch(() => null);
  if (response.status === 401 && path !== "/api/account/login") {
    window.location.assign(`/login?${new URLSearchParams({ return: safeAccountReturn(window.location.pathname + window.location.search), expired: "1" })}`);
    throw new AccountError(401, "登录已过期，请重新登录。");
  }
  if (!response.ok) throw new AccountError(response.status, response.status === 403 ? "当前操作未获授权或登录校验已过期，请刷新页面后重试。" : result?.detail ?? `请求失败（${response.status}），请稍后重试。`);
  return result as T;
}

export function accountErrorMessage(error: unknown): string {
  return error instanceof AccountError ? error.message : "操作未完成，请稍后重试。";
}

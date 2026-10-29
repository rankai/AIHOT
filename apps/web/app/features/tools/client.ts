import { useRef, useState } from "react";
import { safeAccountReturn } from "../account/data";

/** Keep a failed command's identity so a network retry cannot duplicate paid work. */
export function useToolCommand(csrf: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const commands = useRef(new Map<string, string>());
  async function run<T>(path: string, body: unknown, method: "POST" | "DELETE" = "POST"): Promise<T | null> {
    if (busy.current) return null;
    const multipart = body instanceof FormData;
    const input = body && typeof body === "object" && "quoteId" in body && "input" in body ? body.input : body;
    const fingerprint = method + path + (multipart ? JSON.stringify([...body.entries()].map(([key, value]) => [key, value instanceof File ? [value.name, value.size, value.lastModified] : value])) : JSON.stringify(input));
    const key = commands.current.get(fingerprint) ?? crypto.randomUUID();
    commands.current.set(fingerprint, key);
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method, credentials: "same-origin",
        headers: { "x-csrf-token": csrf, "idempotency-key": key, ...(multipart ? {} : { "Content-Type": "application/json" }) },
        body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(multipart ? 120_000 : 30_000),
      });
      if (response.status === 401) {
        window.location.assign(`/login?${new URLSearchParams({ return: safeAccountReturn(window.location.pathname + window.location.search), expired: "1" })}`);
        return null;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 403 ? "权限或登录校验已过期，请刷新页面后重试。" : data?.detail ?? `操作未完成（${response.status}）`);
      commands.current.delete(fingerprint);
      return data as T;
    } catch (error) {
      setError(error instanceof Error && error.name !== "TypeError" && error.name !== "TimeoutError" ? error.message : "连接中断或超时。可先查看执行记录；使用相同输入重试不会重复创建任务。");
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { run, pending, error };
}

export async function toolGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (response.status === 401) {
    window.location.assign(`/login?${new URLSearchParams({ return: safeAccountReturn(window.location.pathname + window.location.search), expired: "1" })}`);
    throw new Error("登录已过期，请重新登录。");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail ?? "暂时无法读取，请稍后重试。");
  return body as T;
}

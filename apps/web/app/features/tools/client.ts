import { useRef, useState } from "react";
import { safeAccountReturn } from "../account/data";
import { limitCommandKeys, scopedCommandKeys } from "./command-keys";
import { prepareAdminBody } from "../admin/action-body";

/** Keep a failed command's identity so a network retry cannot duplicate paid work. */
export function useToolCommand(csrf: string, commandScope?: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const busy = useRef(false);
  const failure = useRef<{ commandKey: string; status: number | null; code: string | null; message: string } | null>(null);
  const commands = useRef(new Map<string, string>());
  async function run<T>(path: string, body: unknown, method: "POST" | "DELETE" = "POST", identityInput?: unknown, commandKey?: string): Promise<T | null> {
    if (busy.current) return null;
    const multipart = body instanceof FormData;
    const input = identityInput ?? (body && typeof body === "object" && "quoteId" in body && "input" in body ? body.input : body);
    const fingerprint = method + path + (multipart ? prepareAdminBody(body).fingerprint : JSON.stringify(input));
    const commandKeys = commandScope ? scopedCommandKeys(csrf, commandScope) : commands.current;
    const key = commandKey ?? commandKeys.get(fingerprint) ?? crypto.randomUUID();
    commandKeys.set(fingerprint, key);
    if (commandScope) limitCommandKeys(commandKeys);
    busy.current = true;
    setPending(true);
    setError(null);
    setErrorStatus(null);
    failure.current = null;
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
      if (!response.ok) { setErrorStatus(response.status); const message = response.status === 403 ? "权限或登录校验已过期，请刷新页面后重试。" : data?.detail ?? `操作未完成（${response.status}）`; failure.current = { commandKey: key, status: response.status, code: data?.code ?? data?.error ?? null, message }; throw new Error(message); }
      commandKeys.delete(fingerprint);
      return data as T;
    } catch (error) {
      if (!failure.current) failure.current = { commandKey: key, status: null, code: null, message: error instanceof Error ? error.message : "连接中断" };
      setError(error instanceof Error && error.name !== "TypeError" && error.name !== "TimeoutError" ? error.message : "连接中断或超时。可先查看执行记录；使用相同输入重试不会重复创建任务。");
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { run, pending, error, errorStatus, failure };
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

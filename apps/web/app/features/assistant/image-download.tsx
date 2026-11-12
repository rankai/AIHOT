import { useEffect, useRef, useState } from "react";
import type { AssistantArtifact } from "@aihot/contracts/assistant";
import { IconDownload } from "../../components/icons";
import { toolGet, ToolReadAuthError } from "../tools/client";
import { imageDownloadName } from "./artifact-display";
import { sessionApi } from "./data";
import { exactImageFile, ImageDownloadError, imageDownloadBlob } from "./image-download-data";

export function ImageDownload({ sessionId, artifactId, version, title, fileKey, compact = false }: {
  sessionId: string;
  artifactId: string;
  version: number;
  title: string;
  fileKey?: string;
  compact?: boolean;
}) {
  const identity = JSON.stringify([sessionId, artifactId, version, fileKey]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const request = useRef<{ identity: string; controller: AbortController } | null>(null);
  const [state, setState] = useState<{ identity: string; busy: boolean; error?: string } | null>(null);
  const busy = state?.identity === identity && state.busy;
  const error = state?.identity === identity ? state.error : null;
  useEffect(() => () => {
    if (request.current?.identity === identity) {
      request.current.controller.abort();
      request.current = null;
    }
  }, [identity]);

  async function download() {
    if (request.current?.identity === identity) return;
    request.current?.controller.abort();
    const active = { identity, controller: new AbortController() };
    request.current = active;
    const signal = AbortSignal.any([active.controller.signal, AbortSignal.timeout(30_000)]);
    const isCurrent = () => request.current === active && currentIdentity.current === identity && !active.controller.signal.aborted;
    setState({ identity, busy: true });
    try {
      const key = fileKey || exactImageFile((await toolGet<{ versions: AssistantArtifact[] }>(
        `${sessionApi(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/versions?version=${version}`, signal, { redirectOnUnauthorized: false },
      )).versions, { artifactId, version });
      if (!isCurrent()) return;
      const blob = await imageDownloadBlob(key, signal);
      if (!isCurrent()) return;
      signal.throwIfAborted();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = imageDownloadName(title, version);
      try {
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        // Give the browser time to take ownership of the Blob before releasing it.
        window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      }
    } catch (cause) {
      if (isCurrent()) setState({ identity, busy: false, error:
        signal.reason?.name === "TimeoutError" ? "准备下载超时，请重试；无需重新生成。" :
        cause instanceof ToolReadAuthError || cause instanceof ImageDownloadError && cause.status === 401 ? "登录已过期，请重新登录后重试下载。" :
        cause instanceof ImageDownloadError && cause.status === 403 ? "当前无法访问这张图片，请刷新页面后重试。" :
        "这一版图片暂未能下载，请重试；无需重新生成。",
      });
    } finally {
      if (request.current === active) {
        request.current = null;
        setState((previous) => previous?.identity === identity ? { ...previous, busy: false } : previous);
      }
    }
  }

  function cancel() {
    request.current?.controller.abort();
    request.current = null;
    setState(null);
  }
  const label = busy ? "正在准备下载…" : error ? "重试下载图片" : "下载图片";
  return <div className="assistant-image-download" data-compact={compact || undefined}>
    <button type="button" className={compact ? "assistant-delivery-download" : "assistant-image-download-button"} disabled={busy} aria-busy={busy || undefined}
      title={label} aria-label={`${label}：${title} · 第 ${version} 版`} onClick={download}>
      {compact ? <IconDownload size={18} /> : label}
    </button>
    {busy && <div className="assistant-image-download-feedback"><span role="status" className={compact ? undefined : "sr-only"}>正在准备下载…</span><button type="button" onClick={cancel}>取消下载</button></div>}
    {error && <p role="alert" className="assistant-image-download-feedback text-hot">{error}</p>}
  </div>;
}

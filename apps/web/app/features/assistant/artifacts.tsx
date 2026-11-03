import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type {
  AssistantArtifact,
  AssistantArtifactContent,
  AssistantId,
  AssistantOptions,
} from "@aihot/contracts/assistant";
import { Badge, Button, Input, Select, Textarea } from "../admin/ui";
import { toolGet, useToolCommand } from "../tools/client";
import { artifactText, safeSourceHref, sessionApi, sessionHref } from "./data";
import { useEditorGuard } from "./unsaved";
import { CoverPlanBody } from "./cover-plan";
function DraftBody({ artifact }: { artifact: AssistantArtifact }) {
  const { content } = artifact;
  return (
    <div className="min-w-0 space-y-4">
      <h3 className="break-words text-[19px] font-semibold text-ink">
        {content.title}
      </h3>
      <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.9] text-ink-2 [overflow-wrap:anywhere]">
        {content.body}
      </div>
      {!!content.titles.length && (
        <div>
          <h4 className="text-[12px] font-medium text-ink-3">备选标题</h4>
          <ul className="mt-2 list-inside list-decimal space-y-1 text-[14px] text-ink-2">
            {content.titles.map((title, i) => (
              <li key={i} className="break-words">
                {title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!content.tags.length && (
        <p className="break-words text-[13px] text-accent">
          {content.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}
        </p>
      )}
      <div className="rounded-control bg-bg-sunk p-3 text-[12px] leading-relaxed text-ink-3">
        <span className="font-medium">
          {content.partial ? "部分交付" : "交付范围"}：
        </span>
        {content.scope}
      </div>
      <div>
        <h4 className="text-[12px] font-medium text-ink-3">材料与引用</h4>
        <ul className="mt-2 space-y-1 text-[12px] text-ink-3">
          {artifact.sources
            .filter((source) => content.sources.includes(source.id))
            .map((source) => {
              const href = safeSourceHref(source.url);
              const label = source.kind === "user-material" && source.id === "current-message" ? "你提供的材料" : source.label;
              return (
                <li
                  key={source.id}
                  className="break-words [overflow-wrap:anywhere]"
                >
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline"
                    >
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
        </ul>
      </div>
    </div>
  );
}

export function AssistantArtifactPanel({
  artifacts,
  target,
  ...props
}: {
  artifacts: AssistantArtifact[];
  target?: { artifactId: string; version: number } | null;
  sessionId: string;
  csrf: string;
  active: boolean;
  options: AssistantOptions;
  refresh: () => Promise<unknown>;
  onReference: (artifact: AssistantArtifact) => void;
}) {
  const [chosen, setChosen] = useState(artifacts[0]?.artifactId);
  const selectedId = artifacts.some(
    (artifact) => artifact.artifactId === chosen,
  )
    ? chosen
    : artifacts[0]?.artifactId;
  const guard = useEditorGuard();
  useEffect(() => {
    if (target) guard.request(() => setChosen(target.artifactId));
  }, [target]);
  return (
    <div className="assistant-artifact-inner">
      <div className="assistant-artifact-heading">
        <h2 className="text-[14px] font-semibold text-ink">
          会话作品{" "}
          <span className="font-normal text-ink-4">{artifacts.length} 项</span>
        </h2>
        <p className="mt-1 text-[11px] text-ink-4">
          在这里查看本次会话的作品、封面方案和生成图片，或引用已保存版本继续修改。
        </p>
        {artifacts.length > 1 && (
          <Select
            aria-label="选择作品"
            value={selectedId}
            onChange={(event) => {
              const id = event.target.value;
              guard.request(() => setChosen(id));
            }}
          >
            {artifacts.map((artifact, index) => (
              <option key={artifact.artifactId} value={artifact.artifactId}>
                作品 {index + 1} · {{ "xhs-cover-plan": "封面方案", image: "图片", "text-draft": "文章", "xhs-note": "笔记" }[artifact.kind]} · {artifact.content.title}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="assistant-artifact-scroll">
        {artifacts.map((artifact) => (
          <div
            key={artifact.artifactId}
            hidden={artifact.artifactId !== selectedId}
          >
            <AssistantArtifactCard artifact={artifact} versionTarget={selectedId === artifact.artifactId && target?.artifactId === artifact.artifactId ? target : undefined} {...props} />
          </div>
        ))}
      </div>
    </div>
  );
}
export function AssistantArtifactCard(props: Parameters<typeof WritingArtifactCard>[0]) {
  const {artifact} = props;
  if (artifact.kind === "image") {
    const c=artifact.content, href=`/api/tools/assets/${encodeURIComponent(c.fileKey ?? "")}/content`;
    return <article className="min-w-0 space-y-4" aria-label={`图片：${c.title}`} data-artifact-id={artifact.artifactId}>
      <Badge tone="ok">图片</Badge><h3 className="break-words text-[19px] font-semibold">{c.title}</h3>
      <img src={href} alt={c.title} width={c.width} height={c.height} className="h-auto w-full rounded-control object-contain" />
      <p className="whitespace-pre-wrap break-words text-[13px] text-ink-2 [overflow-wrap:anywhere]">{c.prompt}</p>
      <a href={href} download className="text-accent underline">下载图片</a>
    </article>;
  }
  return <WritingArtifactCard {...props} />;
}
function WritingArtifactCard({
  artifact,
  sessionId,
  csrf,
  active,
  options,
  refresh,
  onReference,
  versionTarget,
}: {
  artifact: AssistantArtifact;
  sessionId: string;
  csrf: string;
  active: boolean;
  options: AssistantOptions;
  refresh: () => Promise<unknown>;
  onReference?: (artifact: AssistantArtifact) => void;
  versionTarget?: { artifactId: string; version: number };
}) {
  const command = useToolCommand(csrf, `assistant:session:${sessionId}`);
  const [versions, setVersions] = useState<AssistantArtifact[]>([]);
  const [selected, setSelected] = useState(artifact);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [editing, setEditing] = useState<{
    baseVersion: number;
    content: AssistantArtifactContent;
    original: AssistantArtifactContent;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<AssistantArtifact | null>(null);
  const read = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const { register, request } = useEditorGuard();
  const dirty =
    !!editing &&
    JSON.stringify(editing.content) !== JSON.stringify(editing.original);
  const newer = artifact.version > selected.version;
  const cover = selected.kind === "xhs-cover-plan";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      read.current?.abort();
    };
  }, []);
  const path = `${sessionApi(sessionId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/versions`;
  useEffect(() => {
    if (!versionTarget) return;
    const targetVersion = versionTarget.version;
    if (targetVersion === artifact.version) {
      request(() => {
        setEditing(null);
        setSelected(artifact);
        selectedRef.current = artifact;
      });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    toolGet<{ versions: AssistantArtifact[] }>(path, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setVersions(result.versions);
      const version = result.versions.find((value) => value.version === targetVersion);
      if (!version) { setError("指定作品版本暂不可读，请重新读取。"); return; }
      request(() => {
        setEditing(null);
        setSelected(version);
        selectedRef.current = version;
      });
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取版本失败。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [versionTarget, path]);
  async function save(): Promise<boolean> {
    if (!editing || cover || artifact.kind === "xhs-cover-plan" || active || command.pending) return false;
    const content = {
      ...editing.content,
      titles: editing.content.titles
        .map((value) => value.trim())
        .filter(Boolean),
      tags: editing.content.tags.map((value) => value.trim()).filter(Boolean),
    };
    const result = await command.run<AssistantArtifact>(path, {
      baseVersion: editing.baseVersion,
      kind: artifact.kind,
      content,
    });
    if (!alive.current) return !!result;
    if (result) {
      selectedRef.current = result;
      setSelected(result);
      setEditing(null);
      setVersions((previous) => [
        result,
        ...previous.filter((value) => value.version !== result.version),
      ]);
      setNotice("已保存为新版本。");
    } else if (command.errorStatus === 409)
      setError(
        "稿件版本已变化。本地修改仍保留，重新读取后可决定使用哪个版本。",
      );
    await refresh();
    return !!result;
  }
  useEffect(() => {
    register(artifact.artifactId, {
      dirty,
      canSave: !active && !command.pending,
      save,
      discard: () => setEditing(null),
    });
    return () => register(artifact.artifactId, null);
  }, [register, artifact.artifactId, dirty, editing, active, command.pending]);
  function edit(field: Partial<AssistantArtifactContent>) {
    setEditing((previous) =>
      previous
        ? { ...previous, content: { ...previous.content, ...field } }
        : null,
    );
  }
  async function readVersions() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await toolGet<{ versions: AssistantArtifact[] }>(
        path,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setVersions(result.versions);
        setHistoryOpen(true);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "读取历史失败。");
    } finally {
      if (alive.current && read.current === controller) setLoading(false);
    }
  }
  return (
    <article
      className="min-w-0 space-y-4"
      aria-label={`${cover ? "封面方案" : "稿件"}：${selected.content.title}`}
      data-artifact-id={artifact.artifactId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={selected.content.partial ? "warn" : "ok"}>
          {cover ? "小红书封面方案" : selected.kind === "xhs-note" ? "小红书笔记" : "文章草稿"}
        </Badge>
        <span className="text-[12px] text-ink-4">
          版本 {selected.version}
          {dirty ? " · 未保存" : ""}
        </span>
      </div>
      {newer && (
        <div className="assistant-inline-notice" role="status">
          <p>有新版本可查看，当前内容和本地修改不会被覆盖。</p>
          <Button
            size="sm"
            onClick={() =>
              request(() => {
                setEditing(null);
                setSelected(artifact);
                selectedRef.current = artifact;
              })
            }
          >
            查看版本 {artifact.version}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                artifactText(selected.content),
              );
              setNotice("已复制选定的已保存版本。");
            } catch {
              setError("无法自动复制，请选择正文后复制。");
            }
          }}
        >
          复制
        </Button>
        <Button
          size="sm"
          disabled={loading}
          onClick={() => void readVersions()}
        >
          {historyOpen ? "收起版本" : "历史版本"}
        </Button>
        {!cover && <Button
          size="sm"
          disabled={
            active ||
            command.pending ||
            selected.version !== artifact.version ||
            !!editing
          }
          onClick={() => {
            setEditing({
              baseVersion: selected.version,
              content: structuredClone(selected.content),
              original: structuredClone(selected.content),
            });
            setError(null);
          }}
        >
          编辑稿件
        </Button>}
        {!cover && <Button
          size="sm"
          disabled={
            command.pending ||
            !options.assistants.some((profile) => profile.available)
          }
          onClick={() =>
            request(
              () => setHandoff(structuredClone(selectedRef.current)),
              true,
            )
          }
        >
          转交助手
        </Button>}
      </div>
      {historyOpen && (
        <label className="block space-y-2 text-[12px] text-ink-3">
          <span>查看版本</span>
          <Select
            aria-label={cover ? "封面方案版本" : "稿件版本"}
            value={selected.version}
            disabled={command.pending}
            onChange={(event) => {
              const version = Number(event.target.value);
              const next = [artifact, selected, ...versions].find(
                (value) => value.version === version,
              );
              if (next)
                request(() => {
                  setEditing(null);
                  setSelected(next);
                  selectedRef.current = next;
                });
            }}
          >
            {[artifact, selected, ...versions]
              .filter(
                (value, index, all) =>
                  all.findIndex((row) => row.version === value.version) ===
                  index,
              )
              .sort((a, b) => b.version - a.version)
              .map((version) => (
                <option key={version.version} value={version.version}>
                  版本 {version.version}
                  {version.version === artifact.version ? "（当前保存版）" : ""}
                </option>
              ))}
          </Select>
        </label>
      )}
      {cover ? <CoverPlanBody key={selected.version} artifact={selected} /> : editing ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-[13px] text-ink-2">
            <span>标题</span>
            <Input
              required
              maxLength={300}
              value={editing.content.title}
              onChange={(event) => edit({ title: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-[13px] text-ink-2">
            <span>正文</span>
            <Textarea
              required
              rows={12}
              maxLength={30000}
              value={editing.content.body}
              onChange={(event) => edit({ body: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-[13px] text-ink-2">
            <span>备选标题（每行一个，最多 6 个）</span>
            <Textarea
              rows={3}
              value={editing.content.titles.join("\n")}
              onChange={(event) =>
                edit({ titles: event.target.value.split("\n") })
              }
            />
          </label>
          <label className="block space-y-1 text-[13px] text-ink-2">
            <span>标签（每行一个，最多 10 个）</span>
            <Textarea
              rows={3}
              value={editing.content.tags.join("\n")}
              onChange={(event) =>
                edit({ tags: event.target.value.split("\n") })
              }
            />
          </label>
          <label className="block space-y-1 text-[13px] text-ink-2">
            <span>交付范围</span>
            <Textarea
              required
              rows={2}
              maxLength={1000}
              value={editing.content.scope}
              onChange={(event) => edit({ scope: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={editing.content.partial}
              onChange={(event) => edit({ partial: event.target.checked })}
            />
            这是部分交付
          </label>
          <p className="text-[12px] text-ink-4">
            保存追加新版本，保留原版本和来源。只有保存成功才会显示已保存。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              tone="primary"
              busy={command.pending}
              disabled={active}
            >
              保存新版本
            </Button>
            <Button
              disabled={command.pending}
              onClick={() => request(() => setEditing(null))}
            >
              取消编辑
            </Button>
          </div>
        </form>
      ) : (
        <DraftBody artifact={selected} />
      )}
      {onReference && (
        <Button
          size="sm"
          tone="primary"
          disabled={command.pending}
          onClick={() => request(() => onReference(selectedRef.current), true)}
        >
          用这版继续修改
        </Button>
      )}
      {active && !cover && (
        <p className="text-[12px] text-ink-4">
          处理进行中或结果待核对时不能保存，请先完成或停止后续执行。
        </p>
      )}
      {notice && (
        <p role="status" className="text-[12px] text-accent">
          {notice}
        </p>
      )}
      {(error || command.error) && (
        <p role="alert" className="text-[13px] text-hot">
          {error || command.error}
        </p>
      )}
      {handoff && !cover && (
        <HandoffDialog
          artifact={handoff}
          sessionId={sessionId}
          csrf={csrf}
          options={options}
          close={() => setHandoff(null)}
        />
      )}
    </article>
  );
}
function HandoffDialog({
  artifact,
  sessionId,
  csrf,
  options,
  close,
}: {
  artifact: AssistantArtifact;
  sessionId: string;
  csrf: string;
  options: AssistantOptions;
  close: () => void;
}) {
  const profiles = options.assistants.filter((profile) => profile.available);
  const [target, setTarget] = useState<AssistantId>(
    profiles[0]?.id ?? "creative",
  );
  const targetProfile = options.assistants.find((profile) => profile.id === target);
  const targetAvailable = !!targetProfile?.available;
  const [brief, setBrief] = useState("");
  const command = useToolCommand(csrf, `assistant:session:${sessionId}`);
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const navigate = useNavigate();
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
    };
  }, []);
  // Keep an open dialog visible when the responsive workspace hides the artifact panel.
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="assistant-handoff-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!command.pending) close();
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-32px)] max-w-2xl overflow-y-auto rounded-panel bg-surface p-5 text-ink shadow-lg backdrop:bg-black/35"
    >
      <h2 id="assistant-handoff-title" className="text-[19px] font-semibold">
        预览并转交稿件
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
        选定稿件版本与下方说明将复制到新会话。转交免费；继续创作需要另行确认报价。源会话删除后，已转交副本独立保留。
      </p>
      <div className="my-4 max-h-64 overflow-y-auto rounded-control border border-line p-4">
        <p className="mb-3 text-[12px] text-ink-4">
          选定版本 {artifact.version}
        </p>
        <DraftBody artifact={artifact} />
      </div>
      <label className="block space-y-1 text-[13px] text-ink-2">
        <span>目标助手</span>
        <Select
          value={target}
          disabled={command.pending}
          aria-describedby={!targetAvailable ? "assistant-handoff-target-status" : undefined}
          onChange={(event) => setTarget(event.target.value as AssistantId)}
        >
          {!targetAvailable && (
            <option value={target} disabled>
              {targetProfile?.name ?? "所选助手"}（当前不可用）
            </option>
          )}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
      </label>
      {!targetAvailable && (
        <p id="assistant-handoff-target-status" role="status" className="mt-2 text-[13px] text-ink-3">
          当前选择的助手暂不可用，请重新选择目标助手。稿件和说明仍保留。
        </p>
      )}
      <label className="mt-4 block space-y-1 text-[13px] text-ink-2">
        <span>给目标助手的说明</span>
        <Textarea
          rows={4}
          maxLength={10000}
          value={brief}
          disabled={command.pending}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="说明接下来希望怎样使用或修改这份稿件。"
        />
      </label>
      {command.error && (
        <p role="alert" className="mt-3 text-[13px] text-hot">
          {command.error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button disabled={command.pending} onClick={close}>
          取消
        </Button>
        <Button
          tone="primary"
          busy={command.pending}
          disabled={!targetAvailable}
          onClick={async () => {
            if (!targetAvailable) return;
            const result = await command.run<{ targetSessionId: string }>(
              `${sessionApi(sessionId)}/handoffs`,
              {
                targetAssistantId: target,
                artifactId: artifact.artifactId,
                version: artifact.version,
                brief,
              },
            );
            if (result && alive.current)
              navigate(sessionHref(result.targetSessionId));
          }}
        >
          确认转交并打开
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}

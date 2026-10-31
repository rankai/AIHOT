import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { AccountMe } from "@aihot/contracts/account";
import type {
  AssistantArtifact,
  AssistantFeeAuthorization,
  AssistantOptions,
  AssistantSession,
} from "@aihot/contracts/assistant";
import type { ToolQuote } from "@aihot/contracts/credits";
import { TurnQuoteDialog } from "./quote-dialog";
import { Button } from "../admin/ui";
import { usePrivateAccount } from "../account/use-private-account";
import { toolGet, useToolCommand } from "../tools/client";
import { AssistantArtifactPanel } from "./artifacts";
import {
  draftKey,
  freezeTurn,
  failedTurn,
  canRejectTurn,
  readDraft,
  settledDraft,
  rejectedDraft,
  useAssistantDraft,
  type AssistantDraft,
} from "./drafts";
import { useAssistantSnapshot } from "./use-snapshot";
import { AssistantMessageStream } from "./message-stream";
import { AssistantWorkspace } from "./workspace";
import { AssistantComposer } from "./composer";
import { AssistantComposerControls } from "./composer-controls";
import { AssistantAttachmentCards, useAssistantMaterials } from "./materials";
import { attachmentBatchIssue, attachmentInputIds, attachmentSelectionCount, attachmentsReady, patchAttachment } from "./materials-data";
import { AssistantFeeDialog } from "./fee-dialog";
import { SessionControls } from "./session-controls";
import { AssistantUnsavedGuard } from "./unsaved";
import {
  assistantHref,
  makeTurnInput,
  runtimeMessage,
  sessionApi,
  turnActive,
  type PendingTurn,
  type SessionPage,
  type TurnInput,
} from "./data";

export interface AssistantSessionData {
  me: AccountMe;
  options: AssistantOptions;
  session: AssistantSession;
  history?: SessionPage;
}
export function AssistantConversation({
  data,
}: {
  data: AssistantSessionData;
}) {
  usePrivateAccount(data.me);
  return (
    <ConversationContent
      key={`${data.me.user.id}:${data.me.csrf}:${data.session.sessionId}`}
      data={data}
    />
  );
}
function ConversationContent({ data }: { data: AssistantSessionData }) {
  const {
    snapshot: session,
    refresh,
    reading,
    error: readError,
  } = useAssistantSnapshot(data.session);
  const command = useToolCommand(
    data.me.csrf,
    `assistant:session:${data.session.sessionId}`,
  );
  const key = draftKey(`${data.me.user.id}:${data.me.csrf}`, session.sessionId);
  const [draft, updateDraft, ready] = useAssistantDraft(key);
  const [quoted, setQuoted] = useState<{
    input: TurnInput;
    quote: ToolQuote;
  } | null>(null);
  const [quoteReading, setQuoteReading] = useState(false);
  const [feeOpen, setFeeOpen] = useState(false);
  const [feeAuthorization, setFeeAuthorization] = useState<AssistantFeeAuthorization | null>(session.feeAuthorization ?? null);
  const feeModeCommand = useToolCommand(data.me.csrf, `assistant:fee-mode:${session.sessionId}`);
  const [feeModeUncertain, setFeeModeUncertain] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);
  const inputCommand = useToolCommand(data.me.csrf, `assistant:inputs:${session.sessionId}`);
  const materials = useAssistantMaterials({ csrf: data.me.csrf, scopeKey: key, capabilities: data.options.inputCapabilities, update: updateDraft, invalidate: () => setQuoted(null) });
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "artifacts">("chat");
  const [artifactOpen, setArtifactOpen] = useState(true);
  const [newArtifacts, setNewArtifacts] = useState(false);
  const alive = useRef(true);
  const submitting = useRef(false);
  const quoting = useRef(false);
  const lifecyclePending = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const navigate = useNavigate();
  const profile = data.options.assistants.find(
    (row) => row.id === session.assistantId,
  );
  const active = turnActive(session);
  const question =
    session.turn?.phase === "waiting_question" ? session.turn.question : null;
  const sendDisabled =
    !ready ||
    active ||
    session.archived ||
    !profile?.available ||
    command.pending ||
    feeModeCommand.pending || feeModeUncertain ||
    !!draft.pendingTurn ||
    !!draft.pendingLifecycle ||
    !attachmentsReady(draft.attachments) ||
    quoteReading;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => { setFeeAuthorization(session.feeAuthorization ?? null); }, [session.feeAuthorization]);
  useEffect(() => {
    if (!ready) return;
    if (draft.inputIds === undefined) updateDraft((previous) => ({ ...previous, inputIds: !session.messages.length ? session.inputs.filter((input) => typeof input.source.sourceSessionId === "string").map((input) => input.id) : [] }));
    if (draft.configureFees) { updateDraft((previous) => ({ ...previous, configureFees: false })); setFeeOpen(true); }
  }, [ready, draft.configureFees]);
  useEffect(() => {
    setQuoted((previous) =>
      previous && previous.input.expectedRevision !== session.revision
        ? null
        : previous,
    );
  }, [session.revision]);
  async function useManualFees() {
    if (!feeAuthorization?.enabled || feeModeCommand.pending || feeModeUncertain) return;
    setQuoted(null);
    const result = await feeModeCommand.run<{ authorization: AssistantFeeAuthorization | null }>(`${sessionApi(session.sessionId)}/fee-authorization`, { enabled: false, expectedVersion: feeAuthorization.version });
    if (!alive.current) return;
    if (result) { setFeeAuthorization(result.authorization); void refresh(); }
    else setFeeModeUncertain(true);
  }
  async function checkFeeMode() {
    try {
      const snapshot = await toolGet<AssistantSession>(sessionApi(session.sessionId));
      if (!alive.current) return;
      setFeeAuthorization(snapshot.feeAuthorization ?? null); setFeeModeUncertain(false); void refresh();
    } catch { setNotice("暂时无法核对费用模式，请稍后重试。"); }
  }
  function inputFor(value: AssistantDraft, revision = session.revision, autoAuthorizationId?: string): TurnInput {
    return makeTurnInput(
      value.text,
      revision,
      value.actionId,
      value.references,
      attachmentInputIds(value.attachments, value.inputIds),
      autoAuthorizationId,
    );
  }
  async function requestQuote(message: string, manually = false) {
    if (sendDisabled || quoting.current || !message.trim()) return;
    quoting.current = true;
    setQuoteReading(true);
    setManualFallback(false);
    const selected = { ...readDraft(key), text: message };
    let revision = session.revision;
    for (const attachment of selected.attachments ?? []) {
      if (attachment.inputId || !attachment.assetKey) continue;
      const attached = await inputCommand.run<{ inputId: string; revision: number }>(`${sessionApi(session.sessionId)}/inputs`, { assetKey: attachment.assetKey });
      if (!attached) { quoting.current = false; setQuoteReading(false); setNotice("材料关联未完成，文件和需求已保留。请重新发送以核对原关联。"); await refresh(); return; }
      revision = attached.revision;
      updateDraft((previous) => ({ ...previous, attachments: patchAttachment(previous.attachments, attachment.id, { inputId: attached.inputId }) }));
    }
    const current = readDraft(key);
    // Attachment binding changes revision/IDs only; user edits still require a fresh Send.
    if (current.text.trim() !== selected.text.trim() || current.actionId !== selected.actionId || JSON.stringify(current.references ?? []) !== JSON.stringify(selected.references ?? []) || JSON.stringify(current.attachments?.map((row) => row.id) ?? []) !== JSON.stringify(selected.attachments?.map((row) => row.id) ?? [])) {
      quoting.current = false; setQuoteReading(false); setNotice("需求或材料已更改，请重新发送。"); await refresh(); return;
    }
    const autoAuthorizationId = !manually && feeAuthorization?.enabled ? feeAuthorization.id : undefined;
    const input = inputFor(current, revision, autoAuthorizationId);
    const quote = await command.run<ToolQuote>(
      `${sessionApi(session.sessionId)}/quote`,
      input,
    );
    quoting.current = false;
    if (!alive.current) return;
    setQuoteReading(false);
    // A response cannot resurrect a quote for an input changed while the request was in flight.
    if (
      quote &&
      JSON.stringify(inputFor(readDraft(key), revision, autoAuthorizationId)) === JSON.stringify(input)
    ) {
      if (autoAuthorizationId) void submitConfirmed({ input, quoteId: quote.quoteId, attachments: current.attachments?.map((row) => ({ ...row })) });
      else setQuoted({ input, quote });
    } else if (!quote) {
      if (autoAuthorizationId && command.failure.current?.code === "auto_confirmation_required") setManualFallback(true);
      await refresh();
    }
  }
  const autoQuoteStarted = useRef(false);
  useEffect(() => {
    if (!ready || !draft.autoQuote || autoQuoteStarted.current) return;
    autoQuoteStarted.current = true;
    updateDraft((previous) => ({ ...previous, autoQuote: false }));
    void requestQuote(draft.text);
  }, [ready, draft.autoQuote]);
  async function submitConfirmed(attempt: PendingTurn, retry = false) {
    if (
      submitting.current ||
      command.pending ||
      (active && !retry) ||
      session.archived
    )
      return;
    submitting.current = true;
    if (!retry) updateDraft((previous) => freezeTurn(previous, attempt));
    setQuoted(null);
    const result = await command.run(
      `${sessionApi(session.sessionId)}/turns`,
      { ...attempt.input, quoteId: attempt.quoteId },
      "POST",
      attempt.input,
    );
    submitting.current = false;
    if (result) updateDraft((previous) => settledDraft(previous, attempt));
    else {
      const status = command.failure.current?.status ?? null;
      updateDraft((previous) => failedTurn(previous, attempt, status));
      if (attempt.input.autoAuthorizationId && canRejectTurn(attempt, status) && command.failure.current?.code === "auto_confirmation_required") {
        updateDraft((previous) => rejectedDraft(previous, (id) => session.artifacts.find((artifact) => artifact.artifactId === id)?.content.title ?? "稿件"));
        setManualFallback(true);
      }
    }
    if (!alive.current) return;
    await refresh();
  }
  async function answerQuestion() {
    if (!question || command.pending || session.archived) return;
    const answer =
      latest.current.answer?.questionId === question.questionId
        ? latest.current.answer.text.trim()
        : "";
    if (!answer) return;
    const result = await command.run(
      `${sessionApi(session.sessionId)}/turns/${session.turn!.turnId}/answer`,
      {
        questionId: question.questionId,
        expectedRevision: session.revision,
        answer,
      },
    );
    if (result)
      updateDraft((previous) =>
        previous.answer?.questionId === question.questionId &&
        previous.answer.text.trim() === answer
          ? { ...previous, answer: undefined }
          : previous,
      );
    if (alive.current) await refresh();
  }
  async function control(action: "stop" | "resume") {
    if (
      !session.turn ||
      command.pending ||
      (action === "resume" && !session.turn.canResume)
    )
      return;
    const result = await command.run(
      `${sessionApi(session.sessionId)}/turns/${session.turn.turnId}/${action}`,
      { generation: session.turn.generation },
    );
    if (!alive.current) return;
    if (result)
      setNotice(
        action === "stop"
          ? "已停止后续执行。已发出的外部请求及费用按实际结果核对。"
          : "已请求继续处理。",
      );
    await refresh();
  }
  async function verifyLifecycle(action = readDraft(key).pendingLifecycle) {
    if (!action) return;
    if (action === "archive") {
      const current = await refresh();
      if (current?.archived) {
        updateDraft((previous) => ({
          ...previous,
          pendingLifecycle: undefined,
        }));
        window.dispatchEvent(new Event("assistant-history-changed"));
        setNotice(
          "会话已归档，从历史隐藏；原地址仍可查看。当前没有归档列表或恢复入口。",
        );
      } else setNotice("归档结果尚未确认，请重新读取核对。");
      return;
    }
    try {
      const response = await fetch(sessionApi(session.sessionId), {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (!alive.current) return;
      if (response.status === 404) {
        updateDraft((previous) => ({
          ...previous,
          pendingLifecycle: undefined,
        }));
        window.dispatchEvent(new Event("assistant-history-changed"));
        navigate(assistantHref(session.assistantId));
      } else
        setNotice(
          "删除结果尚未确认，已保留当前内容。请重新读取；不会自动重复删除。",
        );
    } catch {
      if (alive.current)
        setNotice("读取中断，删除结果仍需核对。不会自动重复删除。");
    }
  }
  async function lifecycle(action: "archive" | "delete") {
    if (lifecyclePending.current || command.pending || draft.pendingLifecycle)
      return;
    lifecyclePending.current = true;
    updateDraft((previous) => ({ ...previous, pendingLifecycle: action }));
    const result = await command.run(
      `${sessionApi(session.sessionId)}/${action}`,
      {},
    );
    if (!alive.current) return;
    lifecyclePending.current = false;
    if (result && action === "delete") {
      updateDraft((previous) => ({ ...previous, pendingLifecycle: undefined }));
      window.dispatchEvent(new Event("assistant-history-changed"));
      navigate(assistantHref(session.assistantId));
    } else await verifyLifecycle(action);
  }
  const messages = useMemo(
    () => session.messages.filter((message) => message.text.trim()),
    [session.messages],
  );
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: runtimeMessage,
    isRunning: active,
    isSendDisabled: sendDisabled,
    activeRunId: session.turn?.turnId,
    canResume: !!session.turn?.canResume,
    onNew: async (message) => {
      await requestQuote(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
    },
    onCancel: async () => {
      await control("stop");
    },
    ...(session.turn?.canResume
      ? {
          onResume: async () => {
            await control("resume");
          },
        }
      : {}),
  });
  const observed = useRef(
    new Map(
      session.artifacts.map((artifact) => [
        artifact.artifactId,
        artifact.version,
      ]),
    ),
  );
  useEffect(() => {
    if (
      session.artifacts.some(
        (artifact) =>
          !observed.current.has(artifact.artifactId) ||
          artifact.version > observed.current.get(artifact.artifactId)!,
      )
    ) {
      setNewArtifacts(true);
      if (!observed.current.size) setArtifactOpen(true);
    }
    observed.current = new Map(
      session.artifacts.map((artifact) => [
        artifact.artifactId,
        artifact.version,
      ]),
    );
  }, [session.artifacts]);
  function reference(artifact: AssistantArtifact) {
    if (question || active || session.archived || command.pending || draft.pendingTurn) { setNotice("请先结束当前处理，再为下一次需求更换稿件引用。"); return; }
    const references = readDraft(key).references ?? [];
    if (
      references.length >= 10 &&
      !references.some(
        (reference) => reference.artifactId === artifact.artifactId,
      )
    ) {
      setNotice("每次最多引用 10 份稿件，请先移除一个引用。");
      return;
    }
    setQuoted(null);
    updateDraft((previous) => ({
      ...previous,
      references: [
        ...(previous.references ?? []).filter(
          (value) => value.artifactId !== artifact.artifactId,
        ),
        {
          artifactId: artifact.artifactId,
          version: artifact.version,
          title: artifact.content.title,
        },
      ],
    }));
    setView("chat");
    setNotice(`已引用稿件版本 ${artifact.version}，可在下次发送时描述修改要求。`);
  }
  function showArtifacts() {
    setView("artifacts");
    setArtifactOpen(true);
    setNewArtifacts(false);
  }
  const answerText =
    question && draft.answer?.questionId === question.questionId
      ? draft.answer.text
      : "";
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantUnsavedGuard
        hasDraft={!!draft.text || !!draft.answer?.text || !!draft.pendingTurn || !!draft.attachments?.length || !!draft.references?.length}
      >
        <AssistantWorkspace
          assistantId={session.assistantId}
          history={data.history}
          title={session.title}
          subtitle={`${session.assistantId === "creative" ? "创作助手" : "小红书助手"}${session.archived ? " · 已归档" : ""}`}
          controls={
            <SessionControls
              active={active}
              pending={command.pending || !!draft.pendingLifecycle}
              archived={session.archived}
              lifecycle={lifecycle}
            />
          }
          artifactCount={session.artifacts.length}
          view={view}
          setView={setView}
          artifactOpen={artifactOpen}
          setArtifactOpen={setArtifactOpen}
          artifacts={
            session.artifacts.length ? (
              <AssistantArtifactPanel
                artifacts={session.artifacts}
                sessionId={session.sessionId}
                csrf={data.me.csrf}
                active={active}
                options={data.options}
                refresh={refresh}
                onReference={reference}
              />
            ) : undefined
          }
          chat={
            <ThreadPrimitive.Root className="assistant-thread">
              <AssistantMessageStream
                session={session}
                messages={messages}
                profile={profile}
                scopeKey={key}
                csrf={data.me.csrf}
                pending={command.pending}
                reading={reading}
                readError={readError}
                refresh={refresh}
                control={control}
                showArtifacts={showArtifacts}
                setView={setView}
                view={view}
              />
              <AssistantComposer
                text={question ? answerText : draft.text}
                onChange={(text) => {
                  if (question)
                    updateDraft((previous) => ({
                      ...previous,
                      answer: { questionId: question.questionId, text },
                    }));
                  else {
                    setQuoted(null);
                    updateDraft((previous) => ({ ...previous, text }));
                  }
                }}
                onSend={() =>
                  question
                    ? void answerQuestion()
                    : void requestQuote(draft.text)
                }
                disabled={
                  question ? command.pending || session.archived : sendDisabled
                }
                busy={command.pending}
                answerMode={!!question}
                confirmation={quoted && (
                  <TurnQuoteDialog
                    quote={quoted.quote}
                    message={quoted.input.message}
                    pending={command.pending}
                    error={command.error}
                    close={() => setQuoted(null)}
                    confirm={() => {
                      if (
                        !active &&
                          JSON.stringify(inputFor(readDraft(key), quoted.input.expectedRevision, quoted.input.autoAuthorizationId)) ===
                          JSON.stringify(quoted.input)
                      )
                        void submitConfirmed({
                          input: quoted.input,
                          quoteId: quoted.quote.quoteId,
                          attachments: readDraft(key).attachments?.map((row) => ({ ...row })),
                        });
                    }}
                  />
                )}
                maxLength={
                  question ? 10000 : data.options.limits.inputCharacters
                }
                hint={
                  quoteReading
                    ? "正在确认本次费用…"
                    : active && !question
                      ? "可以记录下一次需求；这次处理结束后再发送，不会自动排队。"
                      : session.archived
                        ? "已归档会话可查看，不能发送新需求。"
                        : feeAuthorization?.enabled ? `额度内自动 · 剩余 ${feeAuthorization.remaining.toLocaleString()} 积分 · 当前创作 ${feeAuthorization.turnPrice.amount} 积分 · Shift+Enter 换行` : undefined
                }
                controls={profile && <AssistantComposerControls profile={profile} actionId={draft.actionId} onAction={(actionId) => { setQuoted(null); updateDraft((previous) => ({ ...previous, actionId })); }} disabled={active || session.archived || command.pending || quoteReading || !!draft.pendingTurn} feeDisabled={session.archived || command.pending || quoteReading || feeModeCommand.pending || feeModeUncertain} addFiles={materials.add} capabilities={data.options.inputCapabilities} artifacts={session.artifacts} onReference={reference} feeAuthorization={feeAuthorization} manualFees={() => void useManualFees()} configureFees={() => { setQuoted(null); setFeeOpen(true); }} />}
                attachments={<><AssistantAttachmentCards attachments={draft.attachments ?? []} count={attachmentSelectionCount(draft.attachments, draft.inputIds)} max={data.options.inputCapabilities.maxAttachments} disabled={active || session.archived || command.pending || quoteReading || !!draft.pendingTurn} retry={materials.retry} remove={materials.remove} error={materials.error} />{!attachmentsReady(draft.attachments) && <p className="mb-2 text-[11px] text-ink-4">全部附件可用后才能发送；可重试或移除问题附件。</p>}</>}
              >
                {!question && !!session.inputs.length && <details className="mb-2 text-[12px] text-ink-3"><summary>选择已有会话材料（已选 {draft.inputIds?.length ?? 0} 份）</summary><div className="mt-2 max-h-28 space-y-2 overflow-auto">{session.inputs.filter((input) => !(draft.attachments ?? []).some((card) => card.inputId === input.id)).map((input) => <label key={input.id} className="flex items-start gap-2"><input type="checkbox" checked={draft.inputIds?.includes(input.id) ?? false} disabled={active || command.pending || quoteReading || session.archived} onChange={(event) => { const checked = event.target.checked; const current = readDraft(key); const issue = checked ? attachmentBatchIssue(attachmentSelectionCount(current.attachments, current.inputIds), 1, data.options.inputCapabilities.maxAttachments) : null; if (issue) { setNotice(issue); return; } setQuoted(null); updateDraft((previous) => ({ ...previous, inputIds: checked ? [...(previous.inputIds ?? []), input.id] : previous.inputIds?.filter((id) => id !== input.id) })); }} /><span className="min-w-0 break-words">{typeof input.source.filename === "string" ? input.source.filename : "转交材料"}{typeof input.source.version === "number" ? ` · v${input.source.version}` : ""}</span></label>)}</div><p className="mt-2 text-[11px]">只引用勾选材料。历史消息仍保留；移除不会抹除已经进入历史的内容。</p></details>}
                {newArtifacts && (
                  <p role="status" className="mb-2 text-[12px] text-accent">
                    稿件有更新。
                    <button className="ml-2 underline" onClick={showArtifacts}>
                      查看稿件
                    </button>
                  </p>
                )}
                {notice && (
                  <p role="status" className="mb-2 text-[12px] text-accent">
                    {notice}
                  </p>
                )}
                {profile && !profile.available && (
                  <p role="status" className="mb-2 text-[12px] text-ink-3">
                    {profile.reason ?? "助手当前不可用。"}
                  </p>
                )}

                {draft.pendingTurn && (
                  <div className="assistant-inline-notice" role="status">
                    <p>
                      {command.pending
                        ? "正在提交已确认的需求，尚未显示为已保存消息。"
                        : "上次已确认的提交仍在核对。将按已确认的原需求核对，不会自动重发。"}
                    </p>
                    <details className="mt-2">
                      <summary>查看本次提交</summary>
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {draft.pendingTurn.input.message}
                      </p>
                    </details>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={reading || command.pending}
                        onClick={() => void refresh()}
                      >
                        读取提交状态
                      </Button>
                      <Button
                        size="sm"
                        disabled={command.pending}
                        onClick={() =>
                          void submitConfirmed(draft.pendingTurn!, true)
                        }
                      >
                        重试原提交
                      </Button>
                      {canRejectTurn(draft.pendingTurn, command.errorStatus) && (
                          <Button
                            size="sm"
                            onClick={() => {
                              updateDraft((previous) =>
                                rejectedDraft(
                                  previous,
                                  (id) =>
                                    session.artifacts.find(
                                      (artifact) => artifact.artifactId === id,
                                    )?.content.title ?? "稿件",
                                ),
                              );
                            }}
                          >
                            {draft.text.trim()
                              ? "保留新草稿并取消原提交"
                              : "返回修改原需求"}
                          </Button>
                        )}
                    </div>
                    <p className="mt-2 text-[11px] text-ink-4">
                      本次页面会话内可恢复原提交；刷新或重新登录后先读取服务端状态，不自动重发。
                    </p>
                  </div>
                )}
                {draft.pendingLifecycle && (
                  <div className="assistant-inline-notice">
                    <p>
                      正在核对
                      {draft.pendingLifecycle === "delete" ? "删除" : "归档"}
                      结果，不能重复操作。
                    </p>
                    <Button
                      size="sm"
                      disabled={reading || command.pending}
                      onClick={() => void verifyLifecycle()}
                    >
                      读取操作结果
                    </Button>
                  </div>
                )}
                {command.error && !quoted && (
                  <p role="alert" className="mb-2 text-[12px] text-hot">
                    {command.error}
                  </p>
                )}
                {inputCommand.error && <p role="alert" className="mb-2 text-[12px] text-hot">{inputCommand.error}</p>}
                {feeModeUncertain && <div className="assistant-inline-notice" role="status"><p>费用模式结果待核对，暂不重复更改。</p><Button size="sm" onClick={() => void checkFeeMode()}>核对费用模式</Button></div>}
                {manualFallback && !active && <div className="assistant-inline-notice"><p>本次需要额外人工授权，自动额度不会因此提高。</p><Button size="sm" disabled={command.pending || quoteReading} onClick={() => void requestQuote(draft.text, true)}>逐次确认本次费用</Button></div>}
                {!question && !!draft.references?.length && (
                  <div
                    className="my-2 flex flex-wrap gap-2"
                    aria-label="引用稿件"
                  >
                    {draft.references.map((reference) => (
                      <span
                        key={reference.artifactId}
                        className="assistant-reference"
                      >
                        <span className="truncate">
                          引用 {reference.title} · v{reference.version}
                        </span>
                        <button
                          type="button"
                          disabled={active || command.pending || quoteReading || session.archived}
                          aria-label={`移除引用 ${reference.title}`}
                          onClick={() => {
                            setQuoted(null);
                            updateDraft((previous) => ({
                              ...previous,
                              references: previous.references?.filter(
                                (value) =>
                                  value.artifactId !== reference.artifactId,
                              ),
                            }));
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {question && !!draft.text && (
                  <p className="mb-2 text-[11px] text-ink-4">
                    下一次需求的草稿已在本次页面会话内保留，回答不会覆盖它。
                  </p>
                )}
              </AssistantComposer>
            </ThreadPrimitive.Root>
          }
        />
        {feeOpen && <AssistantFeeDialog sessionId={session.sessionId} csrf={data.me.csrf} initial={feeAuthorization} close={() => setFeeOpen(false)} changed={(authorization) => { setQuoted(null); setFeeAuthorization(authorization); void refresh(); }} />}
      </AssistantUnsavedGuard>
    </AssistantRuntimeProvider>
  );
}

import { useConfirmationMode } from "./fee-mode";
import { draftSelection, editDraftText } from "./drafts";
import { useAssistantOptions, unavailableSelection } from "./use-options";
import { AssistantMessageQueue } from "./message-queue";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { AccountMe } from "@aihot/contracts/account";
import type {
  AssistantArtifact,
  AssistantConfirmationMode,
  AssistantFeeAuthorization,
  AssistantOptions,
  AssistantSession,
  AssistantTurnQuote,
} from "@aihot/contracts/assistant";
import { TurnQuoteDialog } from "./quote-dialog";
import { Button } from "../admin/ui";
import { usePrivateAccount } from "../account/use-private-account";
import { toolGet, useToolCommand } from "../tools/client";
import { AssistantArtifactPanel } from "./artifacts";
import { artifactDeliveries, currentArtifactTarget, uncoveredArtifactUpdates, type ArtifactTarget } from "./artifact-display";
import {
  draftKey,
  hasComposerDraft,
  hasUnsavedAssistantContent,
  freezeTurn,
  canRejectTurn,
  readDraft,
  settledDraft,
  rejectedDraft,
  rejectedQueueDraft,
  restoreDraftInput,
  useAssistantDraft,
  type AssistantDraft,
} from "./drafts";
import { beginRecoveryAttempt, updateRecoveryFailure, recoveryWriteVersion, replaceRecoveryQuote, restoreRejectedQuote, quoteNeedsRefresh, isSubmissionRejection, clearRecovery, saveRecovery, type Recovery, type SavedQuote } from "./recovery-store";
import { useAssistantSnapshot } from "./use-snapshot";
import { AssistantMessageStream } from "./message-stream";
import { AssistantWorkspace } from "./workspace";
import { AssistantComposer } from "./composer";
import { AssistantComposerControls, AssistantSkillNotice, TaskClarification } from "./composer-controls";
import { AssistantAttachmentCards, useAssistantMaterials } from "./materials";
import { attachmentBatchIssue, attachmentInputIds, attachmentSelectionCount, attachmentsReady, patchAttachment } from "./materials-data";
import { AssistantFeeDialog } from "./fee-dialog";
import { SessionControls } from "./session-controls";
import { AssistantUnsavedGuard } from "./unsaved";
import {
  assistantHref,
  makeTurnInput,
  runtimeMessage,
  submissionErrorCovered,
  sessionApi,
  sessionHref,
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
  const stopCommand = useToolCommand(data.me.csrf, `assistant:stop:${session.sessionId}`);
  const confirmation = useConfirmationMode(String(data.me.user.id));
  const modeRef = useRef(confirmation.mode);
  modeRef.current = confirmation.mode;
  const key = draftKey(String(data.me.user.id), session.sessionId);
  const [draft, updateDraft, ready] = useAssistantDraft(key);
  const { options, refresh: refreshOptions, error: optionsError } = useAssistantOptions(data.options,{sessionId:session.sessionId,artifactVersions:draft.references??[]});
  const quoted = draft.pendingQuote ?? null;
  const requiresRequote = !!quoted && (quoted.input.expectedRevision !== session.revision || quoted.rejectionCode !== "insufficient_credits" && quoteNeedsRefresh(quoted.rejectionCode));
  function persist(record: Recovery) {
    try { saveRecovery(key, record); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : "无法保存恢复记录，请核对浏览器存储后重试。"); return false; }
  }
  function beginAttempt(record: Exclude<Recovery, { kind: "quote" }>) {
    try { return beginRecoveryAttempt(key, record); }
    catch (error) { setNotice(error instanceof Error ? error.message : "无法保存恢复记录，请核对浏览器存储后重试。"); return null; }
  }
  function setQuoted(value: SavedQuote | null) {
    if (value) return persist({ kind: "quote", value });
    if (quoted) clearRecovery(key, { kind: "quote", value: quoted });
    return true;
  }
  function restoreInput(input: TurnInput) {
    updateDraft(previous => restoreDraftInput(previous, input, () => "已选稿件"));
  }
  async function requoteSaved() {
    if (!quoted || command.pending || active || draft.pendingTurn) return;
    const original = quoted, writeVersion = recoveryWriteVersion(key, { kind: "quote", value: quoted }), input = { ...quoted.input, autoAuthorizationId:undefined, expectedRevision: session.revision };
    // The saved send mode fixes the meaning of this explicit click across awaits.
    const continueAutomatically = original.input.confirmationMode === "automatic";
    const quote = await command.run<AssistantTurnQuote>(`${sessionApi(session.sessionId)}/quote`, input);
    if (quote) {
      try {
        const next = { commandKey: crypto.randomUUID(), input, quote };
        if (replaceRecoveryQuote(key, original, writeVersion, next)) {
          updateDraft(previous => ({ ...previous, submissionError: undefined }));
          if (continueAutomatically && quote.task && quote.affordable)
            await submitConfirmed({ commandKey: next.commandKey, input, quoteId: quote.quoteId }, false, true, next);
        }
      }
      catch (error) { setNotice(error instanceof Error ? error.message : "新报价未保存，请保留原需求后重试。"); }
    }
    await refresh();
  }
  const [quoteRequest, setQuoteRequest] = useState<string | null>(null);
  const quoteReading = quoteRequest !== null;
  const [feeOpen, setFeeOpen] = useState(false);
  const [feeAuthorization, setFeeAuthorization] = useState<AssistantFeeAuthorization | null>(session.feeAuthorization ?? null);
  const feeModeCommand = useToolCommand(data.me.csrf, `assistant:fee-mode:${session.sessionId}`);
  const [feeModeUncertain, setFeeModeUncertain] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);
  const inputCommand = useToolCommand(data.me.csrf, `assistant:inputs:${session.sessionId}`);
  const materials = useAssistantMaterials({ csrf: data.me.csrf, scopeKey: key, capabilities: options.inputCapabilities, update: updateDraft, invalidate: () => {} });
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "artifacts">("chat");
  const [artifactOpen, setArtifactOpen] = useState(true);
  const [artifactTarget, setArtifactTarget] = useState<{ artifactId: string; version: number } | null>(null);
  const [newArtifacts, setNewArtifacts] = useState<ArtifactTarget[]>([]);
  const deliveries = artifactDeliveries(session);
  const currentArtifact = currentArtifactTarget(session);
  const uncoveredUpdates = uncoveredArtifactUpdates(newArtifacts, deliveries);
  const alive = useRef(true);
  const submitting = useRef(false);
  const queueSubmitting = useRef(false);
  const [sending, setSending] = useState<{ key: string; message: string; afterSeq: number; label: string; entryId?: string } | null>(null);
  const stopAttempt = useRef<{ turnId: string; generation: number } | null>(null);
  const quoting = useRef(false);
  const lifecyclePending = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const navigate = useNavigate();
  const location = useLocation();
  const profile = options.assistants.find(
    (row) => row.id === session.assistantId,
  );
  const active = turnActive(session);
  const waitingEntries = session.queue?.entries.filter(entry => ["pending", "quoted"].includes(entry.state)) ?? [];
  useEffect(() => {
    if (ready && location.hash === "#assistant-fees") document.getElementById("assistant-fees")?.scrollIntoView({ block: "nearest" });
  }, [ready, location.hash, quoted?.quote.quoteId, waitingEntries[0]?.quote?.quoteId]);
  const question =
    session.turn?.phase === "waiting_question" ? session.turn.question : null;
  const sendDisabled =
    !ready || !confirmation.ready ||
    session.archived ||
    (!question && (!profile?.available || unavailableSelection(profile, draftSelection(draft)))) ||
    command.pending ||
    feeModeCommand.pending || feeModeUncertain ||
    !!sending ||
    !!draft.pendingTurn ||
    !!draft.pendingQueue ||
    !!draft.pendingLifecycle ||
    !attachmentsReady(draft.attachments) ||
    quoteReading || !!quoted;
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
  async function useManualFees() {
    if (!feeAuthorization?.enabled || feeModeCommand.pending || feeModeUncertain) return;
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
  function inputFor(value: AssistantDraft, confirmationMode: AssistantConfirmationMode, revision = session.revision, autoAuthorizationId?: string): TurnInput {
    return { ...makeTurnInput(
      value.text,
      revision,
      draftSelection(value),
      value.references,
      attachmentInputIds(value.attachments, value.inputIds),
      autoAuthorizationId,
      value.taskHint,
      value.taskChoice,
    ), confirmationMode };
  }
  async function runQueueAttempt(attempt: NonNullable<AssistantDraft["pendingQueue"]>, clearComposer = false) {
    if (queueSubmitting.current || command.pending) return;
    queueSubmitting.current = true;
    if (!readDraft(key).pendingQueue) setSending({ key: attempt.key, message: attempt.kind === "enqueue" ? attempt.input.message : session.queue?.entries.find(entry => entry.id === attempt.entryId)?.message ?? "", afterSeq: session.messages.at(-1)?.seq ?? 0, label: attempt.kind === "enqueue" ? "正在排队…" : "正在开始处理…", ...(attempt.kind === "approve" ? { entryId: attempt.entryId } : {}) });
    const path = attempt.kind === "enqueue" ? `${sessionApi(session.sessionId)}/queue` : `${sessionApi(session.sessionId)}/queue/${attempt.entryId}/approve`;
    const body = attempt.kind === "enqueue" ? attempt.input : { quoteId: attempt.quoteId };
    const started = beginAttempt({ kind: "queue", value: attempt });
    if (!started) { queueSubmitting.current = false; setSending(null); return; }
    if (clearComposer) updateDraft(previous => ({ ...previous, text: "", taskHint: undefined, taskChoice: undefined, references: [], attachments: [], inputIds: [] }));
    const result = await command.run(path, body, "POST", body, attempt.key);
    if (result) clearRecovery(key, { kind: "queue", value: attempt });
    else updateRecoveryFailure(key, { kind: "queue", value: attempt }, started, command.failure.current?.status ?? null, command.failure.current?.code);
    queueSubmitting.current = false;
    if (!result) setSending(null);
    if (result) setNotice(attempt.kind === "enqueue" ? "已排队，可继续输入下一条需求。" : "费用已确认。");
    await refresh();
    if (result) setSending(null);
  }
  useEffect(() => {
    const attempt = draft.pendingQueue;
    if (!attempt) return;
    const saved = session.queue?.entries.find(entry => attempt.kind === "enqueue" ? entry.commandKey === attempt.key : entry.id === attempt.entryId && entry.state === "submitted");
    if (saved) clearRecovery(key, { kind: "queue", value: attempt });
    if (saved) updateDraft(previous => previous.pendingQueue?.key === attempt.key ? { ...previous, pendingQueue: undefined } : previous);
  }, [session.eventSeq, draft.pendingQueue]);
  async function queueAction(action: "cancel" | "quote" | "resume", entryId?: string, taskChoice?: import("@aihot/contracts/assistant").AssistantTaskChoice) {
    await command.run(`${sessionApi(session.sessionId)}/queue/${entryId ? `${entryId}/` : ""}${action}`, taskChoice?{taskChoice}:{});
    await refresh();
  }
  function approveQueue(entryId: string, quoteId: string) {
    if (command.pending || draft.pendingQueue) return;
    const attempt = { kind: "approve" as const, key: crypto.randomUUID(), entryId, quoteId };
    void runQueueAttempt(attempt);
  }
  async function requestQuote(message: string, manually = false) {
    if (!confirmation.ready || sendDisabled || quoting.current || !message.trim()) return;
    setNotice(null);
    // Cross-tab preference changes apply to the next Send, not this request's authorization.
    const confirmationMode = modeRef.current;
    updateDraft(previous => ({ ...previous, submissionError: undefined }));
    quoting.current = true;
    setQuoteRequest(message);
    setManualFallback(false);
    const selected = { ...readDraft(key), text: message };
    let revision = session.revision;
    for (const attachment of selected.attachments ?? []) {
      if (attachment.inputId || !attachment.assetKey) continue;
      const attached = await inputCommand.run<{ inputId: string; revision: number }>(`${sessionApi(session.sessionId)}/inputs`, { assetKey: attachment.assetKey });
      if (!attached) { quoting.current = false; setQuoteRequest(null); setNotice("材料关联未完成，文件和需求已保留。请重新发送以核对原关联。"); await refresh(); return; }
      revision = attached.revision;
      updateDraft((previous) => ({ ...previous, attachments: patchAttachment(previous.attachments, attachment.id, { inputId: attached.inputId }) }));
    }
    const current = readDraft(key);
    // Attachment binding changes revision/IDs only; user edits still require a fresh Send.
    if (current.text.trim() !== selected.text.trim() || JSON.stringify(draftSelection(current)) !== JSON.stringify(draftSelection(selected)) || JSON.stringify(current.taskHint) !== JSON.stringify(selected.taskHint) || JSON.stringify(current.references ?? []) !== JSON.stringify(selected.references ?? []) || JSON.stringify(current.attachments?.map((row) => row.id) ?? []) !== JSON.stringify(selected.attachments?.map((row) => row.id) ?? [])) {
      quoting.current = false; setQuoteRequest(null); setNotice("需求或材料已更改，请重新发送。"); await refresh(); return;
    }
    const autoAuthorizationId = undefined;
    const input = inputFor(current, confirmationMode, revision, autoAuthorizationId);
    if (active || waitingEntries.length > 0) {
      const attempt = { kind: "enqueue" as const, key: crypto.randomUUID(), input };
      quoting.current = false; setQuoteRequest(null);
      await runQueueAttempt(attempt, true); return;
    }
    const quote = await command.run<AssistantTurnQuote>(
      `${sessionApi(session.sessionId)}/quote`,
      input,
    );
    quoting.current = false;
    if (!alive.current) return;
    setQuoteRequest(null);
    // A response cannot resurrect a quote for an input changed while the request was in flight.
    if (
      quote &&
      JSON.stringify(inputFor(readDraft(key), confirmationMode, revision, autoAuthorizationId)) === JSON.stringify(input)
    ) {
      if ((input.confirmationMode === "automatic" && quote.task && quote.affordable) || autoAuthorizationId) {
        const saved = { commandKey: crypto.randomUUID(), input, quote };
        void submitConfirmed({ commandKey: saved.commandKey, input, quoteId: quote.quoteId, attachments: current.attachments?.map((row) => ({ ...row })) }, false, false, saved);
      }
      else {
        if (!setQuoted({ commandKey: crypto.randomUUID(), input, quote })) return;
        updateDraft(previous => ({ ...previous, text: "", taskHint: undefined, taskChoice: undefined, references: [], attachments: [], inputIds: [] }));
      }
    } else if (quote) {
      setNotice("需求或材料已更改，请重新发送。");
      await refresh();
    } else if (!quote) {
      if (autoAuthorizationId && command.failure.current?.code === "auto_confirmation_required") setManualFallback(true);
      await refresh();
    }
  }
  async function submitConfirmed(attempt: PendingTurn, retry = false, preserveDraft = false, savedQuote = quoted) {
    if (
      submitting.current ||
      command.pending ||
      (active && !retry) ||
      (!retry && (!!readDraft(key).pendingTurn || !!readDraft(key).pendingQueue)) ||
      session.archived
    )
      return;
    submitting.current = true;
    if (!retry) setSending({ key: attempt.commandKey, message: attempt.input.message, afterSeq: session.messages.at(-1)?.seq ?? 0, label: "正在开始处理…" });
    const started = beginAttempt({ kind: "turn", value: attempt });
    if (!started) { submitting.current = false; setSending(null); return; }
    if (!retry) updateDraft((previous) => preserveDraft ? { ...previous, pendingTurn: attempt } : freezeTurn(previous, attempt));
    if (savedQuote?.quote.quoteId === attempt.quoteId) clearRecovery(key, { kind: "quote", value: savedQuote });
    const result = await command.run(
      `${sessionApi(session.sessionId)}/turns`,
      { ...attempt.input, quoteId: attempt.quoteId },
      "POST",
      attempt.input,
      attempt.commandKey,
    );
    submitting.current = false;
    if (result) { clearRecovery(key, { kind: "turn", value: attempt }); updateDraft((previous) => settledDraft(previous, attempt)); }
    else {
      const status = command.failure.current?.status ?? null;
      const failure = command.failure.current;
      try {
        const writeVersion = updateRecoveryFailure(key, { kind: "turn", value: attempt }, started, status, failure?.code);
        if (writeVersion && !started.wasUnknown && savedQuote && status !== null && status >= 400 && status < 500 && isSubmissionRejection(failure?.code)) {
          restoreRejectedQuote(key, attempt, writeVersion, savedQuote);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "恢复记录未保存，请继续原提交。");
      }
    }
    if (!result) setSending(null);
    if (!alive.current) return;
    await refresh();
    if (result) setSending(null);
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
      stopCommand.pending ||
      (action === "resume" && !session.turn.canResume)
    )
      return;
    const target = action === "stop" ? stopAttempt.current ?? { turnId: session.turn.turnId, generation: session.turn.generation } : { turnId: session.turn.turnId, generation: session.turn.generation };
    if (action === "stop") stopAttempt.current = target;
    const result = await stopCommand.run(
      `${sessionApi(session.sessionId)}/turns/${target.turnId}/${action}`,
      { generation: target.generation },
    );
    if (result || stopCommand.failure.current?.status != null && stopCommand.failure.current.status < 500) stopAttempt.current = null;
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
    const updates = session.artifacts.filter((artifact) =>
      !observed.current.has(artifact.artifactId) || artifact.version > observed.current.get(artifact.artifactId)!,
    ).map(({ artifactId, version }) => ({ artifactId, version }));
    if (updates.length) {
      setNewArtifacts((previous) => [...previous.filter((target) => !updates.some((update) => update.artifactId === target.artifactId)), ...updates]);
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
    if (question || session.archived || command.pending || draft.pendingTurn || draft.pendingQueue) { setNotice("请先核对当前提交，再更换作品引用。"); return; }
    if (artifact.kind === "image") { setNotice("图片作品不能作为文字稿件引用；如需调整图片，请新建图片需求并说明修改方向。"); return; }
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
    setNotice(`已引用${artifact.kind === "xhs-cover-plan" ? "封面方案" : "稿件"}版本 ${artifact.version}，可在下次发送时描述修改要求。`);
  }
  function showArtifacts(target?: { artifactId: string; version: number }) {
    if (target) setArtifactTarget({ ...target });
    setView("artifacts");
    setArtifactOpen(true);
    if (!target) setNewArtifacts([]);
  }
  function viewedArtifact(target: ArtifactTarget) {
    setNewArtifacts(previous => previous.some(update => update.artifactId === target.artifactId && update.version === target.version) ? uncoveredArtifactUpdates(previous, target) : previous);
  }
  const answerText =
    question && draft.answer?.questionId === question.questionId
      ? draft.answer.text
      : "";
  const sendingRequestVisible = !!sending && (
    messages.some(message => message.role === "user" && message.seq > sending.afterSeq && message.text === sending.message) ||
    session.queue?.entries.some(entry => ["pending", "quoted"].includes(entry.state) && (entry.commandKey === sending.key || entry.id === sending.entryId))
  );
  const submissionError = submissionErrorCovered(command.failure.current, draft.pendingTurn?.commandKey, draft.pendingTurn?.hasUnknownResult) ||
    submissionErrorCovered(command.failure.current, draft.pendingQueue?.key, draft.pendingQueue?.unknown);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantUnsavedGuard
        hasDraft={hasUnsavedAssistantContent(draft)}
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
                target={artifactTarget}
                defaultTarget={currentArtifact}
                reading={view === "artifacts"}
                onViewed={viewedArtifact}
                artifacts={session.artifacts}
                sessionId={session.sessionId}
                csrf={data.me.csrf}
                active={active}
                options={options}
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
                confirmationMode={confirmation.mode}
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
                canQueue={!sendDisabled && !question && !readError}
                showWelcome={ready && !reading && !readError && !session.turn && !session.initialRequest && !quoteReading && !quoted && !sending && !draft.pendingTurn && !draft.pendingQueue && !waitingEntries.length}
                actionsStamp={`${quoteReading}:${sending?.key ?? ""}:${quoted?.quote.quoteId ?? ""}:${session.queue?.paused}:${session.queue?.entries.map(entry => `${entry.id}:${entry.state}:${entry.quote?.quoteId ?? ""}:${entry.error ?? ""}`).join("|") ?? ""}`}
                actions={<div id="assistant-fees">
                  {(quoteReading || sending) && <div>
                    {!sendingRequestVisible && <div className="assistant-message assistant-message-user">
                      <p className="mb-2 text-[11px] font-medium text-ink-4">你</p>
                      <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.9] [overflow-wrap:anywhere]">{sending?.message ?? quoteRequest}</p>
                    </div>}
                    <p role="status" className="mt-2 text-[12px] text-ink-3">{sending?.label ?? "正在计算本次费用…"}</p>
                  </div>}
                  {quoted && <TurnQuoteDialog
                    key={quoted.quote.quoteId}
                    quote={quoted.quote}
                    message={quoted.input.message}
                    pending={command.pending || !!sending || !!draft.pendingTurn || !!draft.pendingQueue || active}
                    requiresRequote={requiresRequote}
                    continueAutomatically={quoted.input.confirmationMode === "automatic"}
                    showRejectedBalance={quoted.rejectionCode === "insufficient_credits" && !quoted.balanceUnavailable}
                    balanceUnavailable={quoted.balanceUnavailable}
                    serviceUnavailable={command.failure.current?.code === "image_budget_exhausted"}
                    returnTo={`${sessionHref(session.sessionId)}#assistant-fees`}
                    requote={() => void requoteSaved()}
                    error={submissionError || quoted.rejectionCode ? null : command.error ?? draft.submissionError ?? null}
                    close={() => {
                      if (!hasComposerDraft(readDraft(key))) restoreInput(quoted.input);
                      setQuoted(null); setNotice("原需求已取消，未执行；输入框中的草稿已保留。");
                    }}
                    confirm={() => {
                      if (!active)
                        void submitConfirmed({
                          commandKey: quoted.commandKey,
                          input: quoted.input,
                          quoteId: quoted.quote.quoteId,
                          attachments: [],
                        }, false, true);
                    }}
                  />}
                  <AssistantMessageQueue returnTo={`${sessionHref(session.sessionId)}#assistant-fees`} recovering={!!draft.pendingQueue} profile={profile ?? undefined} queue={session.queue} pending={command.pending || !!sending || !!draft.pendingQueue} approve={approveQueue} cancel={id => void queueAction("cancel", id)} resume={() => void queueAction("resume")} requote={(id,choice) => void queueAction("quote", id,choice)} />
                </div>}
              />
              <AssistantComposer
                running={active && !session.archived}
                onStop={() => void control("stop")}
                text={question ? answerText : draft.text}
                onChange={(text) => {
                  if (question)
                    updateDraft((previous) => ({
                      ...previous,
                      answer: { questionId: question.questionId, text },
                    }));
                  else {
                    updateDraft((previous) => editDraftText(previous, text));
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
                stopBusy={stopCommand.pending}
                answerMode={!!question}
                placeholder={question?.coverPlan ? "选择上方方案，或在这里说明修改要求…" : undefined}
                maxLength={
                  question ? 10000 : options.limits.inputCharacters
                }
                hint={
                  question?.coverPlan
                    ? "也可以在这里补充修改要求。"
                    : active && !question
                      ? "输入后发送到队列；输入为空时可停止当前任务。"
                      : session.archived
                        ? "已归档会话可查看，不能发送新需求。"
                        : undefined
                }
                controls={profile && <AssistantComposerControls refreshOptions={refreshOptions} confirmationMode={confirmation.mode} onConfirmationMode={confirmation.choose} profile={profile} taskHint={draft.taskHint} selection={draftSelection(draft)} onSelection={(skillSelection) => { updateDraft((previous) => ({ ...previous, skillSelection, actionId: null, taskHint: undefined, taskChoice: undefined })); }} disabled={session.archived || command.pending || quoteReading || !!draft.pendingTurn || !!draft.pendingQueue} feeDisabled={session.archived || command.pending || quoteReading || feeModeCommand.pending || feeModeUncertain} addFiles={materials.add} capabilities={options.inputCapabilities} artifacts={session.artifacts} onReference={reference} />}
                attachments={<><AssistantAttachmentCards attachments={draft.attachments ?? []} count={attachmentSelectionCount(draft.attachments, draft.inputIds)} max={options.inputCapabilities.maxAttachments} disabled={session.archived || command.pending || quoteReading || !!draft.pendingTurn || !!draft.pendingQueue} retry={materials.retry} remove={materials.remove} error={materials.error} />{!attachmentsReady(draft.attachments) && <p className="mb-2 text-[11px] text-ink-4">全部附件可用后才能发送；可重试或移除问题附件。</p>}</>}
              >
                {!question && !!session.inputs.length && <details className="mb-2 text-[12px] text-ink-3"><summary>选择已有会话材料（已选 {draft.inputIds?.length ?? 0} 份）</summary><div className="mt-2 max-h-28 space-y-2 overflow-auto">{session.inputs.filter((input) => !(draft.attachments ?? []).some((card) => card.inputId === input.id)).map((input) => <label key={input.id} className="flex items-start gap-2"><input type="checkbox" checked={draft.inputIds?.includes(input.id) ?? false} disabled={command.pending || quoteReading || session.archived || !!draft.pendingQueue} onChange={(event) => { const checked = event.target.checked; const current = readDraft(key); const issue = checked ? attachmentBatchIssue(attachmentSelectionCount(current.attachments, current.inputIds), 1, options.inputCapabilities.maxAttachments) : null; if (issue) { setNotice(issue); return; } updateDraft((previous) => ({ ...previous, inputIds: checked ? [...(previous.inputIds ?? []), input.id] : previous.inputIds?.filter((id) => id !== input.id) })); }} /><span className="min-w-0 break-words">{typeof input.source.filename === "string" ? input.source.filename : "转交材料"}{typeof input.source.version === "number" ? ` · v${input.source.version}` : ""}</span></label>)}</div><p className="mt-2 text-[11px]">只引用勾选材料。历史消息仍保留；移除不会抹除已经进入历史的内容。</p></details>}
                {!!uncoveredUpdates.length && (
                  <p role="status" className="mb-2 text-[12px] text-accent">
                    {deliveries.length ? "其他作品已更新。" : "作品已更新。"}
                    <button className="ml-2 underline" onClick={() => showArtifacts(uncoveredUpdates[0])}>
                      {deliveries.length ? "查看其他作品" : "查看作品"}
                    </button>
                  </p>
                )}
                {optionsError && <p role="status" className="text-[12px] text-ink-3">{optionsError}</p>}
                {!question && unavailableSelection(profile, draftSelection(draft)) && <AssistantSkillNotice />}
                {session.initialRequest?.clarification && !session.turn && !quoted && <p role="status" className="mb-2 text-[12px] text-ink-3">{session.initialRequest.clarification.message} 修改需求后在本会话重新发送；尚未查询或冻结积分。</p>}
                {session.initialRequest && !session.initialRequest.quote && !session.turn && !hasComposerDraft(draft) && <Button size="sm" onClick={()=>{const input=session.initialRequest!.input;updateDraft(previous=>({...previous,text:input.message,skillSelection:input.skillSelection,taskHint:input.taskHint,taskChoice:input.taskChoice,inputIds:input.inputIds}));}}>继续首条需求</Button>}
                {session.initialRequest?.quote && !session.turn && !draft.recoveryCount && !hasComposerDraft(draft) && <Button size="sm" onClick={() => setQuoted({...session.initialRequest!,quote:session.initialRequest!.quote!})}>恢复首条需求报价</Button>}
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

                {stopCommand.error && <p role="alert" className="text-[12px] text-hot">{stopCommand.error}</p>}

                {!sending && !!draft.recoveryCount && draft.recoveryCount > 1 && <p className="text-[12px] text-ink-3">还有 {draft.recoveryCount} 条保存的费用或提交记录，按原记录逐条核对。</p>}
                {draft.pendingQueue && sending?.key !== draft.pendingQueue.key && <div className="assistant-inline-notice" role="status">
                  <p>{!!draft.pendingQueue.rejectionCode ? "这次发送未受理，原需求和新草稿都已保留。" : command.pending ? "正在继续上次提交…" : "上次发送的结果尚未确认，原需求和新草稿都已保留。"}</p>
                  {draft.pendingQueue.kind === "enqueue" && <details className="mt-2"><summary>查看原需求</summary><p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{draft.pendingQueue.input.message}</p></details>}
                  {!draft.pendingQueue.rejectionCode && <Button size="sm" disabled={command.pending} onClick={() => void runQueueAttempt(draft.pendingQueue!)}>继续上次提交</Button>}
                  {!draft.pendingQueue.rejectionCode && <p className="mt-2 text-[11px] text-ink-4">继续时会沿用原请求提交，并读取已有结果；新草稿不会被发送。</p>}
                  {!!draft.pendingQueue.rejectionCode && !command.pending && <Button size="sm" onClick={() => updateDraft(previous => {
                    const attempt = previous.pendingQueue;
                    if (attempt) clearRecovery(key, { kind: "queue", value: attempt });
                    return rejectedQueueDraft(previous);
                  })}>{draft.pendingQueue.kind === "approve" ? "返回费用确认" : hasComposerDraft(draft) ? "保留新草稿并取消原提交" : "返回修改原需求"}</Button>}
                </div>}
                {draft.pendingTurn && sending?.key !== draft.pendingTurn.commandKey && (
                  <div className="assistant-inline-notice" role="status">
                    <p>
                      {canRejectTurn(draft.pendingTurn) ? "这次发送未受理，原需求和新草稿都已保留。" : command.pending ? "正在继续上次提交…" : "上次发送的结果尚未确认，原需求和新草稿都已保留。"}
                    </p>
                    <details className="mt-2">
                      <summary>查看原需求</summary>
                      <p className="mt-2 whitespace-pre-wrap break-words">
                        {draft.pendingTurn.input.message}
                      </p>
                    </details>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!canRejectTurn(draft.pendingTurn) && <Button
                        size="sm"
                        disabled={command.pending}
                        onClick={() =>
                          void submitConfirmed(draft.pendingTurn!, true)
                        }
                      >
                        继续上次提交
                      </Button>}
                      {canRejectTurn(draft.pendingTurn) && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const oldAttempt = draft.pendingTurn!;
                              updateDraft((previous) =>
                                rejectedDraft(
                                  previous,
                                  (id) =>
                                    session.artifacts.find(
                                      (artifact) => artifact.artifactId === id,
                                    )?.content.title ?? "稿件",
                                ),
                              );
                              clearRecovery(key, { kind: "turn", value: oldAttempt });
                            }}
                          >
                            {hasComposerDraft(draft)
                              ? "保留新草稿并取消原提交"
                              : "返回修改原需求"}
                          </Button>
                        )}
                    </div>
                    {!canRejectTurn(draft.pendingTurn) && <p className="mt-2 text-[11px] text-ink-4">
                      继续时会沿用原请求提交，并读取已有任务；新草稿不会被发送。
                    </p>}
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
                {profile && !quoted && !active && !waitingEntries.length && hasComposerDraft(draft) && (command.failure.current?.code==='assistant_task_selection_required' || session.initialRequest && !session.initialRequest.quote && !session.initialRequest.input.taskChoice && !draft.taskChoice && draft.text===session.initialRequest.input.message) && <TaskClarification key={JSON.stringify([draftSelection(draft),draft.taskHint])} profile={profile} selection={draftSelection(draft)} taskHint={draft.taskHint} disabled={command.pending||quoteReading} confirm={taskChoice=>{updateDraft(previous=>({...previous,taskChoice}));void requestQuote(draft.text);}} />}
                {command.error && !submissionError && !quoted && command.failure.current?.code!=='assistant_task_selection_required' && (
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
                          disabled={command.pending || quoteReading || session.archived || !!draft.pendingQueue}
                          aria-label={`移除引用 ${reference.title}`}
                          onClick={() => {
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
        {feeOpen && <AssistantFeeDialog sessionId={session.sessionId} csrf={data.me.csrf} initial={feeAuthorization} close={() => setFeeOpen(false)} changed={(authorization) => { setFeeAuthorization(authorization); void refresh(); }} />}
      </AssistantUnsavedGuard>
    </AssistantRuntimeProvider>
  );
}

import { useAssistantOptions, unavailableSelection } from "./use-options";
import { confirmationModeHint, useConfirmationMode } from "./fee-mode";
import { beginRecoveryAttempt, clearRecovery, updateRecoveryFailure, restoreRejectedQuote, isSubmissionRejection, saveRecovery } from "./recovery-store";
import type { AssistantInitialRequest } from "@aihot/contracts/assistant";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { AccountMe } from "@aihot/contracts/account";
import type {
  AssistantId,
  AssistantOptions,
  AssistantProfileDto,
} from "@aihot/contracts/assistant";
import { Button } from "../admin/ui";
import { usePrivateAccount } from "../account/use-private-account";
import { useToolCommand } from "../tools/client";
import { sessionHref, submissionErrorCovered, type SessionPage } from "./data";
import { draftKey, rememberDraft, useAssistantDraft, draftSelection, editDraftText, chooseDraftAction, hasComposerDraft, rejectedCreateDraft } from "./drafts";
import { AssistantWorkspace } from "./workspace";
import { AssistantComposer } from "./composer";
import { AssistantComposerControls, AssistantSkillNotice } from "./composer-controls";
import { AssistantAttachmentCards, useAssistantMaterials } from "./materials";
import { attachmentsReady } from "./materials-data";
import { AssistantUnsavedGuard } from "./unsaved";
import { RingMark } from "../../components/Logo";
export { AssistantHistory } from "./history";

export function AssistantActions({
  profile,
  actionId,
  disabled,
  onChange,
}: {
  profile: AssistantProfileDto;
  actionId: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="assistant-actions" aria-label="创作任务快捷动作">
      {profile.actions.map((action) => (
        <Button
          key={action.actionId}
          size="sm"
          tone={actionId === action.actionId ? "primary" : "secondary"}
          aria-pressed={actionId === action.actionId}
          title={action.reason ?? action.userDescription ?? undefined}
          disabled={disabled || !action.available}
          onClick={() =>
            onChange(actionId === action.actionId ? null : action.actionId)
          }
        >
          <span>{action.label}{!action.available ? " · 暂不可用" : ""}</span>
          {action.userDescription && <span className="block max-w-64 text-[11px] font-normal text-ink-4">{action.userDescription}</span>}
        </Button>
      ))}
    </div>
  );
}
export interface AssistantEntryData {
  me: AccountMe;
  options: AssistantOptions;
  history: SessionPage;
}
export function AssistantEntry({
  data,
  assistantId,
}: {
  data: AssistantEntryData;
  assistantId: AssistantId;
}) {
  usePrivateAccount(data.me);
  return (
    <EntryContent
      key={`${data.me.user.id}:${data.me.csrf}:${assistantId}`}
      data={data}
      assistantId={assistantId}
    />
  );
}
function EntryContent({
  data,
  assistantId,
}: {
  data: AssistantEntryData;
  assistantId: AssistantId;
}) {
  const { options, refresh: refreshOptions, error: optionsError } = useAssistantOptions(data.options);
  const profile = options.assistants.find((row) => row.id === assistantId);
  const identity = String(data.me.user.id);
  const confirmation = useConfirmationMode(identity);
  const key = draftKey(identity, assistantId);
  const [draft, update, ready] = useAssistantDraft(
    key,
  );
  const materials = useAssistantMaterials({ csrf: data.me.csrf, scopeKey: key, capabilities: options.inputCapabilities, update, invalidate: () => {} });
  const command = useToolCommand(
    data.me.csrf,
    `assistant:entry:${assistantId}`,
  );
  const navigate = useNavigate();
  const [createdSession, setCreatedSession] = useState<string | null>(null);
  const [sendingCreate, setSendingCreate] = useState<string | null>(null);
  // Navigate after the cleared frozen command has rendered. The child blocker then
  // sees only a genuinely newer draft, which still requires the ordinary guard.
  useEffect(() => {
    if (!createdSession || draft.pendingCreate) return;
    setCreatedSession(null);
    navigate(sessionHref(createdSession));
  }, [createdSession, draft.pendingCreate, navigate]);
  const alive = useRef(true);
  const creating = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send(configureFees = false) {
    if (
      !ready || !confirmation.ready ||
      command.pending ||
      creating.current ||
      (!draft.pendingCreate && !configureFees && (!profile?.available || unavailableSelection(profile, draftSelection(draft)))) ||
      (!draft.text.trim() && !draft.pendingCreate && !configureFees) ||
      (!draft.pendingCreate && !attachmentsReady(draft.attachments))
    )
      return;
    creating.current = true;
    const frozen = { ...(draft.pendingCreate ?? {
      text: draft.text.trim(),
      actionId: draft.actionId,
      skillSelection: draftSelection(draft),
      ...(draft.taskHint !== undefined ? { taskHint: draft.taskHint } : {}),
      ...(draft.taskChoice ? {taskChoice:draft.taskChoice}:{}),
      attachments: draft.attachments,
      configureFees,
      confirmationMode: confirmation.mode,
      unknown: false,
    }), creationKey: draft.pendingCreate?.creationKey ?? crypto.randomUUID() };
    if (!draft.pendingCreate) setSendingCreate(frozen.creationKey);
    if (!draft.pendingCreate?.creationKey)
      update((previous) => ({
        ...previous,
        text: "",
        actionId: null,
        skillSelection: null,
        taskHint: undefined,
        taskChoice: undefined,
        attachments: [],
        pendingCreate: frozen,
      }));
    const result = await command.run<{ sessionId: string; initialRequest: AssistantInitialRequest | null }>(
      "/api/assistant/sessions",
      { assistantId, title: Array.from(frozen.text.replace(/\s+/g, " ")).slice(0, 60).join("") || "新创作",
        ...(!frozen.configureFees ? { initialRequest: { message: frozen.text, skillSelection: draftSelection(frozen), ...(frozen.confirmationMode ? {confirmationMode:frozen.confirmationMode} : {}), ...(frozen.taskHint !== undefined ? { taskHint: frozen.taskHint } : {}), ...(frozen.taskChoice ? {taskChoice:frozen.taskChoice}:{}), attachments: (frozen.attachments ?? []).map(row => ({ assetKey: row.assetKey })) } } : {}) },
      "POST", undefined, frozen.creationKey,
    );
    if (!result) {
      creating.current = false;
      const status = command.failure.current?.status;
      if (status && status >= 400 && status < 500 && !frozen.unknown) update(previous => rejectedCreateDraft({ ...previous, pendingCreate: frozen }));
      else update(previous => ({ ...previous, pendingCreate: { ...frozen, unknown: true } }));
      setSendingCreate(null);
      return;
    }
    let submissionError: string | undefined;
    if (result.initialRequest?.quote) {
      const scope = draftKey(identity, result.sessionId), saved: import("./recovery-store").SavedQuote = { ...result.initialRequest, quote: result.initialRequest.quote };
      try {
        saveRecovery(scope, { kind: "quote", value: saved });
        // Only this fresh Send authorizes automatic submission. Restored quotes stay explicit.
        if (frozen.confirmationMode === "automatic" && saved.quote.task && saved.quote.affordable) {
          const attempt = { commandKey: saved.commandKey, input: saved.input, quoteId: saved.quote.quoteId };
          const record = { kind: "turn" as const, value: attempt };
          const started = beginRecoveryAttempt(scope, record);
          clearRecovery(scope, { kind: "quote", value: saved });
          const submitted = await command.run(`/api/assistant/sessions/${result.sessionId}/turns`,
            { ...attempt.input, quoteId: attempt.quoteId }, "POST", attempt.input, attempt.commandKey);
          if (submitted) clearRecovery(scope, record);
          else {
            const status = command.failure.current?.status ?? null;
            const failure = command.failure.current;
            const writeVersion = updateRecoveryFailure(scope, record, started, status, failure?.code);
            if (writeVersion && !started.wasUnknown && status !== null && status >= 400 && status < 500 && isSubmissionRejection(failure?.code)) {
              submissionError = command.failure.current?.message;
              restoreRejectedQuote(scope, attempt, writeVersion, saved);
            }
          }
        }
      } catch { submissionError = "暂时无法确认发送结果，请在原会话核对；需求已保留。"; }
    }
    creating.current = false;
    rememberDraft(draftKey(identity, result.sessionId), {
      submissionError,
      ...(frozen.configureFees || !result.initialRequest?.quote ? {...frozen,taskChoice:result.initialRequest?.input.taskChoice??frozen.taskChoice,attachments:[],inputIds:result.initialRequest?.input.inputIds??[]} : { text: "", actionId: null, attachments: [] }),
    });
    update((previous) =>
      previous.pendingCreate?.creationKey === frozen.creationKey
        ? { ...previous, pendingCreate: undefined }
        : previous,
    );
    setSendingCreate(null);
    if (alive.current) setCreatedSession(result.sessionId);
  }
  const title = assistantId === "creative" ? "创作助手" : "小红书助手";
  return (
    <AssistantUnsavedGuard hasDraft={!!draft.text || !!draft.attachments?.length || !!draft.pendingCreate}>
      <AssistantWorkspace
        assistantId={assistantId}
        history={data.history}
        title={title}
        subtitle="新对话"
        chat={
          <>
            <div className={`assistant-message-scroll${draft.pendingCreate ? "" : " assistant-entry-welcome"}`}>
              {draft.pendingCreate ? <div className="assistant-message-column">
                <div className="assistant-message assistant-message-user">
                  <p className="mb-2 text-[11px] font-medium text-ink-4">你</p>
                  <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.9] [overflow-wrap:anywhere]">{draft.pendingCreate.text}</p>
                </div>
                {sendingCreate === draft.pendingCreate.creationKey && <p role="status" className="mt-3 text-[13px] text-ink-3">正在计算本次费用…</p>}
              </div> : <div className="assistant-welcome">
                <RingMark className="assistant-welcome-mark size-9 text-accent" />
                <h2 className="text-[28px] font-medium leading-tight text-ink">
                  {assistantId === "creative"
                    ? "把想法变成一篇好稿"
                    : "一起写出下一篇小红书"}
                </h2>
                <p className="mt-3 text-[14px] leading-[1.9] text-ink-3">
                  {profile?.welcome ?? "此助手尚未开放。"}
                </p>
                <p className="mt-4 text-[12px] leading-relaxed text-ink-4">
                  描述要写什么、给谁看，或粘贴材料。{confirmationModeHint(confirmation.mode)}。
                </p>
                {profile && (
                  <div className="mt-6">
                    <AssistantActions
                      profile={profile}
                      actionId={draft.taskHint?.actionId ?? draftSelection(draft)?.actionId ?? null}
                      disabled={
                        !profile.available ||
                        command.pending ||
                        creating.current ||
                        !!draft.pendingCreate
                      }
                      onChange={(actionId) =>
                        update((previous) => chooseDraftAction(previous, profile.actions.find(row => row.actionId === actionId) ?? null))
                      }
                    />
                  </div>
                )}
                {profile && !profile.available && (
                  <p
                    role="status"
                    className="mt-5 rounded-control bg-bg-sunk p-3 text-[13px] text-ink-3"
                  >
                    {profile.reason ?? "此助手暂不可用。"}
                  </p>
                )}
              </div>}
            </div>
            <AssistantComposer
              text={draft.text}
              onChange={(text) => update((previous) => editDraftText(previous, text))}
              onSend={() => void send()}
              disabled={!ready || !profile?.available || unavailableSelection(profile, draftSelection(draft)) || !!draft.pendingCreate || !attachmentsReady(draft.attachments)}
              busy={command.pending}
              maxLength={options.limits.inputCharacters}
              controls={profile && <AssistantComposerControls refreshOptions={refreshOptions} confirmationMode={confirmation.mode} onConfirmationMode={confirmation.choose} profile={profile} taskHint={draft.taskHint} onAction={(action) => update(previous => chooseDraftAction(previous, action))} selection={draftSelection(draft)} onSelection={(skillSelection) => update((previous) => ({ ...previous, skillSelection, actionId: null, taskHint: undefined, taskChoice: undefined }))} disabled={!ready || !profile.available || command.pending || !!draft.pendingCreate} feeDisabled={!ready || !profile.available || command.pending || !!draft.pendingCreate || !attachmentsReady(draft.attachments)} addFiles={materials.add} capabilities={options.inputCapabilities} />}
              attachments={<><AssistantAttachmentCards attachments={draft.attachments ?? []} max={options.inputCapabilities.maxAttachments} disabled={command.pending || !!draft.pendingCreate} retry={materials.retry} remove={materials.remove} error={materials.error} />{!attachmentsReady(draft.attachments) && <p className="mb-2 text-[11px] text-ink-4">全部附件可用后才能发送；可重试或移除问题附件。</p>}</>}
            >
              {optionsError && <p role="status" className="text-[12px] text-ink-3">{optionsError}</p>}
              {unavailableSelection(profile, draftSelection(draft)) && <AssistantSkillNotice />}
              {draft.pendingCreate && sendingCreate !== draft.pendingCreate.creationKey && (
                <div className="assistant-inline-notice" role="status">
                  <p>
                    {draft.pendingCreate.rejected ? "这次发送未受理，原需求和新草稿都已保留。" : command.pending ? "正在核对上次发送…" : "上次发送的结果尚未确认，原需求和新草稿都已保留。"}
                  </p>
                  <details className="mt-2">
                    <summary>查看原需求</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {draft.pendingCreate.text}
                    </p>
                  </details>
                  {!draft.pendingCreate.rejected && (
                    <Button size="sm" disabled={command.pending} onClick={() => void send()}>
                      核对上次发送
                    </Button>
                  )}
                  {draft.pendingCreate.rejected && <><Button size="sm" disabled={hasComposerDraft(draft)} onClick={() => update(rejectedCreateDraft)}>返回修改原需求</Button><p className="text-[11px] text-ink-4">原需求未受理。请先保存或清空新草稿，再返回修改原需求。</p></>}
                  {!draft.pendingCreate.rejected && <p className="mt-2 text-[11px] text-ink-4">核对时沿用上次需求。刷新或重新登录后请先查看会话历史。</p>}
                </div>
              )}
              {command.error && !submissionErrorCovered(command.failure.current, draft.pendingCreate?.creationKey, draft.pendingCreate?.unknown) && (
                <p role="alert" className="mb-3 text-[13px] text-hot">
                  {command.error}
                </p>
              )}
            </AssistantComposer>
          </>
        }
      />
    </AssistantUnsavedGuard>
  );
}

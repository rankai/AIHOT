import { useAssistantOptions, unavailableSelection } from "./use-options";
import { saveRecovery } from "./recovery-store";
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
import { sessionHref, type SessionPage } from "./data";
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
          title={action.reason ?? undefined}
          disabled={disabled || !action.available}
          onClick={() =>
            onChange(actionId === action.actionId ? null : action.actionId)
          }
        >
          {action.label}
          {!action.available ? " · 暂不可用" : ""}
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
      !ready ||
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
      unknown: false,
    }), creationKey: draft.pendingCreate?.creationKey ?? crypto.randomUUID() };
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
        ...(!frozen.configureFees ? { initialRequest: { message: frozen.text, skillSelection: draftSelection(frozen), ...(frozen.taskHint !== undefined ? { taskHint: frozen.taskHint } : {}), ...(frozen.taskChoice ? {taskChoice:frozen.taskChoice}:{}), attachments: (frozen.attachments ?? []).map(row => ({ assetKey: row.assetKey })) } } : {}) },
      "POST", undefined, frozen.creationKey,
    );
    creating.current = false;
    if (!result) {
      const status = command.failure.current?.status;
      if (status && status >= 400 && status < 500 && !frozen.unknown) update(previous => rejectedCreateDraft({ ...previous, pendingCreate: frozen }));
      else update(previous => ({ ...previous, pendingCreate: { ...frozen, unknown: true } }));
      return;
    }
    if (result.initialRequest?.quote) {
      try { saveRecovery(draftKey(identity, result.sessionId), { kind: "quote", value: {...result.initialRequest,quote:result.initialRequest.quote} }); }
      catch { /* The session retains an explicit recovery action if browser storage fails. */ }
    }
    rememberDraft(draftKey(identity, result.sessionId), {
      ...(frozen.configureFees || !result.initialRequest?.quote ? {...frozen,attachments:[],inputIds:result.initialRequest?.input.inputIds??[]} : { text: "", actionId: null, attachments: [] }),
    });
    update((previous) =>
      previous.pendingCreate?.creationKey === frozen.creationKey
        ? { ...previous, pendingCreate: undefined }
        : previous,
    );
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
            <div className="assistant-message-scroll assistant-entry-welcome">
              <div className="assistant-welcome">
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
                  描述要写什么、给谁看，或粘贴材料。发送后确认任务费用上限，完成或停止后按实际交付结算。
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
              </div>
            </div>
            <AssistantComposer
              text={draft.text}
              onChange={(text) => update((previous) => editDraftText(previous, text))}
              onSend={() => void send()}
              disabled={!ready || !profile?.available || unavailableSelection(profile, draftSelection(draft)) || !!draft.pendingCreate || !attachmentsReady(draft.attachments)}
              busy={command.pending}
              maxLength={options.limits.inputCharacters}
              hint={
                command.pending
                  ? "正在免费建立会话，随后确认本次费用…"
                  : undefined
              }
              controls={profile && <AssistantComposerControls refreshOptions={refreshOptions} profile={profile} taskHint={draft.taskHint} selection={draftSelection(draft)} onSelection={(skillSelection) => update((previous) => ({ ...previous, skillSelection, actionId: null, taskHint: undefined, taskChoice: undefined }))} disabled={!ready || !profile.available || command.pending || !!draft.pendingCreate} feeDisabled={!ready || !profile.available || command.pending || !!draft.pendingCreate || !attachmentsReady(draft.attachments)} addFiles={materials.add} capabilities={options.inputCapabilities} />}
              attachments={<><AssistantAttachmentCards attachments={draft.attachments ?? []} max={options.inputCapabilities.maxAttachments} disabled={command.pending || !!draft.pendingCreate} retry={materials.retry} remove={materials.remove} error={materials.error} />{!attachmentsReady(draft.attachments) && <p className="mb-2 text-[11px] text-ink-4">全部附件可用后才能发送；可重试或移除问题附件。</p>}</>}
            >
              {optionsError && <p role="status" className="text-[12px] text-ink-3">{optionsError}</p>}
              {unavailableSelection(profile, draftSelection(draft)) && <AssistantSkillNotice />}
              {draft.pendingCreate && (
                <div className="assistant-inline-notice" role="status">
                  <p>
                    正在确认建会话结果。原需求已单独保留；下一轮草稿可以继续记录。
                  </p>
                  <details className="mt-2">
                    <summary>查看原需求</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {draft.pendingCreate.text}
                    </p>
                  </details>
                  {!command.pending && (
                    <Button size="sm" onClick={() => void send()}>
                      重试原建会话命令
                    </Button>
                  )}
                  {draft.pendingCreate.rejected && <><Button size="sm" disabled={hasComposerDraft(draft)} onClick={() => update(rejectedCreateDraft)}>返回修改原需求</Button><p className="text-[11px] text-ink-4">原需求未受理。请先保存或清空新草稿，再返回修改原需求。</p></>}
                  <p className="mt-2 text-[11px] text-ink-4">
                    本次页面会话内可按原命令恢复；刷新或重新登录后先核对历史，不自动重发。
                  </p>
                </div>
              )}
              {command.error && (
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

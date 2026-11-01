import { useEffect, useRef } from "react";
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
import { draftKey, rememberDraft, useAssistantDraft } from "./drafts";
import { AssistantWorkspace } from "./workspace";
import { AssistantComposer } from "./composer";
import { AssistantComposerControls } from "./composer-controls";
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
          {!action.available
            ? ` · ${action.actionId === "wechat" ? "未开放" : "暂不可用"}`
            : ""}
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
  const profile = data.options.assistants.find((row) => row.id === assistantId);
  const identity = `${data.me.user.id}:${data.me.csrf}`;
  const key = draftKey(identity, assistantId);
  const [draft, update, ready] = useAssistantDraft(
    key,
  );
  const materials = useAssistantMaterials({ csrf: data.me.csrf, scopeKey: key, capabilities: data.options.inputCapabilities, update, invalidate: () => {} });
  const command = useToolCommand(
    data.me.csrf,
    `assistant:entry:${assistantId}`,
  );
  const navigate = useNavigate();
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
      !profile?.available ||
      (!draft.text.trim() && !draft.pendingCreate && !configureFees) ||
      !attachmentsReady(draft.attachments)
    )
      return;
    creating.current = true;
    const frozen = draft.pendingCreate ?? {
      text: draft.text.trim(),
      actionId: draft.actionId,
      attachments: draft.attachments,
      configureFees,
    };
    if (!draft.pendingCreate)
      update((previous) => ({
        ...previous,
        text: "",
        actionId: null,
        attachments: [],
        pendingCreate: frozen,
      }));
    const result = await command.run<{ sessionId: string }>(
      "/api/assistant/sessions",
      { assistantId, title: Array.from(frozen.text.replace(/\s+/g, " ")).slice(0, 60).join("") || "新创作" },
    );
    creating.current = false;
    if (!result) return;
    rememberDraft(draftKey(identity, result.sessionId), {
      ...frozen,
      autoQuote: !frozen.configureFees,
    });
    update((previous) =>
      previous.pendingCreate === frozen
        ? { ...previous, pendingCreate: undefined }
        : previous,
    );
    if (alive.current) navigate(sessionHref(result.sessionId));
  }
  const title = assistantId === "creative" ? "创作助手" : "小红书助手";
  return (
    <AssistantUnsavedGuard hasDraft={!!draft.text || !!draft.attachments?.length}>
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
                  描述要写什么、给谁看，或粘贴材料。发送后免费建立会话，再确认本次创作积分；额外检索单独批准。
                </p>
                {profile && (
                  <div className="mt-6">
                    <AssistantActions
                      profile={profile}
                      actionId={draft.actionId}
                      disabled={
                        !profile.available ||
                        command.pending ||
                        creating.current ||
                        !!draft.pendingCreate
                      }
                      onChange={(actionId) =>
                        update((previous) => ({ ...previous, actionId }))
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
              onChange={(text) => update((previous) => ({ ...previous, text }))}
              onSend={() => void send()}
              disabled={!ready || !profile?.available || !!draft.pendingCreate || !attachmentsReady(draft.attachments)}
              busy={command.pending}
              maxLength={data.options.limits.inputCharacters}
              hint={
                command.pending
                  ? "正在免费建立会话，随后确认本次费用…"
                  : undefined
              }
              controls={profile && <AssistantComposerControls profile={profile} actionId={draft.actionId} onAction={(actionId) => update((previous) => ({ ...previous, actionId }))} disabled={!ready || !profile.available || command.pending || !!draft.pendingCreate} feeDisabled={!ready || !profile.available || command.pending || !!draft.pendingCreate || !attachmentsReady(draft.attachments)} addFiles={materials.add} capabilities={data.options.inputCapabilities} configureFees={() => void send(true)} />}
              attachments={<><AssistantAttachmentCards attachments={draft.attachments ?? []} max={data.options.inputCapabilities.maxAttachments} disabled={command.pending || !!draft.pendingCreate} retry={materials.retry} remove={materials.remove} error={materials.error} />{!attachmentsReady(draft.attachments) && <p className="mb-2 text-[11px] text-ink-4">全部附件可用后才能发送；可重试或移除问题附件。</p>}</>}
            >
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

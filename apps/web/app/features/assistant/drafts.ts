import type { AssistantSkillSelection, AssistantTaskHint, AssistantAction } from "@aihot/contracts/assistant";
import { useEffect, useRef, useState } from "react";
import type { PendingTurn, TurnInput } from "./data";
import { readRecoveries, subscribeRecovery, type QueueAttempt, type SavedQuote } from "./recovery-store.ts";
import type { DraftAttachment } from "./materials-data";
export interface ArtifactReference {
  artifactId: string;
  version: number;
  title: string;
}
export interface AssistantDraft {
  text: string;
  actionId: string | null;
  skillSelection?: AssistantSkillSelection | null;
  taskHint?: AssistantTaskHint | null;
  taskChoice?: import("@aihot/contracts/assistant").AssistantTaskChoice;
  references?: ArtifactReference[];
  attachments?: DraftAttachment[];
  inputIds?: string[];
  answer?: { questionId: string; text: string };
  pendingTurn?: PendingTurn;
  pendingQueue?: QueueAttempt;
  pendingQuote?: SavedQuote;
  recoveryCount?: number;
  pendingCreate?: { creationKey?: string; text: string; actionId: string | null; skillSelection?: AssistantSkillSelection | null; taskHint?: AssistantTaskHint | null; taskChoice?: import("@aihot/contracts/assistant").AssistantTaskChoice; attachments?: DraftAttachment[]; configureFees?: boolean; unknown?: boolean; rejected?: boolean };
  configureFees?: boolean;
  pendingLifecycle?: "archive" | "delete";
}
export const emptyDraft = (): AssistantDraft => ({ text: "", actionId: null });
/** Old in-memory drafts keep their exact action until an explicit reselection. */
export function draftSelection(draft: { skillSelection?: AssistantSkillSelection | null; actionId?: string | null }): AssistantSkillSelection | null {
  return draft.skillSelection !== undefined ? draft.skillSelection : draft.actionId ? { actionId: draft.actionId } : null;
}
export function editDraftText(draft: AssistantDraft, text: string): AssistantDraft {
  return { ...draft, text, taskHint: undefined, taskChoice: undefined };
}
export function chooseDraftAction(draft: AssistantDraft, action: AssistantAction | null): AssistantDraft {
  return { ...draft, actionId: null, skillSelection: action ? { skillId: action.skillId } : null,
    taskHint: action ? { actionId: action.actionId } : undefined,
    text: draft.text.trim() ? draft.text : action ? `请帮我完成「${action.label}」。\n主题或原文：` : "" };
}
const drafts = new Map<string, AssistantDraft>();
const listeners = new Map<string, Set<(draft: AssistantDraft) => void>>();
export const draftKey = (identity: string, scope: string) =>
  `${identity}:${scope}`;
export function rememberDraft(key: string, draft: AssistantDraft) {
  if (typeof window !== "undefined") {
    drafts.set(key, draft);
    listeners.get(key)?.forEach((listener) => listener(readDraft(key)));
  }
}
export function readDraft(key: string): AssistantDraft {
  const current = drafts.get(key) ?? emptyDraft();
  const records = readRecoveries(key);
  return { ...current, pendingTurn: records.find(r => r.kind === "turn")?.value as PendingTurn | undefined,
    pendingQueue: records.find(r => r.kind === "queue")?.value as QueueAttempt | undefined,
    pendingQuote: records.find(r => r.kind === "quote")?.value as SavedQuote | undefined, recoveryCount: records.length };
}
export function hasComposerDraft(draft: AssistantDraft): boolean {
  return !!(draft.text.trim() || draft.attachments?.length || draft.references?.length || draft.inputIds?.length);
}
/** Clear only the frozen submission. A later draft is a separate piece of user input. */
export function settledDraft(
  draft: AssistantDraft,
  attempt: PendingTurn,
): AssistantDraft {
  return draft.pendingTurn?.commandKey === attempt.commandKey
    ? { ...draft, pendingTurn: undefined }
    : draft;
}
export function freezeTurn(
  draft: AssistantDraft,
  attempt: PendingTurn,
): AssistantDraft {
  return {
    ...draft,
    text: "",
    taskHint: undefined,
    references: [],
    attachments: [],
    inputIds: [],
    pendingTurn: attempt,
  };
}

/** Preserve uncertainty for this exact frozen attempt, including across remounts. */
export function failedTurn(draft: AssistantDraft, attempt: PendingTurn, status: number | null): AssistantDraft {
  if (draft.pendingTurn?.commandKey !== attempt.commandKey || attempt.hasUnknownResult || (status !== null && status < 500)) return draft;
  return { ...draft, pendingTurn: { ...attempt, hasUnknownResult: true } };
}
export function canRejectTurn(attempt: PendingTurn | undefined, status: number | null): boolean {
  return !!attempt && !attempt.hasUnknownResult && status !== null && status >= 400 && status < 500;
}

/** Definite rejection can return to editing; a newer draft must stay independent. */
export function rejectedDraft(
  draft: AssistantDraft,
  title: (id: string) => string,
): AssistantDraft {
  if (!draft.pendingTurn || draft.pendingTurn.hasUnknownResult) return draft;
  if (hasComposerDraft(draft)) return { ...draft, pendingTurn: undefined };
  const input = draft.pendingTurn.input;
  return {
    ...draft,
    text: input.message,
    actionId: input.skillSelection?.actionId ?? null,
    skillSelection: input.skillSelection,
    taskHint: input.taskHint,
    attachments: draft.pendingTurn.attachments,
    inputIds: input.inputIds.filter((id) => !draft.pendingTurn!.attachments?.some((attachment) => attachment.inputId === id)),
    references: input.artifactVersions?.map((reference) => ({
      ...reference,
      title: title(reference.artifactId),
    })),
    pendingTurn: undefined,
  };
}

export function useAssistantDraft(key: string) {
  const [draft, setDraft] = useState<AssistantDraft>(emptyDraft);
  const [ready, setReady] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    setDraft(readDraft(key));
    const unsubscribe = subscribeRecovery(key, () => setDraft(readDraft(key)));
    setReady(true);
    const subscribers = listeners.get(key) ?? new Set();
    subscribers.add(setDraft);
    listeners.set(key, subscribers);
    return () => {
      alive.current = false;
      unsubscribe();
      subscribers.delete(setDraft);
      if (!subscribers.size) listeners.delete(key);
    };
  }, [key]);
  function update(
    next: AssistantDraft | ((previous: AssistantDraft) => AssistantDraft),
  ) {
    const value = typeof next === "function" ? next(readDraft(key)) : next;
    rememberDraft(key, value);
    if (alive.current) setDraft(readDraft(key));
  }
  return [draft, update, ready] as const;
}

import { useEffect, useRef, useState } from "react";
import type { PendingTurn } from "./data";
import type { DraftAttachment } from "./materials-data";
export interface ArtifactReference {
  artifactId: string;
  version: number;
  title: string;
}
export interface AssistantDraft {
  text: string;
  actionId: string | null;
  references?: ArtifactReference[];
  attachments?: DraftAttachment[];
  inputIds?: string[];
  answer?: { questionId: string; text: string };
  pendingTurn?: PendingTurn;
  pendingCreate?: { text: string; actionId: string | null; attachments?: DraftAttachment[]; configureFees?: boolean };
  configureFees?: boolean;
  autoQuote?: boolean;
  pendingLifecycle?: "archive" | "delete";
}
export const emptyDraft = (): AssistantDraft => ({ text: "", actionId: null });
const drafts = new Map<string, AssistantDraft>();
const listeners = new Map<string, Set<(draft: AssistantDraft) => void>>();
export const draftKey = (identity: string, scope: string) =>
  `${identity}:${scope}`;
export function rememberDraft(key: string, draft: AssistantDraft) {
  if (typeof window !== "undefined") {
    drafts.set(key, draft);
    listeners.get(key)?.forEach((listener) => listener(draft));
  }
}
export function readDraft(key: string): AssistantDraft {
  return drafts.get(key) ?? emptyDraft();
}
/** Clear only the frozen submission. A later draft is a separate piece of user input. */
export function settledDraft(
  draft: AssistantDraft,
  attempt: PendingTurn,
): AssistantDraft {
  return draft.pendingTurn === attempt
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
    references: [],
    attachments: [],
    inputIds: [],
    pendingTurn: attempt,
  };
}

/** Preserve uncertainty for this exact frozen attempt, including across remounts. */
export function failedTurn(draft: AssistantDraft, attempt: PendingTurn, status: number | null): AssistantDraft {
  if (draft.pendingTurn !== attempt || attempt.hasUnknownResult || (status !== null && status < 500)) return draft;
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
  if (draft.text.trim() || draft.attachments?.length || draft.references?.length || draft.inputIds?.length) return { ...draft, pendingTurn: undefined };
  const input = draft.pendingTurn.input;
  return {
    ...draft,
    text: input.message,
    actionId: input.skillSelection?.actionId ?? null,
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
    setReady(true);
    const subscribers = listeners.get(key) ?? new Set();
    subscribers.add(setDraft);
    listeners.set(key, subscribers);
    return () => {
      alive.current = false;
      subscribers.delete(setDraft);
      if (!subscribers.size) listeners.delete(key);
    };
  }, [key]);
  function update(
    next: AssistantDraft | ((previous: AssistantDraft) => AssistantDraft),
  ) {
    const value = typeof next === "function" ? next(readDraft(key)) : next;
    rememberDraft(key, value);
    if (alive.current) setDraft(value);
  }
  return [draft, update, ready] as const;
}

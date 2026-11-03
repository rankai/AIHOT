import type { AssistantTurnQuote } from "@aihot/contracts/assistant";
import type { PendingTurn, TurnInput } from "./data";
export type QueueAttempt = { key: string; kind: "enqueue"; input: TurnInput; unknown?: boolean } | { key: string; kind: "approve"; entryId: string; quoteId: string; unknown?: boolean };
export type SavedQuote = { commandKey: string; input: TurnInput; quote: AssistantTurnQuote };
export type Recovery = { kind: "turn"; value: PendingTurn } | { kind: "queue"; value: QueueAttempt } | { kind: "quote"; value: SavedQuote };
type Row = Recovery & { savedAt: number; writeVersion?: string };
const cache = new Map<string, { raw: string; row: Row }>();
const subscribers = new Map<string, Set<() => void>>();
const prefix = (scope: string) => `assistant-recovery:${encodeURIComponent(scope)}:`;
export const recoveryId = (record: Recovery) => `${record.kind}:${record.kind === "turn" ? record.value.commandKey : record.kind === "queue" ? record.value.key : record.value.quote.quoteId}`;
const string = (v: unknown, max = 200) => typeof v === "string" && v.length > 0 && v.length <= max;
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const keys = (v: any, allowed: string[]) => object(v) && Object.keys(v).every(k => allowed.includes(k));
function input(v: any): boolean {
  return keys(v, ["message", "expectedRevision", "skillSelection", "inputIds", "artifactVersions", "autoAuthorizationId", "taskHint", "taskChoice"]) && string(v.message, 30000) && Number.isInteger(v.expectedRevision) && v.expectedRevision >= 0 &&
    (v.skillSelection === null || keys(v.skillSelection, ["actionId"]) && string(v.skillSelection.actionId) || keys(v.skillSelection, ["skillId"]) && string(v.skillSelection.skillId)) &&
    (v.taskChoice === undefined || keys(v.taskChoice,["skillId","moduleId","delivery","size"]) && string(v.taskChoice.skillId) && string(v.taskChoice.moduleId) && ["writing","plans-only","image"].includes(v.taskChoice.delivery) && (v.taskChoice.size===undefined || string(v.taskChoice.size))) &&
    (v.taskHint === undefined || v.taskHint === null || keys(v.taskHint, ["actionId"]) && string(v.taskHint.actionId)) &&
    Array.isArray(v.inputIds) && v.inputIds.length <= 10 && v.inputIds.every((id: unknown) => string(id)) &&
    Array.isArray(v.artifactVersions) && v.artifactVersions.length <= 10 && v.artifactVersions.every((r: any) => keys(r, ["artifactId", "version"]) && string(r.artifactId) && Number.isInteger(r.version) && r.version > 0) &&
    (v.autoAuthorizationId === undefined || string(v.autoAuthorizationId));
}
function valid(row: any): row is Row {
  if (!keys(row, ["kind", "value", "savedAt", "writeVersion"]) || !Number.isFinite(row.savedAt) || row.writeVersion !== undefined && !string(row.writeVersion)) return false;
  const v = row.value;
  if (row.kind === "turn") return keys(v, ["commandKey", "input", "quoteId", "hasUnknownResult"]) && string(v.commandKey) && input(v.input) && string(v.quoteId) && (v.hasUnknownResult === undefined || typeof v.hasUnknownResult === "boolean");
  if (row.kind === "queue") return keys(v, ["key", "kind", "input", "entryId", "quoteId", "unknown"]) && string(v.key) && (v.unknown === undefined || typeof v.unknown === "boolean") && (v.kind === "enqueue" ? input(v.input) && v.entryId === undefined && v.quoteId === undefined : v.kind === "approve" && string(v.entryId) && string(v.quoteId) && v.input === undefined);
  const q = v?.quote;
  return row.kind === "quote" && keys(v, ["commandKey", "input", "quote"]) && string(v.commandKey) && input(v.input) && keys(q, ["quoteId", "amount", "expiresAt", "priceVersion", "priceId", "available", "affordable", "recoveryOfRunId", "additionalFeeKinds", "task"]) && string(q.quoteId) && typeof q.affordable === "boolean" && string(q.expiresAt) && Number.isFinite(Date.parse(q.expiresAt)) && [q.amount, q.available, q.priceVersion].every(n => Number.isInteger(n) && n >= 0) && (q.priceId === null || string(q.priceId)) && (q.recoveryOfRunId === null || Number.isInteger(q.recoveryOfRunId)) &&
    (q.additionalFeeKinds === undefined || Array.isArray(q.additionalFeeKinds) && q.additionalFeeKinds.length <= 3 && new Set(q.additionalFeeKinds).size === q.additionalFeeKinds.length && q.additionalFeeKinds.every((kind: unknown) => kind === "search" || kind === "image" || kind === "vision"));
}
export function readRecoveries(scope: string): Row[] {
  if (typeof window === "undefined") return [];
  const start = prefix(scope), rows: Row[] = [];
  try {
    // Only the explicitly known account/session legacy key may be migrated.
    const legacyKey = `assistant-queue-command:${scope}`, legacy = localStorage.getItem(legacyKey);
    if (legacy && legacy.length <= 150000) {
      try {
        const row = { kind: "queue", value: { ...JSON.parse(legacy), unknown: true }, savedAt: Date.now() };
        if (valid(row)) { const key = start + recoveryId(row); if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(row)); localStorage.removeItem(legacyKey); }
      } catch { /* Invalid legacy commands never become actionable. */ }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(start)) continue;
      const raw = localStorage.getItem(key);
      if (!raw || raw.length > 150000) continue;
      let row: Row;
      try { row = cache.get(key)?.raw === raw ? cache.get(key)!.row : JSON.parse(raw); } catch { continue; }
      if (!valid(row) || key !== start + recoveryId(row)) continue;
      cache.set(key, { raw, row }); rows.push(row);
      if (rows.length >= 30) break;
    }
  } catch { /* An unreadable record is never executed. */ }
  return rows.sort((a, b) => a.savedAt - b.savedAt || recoveryId(a).localeCompare(recoveryId(b)));
}
function notify(scope: string) { subscribers.get(scope)?.forEach(fn => fn()); }
export function saveRecovery(scope: string, record: Recovery) {
  const key = prefix(scope) + recoveryId(record);
  const value = record.kind === "turn" ? { commandKey: record.value.commandKey, input: record.value.input, quoteId: record.value.quoteId, hasUnknownResult: record.value.hasUnknownResult } : record.value;
  const prior = readRecoveries(scope).find(row => recoveryId(row) === recoveryId(record));
  const row = { kind: record.kind, value, savedAt: prior?.savedAt ?? Date.now(), writeVersion: crypto.randomUUID() } as Row;
  if (!valid(row) || !prior && readRecoveries(scope).length >= 30) throw new Error("待核对记录已满或内容无效，请先核对原提交。");
  const raw = JSON.stringify(row);
  if (raw.length > 150000) throw new Error("待核对内容过大，请精简需求。");
  localStorage.setItem(key, raw); // Must succeed before a potentially paid POST is sent.
  cache.set(key, { raw, row }); notify(scope);
  return row.writeVersion!;
}
export function clearRecovery(scope: string, record: Recovery) {
  const key = prefix(scope) + recoveryId(record);
  localStorage.removeItem(key); cache.delete(key); notify(scope);
}
export function subscribeRecovery(scope: string, callback: () => void) {
  const set = subscribers.get(scope) ?? new Set(); set.add(callback); subscribers.set(scope, set);
  const changed = (event: StorageEvent) => { if (event.key?.startsWith(prefix(scope)) || event.key === null) callback(); };
  window.addEventListener("storage", changed);
  return () => { set.delete(callback); if (!set.size) subscribers.delete(scope); window.removeEventListener("storage", changed); };
}

/** Each async response may update only the record version that started its request. */
export function beginRecoveryAttempt(scope: string, record: Exclude<Recovery, { kind: "quote" }>) {
  const current = readRecoveries(scope).find(row => recoveryId(row) === recoveryId(record));
  const frozen = current && current.kind !== "quote" ? current : record;
  const wasUnknown = frozen.kind === "turn" ? !!frozen.value.hasUnknownResult : !!frozen.value.unknown;
  const pending: Recovery = frozen.kind === "turn" ? { kind: "turn", value: { ...frozen.value, hasUnknownResult: true } } : { kind: "queue", value: { ...frozen.value, unknown: true } };
  return { writeVersion: saveRecovery(scope, pending), wasUnknown };
}
export function updateRecoveryFailure(scope: string, record: Exclude<Recovery, { kind: "quote" }>, started: { writeVersion: string; wasUnknown: boolean }, status: number | null) {
  const current = readRecoveries(scope).find(row => recoveryId(row) === recoveryId(record));
  if (!current || current.kind === "quote" || current.writeVersion !== started.writeVersion) return false;
  const unknown = started.wasUnknown || status === null || status >= 500;
  saveRecovery(scope, current.kind === "turn" ? { kind: "turn", value: { ...current.value, hasUnknownResult: unknown } } : { kind: "queue", value: { ...current.value, unknown } });
  return true;
}
export function recoveryWriteVersion(scope: string, record: Recovery) {
  return readRecoveries(scope).find(row => recoveryId(row) === recoveryId(record))?.writeVersion;
}
export function replaceRecoveryQuote(scope: string, original: SavedQuote, writeVersion: string | undefined, next: SavedQuote) {
  const rows = readRecoveries(scope), current = rows.find(row => row.kind === "quote" && row.value.quote.quoteId === original.quote.quoteId);
  if (!current || current.kind !== "quote" || current.writeVersion !== writeVersion || current.value.commandKey !== original.commandKey || rows.some(row => row.kind === "turn" && row.value.commandKey === original.commandKey)) return false;
  saveRecovery(scope, { kind: "quote", value: next });
  clearRecovery(scope, { kind: "quote", value: original });
  return true;
}

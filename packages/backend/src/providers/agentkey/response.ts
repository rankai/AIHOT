import type { CallOutcome } from "../receipts.ts";

export const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Node 24's source context preserves integer tokens before JavaScript can round them. */
export function parseLosslessJson(text: string): unknown {
  return JSON.parse(text, ((_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source) throw new Error("Lossless JSON source context unavailable");
      return context.source;
    }
    return value;
  }) as Parameters<typeof JSON.parse>[1]);
}

const secretField = /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|password|secret|credential/i;
/** Input has already passed the transport byte limit. Never log the unsanitized input. */
export function redactEvidence(value: unknown, key: string): unknown {
  const cleanString = (text: string) => text.split(key).join("[redacted]")
    .replace(/Bearer\s+[^\s"'\\]+/gi, "Bearer [redacted]")
    .replace(/("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[redacted]"');
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry, key));
  const row = object(value);
  if (!row) return value;
  return Object.fromEntries(Object.entries(row).map(([name, entry]) => [cleanString(name), secretField.test(name) ? "[redacted]" : redactEvidence(entry, key)]));
}

export interface WireEvidence { status: number; contentType: string; body: string; complete: boolean; requestId?: string; retryAfter?: string }

/** Inspect captured evidence only; MCP framing, negotiation and validation belong to the SDK. */
export function wireMessage(wire: WireEvidence | undefined, requestId: unknown): Record<string, unknown> | null {
  if (!wire) return null;
  const bodies = wire.contentType.includes("text/event-stream")
    ? wire.body.split(/\r?\n\r?\n/).slice(0, -1).map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n"))
    : wire.complete ? [wire.body] : [];
  for (const body of bodies) {
    try {
      const message = object(parseLosslessJson(body));
      if (message && message.id === requestId) return message;
    } catch { /* Incomplete/non-JSON evidence is never promoted into a response. */ }
  }
  return null;
}

export interface AgentKeyResponse {
  httpStatus: number;
  mcp: unknown;
  envelope: unknown;
  retryAfter?: string | null;
}

/** structuredContent takes precedence; content is the standard legacy JSON text fallback. */
export function agentKeyOutcome(result: unknown, wire: WireEvidence | undefined, key: string): CallOutcome {
  const row = object(result);
  let envelope: unknown = row?.structuredContent;
  if (envelope === undefined && Array.isArray(row?.content)) {
    for (const block of row.content) {
      const item = object(block);
      if (item?.type !== "text" || typeof item.text !== "string") continue;
      try { envelope = parseLosslessJson(item.text); break; } catch { /* Preserve non-JSON content in mcp. */ }
    }
  }
  const response = redactEvidence({ httpStatus: wire?.status ?? 200, mcp: result, envelope: envelope ?? null,
    retryAfter: wire?.retryAfter ?? null }, key) as AgentKeyResponse;
  const e = object(response.envelope);
  const usage: Record<string, unknown> = {};
  if (typeof e?.credits_charged === "number" && Number.isFinite(e.credits_charged) && e.credits_charged >= 0) usage.chargedCredits = e.credits_charged;
  if (typeof e?.took_ms === "number" && Number.isFinite(e.took_ms)) usage.tookMs = e.took_ms;
  if (typeof e?.provider === "string") usage.provider = e.provider;
  if (typeof e?.category === "string") usage.category = e.category;
  const requestId = typeof e?.request_id === "string" ? e.request_id : wire?.requestId;
  return { response, requestId: requestId ? String(redactEvidence(requestId, key)).slice(0, 500) : undefined,
    usage: Object.keys(usage).length ? usage : undefined };
}

export function explicitAgentKeyError(result: unknown, envelope: unknown): boolean {
  const mcp = object(result), e = object(envelope);
  const rejected = (value: Record<string, unknown> | null) => value?.disabled === true || value?.success === false
    || (value?.error !== undefined && value.error !== null && value.error !== false && value.error !== "");
  return mcp?.isError === true || rejected(e) || rejected(object(e?.data));
}

import { modelBillingProvider } from "../providers/llm.ts";
import { generateText, jsonSchema, tool, type ModelMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { contextTokens } from "./context.ts";
import { paidRequest, estimatedCatalogCost } from "../providers/receipts.ts";
import { resolveDeepSeekPriceSnapshot } from "../providers/deepseek-pricing.ts";
import { receiptOptions, requireExecution, type Execution } from "../providers/operations/store.ts";
import { requireCreditUser } from "../users/credits-core.ts";
import { outbound, modelCredential, type AssistantModelSnapshot } from "./config.ts";
import { conflict } from "./store.ts";
export interface RequestSnapshot {
  model: AssistantModelSnapshot;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, { description: string; schema: Record<string, unknown> }>;
}
export async function generateStep(
  execution: Execution,
  step: { id: string; turn_id: string; request_snapshot: RequestSnapshot; request_hash: string },
) {
  const snapshot = step.request_snapshot;
  const apiKey = modelCredential(snapshot.model);
  if (
    snapshot.model.tokenizer !== "cl100k_base" ||
    contextTokens(JSON.stringify(snapshot)) + 256 > snapshot.model.maxInputTokens
  )
    throw conflict("模型上下文超过上限，请缩小材料");
  const base = receiptOptions(execution);
  let receiptId: number | undefined;
  const provider = createOpenAICompatible({
    name: "assistant",
    baseURL: snapshot.model.baseURL,
    apiKey,
    fetch: async (url, init) => {
      const requestBody = JSON.stringify({ ...JSON.parse(String(init?.body ?? "{}")), ...snapshot.model.extra });
      const receipt = await paidRequest(
        {
          service: "assistant.text",
          purpose: "assistant.turn",
          model: snapshot.model.model,
          pricingKey: { service: snapshot.model.service, model: snapshot.model.model },
          costIdentity: { billingProvider: modelBillingProvider(snapshot.model.baseURL), operation: "chat.completions", model: snapshot.model.model },
          subject: step.id,
          identity: { stepId: step.id, requestHash: step.request_hash, url: String(url), body: requestBody },
          requestSummary: { stepId: step.id, turnId: step.turn_id, requestHash: step.request_hash },
        },
        async ({ priceSnapshot }) => {
          outbound();
          modelCredential(snapshot.model);
          const response = await fetch(url, { ...init, body: requestBody, redirect: "error", signal: AbortSignal.timeout(90000) });
          const body = await response.text();
          if (Buffer.byteLength(body) > 2097152) throw new Error("Model response exceeds limit");
          return {
            response: {
              status: response.status,
              body,
              headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
            },
            requestId: response.headers.get("x-request-id"),
            usage: responseUsage(body),
            cost: response.ok ? estimatedCatalogCost(priceSnapshot, responseUsage(body)) : null,
          };
        },
        {
          resolvePriceSnapshot: resolveDeepSeekPriceSnapshot,
          beforeClaim: async (tx) => {
            const context = await base.beforeClaim!(tx);
            const run = await requireExecution(tx, execution);
            await requireCreditUser(tx, Number(run.actor.slice(5)), true);
            return context;
          },
          onReceipt: async (tx, id, info) => {
            await base.onReceipt!(tx, id, info);
            if (info.kind === "call") {
              outbound();
              modelCredential(snapshot.model);
              const [updated] =
                await tx`UPDATE assistant_turns SET model_calls=model_calls+1 WHERE id=${step.turn_id} AND model_calls<8 RETURNING id`;
              if (!updated) throw conflict("本回合模型请求已达8次上限");
            }
            await tx`UPDATE assistant_model_steps SET receipt_id=${id} WHERE id=${step.id}`;
          },
        },
      );
      receiptId = receipt.receiptId;
      const raw = receipt.response as { status: number; body: string; headers: Record<string, string> };
      return new Response(raw.body, { status: raw.status, headers: raw.headers });
    },
  });
  const tools = Object.fromEntries(
    Object.entries(snapshot.tools).map(([name, t]) => [
      name,
      tool({ description: t.description, inputSchema: jsonSchema(t.schema) }),
    ]),
  );
  const result = await generateText({
    model: provider.chatModel(snapshot.model.model),
    system: snapshot.system,
    messages: snapshot.messages,
    tools,
    maxRetries: 0,
    maxOutputTokens: snapshot.model.maxOutputTokens,
  });
  if (!receiptId) throw new Error("Model returned without HTTP receipt");
  if (
    result.toolCalls.length > 20 ||
    new Set(result.toolCalls.map((c) => c.toolCallId)).size !== result.toolCalls.length
  )
    throw new Error("Invalid tool call identities or count");
  if (result.toolCalls.some((c) => "invalid" in c && c.invalid)) throw new Error("Model tool arguments are invalid");
  return {
    receiptId,
    text: result.text,
    calls: result.toolCalls.map((c) => ({ upstreamId: c.toolCallId, name: c.toolName, input: c.input })),
    messages: result.response.messages,
  };
}

/** Preserve provider token evidence, without inventing usage or monetary cost. */
export function responseUsage(body: string): Record<string, number> | null {
  let usage: unknown;
  try { usage = JSON.parse(body)?.usage; } catch { return null; }
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const out: Record<string, number> = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens"]) {
    const value = (usage as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

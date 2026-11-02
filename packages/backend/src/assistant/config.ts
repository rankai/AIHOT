import { z } from "zod";
import { sql, type Db } from "../db.ts";
import { credential } from "../config.ts";
import { modelFor } from "../editorial/models.ts";
import { MODELS } from "../providers/llm.ts";
import { catalogError } from "./catalog.ts";
const Extra = z.object({
  thinking: z.object({ type: z.enum(["enabled", "disabled"]), clear_thinking: z.boolean().optional() }).strict().optional(),
  reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  top_p: z.number().min(0).max(1).optional(),
  enable_thinking: z.boolean().optional(),
}).strict();
const ModelSnapshot = z.object({
  version: z.literal(2),
  key: z.string().min(1), service: z.string().min(1), model: z.string().min(1),
  baseURL: z.string().url(), apiKeyEnv: z.string().min(1), extra: Extra,
  tokenizer: z.literal("cl100k_base"), maxInputTokens: z.literal(24000),
  maxOutputTokens: z.literal(4096), modelCalls: z.literal(8),
  capabilities: z.tuple([z.literal("text-tools")]),
}).strict();
export type AssistantModelSnapshot = z.infer<typeof ModelSnapshot>;
function checkedURL(baseURL: string) {
  const url = new URL(baseURL);
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol))
    throw catalogError("model_incompatible", "模型端点配置无效");
  return baseURL;
}
export async function modelPolicy(): Promise<AssistantModelSnapshot> {
  const key = await modelFor("assistant"), spec = MODELS[key]!;
  const baseURL = spec ? credential("models", spec.baseUrlEnv) ?? "" : "";
  if (process.env.ASSISTANT_MODEL_VERIFIED !== "true" || !spec?.model || !baseURL)
    throw catalogError("model_incompatible", "助手模型尚未配置或验证");
  if (process.env.ASSISTANT_TOKENIZER !== "cl100k_base")
    throw catalogError("model_incompatible", "助手模型需要明确的tokenizer配置");
  return ModelSnapshot.parse({
    key, service: spec.service, model: spec.model, baseURL: checkedURL(baseURL), apiKeyEnv: spec.apiKeyEnv,
    extra: Extra.parse(spec.extra ?? {}), tokenizer: "cl100k_base",
    maxInputTokens: 24000, maxOutputTokens: 4096, modelCalls: 8, capabilities: ["text-tools"], version: 2,
  });
}
/** Resolve only a registered credential field, and never send it to a changed endpoint.
 * Legacy snapshots remain readable but cannot dispatch; same-endpoint key rotation is allowed. */
export function modelCredential(raw: unknown): string {
  const parsed = ModelSnapshot.safeParse(raw);
  if (!parsed.success) throw catalogError("model_incompatible", "旧版或无效模型快照不能继续执行，请停止回合后重新提交");
  const snapshot = parsed.data, spec = MODELS[snapshot.key];
  if (!spec || spec.service !== snapshot.service || spec.apiKeyEnv !== snapshot.apiKeyEnv ||
      credential("models", spec.baseUrlEnv) !== checkedURL(snapshot.baseURL))
    throw catalogError("model_incompatible", "模型端点配置已变化，请停止回合后重新提交");
  const key = credential("models", spec.apiKeyEnv);
  if (!key) throw catalogError("capability_unavailable", "助手模型凭据未配置");
  return key;
}
export function accepting() {
  if (process.env.ASSISTANT_ENABLED !== "true") throw catalogError("capability_unavailable", "助手尚未开放");
}
export function outbound() {
  if (process.env.MODEL_CALLS_ENABLED !== "true" || process.env.ASSISTANT_CALLS_ENABLED !== "true")
    throw catalogError("capability_unavailable", "助手模型外发已关闭");
}
export async function requireAvailable(db: Db = sql) {
  accepting();
  outbound();
  const model = await modelPolicy();
  modelCredential(model);
  const [budget] = await db`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='assistant.text'`;
  if (!budget || budget.per_minute <= 0 || budget.per_hour <= 0 || budget.per_day <= 0)
    throw catalogError("capability_unavailable", "助手预算尚未开启");
  const [memberBudget] = await db`SELECT per_minute,per_hour,per_day FROM budget_scopes WHERE service='assistant.text' AND scope='member'`;
  if (!memberBudget || memberBudget.per_minute <= 0 || memberBudget.per_hour <= 0 || memberBudget.per_day <= 0)
    throw catalogError("capability_unavailable", "助手会员预算尚未开启");
  return model;
}
export const TurnInput = z
  .object({
    message: z.string().trim().min(1).max(30000),
    expectedRevision: z.number().int().positive(),
    taskHint: z.unknown().optional(),
    skillSelection: z.object({ actionId: z.string() }).strict().nullable().optional(),
    autoAuthorizationId: z.string().uuid().optional(),
    inputIds: z.array(z.string().uuid()).max(10).optional(),
    artifactVersions: z
      .array(z.object({ artifactId: z.string().uuid(), version: z.number().int().positive() }).strict())
      .max(10)
      .optional(),
  })
  .strict();

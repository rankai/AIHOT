import { z } from "zod";
import type { ToolCreditIntent, ToolCreditKind } from "@aihot/contracts/credits";
import { sql, type Db } from "../db.ts";
import { AccountError } from "./accounts.ts";
import { assertUsableToolAsset } from "./tool-assets.ts";
import { parseSynchronousQuery } from "../providers/redfox/synchronous.ts";
import { parseAgentKeyQuery } from "../providers/agentkey/queries.ts";
import { platformToolCatalog } from "../providers/redfox/catalog.ts";
import { AccountInput } from "../providers/redfox/x.ts";
import { ImageInput, assertImageGenerationAvailable, imageModelOf } from "../providers/redfox/image-models.ts";
import { VideoInput } from "../providers/redfox/video-contract.ts";
import { AiSearchInput } from "../providers/redfox/ai-search-contract.ts";
import { TranscriptionInput } from "../providers/redfox/transcription-contract.ts";
import { XhsCommentInput } from "../providers/redfox/xhs-comments-contract.ts";

export const ToolKind = z.enum(["query", "x-account", "x-tweet", "images", "videos", "ai-search", "transcriptions", "xhs-comments", "media-upload", "images/query", "videos/query", "ai-search/query", "transcriptions/query", "xhs-comments/query"]);
export const ToolId = z.number().int().safe().positive();
const missing = () => new AccountError(404, "not_found", "执行记录不存在或不可访问");
export async function ownToolResult(actor: string, id: number, db: Db = sql) {
  ToolId.parse(id);
  const [row] = await db`SELECT z.id,z.run_id,z.kind,z.data,z.file_key FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.id=${id} AND r.actor=${actor}`;
  if (!row) throw missing();
  return row;
}
export const recoveryKeys = {
  "images/query": "redfox.image.generate", "videos/query": "redfox.video.generate", "ai-search/query": "redfox.ai_search.submit",
  "transcriptions/query": "redfox.transcript.submit", "xhs-comments/query": "redfox.xhs_comments.submit",
} as const;
/** A task ID is never accepted from the browser. Only the owner's persisted submission is usable. */
export async function recoveryInput(actor: string, kind: keyof typeof recoveryKeys, id: number) {
  const [run] = await sql`SELECT r.*,p.status AS receipt_status FROM operation_runs r LEFT JOIN receipts p ON p.id=r.current_receipt_id
    WHERE r.id=${id} AND r.actor=${actor} AND r.operation_key=${recoveryKeys[kind]}`;
  if (!run) throw missing();
  if (!["stopped", "needs_review"].includes(run.status) || !run.step_key.endsWith(".poll") || ["pending", "unknown"].includes(run.receipt_status)) {
    throw new AccountError(409, "conflict", "此任务不能另行续查，请先查看现有结果或由管理员核对；结果保存失败请恢复原任务");
  }
  const [submission] = await sql`SELECT data FROM operation_results WHERE run_id=${id} AND item_key='submission' ORDER BY id LIMIT 1`;
  const taskId = z.string().min(1).max(500).safeParse(submission?.data.taskId);
  if (!taskId.success) throw new AccountError(409, "conflict", "缺少已确认的供应商任务编号，请联系管理员核对");
  const commandInput: Record<string, unknown> = kind === "images/query" ? { model: imageModelOf(run.input.parameters), taskId: taskId.data }
    : kind === "ai-search/query" ? { family: run.input.family, taskId: taskId.data }
    : kind === "transcriptions/query" ? { platform: run.input.parameters.platform, taskId: taskId.data } : { taskId: taskId.data };
  const parameters = run.input.parameters as Record<string, unknown>;
  const metrics: Partial<ToolCreditIntent> = {};
  if (kind === "images/query") {
    const parsed = ImageInput.parse(parameters);
    metrics.model = imageModelOf(parsed);
    metrics.tier = "resolution" in parsed ? parsed.resolution : "metadata" in parsed ? parsed.metadata.resolution : parsed.size;
    metrics.imageCount = "n" in parsed ? parsed.n : "sequentialImageGenerationOptions" in parsed ? parsed.sequentialImageGenerationOptions?.maxImages ?? 1 : 1;
    metrics.referenceCount = parsed.fileKeys.length;
  } else if (kind === "videos/query") {
    const parsed = VideoInput.parse(parameters); metrics.model = "seedance"; metrics.tier = parsed.resolution; metrics.videoSeconds = parsed.duration;
    metrics.referenceCount = new Set(parsed.imageWithRoles.map(ref => ref.fileKey)).size;
  } else if (kind === "ai-search/query") metrics.model = AiSearchInput.parse(parameters).engine;
  else if (kind === "transcriptions/query") metrics.model = TranscriptionInput.parse(parameters).platform;
  return { commandInput, metrics };
}

export interface NormalizedToolInput { intent: ToolCreditIntent; commandInput: Record<string, unknown> }
export async function normalizeToolInput(actor: string, rawKind: unknown, raw: unknown): Promise<NormalizedToolInput> {
  const kind = ToolKind.parse(rawKind);
  if (kind in recoveryKeys) {
    const { runId } = z.object({ runId: ToolId }).strict().parse(raw);
    const { commandInput, metrics } = await recoveryInput(actor, kind as keyof typeof recoveryKeys, runId);
    return { intent: { ...metrics, kind, provider: "redfox", input: { runId, ...commandInput }, recoveryRunId: runId }, commandInput };
  }
  let input: Record<string, unknown>, provider = "redfox", model: string | undefined, tier: string | undefined;
  let imageCount: number | undefined, videoSeconds: number | undefined, referenceCount: number | undefined;
  switch (kind) {
    case "query": {
      const request = z.object({ provider: z.enum(["redfox", "agentkey"]).default("redfox"), operationId: z.string().min(1), parameters: z.record(z.string(), z.unknown()), sourceResultId: ToolId.optional() }).strict().parse(raw);
      const catalog = await platformToolCatalog();
      const descriptor = catalog.find(operation => operation.id === request.operationId);
      if (!descriptor || descriptor.platform === "redfox-account") throw new AccountError(403, "forbidden", "该接口不对前台用户开放");
      if (request.sourceResultId !== undefined) await ownToolResult(actor, request.sourceResultId);
      provider = request.provider;
      const { provider: _, ...body } = request;
      if (provider === "agentkey") {
        if (request.sourceResultId !== undefined) throw new AccountError(400, "invalid_request", "此供应商查询不接受结果引用");
        const parsed = parseAgentKeyQuery(request);
        input = { provider, operationId: request.operationId, parameters: parsed.parameters };
      } else {
        const parsed = parseSynchronousQuery(body);
        input = { provider, operationId: request.operationId, parameters: parsed.parameters, ...(request.sourceResultId === undefined ? {} : { sourceResultId: request.sourceResultId }) };
      }
      model = request.operationId;
      break;
    }
    case "x-account": input = AccountInput.parse(raw); break;
    case "x-tweet": {
      input = z.object({ tweetId: z.string().regex(/^\d+$/).max(30), sourceResultId: ToolId.optional() }).strict().parse(raw);
      if (input.sourceResultId !== undefined) await ownToolResult(actor, input.sourceResultId as number);
      break;
    }
    case "images": {
      const parsed = ImageInput.parse(raw); input = parsed; model = imageModelOf(parsed);
      assertImageGenerationAvailable(imageModelOf(parsed));
      tier = "resolution" in parsed ? parsed.resolution : "metadata" in parsed ? parsed.metadata.resolution : parsed.size;
      imageCount = "n" in parsed ? parsed.n : "sequentialImageGenerationOptions" in parsed ? parsed.sequentialImageGenerationOptions?.maxImages ?? 1 : 1;
      referenceCount = parsed.fileKeys.length;
      for (const key of parsed.fileKeys) await assertUsableToolAsset(actor, key);
      if ("referenceUploads" in parsed) for (const reference of parsed.referenceUploads ?? []) await ownToolResult(actor, reference.resultId);
      break;
    }
    case "videos": {
      const parsed = VideoInput.parse(raw); input = parsed; model = "seedance"; tier = parsed.resolution;
      videoSeconds = parsed.duration; referenceCount = new Set(parsed.imageWithRoles.map(ref => ref.fileKey)).size;
      for (const reference of parsed.imageWithRoles) {
        await assertUsableToolAsset(actor, reference.fileKey);
        if (reference.uploadResultId !== undefined) await ownToolResult(actor, reference.uploadResultId);
      }
      break;
    }
    case "ai-search": input = AiSearchInput.parse(raw); model = String(input.engine); break;
    case "transcriptions": input = TranscriptionInput.parse(raw); model = String(input.platform); break;
    case "xhs-comments": {
      input = XhsCommentInput.parse(raw);
      if ((input.dataNum as number) < 1 || (input.dataNum as number) > 1000) throw new AccountError(400, "invalid_request", "试用账号每次评论任务支持 1–1000 条，请明确数量");
      break;
    }
    case "media-upload": {
      input = z.object({ fileKey: z.string().min(1).max(500) }).strict().parse(raw);
      await assertUsableToolAsset(actor, input.fileKey as string); break;
    }
    default: throw new AccountError(400, "invalid_request", "不支持此工具");
  }
  return { intent: { kind: kind as ToolCreditKind, provider, ...(model ? { model } : {}), ...(tier ? { tier } : {}), input,
    ...(imageCount === undefined ? {} : { imageCount }), ...(videoSeconds === undefined ? {} : { videoSeconds }), ...(referenceCount === undefined ? {} : { referenceCount }) }, commandInput: input };
}

import { z } from "zod";
import { createWanGeneration, createWanQuery } from "../providers/aliyun/wan.ts";
import { wanOptions } from "../providers/aliyun/wan-contract.ts";
import type { ToolRunAction } from "@aihot/contracts/user-tools";
import { assetUploadOptions, MEMBER_STORAGE_BYTES, MEMBER_STORAGE_FILES } from "../operations/assets.ts";
import { platformToolCatalog } from "../providers/redfox/catalog.ts";
import { createSynchronousQuery } from "../providers/redfox/synchronous.ts";
import { createAgentKeyQuery } from "../providers/agentkey/queries.ts";
import { createAccountQuery, createTweetQuery } from "../providers/redfox/queries.ts";
import { createImageGeneration, createImageQuery, imageOptions } from "../providers/redfox/images.ts";
import { createVideoGeneration, createVideoQuery, videoOptions } from "../providers/redfox/videos.ts";
import { createAiSearch, createAiSearchQuery, aiSearchOptions } from "../providers/redfox/ai-search.ts";
import { createTranscription, createTranscriptionQuery, transcriptionOptions } from "../providers/redfox/transcription.ts";
import { createXhsComments, createXhsCommentQuery, xhsCommentOptions } from "../providers/redfox/xhs-comments.ts";
import { createMediaUpload } from "../providers/redfox/media-upload.ts";
import { controlOperation } from "../providers/operations/read.ts";
import { AccountError } from "./accounts.ts";
import { normalizeToolInput, ToolKind } from "./tool-input.ts";
import { userToolDetail } from "./tool-read.ts";
export { userToolDetail, exportUserToolResults } from "./tool-read.ts";
export { listUserTools } from "./tool-history.ts";
import { quoteTool, type ToolAuthorization } from "./credits.ts";

export async function userToolOptions() {
  const operations = (await platformToolCatalog()).filter(operation => operation.platform !== "redfox-account").map(operation => {
    const { collectionProviders, collectionCapabilities: _, collectionPrice: __, ...query } = operation;
    return { ...query, schedulableType: null, queryProviders: (operation.queryProviders ?? collectionProviders ?? [{ id: "redfox", label: "Redfox" }]).map(({ collectionCapabilities: ___, collectionPrice: ____, ...provider }) => provider) };
  });
  return { operations, images: imageOptions(), videos: videoOptions(), videoReplication: wanOptions(), aiSearch: aiSearchOptions(), transcriptions: transcriptionOptions(),
    xhsComments: { ...xhsCommentOptions(), allDataNum: null, dataNumMax: 1000 }, assets: assetUploadOptions(),
    limits: { activeRuns: 5, submissionsPerMinute: 10, storageBytes: MEMBER_STORAGE_BYTES, storageFiles: MEMBER_STORAGE_FILES } };
}

export async function quoteUserTool(userId: number, raw: unknown) {
  const { kind, input } = z.object({ kind: ToolKind, input: z.record(z.string(), z.unknown()) }).strict().parse(raw);
  const normalized = await normalizeToolInput(`user:${userId}`, kind, input);
  return quoteTool(userId, normalized.intent);
}
export async function submitUserTool(userId: number, kind: unknown, raw: unknown, key: unknown) {
  const { input, quoteId } = z.object({ input: z.record(z.string(), z.unknown()), quoteId: z.string().min(1).max(200) }).strict().parse(raw);
  const commandKey = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/, "请提供有效的提交标识").parse(key), actor = `user:${userId}`;
  const normalized = await normalizeToolInput(actor, kind, input);
  const authorization: ToolAuthorization = { quoteId, intent: normalized.intent }, body = normalized.commandInput;
  let result;
  switch (normalized.intent.kind) {
    case "query": { const { provider, ...query } = body; result = provider === "agentkey" ? await createAgentKeyQuery(body, actor, commandKey, authorization) : await createSynchronousQuery(query, actor, commandKey, authorization); break; }
    case "x-account": result = await createAccountQuery(body, actor, commandKey, authorization); break;
    case "x-tweet": result = await createTweetQuery(body, actor, commandKey, authorization); break;
    case "images": result = await createImageGeneration(body, actor, commandKey, authorization); break;
    case "images/query": result = await createImageQuery(body, actor, commandKey, authorization); break;
    case "videos": result = body.provider === "aliyun" ? await createWanGeneration(body, actor, commandKey, authorization) : await createVideoGeneration(body, actor, commandKey, authorization); break;
    case "videos/query": result = body.provider === "aliyun" ? await createWanQuery(body, actor, commandKey, authorization) : await createVideoQuery(body, actor, commandKey, authorization); break;
    case "ai-search": result = await createAiSearch(body, actor, commandKey, authorization); break;
    case "ai-search/query": result = await createAiSearchQuery(body, actor, commandKey, authorization); break;
    case "transcriptions": result = await createTranscription(body, actor, commandKey, authorization); break;
    case "transcriptions/query": result = await createTranscriptionQuery(body, actor, commandKey, authorization); break;
    case "xhs-comments": result = await createXhsComments(body, actor, commandKey, authorization); break;
    case "xhs-comments/query": result = await createXhsCommentQuery(body, actor, commandKey, authorization); break;
    case "media-upload": result = await createMediaUpload(body, actor, commandKey, authorization); break;
  }
  return { runId: result.id, status: result.status };
}

export async function controlUserTool(userId: number, id: number, action: ToolRunAction, raw: unknown) {
  const detail = await userToolDetail(userId, id);
  if (!detail.actions.includes(action)) throw new AccountError(409, "conflict", "当前状态不支持此操作，请刷新后重试");
  await controlOperation(id, action, raw, `user:${userId}`);
  return userToolDetail(userId, id);
}

import {xhsCommentPaths} from "./xhs-comments-contract.ts";
import {videoPaths} from "./video-contract.ts";
import {newImagePaths,imagePairs} from "./image-models.ts";
import { aiSearchPaths,aiSearchPolls } from "./ai-search-contract.ts";
import type { InputMediaFormat } from "../../operations/asset-media.ts";
import { mediaToolOperations } from "./media-tools-contract.ts";
import { transcriptionPaths, transcriptionPairs } from "./transcription-contract.ts";
import { socialResearchOperations } from "./social-research-contract.ts";
import { redfoxAccountOperations } from "./redfox-account-contract.ts";
import { hotResearchOperations } from "./hot-research-contract.ts";
import { xResearchOperations } from "./x-research-contract.ts";
import { qichezhijiaOperations } from "./qichezhijia-contract.ts";
import { dongchediOperations } from "./dongchedi-contract.ts";
import { yicheOperations } from "./yiche-contract.ts";
import { baijiahaoOperations } from "./baijiahao-contract.ts";
import { zhihuOperations } from "./zhihu-contract.ts";
import { toutiaoOperations } from "./toutiao-contract.ts";
import { kuaishouOperations } from "./kuaishou-contract.ts";
import { shipinhaoOperations } from "./shipinhao-contract.ts";
import { instagramOperations } from "./instagram-contract.ts";
import { youtubeOperations } from "./youtube-contract.ts";
import { bilibiliOperations } from "./bilibili-contract.ts";
import { tiktokOperations, tiktokWireInput, type TiktokOperation } from "./tiktok-contract.ts";
import { xiaohongshuOperations } from "./xiaohongshu-contract.ts";
import { FormData } from "undici";
import { openAsBlob } from "node:fs";
import { open } from "node:fs/promises";
import { credential, isProduction } from "../../config.ts";
import { sql } from "../../db.ts";
import { guardedFetch } from "../../lib/http-fetch.ts";
import { paidRequest, type PaidRequestOptions } from "../receipts.ts";

import { douyinOperations } from "./douyin-contract.ts";
import { wechatOperations } from "./wechat-contract.ts";
import { weiboOperations } from "./weibo-contract.ts";
const paths = { ...xhsCommentPaths, ...videoPaths, ...newImagePaths, ...aiSearchPaths, "6L178PZD":"/story/api/parseWork/videoGen/uploadFile", ...Object.fromEntries(Object.entries(mediaToolOperations).map(([id,o])=>[id,o.path])) as {[K in keyof typeof mediaToolOperations]:typeof mediaToolOperations[K]["path"]}, ...transcriptionPaths, ...Object.fromEntries(Object.entries(socialResearchOperations).map(([id,o])=>[id,o.path])) as {[K in keyof typeof socialResearchOperations]:typeof socialResearchOperations[K]["path"]}, ...Object.fromEntries(Object.entries(redfoxAccountOperations).map(([id,o])=>[id,o.path])) as {[K in keyof typeof redfoxAccountOperations]:typeof redfoxAccountOperations[K]["path"]}, ...Object.fromEntries(Object.entries(hotResearchOperations).map(([id,o])=>[id,o.path])) as {[K in keyof typeof hotResearchOperations]:typeof hotResearchOperations[K]["path"]}, ...Object.fromEntries(Object.entries(xResearchOperations).map(([id,o])=>[id,o.path])) as {[K in keyof typeof xResearchOperations]:typeof xResearchOperations[K]["path"]}, ...Object.fromEntries(Object.entries(qichezhijiaOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof qichezhijiaOperations]: typeof qichezhijiaOperations[K]["path"] }, ...Object.fromEntries(Object.entries(dongchediOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof dongchediOperations]: typeof dongchediOperations[K]["path"] }, ...Object.fromEntries(Object.entries(yicheOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof yicheOperations]: typeof yicheOperations[K]["path"] }, ...Object.fromEntries(Object.entries(baijiahaoOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof baijiahaoOperations]: typeof baijiahaoOperations[K]["path"] }, ...Object.fromEntries(Object.entries(zhihuOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof zhihuOperations]: typeof zhihuOperations[K]["path"] },  ...Object.fromEntries(Object.entries(toutiaoOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof toutiaoOperations]: typeof toutiaoOperations[K]["path"] }, ...Object.fromEntries(Object.entries(kuaishouOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof kuaishouOperations]: typeof kuaishouOperations[K]["path"] }, ...Object.fromEntries(Object.entries(shipinhaoOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof shipinhaoOperations]: typeof shipinhaoOperations[K]["path"] }, ...Object.fromEntries(Object.entries(instagramOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof instagramOperations]: typeof instagramOperations[K]["path"] }, ...Object.fromEntries(Object.entries(youtubeOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof youtubeOperations]: typeof youtubeOperations[K]["path"] }, ...Object.fromEntries(Object.entries(bilibiliOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof bilibiliOperations]: typeof bilibiliOperations[K]["path"] }, ...Object.fromEntries(Object.entries(tiktokOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof tiktokOperations]: typeof tiktokOperations[K]["path"] }, ...Object.fromEntries(Object.entries(xiaohongshuOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof xiaohongshuOperations]: typeof xiaohongshuOperations[K]["path"] }, ...Object.fromEntries(Object.entries(douyinOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof douyinOperations]: typeof douyinOperations[K]["path"] }, ...Object.fromEntries(Object.entries(wechatOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof wechatOperations]: typeof wechatOperations[K]["path"] }, ...Object.fromEntries(Object.entries(weiboOperations).map(([id,operation])=>[id,operation.path])) as { [K in keyof typeof weiboOperations]: typeof weiboOperations[K]["path"] }, AKFHJMXQ: "/story/api/x/userInfo", API_1790148502632: "/story/api/x/userTimeline", QCP75W33: "/story/api/x/tweetDetail", FXDGJO1V: "/story/api/parseWork/imageGen/uploadImage", ATY07YGY: "/story/api/parseWork/imageGen/gptImage2Submit", "849ONCDF": "/story/api/parseWork/imageGen/gptImage2Result" } as const;
export type XOperation = "AKFHJMXQ" | "API_1790148502632" | "QCP75W33";
type Operation = keyof typeof paths;
const readOnly = (operation: Operation) => ["LO93CE5K","VBALJNC7",...Object.values(imagePairs).map(p=>p.poll),...Object.values(aiSearchPolls),...Object.keys(mediaToolOperations),...Object.values(transcriptionPairs).map(pair=>pair.poll),"AKFHJMXQ","API_1790148502632","QCP75W33","849ONCDF",...Object.keys(socialResearchOperations),...Object.keys(weiboOperations),...Object.keys(wechatOperations),...Object.keys(douyinOperations),...Object.keys(xiaohongshuOperations),...Object.keys(tiktokOperations),...Object.keys(bilibiliOperations),...Object.keys(youtubeOperations),...Object.keys(instagramOperations),...Object.keys(shipinhaoOperations),...Object.keys(kuaishouOperations),...Object.keys(toutiaoOperations),...Object.keys(qichezhijiaOperations),...Object.keys(dongchediOperations),...Object.keys(yicheOperations),...Object.keys(baijiahaoOperations),...Object.keys(xResearchOperations),...Object.keys(hotResearchOperations),...Object.keys(redfoxAccountOperations),...Object.keys(zhihuOperations)].includes(operation);
export class RedfoxDisabledError extends Error {}
export class RedfoxResponseError extends Error {}
/** A confirmed HTTP/business rejection, not malformed JSON or a local identity/schema disagreement. */
export class RedfoxRejectedResponseError extends RedfoxResponseError {
  readonly receiptId:number;
  readonly attempt:number;
  constructor(message:string,receiptId:number,attempt:number){super(message);this.receiptId=receiptId;this.attempt=attempt;}
}
export class RedfoxDeferredError extends Error {
  readonly retryAt: Date;
  constructor(receiptId:number,retryAt:Date) {super(`Redfox shared receipt ${receiptId} is deferred until ${retryAt.toISOString()}`);this.retryAt=retryAt;}
}
export class RedfoxRetryableResponseError extends Error {
  readonly receiptId: number;
  readonly attempt: number;
  readonly response: RawResponse;
  readonly retryAt: Date;
  constructor(receiptId: number, attempt:number, response: RawResponse, retryAt: Date) {
    super(`Redfox temporary read-only rejection; receipt ${receiptId}`);
    this.receiptId=receiptId; this.attempt=attempt; this.response=response; this.retryAt=retryAt;
  }
}
function retryDeadline(header:string|null,finishedAt:Date) {
  const fallback=finishedAt.getTime()+60_000;
  const ms=header && /^\d+$/.test(header)?finishedAt.getTime()+Number(header)*1000:header?Date.parse(header):fallback;
  return new Date(Number.isFinite(ms) && Math.abs(ms)<=8640000000000000?ms:fallback);
}
export interface RawResponse { status: number; headers: { contentType: string | null; retryAfter: string | null }; body: string }
export function redfoxBaseUrl() {
  const testBase = process.env.REDFOX_TEST_BASE_URL;
  if (!testBase) return "https://redfox.hk";
  const url = new URL(testBase);
  if (isProduction || process.env.NODE_ENV !== "test" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid Redfox test endpoint");
  return url.origin;
}
/** Preserve integer lexemes before Number rounding; raw HTTP text remains the recovery authority. */
export function parseRedfoxJson(text: string): unknown {
  try {
    return JSON.parse(text, (_key, value, context?: { source?: string }) => typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value) ? context!.source : value);
  } catch { throw new RedfoxResponseError("Redfox response is not valid JSON"); }
}
export async function redfoxRequest(operation: Operation, input: Record<string, unknown>, window: string, purpose: "video" | "query" | "collect" | "image" | "poll" | "media" | "account" | "transcript" | "ai_search", options: PaidRequestOptions, upload?: {file: string; format: InputMediaFormat|"jpeg"; mime?:string}) {
  const base = redfoxBaseUrl(), service = `redfox.${purpose}`;
  const [price] = await sql`SELECT per_request, currency FROM service_prices WHERE service = ${service} AND model = ${operation}`;
  let uploadBody: FormData | undefined;
  const receipt = await paidRequest({ service, model: operation, purpose: `redfox.${operation}`, identity: { base, operation, input, window },
    requestSummary: { base, operation, input, window } }, async () => {
    const key = credential("collectors", "REDFOX_API_KEY")!;
    const encodedKey=new URLSearchParams({apiKey:key}).toString().slice("apiKey=".length);
    const redact = (text: string | null) => text === null ? null : [key,encodeURIComponent(key),encodedKey].reduce((value,secret)=>value.split(secret).join("[REDACTED]"),text);
    const accountQuery=operation in redfoxAccountOperations;
    const method=accountQuery?"GET":operation in hotResearchOperations?hotResearchOperations[operation as keyof typeof hotResearchOperations].method:operation in xiaohongshuOperations?xiaohongshuOperations[operation as keyof typeof xiaohongshuOperations].method:operation in wechatOperations?wechatOperations[operation as keyof typeof wechatOperations].method:"POST";
    let wireInput = operation in tiktokOperations ? tiktokWireInput(operation as TiktokOperation,input) : input;
    if(operation === "API_1789095347662") {
      // Keep persisted inputs and receipt identity stable; Redfox now expects keyword on the wire.
      const {keword,...parameters}=input;
      wireInput={...parameters,keyword:keword};
    }
    let body: string | FormData | undefined = method==="GET"?undefined:JSON.stringify(wireInput);
    let suffix = "";
    const headers: Record<string,string> = accountQuery?{}:{ "REDFOX_API_KEY": key };
    if(operation === "FXDGJO1V" || operation === "6L178PZD") {
      if(!upload) throw new Error("Missing upload transport");
      if(!uploadBody)throw new Error("Upload was not prepared");
      body=uploadBody;suffix=`?format=${upload.format}`;
    } else if(operation==="LO93CE5K"){body=undefined;suffix=`?${new URLSearchParams({taskId:String(input.taskId)})}`;} else if(method==="POST") headers["Content-Type"]="application/json";
    else {
      const query=new URLSearchParams(Object.entries(input).map(([k,v])=>[k,String(v)]));
      // Fixed account endpoints require a query credential. It never enters input, identity, or requestSummary.
      if(accountQuery)query.set("apiKey",key);
      suffix=`?${query}`;
    }
    let response;
    try { response = await guardedFetch(`${base}${paths[operation]}${suffix}`, { method, route: "direct", maxRedirects: 0,
      timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024, headers, body }); }
    catch { throw new Error("Redfox transport did not return a complete response"); }
    return { response: { status: response.status, headers: { contentType: redact(response.headers.get("content-type")), retryAfter: redact(response.headers.get("retry-after")) }, body: redact(response.text()) },
      cost: operation==="5AM3X4HZ" || price?.per_request == null ? null : { amount: Number(price.per_request), currency: price.currency, basis: "estimated" as const } };
  }, { ...options, onReceipt: async (tx, id, info) => {
    if (info.kind === "call") {
      const [previous]=await tx`SELECT response,finished_at FROM receipt_attempts WHERE receipt_id=${id} AND status='failed'
        AND response IS NOT NULL AND error LIKE 'Redfox temporary read-only rejection; receipt %' ORDER BY attempt DESC LIMIT 1`;
      if(readOnly(operation) && previous?.finished_at) {
        const retryAt=retryDeadline((previous.response as RawResponse).headers.retryAfter,previous.finished_at);
        if(retryAt.getTime()>Date.now())throw new RedfoxDeferredError(id,retryAt);
      }
      if (process.env.REDFOX_CALLS_ENABLED !== "true" || (purpose === "collect" && process.env.COLLECT_ENABLED === "false")) throw new RedfoxDisabledError("Redfox outbound calls are disabled");
      if (operation in aiSearchPaths && process.env.MODEL_CALLS_ENABLED !== "true") throw new RedfoxDisabledError("AI search outbound calls are disabled");
      if ((operation in videoPaths || operation in newImagePaths || ["FXDGJO1V","ATY07YGY","849ONCDF"].includes(operation)) && process.env.MODEL_CALLS_ENABLED !== "true") throw new RedfoxDisabledError("Image generation outbound calls are disabled");
      if (!credential("collectors", "REDFOX_API_KEY")) throw new RedfoxDisabledError("REDFOX_API_KEY is not configured");
      if(operation === "FXDGJO1V" || operation === "6L178PZD") {
        if(!upload)throw new Error("Missing upload transport");
        // Local preparation is inside the placeholder transaction: failure rolls back the attempt.
        const handle=await open(upload.file,"r");try {await handle.read(Buffer.alloc(1),0,1,0);}finally{await handle.close();}
        uploadBody=new FormData();uploadBody.append("file",await openAsBlob(upload.file,{type:operation === "FXDGJO1V"?`image/${upload.format}`:upload.mime}),`reference.${upload.format}`);
      }
    }
    await options.onReceipt?.(tx, id, info);
  } });
  const raw = receipt.response as RawResponse;
  if (!raw || typeof raw.body !== "string") throw new RedfoxResponseError("Redfox HTTP response is missing");
  const rejected=async()=>{
    const [attempt]=await sql`SELECT finished_at FROM receipt_attempts WHERE receipt_id=${receipt.receiptId} AND attempt=${receipt.attempt}`;
    return new RedfoxRetryableResponseError(receipt.receiptId,receipt.attempt,raw,retryDeadline(raw.headers.retryAfter,attempt!.finished_at));
  };
  if (readOnly(operation) && [429,500,503].includes(raw.status)) throw await rejected();
  if (raw.status !== 200) throw new RedfoxRejectedResponseError(`Redfox HTTP ${raw.status}; response retained for review`,receipt.receiptId,receipt.attempt);
  const parsed = parseRedfoxJson(raw.body) as { code?: unknown; data?: unknown } | null;
  if (readOnly(operation) && parsed?.code === 4004) throw await rejected();
  // These fixed operations document HTTP 200 root objects without a business envelope.
  if (["3X8FGEEM","4QS1F8DE","ZMFVK589"].includes(operation) && parsed && typeof parsed === "object" && !Array.isArray(parsed) && !("code" in parsed)) return { ...receipt, data: parsed };
  if (!parsed || !(operation==="AJWHKFQI"&&(parsed.code===200||parsed.code===2000)) && parsed.code !== (["I3CIBRI2","W86F8SSK","QQ5E3EZ9"].includes(operation)?200:2000)) {
    if(parsed&&typeof parsed==="object"&&typeof parsed.code==="number")throw new RedfoxRejectedResponseError("Redfox business response was not successful; response retained for review",receipt.receiptId,receipt.attempt);
    throw new RedfoxResponseError("Redfox business response lacks a valid success code; response retained for review");
  }
  return { ...receipt, data: operation === "WULKP6JP" || operation === "3X8FGEEM" && parsed.data === undefined ? parsed : parsed.data };
}

import { candidateOutboundAllowed, subscriptionVideoFileKey, videoResolver, type VideoTarget, type VideoManifest } from "../../sources/subscription-video-candidates.ts";
import {agentKeyXOperations} from '../agentkey/x-contract.ts';
import {agentKeyWeiboOperations} from "../agentkey/weibo-contract.ts";
import {agentKeyBilibiliOperations} from "../agentkey/bilibili-contract.ts";
import {agentKeyXiaohongshuOperations} from "../agentkey/xiaohongshu-contract.ts";
import {toutiaoArticleRoute,toutiaoCommentsRoute,toutiaoProfileRoute} from "../agentkey/toutiao-contract.ts";
import {agentKeyRouteFor,agentKeyOutboundAllowed} from "../agentkey/routes.ts";
import {wechatArticlesRoute,wechatDetailRoute,wechatProfileRoute,wechatCommentsRoute,wechatRepliesRoute,wechatStatsRoute} from "../agentkey/wechat-contract.ts";
import { douyinTrendingRoute,douyinCommentsRoute,douyinRepliesRoute,douyinTopicRoute,douyinFollowingRoute,douyinProfileRoute,douyinSearchRoute, douyinAccountPostsRoute, douyinDetailRoute, douyinSuggestRoute, douyinAccountSearchRoute } from "../agentkey/douyin-contract.ts";
import { hasCompleteLocalFile } from "../../operations/assets.ts";
import { sql, type Tx } from "../../db.ts";
import { queueOperationStep } from "./queue.ts";
import { eligibleMembers, releaseSubscriptions, type SubscriptionMember } from "../../sources/subscriptions.ts";
import { lockRun, lockRunAdmission, resumeRun, setRunState, StaleOperationError, type Execution, type RunRow } from "./store.ts";
import { SUBSCRIPTION_VIDEO_DOWNLOAD } from "../../sources/subscription-video-ownership.ts";

/** Includes terminal unknown evidence: abandonment must not route a receipt back to generic release. */
export const governedReceipt = (id: number) => sql`EXISTS (
  SELECT 1 FROM operation_runs o WHERE o.current_receipt_id = ${id}
    OR o.progress->'retainedReceiptIds' @> ${sql.json([id])}
  UNION ALL SELECT 1 FROM operation_results z WHERE z.receipt_id = ${id})`;
function outboundAllowed(run: RunRow) {
  if(run.operation_key===SUBSCRIPTION_VIDEO_DOWNLOAD){
    if(run.step_key==="subscription.video.resolve")return candidateOutboundAllowed("redfox");
    const targets=run.progress.targets as VideoTarget[]|undefined??(run.input.manifest as VideoManifest|undefined)?.targets;
    const candidate=targets?.[Number(run.progress.targetIndex??0)]?.candidates[Number(run.progress.candidateIndex??0)];
    return candidate?candidateOutboundAllowed(candidate.provider):process.env.COLLECT_ENABLED!=="false";
  }
  if (run.provider === "agentkey") return agentKeyOutboundAllowed(run);
  if(run.step_key.startsWith("redfox.ai_search."))return process.env.REDFOX_CALLS_ENABLED === "true" && process.env.MODEL_CALLS_ENABLED === "true";
  if(run.step_key.startsWith("redfox.image.")||run.step_key.startsWith("redfox.video."))return process.env.REDFOX_CALLS_ENABLED === "true" && process.env.MODEL_CALLS_ENABLED === "true";
  return run.provider === "redfox" ? process.env.REDFOX_CALLS_ENABLED === "true" && (run.input.mode !== "collection" || process.env.COLLECT_ENABLED !== "false") : process.env.COLLECT_ENABLED !== "false";
}
const AUTO_NOTE = "自动放行：结果未知超过 30 分钟，未核对是否计费";

async function videoLocalRecovery(tx:Tx,run:RunRow):Promise<boolean>{
  if(run.operation_key!==SUBSCRIPTION_VIDEO_DOWNLOAD)return false;
  const targets=run.progress.targets as VideoTarget[]|undefined??(run.input.manifest as VideoManifest|undefined)?.targets;
  const target=targets?.[Number(run.progress.targetIndex??0)];
  const selection=target?.selection??(run.input.singleVideo===true||run.input.videoProof==="agentkey-douyin-v4"?"single-video-main":"unresolved");
  const key=subscriptionVideoFileKey(String(run.input.platform),String(run.input.workId),selection);
  const [asset]=await tx`SELECT key FROM stored_files WHERE key=${key}`;
  if(asset||await hasCompleteLocalFile(key))return true;
  const [deletedWork]=await tx`SELECT 1 FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN stored_files f ON f.key=z.file_key
    WHERE r.operation_key=${SUBSCRIPTION_VIDEO_DOWNLOAD} AND r.input->>'platform'=${String(run.input.platform)} AND r.input->>'workId'=${String(run.input.workId)}
      AND f.metadata->>'origin'='subscription-video' AND (f.status<>'available' OR f.expires_at<=now()) LIMIT 1`;
  if(deletedWork)return true;
  // A missing fixed parser is a local result, not a reason to wait for Redfox configuration.
  return run.step_key==="subscription.video.resolve"&&!videoResolver(String(run.input.platform));
}

/** Only implemented read operations may automatically retry an unknown request. */
function isReadOnlyStep(run: RunRow): boolean {
  if(run.operation_key===SUBSCRIPTION_VIDEO_DOWNLOAD)return run.step_key==="subscription.video.resolve";
  if (run.provider === "agentkey") return agentKeyRouteFor(run)?.recovery === "readOnly";
  return run.provider === "redfox" ? ["redfox.xhs_comments.poll","redfox.video.poll","redfox.ai_search.poll","redfox.wechat.page","redfox.wechat.detail","redfox.platform.page","redfox.platform.item","redfox.platform.detail","redfox.weibo.page","redfox.weibo.item","redfox.weibo.detail","redfox.sync.query","redfox.x.account","redfox.x.detail","redfox.x.page","redfox.x.item","redfox.image.poll","redfox.transcript.poll"].includes(run.step_key)
    : run.provider === "socialdata" ? run.step_key === "x.page"
    : run.provider === "dajiala" && ["mp.list","mp.body"].includes(run.step_key);
}
/** Comment jobs have long local deadlines; expiration never releases or repurchases unknown work.
 * Caller holds the run lock. Received data may still be consumed after the request deadline. */
export async function settleExpiredCommentTask(tx:Tx,run:RunRow):Promise<boolean>{
 if(!run.step_key.startsWith("redfox.xhs_comments.")||Date.now()-Date.parse(String(run.input.startedAt))<=Number(run.limits.pollDeadlineSeconds)*1000)return false;
 const [local]=run.current_receipt_id?await tx`SELECT id FROM receipts WHERE id=${run.current_receipt_id} AND status IN ('received','completed') AND response IS NOT NULL`:[];
 if(local)return false;
 await tx`UPDATE operation_runs SET status='needs_review',wait_reason='Comment task local deadline exhausted; query the retained task ID explicitly',next_attempt_at=NULL,updated_at=now() WHERE id=${run.id}`;
 return true;
}
/** Caller already holds requireExecution locks. Classify the persisted receipt, not a thrown transport error. */
export async function settleUnknownReceipt(tx: Tx, execution: Execution, run: RunRow): Promise<boolean> {
  if (!run.current_receipt_id) return false;
  const [receipt]=await tx`SELECT status,updated_at,attempts FROM receipts WHERE id=${run.current_receipt_id} FOR UPDATE`;
  if(receipt?.status!=="unknown") return false;
  const [previous]=await tx`SELECT id FROM receipt_attempts WHERE receipt_id=${run.current_receipt_id} AND error LIKE ${AUTO_NOTE+"%"} LIMIT 1`;
  const automatic=isReadOnlyStep(run) && !previous && (run.operation_key!==SUBSCRIPTION_VIDEO_DOWNLOAD || Number(receipt.attempts)<2);
  await setRunState(tx,execution,automatic?"waiting":"needs_review",previous?"Automatic unknown retry already used":"Request outcome unknown; retained receipt requires reconciliation",
    automatic?new Date(receipt.updated_at.getTime()+30*60_000):null);
  return true;
}

export async function releaseOperationReceipt(receiptId: number, manual = false) {
  const owners = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE current_receipt_id = ${receiptId} ORDER BY id`;
  return sql.begin(async (tx) => {
    await lockRunAdmission(tx, owners.map(run => run.id));
    // Lock the complete member set before any individual run, including shared-receipt batches.
    const members = [...new Map(owners.flatMap((r) => r.input.members).map((m) => [m.subscriptionId, m])).values()];
    await eligibleMembers(tx, -1, members);
    const valid: RunRow[] = [];
    for (const owner of owners) {
      const { run, eligible } = await lockRun(tx, owner.id);
      if (run.current_receipt_id !== receiptId || !["active", "waiting", ...(manual ? ["needs_review"] : [])].includes(run.status)) continue;
      if ((run.input.members.length || run.operation_key === SUBSCRIPTION_VIDEO_DOWNLOAD) && !eligible.length) continue;
      if (await settleExpiredCommentTask(tx,run)) continue;
      if (!isReadOnlyStep(run)) continue;
      if (!outboundAllowed(run)) continue;
      valid.push(run);
    }
    if (!valid.length) return { released: false, requeued: 0 };
    const [receipt] = await tx`SELECT status, updated_at, attempts FROM receipts WHERE id = ${receiptId} FOR UPDATE`;
    if (receipt?.status !== "unknown") return { released: false, requeued: 0 };
    if(valid.some(run=>run.operation_key===SUBSCRIPTION_VIDEO_DOWNLOAD) && Number(receipt.attempts)>=2){
      for(const run of valid)await tx`UPDATE operation_runs SET status='needs_review',wait_reason='Automatic video parsing attempt limit exhausted',next_attempt_at=NULL WHERE id=${run.id}`;
      return {released:false,requeued:0};
    }
    const [previous] = await tx`SELECT id FROM receipt_attempts WHERE receipt_id = ${receiptId} AND error LIKE ${AUTO_NOTE + "%"} LIMIT 1`;
    if (!manual && previous) {
      for (const run of valid) await tx`UPDATE operation_runs SET status = 'needs_review', wait_reason = 'Automatic unknown retry already used' WHERE id = ${run.id}`;
      return { released: false, requeued: 0 };
    }
    if (!manual && Date.now() - receipt.updated_at.getTime() < 30 * 60_000) return { released: false, requeued: 0 };
    const reason = manual ? "operation unknown manually released" : AUTO_NOTE;
    await tx`UPDATE receipts SET status = 'failed', error = ${reason}, updated_at = now() WHERE id = ${receiptId}`;
    await tx`UPDATE receipt_attempts SET status = 'failed', error = ${reason} WHERE receipt_id = ${receiptId} AND status = 'unknown'`;
    let requeued = 0;
    for (const run of valid) {
      if (run.status !== "active") await resumeRun(tx, { runId: run.id, stepVersion: run.step_version, generation: run.generation });
      else await tx`UPDATE operation_runs SET generation = generation + 1 WHERE id = ${run.id}`;
      if (await queueOperationStep(tx, run.id)) requeued++;
    }
    return { released: true, requeued };
  });
}

/** Called only by the existing ops.recover schedule. Queue evidence prevents duplicate wakeups. */
export async function recoverOperations() {
  const [cursor]=await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`;
  const lastId=typeof cursor?.value === "number" ? cursor.value : 0;
  const rows = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE status IN ('active','waiting') AND operation_key IN ('subscription.video.download',${agentKeyXOperations[0].route.operationKey},${agentKeyXOperations[1].route.operationKey},${agentKeyXOperations[2].route.operationKey},${agentKeyXOperations[3].route.operationKey},${agentKeyXOperations[4].route.operationKey},${agentKeyXOperations[5].route.operationKey},${agentKeyXOperations[6].route.operationKey},${agentKeyXOperations[7].route.operationKey},${agentKeyXOperations[8].route.operationKey},${agentKeyXOperations[9].route.operationKey},${agentKeyXOperations[10].route.operationKey},${agentKeyXOperations[11].route.operationKey},${agentKeyWeiboOperations[0].route.operationKey},${agentKeyWeiboOperations[1].route.operationKey},${agentKeyWeiboOperations[2].route.operationKey},${agentKeyWeiboOperations[3].route.operationKey},${agentKeyWeiboOperations[4].route.operationKey},${agentKeyWeiboOperations[5].route.operationKey},${agentKeyWeiboOperations[6].route.operationKey},${agentKeyWeiboOperations[7].route.operationKey},'redfox.xhs_comments.submit','redfox.xhs_comments.query','redfox.video.generate','redfox.video.query','redfox.ai_search.submit','redfox.ai_search.query','redfox.media.upload','x.search','mp.history','redfox.x.account','redfox.x.detail','redfox.x.timeline','redfox.image.generate','redfox.image.query','redfox.transcript.submit','redfox.transcript.query','redfox.sync.query','redfox.weibo.collection','redfox.platform.collection','redfox.wechat.collection',${douyinTrendingRoute.operationKey},${douyinCommentsRoute.operationKey},${douyinRepliesRoute.operationKey},${douyinTopicRoute.operationKey},${douyinFollowingRoute.operationKey},${douyinProfileRoute.operationKey},${douyinSearchRoute.operationKey},${douyinAccountPostsRoute.operationKey},${douyinDetailRoute.operationKey},${douyinSuggestRoute.operationKey},${douyinAccountSearchRoute.operationKey},${wechatArticlesRoute.operationKey},${wechatDetailRoute.operationKey},${wechatProfileRoute.operationKey},${wechatCommentsRoute.operationKey},${wechatRepliesRoute.operationKey},${wechatStatsRoute.operationKey},${toutiaoArticleRoute.operationKey},${toutiaoCommentsRoute.operationKey},${toutiaoProfileRoute.operationKey},${agentKeyXiaohongshuOperations[0].route.operationKey},${agentKeyXiaohongshuOperations[1].route.operationKey},${agentKeyXiaohongshuOperations[2].route.operationKey},${agentKeyXiaohongshuOperations[3].route.operationKey},${agentKeyXiaohongshuOperations[4].route.operationKey},${agentKeyXiaohongshuOperations[5].route.operationKey},${agentKeyXiaohongshuOperations[6].route.operationKey},${agentKeyXiaohongshuOperations[7].route.operationKey},${agentKeyXiaohongshuOperations[8].route.operationKey},${agentKeyBilibiliOperations[0]!.route.operationKey},${agentKeyBilibiliOperations[1]!.route.operationKey},${agentKeyBilibiliOperations[2]!.route.operationKey},${agentKeyBilibiliOperations[3]!.route.operationKey},${agentKeyBilibiliOperations[4]!.route.operationKey},${agentKeyBilibiliOperations[5]!.route.operationKey},${agentKeyBilibiliOperations[6]!.route.operationKey},${agentKeyBilibiliOperations[7]!.route.operationKey},${agentKeyBilibiliOperations[8]!.route.operationKey},${agentKeyBilibiliOperations[9]!.route.operationKey},${agentKeyBilibiliOperations[10]!.route.operationKey}) AND id > ${lastId} ORDER BY id LIMIT 200`;
  let requeued = 0, released = 0;
  for (const snapshot of rows) {
    try {
      const result = await sql.begin(async (tx) => {
        await lockRunAdmission(tx, [snapshot.id]);
        const { run, eligible } = await lockRun(tx, snapshot.id);
        if (!["active", "waiting"].includes(run.status)) return 0;
        // Local closeout precedes receipt recovery, even when outbound calls are disabled.
        if ((run.input.members.length || run.operation_key === SUBSCRIPTION_VIDEO_DOWNLOAD) && !eligible.length) {
          await tx`UPDATE operation_runs SET status = 'stopped', generation=generation+1, wait_reason = 'Execution configuration no longer eligible',
            next_attempt_at = NULL, updated_at = now() WHERE id = ${run.id}`;
          await releaseSubscriptions(tx, run.id);
          return 0;
        }
        if (await settleExpiredCommentTask(tx, run)) return 0;
        const [receipt] = run.current_receipt_id ? await tx`SELECT status FROM receipts WHERE id = ${run.current_receipt_id} FOR UPDATE` : [];
        if (receipt?.status === "unknown") {
          if (!isReadOnlyStep(run)) {
            await tx`UPDATE operation_runs SET status = 'needs_review', wait_reason = 'Request outcome unknown; retained receipt requires reconciliation',
              next_attempt_at = NULL, updated_at = now() WHERE id = ${run.id}`;
            return 0;
          }
          return outboundAllowed(run) ? { unknownReceiptId: run.current_receipt_id! } : 0;
        }
        if (receipt?.status === "pending") return 0;
        const [detail] = await tx`SELECT job_id, next_attempt_at, retry_count, limits FROM operation_runs WHERE id = ${run.id}`;
        const [job] = detail!.job_id ? await tx`SELECT state FROM pgboss.job WHERE id = ${detail!.job_id}` : [];
        if (job && ["created", "retry", "active"].includes(job.state)) return 0;
        if (detail!.next_attempt_at && detail!.next_attempt_at.getTime() > Date.now()) return 0;
        if (Number(detail!.retry_count) > Number(detail!.limits.retries ?? 3)) {
          await tx`UPDATE operation_runs SET status = 'needs_review', wait_reason = 'retry limit exhausted' WHERE id = ${run.id}`;
          return 0;
        }
        const receiptIds=[...new Set([...(run.current_receipt_id?[run.current_receipt_id]:[]),...(run.progress.retainedReceiptIds??[])])];
        const [localReceipt]=receiptIds.length?await tx`SELECT id FROM receipts WHERE id IN ${tx(receiptIds)}
          AND status IN ('received','completed') AND response IS NOT NULL LIMIT 1`:[];
        const local=!!localReceipt || await videoLocalRecovery(tx,run) || (["redfox.image.save","redfox.video.save","subscription.video.save"].includes(run.step_key) && typeof run.progress.expectedFileKey==="string" && await hasCompleteLocalFile(run.progress.expectedFileKey));
        if (!local && !outboundAllowed(run)) return 0;
        if (run.status === "waiting") await resumeRun(tx, { runId: run.id, stepVersion: run.step_version, generation: run.generation });
        return Number(!!await queueOperationStep(tx, run.id));
      });
      // Release locks before acquiring the complete shared-receipt member set.
      if (typeof result === "number") requeued += result;
      else {
        const recovered = await releaseOperationReceipt(result.unknownReceiptId);
        released += Number(recovered.released); requeued += recovered.requeued;
      }
    } catch (error) { if (!(error instanceof StaleOperationError)) throw error; }
  }
  const next=rows.length===200?rows[rows.length-1]!.id:0;
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('operations.recovery-cursor',${sql.json(next)},'operations.recovery') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
  return { requeued, released };
}

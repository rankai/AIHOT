import {videoResourcesFromHtml} from "../content/media.ts";
import type { Tx } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { createRun, type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { lockSubscription } from "./subscriptions.ts";
import { collectedVideoCandidates, frozenVideoManifest, videoResolver, type VideoManifest } from "./subscription-video-candidates.ts";
import { SUBSCRIPTION_VIDEO_DOWNLOAD, lockVideoDownloadOwners } from "./subscription-video-ownership.ts";

/** Manual imports must take the same subscription-before-source lock order as collectors. */
export async function lockVideoParentSubscriptions(tx:Tx,resultId:number) {
  const [parent]=await tx`SELECT r.input FROM operation_results z JOIN operation_runs r ON r.id=z.run_id WHERE z.id=${resultId}`;
  for(const id of [...new Set((parent?.input.members??[]).map((m:{subscriptionId:number})=>m.subscriptionId))].sort((a,b)=>Number(a)-Number(b)))await lockSubscription(tx,Number(id));
}

/** Importers call this only with their already-verified current work/media facts. */
export async function registerImportedVideo(tx:Tx,resultId:number,proof:{platform:string;operationId:string;record:unknown;confirmed:boolean;singleVideo:boolean;videoProof:string;mediaRole?:"own"|"quoted";manifest?:VideoManifest;html?:string;workId?:string;originalUrl?:string}) {
  if(!proof.confirmed&&!proof.html)return null;
  const [r]=await tx`SELECT z.article_id,z.source_id,z.receipt_id,z.run_id,a.identity_key,a.url,p.attempts,r.provider,r.input
    FROM operation_results z JOIN articles a ON a.id=z.article_id JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  if(!r||r.input.mode!=="collection")return null;
  const member=r.input.members.find((m:{sourceId:string|null})=>m.sourceId===r.source_id)??(r.input.members.length===1?r.input.members[0]:undefined);
  if(!member)return null;
  const resources=proof.html?videoResourcesFromHtml(proof.html,r.url):[];
  if(!proof.confirmed&&!resources.some(v=>v.length))return null;
  const singleVideo=resources.length?resources.length===1&&resources[0]!.length>0:proof.singleVideo;
  const manifest=proof.manifest??(resources.length?frozenVideoManifest(r.receipt_id,r.attempts,{record:proof.record,resources},resources.map(urls=>({candidates:urls.map(url=>({url,provider:r.provider,field:"owned-body.video",quality:"unknown" as const}))})),singleVideo):collectedVideoCandidates({provider:r.provider,platform:proof.platform,operationId:proof.operationId,record:proof.record,receiptId:r.receipt_id,attempt:r.attempts,singleVideo:proof.singleVideo}));
  try{return await registerSubscriptionVideo(tx,{parentRunId:r.run_id,parentResultId:resultId,articleId:r.article_id,sourceId:r.source_id,
    workId:proof.workId??(proof.platform==="x"&&r.identity_key.startsWith("x:")?r.identity_key.slice(2):r.identity_key),originalUrl:proof.originalUrl??r.url,platform:proof.platform,mediaRole:proof.mediaRole??"own",singleVideo,videoProof:proof.videoProof,manifest,subscriptionId:member.subscriptionId});}
  catch(cause){throw new Error("Subscription video registration failed",{cause});}
}

/** Only call after receipt-derived video/author proof and successful material import.
 * Parent result, material, intent and queue commit in the caller's one transaction. */
export async function registerSubscriptionVideo(tx: Tx, input: {
  parentRunId: number; parentResultId: number; articleId: string; sourceId: string;
  workId: string; originalUrl: string; platform: string; singleVideo: boolean; videoProof: string;
  manifest?: VideoManifest; subscriptionId?: number; mediaRole?:"own"|"quoted";
}): Promise<RunRow | null> {
  const [parent] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id=${input.parentRunId}`;
  if (!parent || parent.input.mode !== "collection") return null;
  const member=input.subscriptionId?parent.input.members.find(m=>m.subscriptionId===input.subscriptionId):parent.input.members.length===1?parent.input.members[0]:undefined;
  if(!member)return null;
  const sub = await lockSubscription(tx, member.subscriptionId);
  if (!sub.enabled || sub.config.autoDownloadVideo !== true || sub.execution_version !== member.executionVersion || sub.provider !== parent.provider) return null;
  const [result] = await tx`SELECT article_id,source_id,receipt_id,data,provenance FROM operation_results WHERE id=${input.parentResultId} AND run_id=${parent.id} FOR UPDATE`;
  if (!result || result.article_id !== input.articleId || result.source_id !== input.sourceId) throw new Error("Video registration requires the committed parent material association");
  const linkRun=async(id:number)=>{
    const first=result.provenance.videoDownloadRunId??id;
    const ids=[...new Set([...(result.provenance.videoDownloadRunIds??[]),first,id])];
    await tx`UPDATE operation_results SET provenance=provenance||${tx.json({videoDownloadRunId:first,videoDownloadRunIds:ids})} WHERE id=${input.parentResultId}`;
  };
  const commandKey = `subscription-video:${sha256(stableJson([sub.id,sub.execution_version,input.platform,input.workId]))}`;
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:subscription-video:${commandKey}`}))`;
  // Re-discovery must reuse the original frozen evidence, not hash a fresh result ID or signed URL.
  const [existing] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor='subscription-video' AND command_key=${commandKey}`;
  if (existing) {
    await linkRun(existing.id);
    return existing;
  }
  const [receipt]=await tx`SELECT attempts,status FROM receipts WHERE id=${result.receipt_id}`;
  if(!receipt||!["received","completed"].includes(receipt.status))throw new Error("Video registration requires retained receipt evidence");
  const manifest=input.manifest??frozenVideoManifest(result.receipt_id,receipt.attempts,result.data,input.singleVideo?[{candidates:[]}]:[],input.singleVideo);
  if(manifest.receiptId!==result.receipt_id||manifest.attempt!==receipt.attempts)throw new Error("Video manifest does not match the received source attempt");
  // Losing optional save eligibility must not roll back a valid import; registration errors still propagate.
  if(!await lockVideoDownloadOwners(tx,sub.id,input.articleId))return null;
  const run = await createRun(tx, { actor: "subscription-video", commandKey, provider: "local", operationKey: SUBSCRIPTION_VIDEO_DOWNLOAD,
    contractVersion: 1, subscriptionIds: [sub.id], stepKey: manifest.targets.some(t=>t.candidates.length)?"subscription.video.save":"subscription.video.resolve", limits: { retries: 1 }, input: {
      ...input, manifest, collector: parent.provider, sourceReceiptId: result.receipt_id,
      resolver: videoResolver(input.platform),
    } });
  await queueOperationStep(tx, run.id);
  await linkRun(run.id);
  return run;
}

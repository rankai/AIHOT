import {lockVideoParentSubscriptions,registerImportedVideo} from "../../sources/subscription-video.ts";
import {videoMediaFromHtml} from "../../content/media.ts";
import {redfoxToutiaoHasVideo} from "./video-media.ts";
import {confirmedVideoMedia} from "../../content/media.ts";
import {agentKeyToutiaoEvidence} from "../agentkey/toutiao-evidence.ts";
import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectionDiscoveredAt } from "./collection-page-proof.ts";
import { z } from "zod";
import { sql,type Tx } from "../../db.ts";
import { sha256, stableJson } from "../../lib/ids.ts";
import { toutiaoWorkId } from "../../lib/url.ts";
import { stripTags } from "../../lib/text.ts";
import { audit } from "../../admin/auth.ts";
import { bindSourceAccount } from "../../sources/account-bindings.ts";
import { decideTimeline, upsertMaterial, type MediaItem } from "../../content/materials.ts";
import { sanitizeBody } from "../../content/sanitize.ts";
import { queueProcessing } from "../../jobs/content.ts";
import { StaleOperationError } from "../operations/store.ts";
import { UnsupportedReplacement } from "../../sources/x-replacement.ts";
import { parseToutiao, ToutiaoOrigin } from "./toutiao.ts";
import { ToutiaoOperationId, toutiaoOperations, type ToutiaoOperation } from "./toutiao-contract.ts";

type ToutiaoIdentity = { uid?: string; secUid?: string };
const Input = z.object({
  sourceId: z.string().min(1).optional(), reason: z.string().trim().min(1).max(500),
  supplement: z.object({
    uid: z.string().regex(/^[0-9]+$/).optional(), secUid: z.string().min(1).max(500).optional(),
    url: z.url().refine(v => !!toutiaoWorkId(v), "A documented native Toutiao work permalink is required").optional(),
    evidence: z.string().trim().min(1).max(1000),
  }).strict().optional(),
}).strict();
function media(record: Record<string, unknown>): MediaItem[] {
  const safe = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
  };
  return [...(Array.isArray(record.imageList) ? record.imageList.filter(safe).map(url => ({ kind: "image" as const, url })) : []),
    ...(Array.isArray(record.downloadUrl) ? record.downloadUrl.filter(safe).map(url => ({ kind: "video" as const, url })) : [])];
}
function publicationTime(op: ToutiaoOperation, record: Record<string, unknown>): Date | null {
  const raw = record.publishTime;
  if (typeof raw !== "string") return null;
  if (op === "28CFGF5I" && /^-?[0-9]+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds)) return null;
    const date = new Date(seconds * 1000); return Number.isFinite(date.getTime()) ? date : null;
  }
  if (!z.iso.datetime({ offset: true }).safeParse(raw).success) return null;
  const date = new Date(raw); return Number.isFinite(date.getTime()) ? date : null;
}
export async function importToutiaoResult(resultId: number, raw: unknown, actor: string, key: unknown, db?:Tx) {
  const commandKey = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key), input = Input.parse(raw);
  const execute=async(tx:Tx)=>{
    const [snapshot] = await tx`SELECT z.*,r.provider,r.operation_key,r.step_key,r.contract_version,r.input,p.logical_key AS receipt_logical_key,p.request AS receipt_request,p.service AS receipt_service,p.purpose AS receipt_purpose,p.subject AS receipt_subject,p.response AS receipt_response,p.received_at,p.model AS receipt_model,p.status AS receipt_status
      FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
    if (!snapshot) return null;
    await lockVideoParentSubscriptions(tx,resultId);
    const agentkey=snapshot.provider==="agentkey";
    if(agentkey&&input.supplement&&(input.supplement.uid||input.supplement.secUid||input.supplement.url))throw new UnsupportedReplacement("AgentKey requires received identity and native URL; manual supplements cannot replace evidence");
    const verified=agentkey?await agentKeyToutiaoEvidence(tx,snapshot):null;
    const operation = ToutiaoOperationId.safeParse(snapshot.input.operationId);
    if (!verified && (!operation.success || snapshot.provider !== "redfox" || !["redfox.sync.query","redfox.platform.collection"].includes(snapshot.operation_key) || snapshot.receipt_model !== operation.data || !["received", "completed"].includes(snapshot.receipt_status) || snapshot.data.platform !== "toutiao" || snapshot.data.operationId !== operation.data)) throw new UnsupportedReplacement("Not a confirmed Toutiao result");
    const sourceDiscoveredAt=verified?.sourceDiscoveredAt??await collectionDiscoveredAt(tx,snapshot,"toutiao",operation.data!);
    if (!["toutiao_account", "toutiao_work"].includes(snapshot.kind)) throw new UnsupportedReplacement("Toutiao query summaries are not importable accounts or works");
    const op = operation.data!, parameters = agentkey?{}:toutiaoOperations[op].schema.parse(snapshot.input.parameters);
    const origin = snapshot.input.origin === undefined ? undefined : ToutiaoOrigin.parse(snapshot.input.origin);
    const payload = op === "28CFGF5I" ? [snapshot.data.record] : op === "4QS1F8DE" ? { list: [snapshot.data.record] } : op === "R1IGR09H" ? { workList: [snapshot.data.record] } : snapshot.data.record;
    const parsed = verified?.parsed??parseToutiao(op, payload, parameters, origin)[0];
    if (!parsed || parsed.kind !== snapshot.kind) throw new UnsupportedReplacement("Result kind does not match its received operation record");
    const account = parsed.kind === "toutiao_account", record = parsed.data.record as Record<string, unknown>;
    const received = parsed.data.identity as ToutiaoIdentity, identity: ToutiaoIdentity = { ...received };
    if (account && input.supplement) throw new UnsupportedReplacement("Account import requires received uid; manual account IDs are not accepted");
    for (const kind of ["uid", "secUid"] as const) {
      const extra = input.supplement?.[kind];
      if (extra && received[kind] && extra !== received[kind]) throw new StaleOperationError("Received stable identity cannot be replaced");
      if (extra) identity[kind] = extra;
    }
    const receivedUrl = op === "28CFGF5I" ? record.opusUrl : record.workUrl;
    if (!account && receivedUrl && input.supplement?.url && receivedUrl !== input.supplement.url) throw new StaleOperationError("Received original URL cannot be replaced");
    const url = typeof parsed.data.url === "string" ? parsed.data.url : input.supplement?.url;
    const nativeId = url ? toutiaoWorkId(url) : null;
    if (!account && (!nativeId || !url)) throw new UnsupportedReplacement("A documented native Toutiao work permalink is required");
    if (!account && parsed.data.workId && parsed.data.workId !== nativeId) throw new StaleOperationError("Received work ID differs from its native original URL");
    if (!account && op === "PAB6Z75Y" && nativeId !== (agentkey?snapshot.input.parameters.group_id:snapshot.input.parameters.opusId)) throw new StaleOperationError("Original URL differs from requested Toutiao work ID");
    const ids = Object.entries(identity).sort(([a], [b]) => a.localeCompare(b));
    if (!ids.length) throw new UnsupportedReplacement("A verified uid or secUid is required; display names and request tokens are not author evidence");
    for (const [kind, value] of ids) await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`toutiao:${kind}:${value}`},0))`;
    const owners: string[] = [];
    for (const [kind, value] of ids) {
      const [binding] = await tx`SELECT source_id FROM source_account_bindings WHERE platform='toutiao' AND id_kind=${kind} AND id_value=${value}`;
      if (binding) owners.push(binding.source_id);
    }
    if (new Set(owners).size > 1) throw new StaleOperationError("Account IDs belong to different sources");
    const primary = identity.uid ? `uid:${identity.uid}` : `secUid:${identity.secUid}`;
    const sourceId = input.sourceId ?? owners[0] ?? `toutiao-${sha256(primary).slice(0,24)}`;
    if (owners.length && owners[0] !== sourceId) throw new StaleOperationError("Account identity already belongs to another source");
    let [source] = await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if (!source && input.sourceId) return null;
    if (source && source.kind !== "external") throw new UnsupportedReplacement("Toutiao accounts require an external source");
    // An explicit new cross-kind association requires human evidence and an isolated target.
    const manualTarget = !account && !!input.sourceId && owners[0] !== input.sourceId;
    if (manualTarget && (source!.participation_mode !== "isolated" || !input.supplement?.evidence)) throw new UnsupportedReplacement("An unbound author can only be confirmed against an isolated source with evidence");
    if (source && source.participation_mode !== "isolated" && ids.some(([kind]) => !received[kind as keyof ToutiaoIdentity])) throw new UnsupportedReplacement("Manual identity cannot inherit publication permissions");
    const prior = await tx`SELECT id_kind,id_value FROM source_account_bindings WHERE platform='toutiao' AND source_id=${sourceId}`;
    if (prior.some(b => identity[b.id_kind as keyof ToutiaoIdentity] && identity[b.id_kind as keyof ToutiaoIdentity] !== b.id_value)) throw new StaleOperationError("Source already has another identity of this type");
    const [result] = await tx`SELECT * FROM operation_results WHERE id=${resultId} FOR UPDATE`;
    requireLiveResult(result,snapshot.kind);
    const intent = { sourceId: input.sourceId ?? null, supplement: input.supplement ?? null }, previous = result!.provenance?.toutiaoImport;
    if (previous?.key === commandKey && stableJson(previous.intent) !== stableJson(intent)) throw new StaleOperationError("Import key reused with different input");
    if (result!.source_id || result!.article_id) {
      if (result!.source_id !== sourceId || (previous && stableJson(previous.intent) !== stableJson(intent))) throw new StaleOperationError("Result already imported with different target or evidence");
      return { resultId, sourceId, articleId: result!.article_id };
    }
    if (!source) {
      const name = String(record.nickname ?? record.authorName ?? `Toutiao ${primary}`).slice(0,200);
      [source] = await tx`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,syndicate_fulltext,enabled,next_fetch_at)
        VALUES (${sourceId},${name},'external',${tx.json({ platform: "toutiao" })},'isolated',false,false,true,NULL) RETURNING *`;
    }
    if (!account && !source!.enabled) throw new UnsupportedReplacement("Author source is disabled; material import is paused");
    for (const [idKind, idValue] of ids) await bindSourceAccount(tx, { platform: "toutiao", idKind, idValue, sourceId, evidence: { kind: "result", reference: String(resultId) } });
    let articleId: string | null = null;
    if (!account) {
      const bodyMedia=op==="PAB6Z75Y"&&typeof record.content==="string"?videoMediaFromHtml(record.content,url!):[];
      const bodyHtml = op === "PAB6Z75Y" && typeof record.content === "string" ? sanitizeBody(record.content, url!) : null;
      const bodyText = bodyHtml ? stripTags(bodyHtml) : null;
      const publishedAt = publicationTime(op, record), discoveredAt = new Date(origin?.discoveredAt ?? sourceDiscoveredAt);
      const backfill = decideTimeline(publishedAt, discoveredAt).publishedAt ? null : `${snapshot.provider}-import-unknown-time`;
      const material = await upsertMaterial({ sourceId, url: url!, identityKey: `toutiao:workId:${nativeId}`, title: String(parsed.data.title),
        author: typeof record.nickname === "string" ? record.nickname : typeof record.authorName === "string" ? record.authorName : null,
        bodyHtml: bodyText ? bodyHtml : null, bodyText, bodyStatus: bodyText ? "ok" : "pending", publishedAt, discoveredAt, backfill, media: [...bodyMedia,...(!agentkey&&redfoxToutiaoHasVideo(op,record)?confirmedVideoMedia(media(record)):media(record))], via: "import",
        raw: { provider: snapshot.provider, resultId, publishTime: record.publishTime ?? null, updateTime: record.updateTime ?? null, originResultId: origin?.resultId ?? null, request: snapshot.input.parameters, supplement: input.supplement ?? null } }, tx);
      articleId = material.articleId;
      if (material.created || material.revised) await queueProcessing(articleId, { db: tx });
    }
    await tx`UPDATE operation_results SET source_id=${sourceId},article_id=${articleId},provenance=provenance||${tx.json({ toutiaoImport: { key: commandKey, intent } })} WHERE id=${resultId}`;
    if(articleId){const videoHtml=op==="PAB6Z75Y"?record.content:undefined;await registerImportedVideo(tx,resultId,{platform:"toutiao",operationId:String(parsed.data.operationId),record,confirmed:(!agentkey&&redfoxToutiaoHasVideo(op,record)),singleVideo:false,videoProof:"verified-current-work-or-owned-body",...(typeof videoHtml==="string"?{html:videoHtml}:{})});}
    await audit(actor, account ? "source.bind_account" : "material.import", `result:${resultId}`, input.reason, null, { sourceId, articleId, identity, supplement: input.supplement ?? null }, undefined, tx);
    return { resultId, sourceId, articleId };
  };
  return db?execute(db):sql.begin(execute);
}

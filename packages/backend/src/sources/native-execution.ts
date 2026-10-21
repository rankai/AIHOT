import {recordCollectionFailure} from "./collection-health.ts";
import { settleUnknownReceipt } from "../providers/operations/recovery.ts";
// One native external request per job. Raw responses, material writes and continuation are distinct boundaries.
import { sql, type Tx } from "../db.ts";
import { upsertMaterial } from "../content/materials.ts";
import { queueProcessing } from "../jobs/content.ts";
import { searchTweets, type SdTweet } from "../providers/socialdata.ts";
import { mpHistory, mpArticle, type MpPost, type MpArticle } from "../providers/dajiala.ts";
import { BudgetExceededError, ProviderRejectedError, ReceiptBusyError, type PaidRequestOptions } from "../providers/receipts.ts";
import { advanceRun, claimRun, requireExecution, receiptOptions, retainCurrentReceipt, saveResult, setRunState, StaleOperationError, type Execution, type RunRow, type OperationProgress } from "../providers/operations/store.ts";
import { eligibleMembers } from "./subscriptions.ts";
import { type NativeSourceInput } from "./native-commands.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { tweetToCandidate, type XBacklog } from "./x.ts";
import type { SourceRow } from "./types.ts";
import { noiseFiltered, rewriteUrl } from "./collect.ts";
import { allowed } from "./web-list.ts";
import { shardHandle } from "./x.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { stripTags } from "../lib/text.ts";

interface NativeInput {
  xPlan?: { query: string; lastId: string; backlog: XBacklog[]; batch: boolean; intervalMinutes: number };
  mode: "collection" | "preview"; sources: NativeSourceInput[]; window: string; startedAt: string; subject: string;
}
interface XProgress extends OperationProgress {
  query: string; cursor: string | null; lastId: string | null; backlog: XBacklog[];
  phase: "main" | "backlog"; pages: number; backlogPages: number; dropped: number;
}
interface MpProgress extends OperationProgress { pageReceiptId: number; indices: number[]; index: number }
class OutboundDisabledError extends Error {}
function options(execution: Execution): PaidRequestOptions {
  const base = receiptOptions(execution);
  return { ...base, onReceipt: async (tx, id, info) => {
    if (info.kind === "call" && process.env.COLLECT_ENABLED === "false") throw new OutboundDisabledError("Collection outbound calls are disabled");
    await base.onReceipt!(tx, id, info);
  } };
}
function inputOf(run: RunRow): NativeInput { return run.input as unknown as NativeInput; }

async function finish(tx: Tx, execution: Execution, run: RunRow, cursor: Record<string, unknown>) {
  const members = await eligibleMembers(tx, run.id, run.input.members, run.input.forceSourceId);
  for (const member of members) {
    const frozen = inputOf(run).sources.find((s) => s.id === member.sourceId)!;
    const original = frozen.cursor;
    const plannedInterval = inputOf(run).xPlan?.intervalMinutes;
    if (plannedInterval) await tx`UPDATE collection_subscriptions SET interval_minutes = ${plannedInterval}
      WHERE id = ${member.subscriptionId} AND active_run_id = ${run.id} AND interval_minutes = ${frozen.interval_minutes}`;
    const nextCursor = { ...original, ...cursor };
    if (original?.initializedAt) nextCursor.initializedAt = original.initializedAt;
    if (original?.lastTweetId && nextCursor.lastTweetId && BigInt(original.lastTweetId) > BigInt(String(nextCursor.lastTweetId))) nextCursor.lastTweetId = original.lastTweetId;
    await tx`UPDATE collection_subscriptions SET progress = ${tx.json(nextCursor as never)}, next_run_at = now() + make_interval(mins => interval_minutes), updated_at = now()
      WHERE id = ${member.subscriptionId} AND active_run_id = ${run.id}`;
    if (member.sourceId) await tx`UPDATE sources SET last_fetch_at = now(), last_ok_at = now(), fail_count = 0, last_error = NULL, health = 'ok' WHERE id = ${member.sourceId}`;
  }
  await advanceRun(tx, execution, null);
}
async function continueAt(tx: Tx, execution: Execution, stepKey: string, progress: OperationProgress) {
  await advanceRun(tx, execution, { stepKey, progress });
  await queueOperationStep(tx, execution.runId);
}

function initialX(input: NativeInput): XProgress {
  const source = input.sources[0]!;
  const lastId = input.xPlan?.lastId ?? source.cursor?.lastTweetId ?? null;
  return { query: `${input.xPlan?.query ?? source.config.query}${lastId ? ` since_id:${lastId}` : ""}`, cursor: null, lastId,
    backlog: input.xPlan ? structuredClone(input.xPlan.backlog) : Array.isArray(source.cursor?.xBacklog) ? structuredClone(source.cursor.xBacklog) : [], phase: "main", pages: 0, backlogPages: 0, dropped: 0 };
}
async function xPage(execution: Execution, snapshot: RunRow) {
  const input = inputOf(snapshot), source = input.sources[0]!;
  const progress = snapshot.progress.query ? snapshot.progress as XProgress : initialX(input);
  let page: Awaited<ReturnType<typeof searchTweets>>;
  try { page = await searchTweets(progress.query, { purpose: "source_fetch", subject: input.subject, window: input.window,
    type: source.config.searchType ?? "Latest", cursor: progress.cursor, paid: options(execution) }); }
  catch (error) {
    if (progress.phase !== "backlog" || !(error instanceof ProviderRejectedError) || ![400,422].includes(error.status ?? 0)) throw error;
    await sql.begin(async (tx) => {
      const run = await requireExecution(tx, execution);
      await saveResult(tx, execution, { itemKey: "expired-backlog", kind: "control", data: { dropped: progress.backlog[0] }, receiptId: run.current_receipt_id! });
      const [receipt] = await tx`SELECT status FROM receipts WHERE id = ${run.current_receipt_id} FOR UPDATE`;
      if (receipt?.status !== "failed") throw new Error("Backlog rejection is not definitive");
      await tx`UPDATE operation_runs SET current_receipt_id = NULL WHERE id = ${run.id}`;
      const next = structuredClone(progress); next.backlog.shift(); next.dropped++;
      if (next.backlog.length) {
        next.query = next.backlog[0]!.query; next.cursor = next.backlog[0]!.next;
        await continueAt(tx, execution, "x.page", next);
      } else await finish(tx, execution, run, { ...source.cursor, lastOkAt: new Date().toISOString(), lastTweetId: next.lastId, xBacklog: [] });
    });
    return;
  }
  await sql.begin(async (tx) => {
    const run = await requireExecution(tx, execution);
    const next = structuredClone(progress);
    const tweets = page.tweets.filter((t) => !t.retweeted_status);
    for (const tweet of tweets) {
      if (!next.lastId || BigInt(tweet.id_str) > BigInt(next.lastId)) next.lastId = tweet.id_str;
    }
    const eligible = await eligibleMembers(tx, run.id, run.input.members, run.input.forceSourceId);
    for (const memberSource of input.sources) {
      if (input.mode === "collection" && !eligible.some((m) => m.sourceId === memberSource.id)) continue;
      let candidates = (input.xPlan?.batch ? tweets.filter((t) => t.user.screen_name.toLowerCase() === shardHandle(memberSource)?.toLowerCase()) : tweets).map(tweetToCandidate);
      candidates = candidates.filter((c) => allowed(c.url, memberSource as SourceRow)).map((c) => rewriteUrl(c, memberSource)).filter((c) => !noiseFiltered(c, memberSource));
      if (!memberSource.cursor?.initializedAt) {
        const cutoff = Date.parse(input.startedAt) - Number(memberSource.config._aihot?.initialBackfillMonths ?? 12) * 30 * 86400000;
        candidates = candidates.filter((c) => !c.publishedAt || c.publishedAt.getTime() >= cutoff).slice(0, Number(memberSource.config._aihot?.initialBackfillLimit ?? 30));
      }
      for (const candidate of candidates) {
        const result = input.mode === "collection" ? await upsertMaterial({ ...candidate, sourceId: memberSource.id, via: "fetch", discoveredAt: new Date(input.startedAt), backfill: !memberSource.cursor?.initializedAt ? "first-import" : null }, tx) : null;
        await saveResult(tx, execution, { itemKey: `${memberSource.id}:${candidate.identityKey}`, kind: "article", data: input.mode === "preview" ? candidate as unknown as Record<string, unknown> : {},
          receiptId: page.receiptId, ...(result ? { articleId: result.articleId, sourceId: memberSource.id } : {}) });
        if (result && (result.created || result.revised)) await queueProcessing(result.articleId, { db: tx });
      }
    }
    await saveResult(tx, execution, { itemKey: "page", kind: "page", data: { found: tweets.length }, receiptId: page.receiptId });
    if (next.phase === "main") {
      next.pages++;
      if ((input.xPlan?.lastId || source.cursor?.lastTweetId) && page.nextCursor && page.tweets.length && next.pages < 10) {
        next.cursor = page.nextCursor;
        await continueAt(tx, execution, "x.page", next); return;
      }
      if ((input.xPlan?.lastId || source.cursor?.lastTweetId) && page.nextCursor && page.tweets.length && next.pages >= 10) next.backlog.push({ query: next.query, next: page.nextCursor });
      while (next.backlog.length > 5) { next.backlog.shift(); next.dropped++; }
    } else {
      next.backlogPages++;
      if (!page.nextCursor || !page.tweets.length) next.backlog.shift();
      else next.backlog[0]!.next = page.nextCursor;
    }
    if (next.backlog.length && next.backlogPages < 10) {
      next.phase = "backlog"; next.query = next.backlog[0]!.query; next.cursor = next.backlog[0]!.next;
      await continueAt(tx, execution, "x.page", next); return;
    }
    const cursor = { ...source.cursor, initializedAt: source.cursor?.initializedAt ?? input.startedAt, lastOkAt: new Date().toISOString(), lastTweetId: next.lastId, xBacklog: next.backlog };
    await finish(tx, execution, run, cursor);
  });
}

async function mpList(execution: Execution, snapshot: RunRow) {
  const input = inputOf(snapshot), source = input.sources[0]!;
  const ghid = source.config.ghid ?? source.config.wxid;
  if (!ghid) throw new Error("MP account identity missing");
  const page = await mpHistory(ghid, { subject: input.subject, window: input.window, paid: options(execution) });
  await sql.begin(async (tx) => {
    await requireExecution(tx, execution);
    const indices: number[] = [];
    for (const { post, index } of page.posts.map((post, index) => ({ post, index })).sort((a, b) => b.post.post_time - a.post.post_time)) {
      if (!post.url || !post.title || indices.length >= 8) continue;
      if (!source.cursor?.lastCheckedAt && post.post_time && Date.parse(input.startedAt) - post.post_time * 1000 > 7 * 86400000) continue;
      const [known] = await tx`SELECT body_status, discovered_at, raw->'dajiala'->'bodyRetry' AS retry FROM articles WHERE identity_key = ${identityKeyForUrl(post.url)}`;
      if (known && !(known.retry && known.body_status === "none" && known.retry.attempts < 3 && Date.parse(input.startedAt) - known.discovered_at.getTime() < 3 * 86400000)) continue;
      indices.push(index);
    }
    if (!indices.length) {
      await saveResult(tx, execution, { itemKey: "page", kind: "page", data: { count: page.posts.length }, receiptId: page.receiptId });
      await finish(tx, execution, snapshot, mpCursor(input, page.posts, page.remainMoney));
      return;
    }
    await retainCurrentReceipt(tx, execution, { pageReceiptId: page.receiptId, indices, index: 0 });
    const [retained] = await tx<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${execution.runId}`;
    await continueAt(tx, execution, "mp.body", retained!.progress);
  });
}
function mpCursor(input: NativeInput, posts: MpPost[], remainMoney: number | null) {
  return { ...input.sources[0]!.cursor, lastCheckedAt: new Date().toISOString(), lastPostTime: Math.max(0, ...posts.map((p) => p.post_time)) || input.sources[0]!.cursor?.lastPostTime || null, remainMoney };
}
async function mpBody(execution: Execution, snapshot: RunRow) {
  const input = inputOf(snapshot), source = input.sources[0]!, progress = snapshot.progress as MpProgress;
  const [page] = await sql`SELECT response FROM receipts WHERE id = ${progress.pageReceiptId}`;
  if (!Array.isArray(page?.response?.data)) throw new Error("Retained MP page is unavailable");
  const posts = page.response.data as MpPost[], post = posts[progress.indices[progress.index]!]!;
  let body: MpArticle | null = null;
  let rejection: ProviderRejectedError | null = null;
  try { body = await mpArticle(post.url, { subject: input.subject, identity: post.sn ?? post.url, paid: options(execution) }); }
  catch (error) { if (!(error instanceof ProviderRejectedError)) throw error; rejection = error; }
  await sql.begin(async (tx) => {
    const run = await requireExecution(tx, execution);
    const failedReceipt = run.current_receipt_id;
    const effectiveBody = body ?? { title: post.title, content: "", author: null, desc: null, pubtime: null, receiptId: failedReceipt! };
    await saveMpMaterial(tx, execution, input, source, post, effectiveBody, rejection?.retryable ? rejection.message : null);
    if (rejection) {
      const [receipt] = await tx`SELECT status FROM receipts WHERE id = ${failedReceipt} FOR UPDATE`;
      if (receipt?.status !== "failed") throw new Error("Only explicitly rejected requests can finish without a response");
      await tx`UPDATE operation_runs SET current_receipt_id = NULL WHERE id = ${run.id}`;
    }
    const next = { ...progress, index: progress.index + 1 };
    if (next.index < next.indices.length) { await continueAt(tx, execution, "mp.body", next); return; }
    await saveResult(tx, execution, { itemKey: "page", kind: "page", data: { count: posts.length }, receiptId: progress.pageReceiptId });
    await finish(tx, execution, run, mpCursor(input, posts, page.response.remain_money ?? null));
  });
}
async function saveMpMaterial(tx: Tx, execution: Execution, input: NativeInput, source: NativeSourceInput, post: MpPost, body: MpArticle, passing: string | null = null) {
  const text = body.content ? stripTags(body.content.replace(/<\/p>|<br\s*\/?>/gi, "\n")).replace(/\n{3,}/g, "\n\n").trim() : null;
  const [known] = await tx`SELECT id, source_id, raw->'dajiala'->'bodyRetry' AS retry FROM articles WHERE identity_key = ${identityKeyForUrl(post.url)} FOR UPDATE`;
  if (known?.source_id === source.id && !body.content) {
    await tx`UPDATE articles SET raw = ${passing ? tx`jsonb_set(raw, '{dajiala,bodyRetry}', ${tx.json({ attempts: Number(known.retry?.attempts ?? 0) + 1, error: passing })})` : tx`raw #- '{dajiala,bodyRetry}'`} WHERE id = ${known.id}`;
    await saveResult(tx, execution, { itemKey: identityKeyForUrl(post.url) ?? post.url, kind: "article", data: { bodyMissing: true }, receiptId: body.receiptId, articleId: known.id, sourceId: source.id });
    return;
  }
  const result = await upsertMaterial({ sourceId: source.id, url: post.url, title: post.title, author: body.author,
    language: "zh", publishedAt: post.post_time ? new Date(post.post_time * 1000) : null, discoveredAt: new Date(input.startedAt),
    excerpt: post.digest ?? body.desc, bodyHtml: body.content ? sanitizeBody(body.content, post.url) : null, bodyText: text,
    bodyStatus: text ? "ok" : "none", via: "fetch", backfill: !source.cursor?.lastCheckedAt ? "first-import" : null,
    raw: { dajiala: { position: post.position, sn: post.sn ?? null, original: post.original ?? null, itemShowType: post.item_show_type ?? null, cover: post.cover_url ?? null, ...(passing ? { bodyRetry: { attempts: 1, error: passing } } : {}) } },
  }, tx);
  if (body.content) await tx`UPDATE articles SET raw = raw #- '{dajiala,bodyRetry}' WHERE id = ${result.articleId} AND source_id = ${source.id}`;
  await saveResult(tx, execution, { itemKey: identityKeyForUrl(post.url) ?? post.url, kind: "article", data: {}, receiptId: body.receiptId, articleId: result.articleId, sourceId: source.id });
  if (result.created || result.revised) await queueProcessing(result.articleId, { db: tx });
}

export async function executeNativeStep(runId: number, stepVersion: number, jobId: string) {
  const [snapshot] = await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id = ${runId}`;
  if (!snapshot || snapshot.status !== "active" || snapshot.step_version !== stepVersion) return { skipped: true };
  let execution: Execution;
  try { execution = await sql.begin((tx) => claimRun(tx, { runId, stepVersion, generation: snapshot.generation }, jobId)); }
  catch (error) { if (error instanceof StaleOperationError) return { skipped: true }; throw error; }
  try {
    const [limits] = await sql`SELECT limits FROM operation_runs WHERE id = ${runId}`;
    if (stepVersion > Number(limits!.limits.steps ?? 24)) throw new Error("Operation step limit exhausted");
    if (snapshot.step_key === "x.page") await xPage(execution, snapshot);
    else if (snapshot.step_key === "mp.list") await mpList(execution, snapshot);
    else if (snapshot.step_key === "mp.body") await mpBody(execution, snapshot);
    else throw new Error("Unsupported native operation step");
    return { runId, stepVersion };
  } catch (error) {
    if (error instanceof StaleOperationError) return { skipped: true };
    await sql.begin(async (tx) => {
      let current: RunRow;
      try { current = await requireExecution(tx, execution); } catch (e) { if (e instanceof StaleOperationError) return; throw e; }
      const unknown = await settleUnknownReceipt(tx, execution, current);
      const recoverable = error instanceof BudgetExceededError || error instanceof ReceiptBusyError || error instanceof OutboundDisabledError || (error instanceof ProviderRejectedError && error.retryable);
      const delay = error instanceof BudgetExceededError ? error.retryAfterSeconds * 1000 : 60_000;
      if (!unknown) await setRunState(tx, execution, recoverable ? "waiting" : "needs_review", String(error).slice(0, 500), recoverable ? new Date(Date.now() + delay) : null);
      if (error instanceof ProviderRejectedError && error.retryable)
        await tx`UPDATE operation_runs SET retry_count = retry_count + 1 WHERE id = ${runId}`;
      if(error instanceof ProviderRejectedError&&!error.retryable)await recordCollectionFailure(tx,current,String(error));
    });
    return { runId, error: String(error) };
  }
}

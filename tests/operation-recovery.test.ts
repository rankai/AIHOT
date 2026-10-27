import { tag, gate, assertConfiguredTestDatabase } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { getBoss, stopBoss, QUEUES } from '@aihot/backend/jobs/queue';
import { createImageGeneration } from '@aihot/backend/providers/redfox/images';
import { executeOperationStep } from '@aihot/backend/providers/operations/execute';
import { recoverOperations } from '@aihot/backend/providers/operations/recovery';
import { operationDetail } from '@aihot/backend/providers/operations/read';
import { abandonRun, receiptOptions, requireExecution } from '@aihot/backend/providers/operations/store';
import { paidRequest, markStalePendingReceipts } from '@aihot/backend/providers/receipts';
import { createNativeSubscription } from '@aihot/backend/sources/native-migration';
import { createNativeBatch, createNativeCollection } from '@aihot/backend/sources/native-commands';
import { createCollection } from '@aihot/backend/sources/collection-commands';
import { preflightXReplacement, switchXCollection } from '@aihot/backend/sources/x-replacement';

const actor = `recovery-${tag()}`, sources: string[] = [];
const row = async (id: number) => (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
let hits = 0, started = gate();
const server = http.createServer((req) => {
  req.resume(); req.on('end', () => { hits++; started.open(); }); // Deliberately never return a response.
});
let budgets: Array<{ service: string; per_minute: number; per_hour: number; per_day: number }> = [];
let cursor: unknown;
before(async () => {
  const [db] = await sql`SELECT current_database() AS name`;
  assertConfiguredTestDatabase(db!.name);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.REDFOX_TEST_BASE_URL = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  process.env.REDFOX_API_KEY = 'synthetic-recovery';
  process.env.SOCIALDATA_API_KEY = 'synthetic-recovery';
  process.env.REDFOX_CALLS_ENABLED = 'true'; process.env.MODEL_CALLS_ENABLED = 'true';
  process.env.COLLECT_ENABLED = 'true'; config.allowPrivateNetworkFetch = true;
  budgets = await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('redfox.image','socialdata')`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.image','socialdata')`;
  cursor = (await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`)[0]?.value;
});
after(async () => {
  for (const {id} of await sql`SELECT id FROM operation_runs WHERE actor=${actor}`) {
    const r = await row(id);
    if (!['failed','completed'].includes(r.status)) await sql.begin(tx => abandonRun(tx, {runId:id,stepVersion:r.step_version,generation:r.generation}, 'synthetic cleanup'));
  }
  const jobs = await sql`SELECT id FROM pgboss.job WHERE name=${QUEUES.operation} AND data->>'runId' IN (SELECT id::text FROM operation_runs WHERE actor=${actor}) AND state IN ('created','retry','active')`;
  for (const job of jobs) await (await getBoss()).cancel(QUEUES.operation,job.id);
  if (sources.length) {
    await sql`UPDATE collection_subscriptions SET enabled=false WHERE control_source_id IN ${sql(sources)}`;
    await sql`UPDATE sources SET enabled=false WHERE id IN ${sql(sources)}`;
  }
  for (const b of budgets) await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;
  if (cursor === undefined) await sql`DELETE FROM settings WHERE key='operations.recovery-cursor'`;
  else await sql`UPDATE settings SET value=${sql.json(cursor as never)} WHERE key='operations.recovery-cursor'`;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await stopBoss(); await closeDb();
});
async function recoverFrom(id: number) {
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('operations.recovery-cursor',${sql.json(id-1)},${actor}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  return recoverOperations();
}
async function fetchJob(id: number) {
  const r = await row(id), boss = await getBoss();
  await sql`UPDATE pgboss.job SET priority=2000000000,start_after=now()-interval '1 second' WHERE id=${r.job_id}`;
  const jobs = await boss.fetch<{runId:number;stepVersion:number}>(QUEUES.operation, {minPriority:2000000000});
  assert.equal(jobs.length,1); assert.equal(jobs[0]!.id,r.job_id);
  return jobs[0]!;
}

test('killed submit is retried while pending, then stale unknown settles locally with outbound disabled', async () => {
  const run = await createImageGeneration({prompt:'Synthetic recovery',resolution:'1k',size:'1:1',n:1,fileKeys:[]},actor,tag());
  const job = await fetchJob(run.id), beforeHits = hits;
  started = gate();
  const child = spawn(process.execPath, ['--input-type=module','--eval', `
    import {config} from '@aihot/backend/config';
    import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
    config.allowPrivateNetworkFetch=true;
    await executeOperationStep(${run.id},${job.data.stepVersion},${JSON.stringify(job.id)});
  `], {cwd:process.cwd(),env:{...process.env},stdio:['ignore','ignore','pipe']});
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = once(child,'exit');
  try {
    await Promise.race([started.promise, exit.then(() => {throw new Error(`Child exited before dispatch: ${stderr}`);})]);
    const dispatched = await row(run.id);
    assert.ok(dispatched.current_receipt_id);
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${dispatched.current_receipt_id}`)[0]!.status,'pending');
    child.kill('SIGKILL'); await exit;
    const boss = await getBoss();
    await boss.fail(QUEUES.operation,job.id,{message:'Synthetic worker killed after dispatch'});
    const retry = await fetchJob(run.id);
    await executeOperationStep(run.id,retry.data.stepVersion,retry.id); await boss.complete(QUEUES.operation,retry.id);
    const waiting = await row(run.id);
    assert.equal(waiting.status,'waiting'); assert.match(waiting.wait_reason,/in flight/);
    assert.equal(hits,beforeHits+1);
    await sql`UPDATE receipts SET updated_at=now()-interval '11 minutes' WHERE id=${waiting.current_receipt_id}`;
    await markStalePendingReceipts();
    const receipt = (await sql`SELECT * FROM receipts WHERE id=${waiting.current_receipt_id}`)[0]!;
    const attempts = await sql`SELECT * FROM receipt_attempts WHERE receipt_id=${receipt.id}`;
    assert.equal(receipt.status,'unknown'); assert.equal(attempts[0]!.status,'unknown');
    process.env.REDFOX_CALLS_ENABLED='false'; process.env.MODEL_CALLS_ENABLED='false';
    await recoverFrom(run.id);
    const settled = await row(run.id);
    assert.equal(settled.status,'needs_review'); assert.equal(settled.next_attempt_at,null);
    assert.match(settled.wait_reason,/unknown/i);
    const dto = (await operationDetail(run.id))!;
    assert.ok('status' in dto && 'waitReason' in dto && 'nextAttemptAt' in dto);
    assert.equal(dto.status,settled.status); assert.equal(dto.waitReason,settled.wait_reason); assert.equal(dto.nextAttemptAt,null);
    await recoverFrom(run.id);
    assert.deepEqual(await row(run.id),settled);
    assert.deepEqual((await sql`SELECT * FROM receipts WHERE id=${receipt.id}`)[0],receipt);
    assert.deepEqual(await sql`SELECT * FROM receipt_attempts WHERE receipt_id=${receipt.id}`,attempts);
    assert.equal(hits,beforeHits+1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit; }
    server.closeAllConnections(); process.env.REDFOX_CALLS_ENABLED='true'; process.env.MODEL_CALLS_ENABLED='true';
  }
});

async function source() {
  const id = `recovery-${tag()}`, handle = `s${tag()}`.slice(0,15);
  const uid = String(BigInt(Date.now())*1000000n+BigInt(Math.floor(Math.random()*1000000)));
  sources.push(id);
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode) VALUES (${id},'Synthetic','x_search',${sql.json({query:`from:${handle} -filter:replies`})},'isolated')`;
  await sql.begin(tx => createNativeSubscription(tx,id));
  await sql`UPDATE collection_subscriptions SET progress='{"lastTweetId":"100","initializedAt":"2026-01-01"}'::jsonb WHERE control_source_id=${id}`;
  await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('x','user_id',${uid},${id},'{"kind":"audit","reference":"synthetic"}')`;
  return id;
}
async function switchSource(id: string) {
  const p = (await preflightXReplacement(id,'redfox'))!;
  assert.equal(p.supported,true,JSON.stringify(p.checks));
  await switchXCollection(id,{target:'redfox',sourceVersion:p.sourceVersion,subscriptionVersion:p.subscriptionVersion,mappingVersion:p.mappingVersion,reason:'Synthetic recovery switch'},actor);
  const fresh = await createCollection(id,{actor,key:tag(),reason:'schedule'});
  return fresh;
}

test('switch closes an invalid unknown owner while a partial batch sharing its receipt retains the one retry', async () => {
  const a = await source(), b = await source(), c = await source();
  const old = await createNativeCollection(a,{actor,key:tag(),reason:'schedule'});
  const batch = await createNativeBatch([b,c],{actor,key:tag(),shardKey:tag()});
  const request = {service:'socialdata',purpose:'source_fetch',identity:{syntheticRecovery:tag()}};
  let calls=0;
  const lose = async () => { calls++; throw new Error('Synthetic transport loss'); };
  const options = async (id:number) => {const r=await row(id);return receiptOptions({runId:id,stepVersion:r.step_version,generation:r.generation});};
  await assert.rejects(paidRequest(request,lose,await options(old.id)),/transport loss/);
  await assert.rejects(paidRequest(request,lose,await options(batch.id)),/unknown outcome/);
  const receiptId = (await row(old.id)).current_receipt_id;
  assert.equal((await row(batch.id)).current_receipt_id,receiptId);
  const receipt = (await sql`SELECT * FROM receipts WHERE id=${receiptId}`)[0]!;
  const attempts = await sql`SELECT * FROM receipt_attempts WHERE receipt_id=${receiptId}`;
  const freshA = await switchSource(a), freshB = await switchSource(b);
  process.env.COLLECT_ENABLED='false'; process.env.REDFOX_CALLS_ENABLED='false';
  try {
    await recoverFrom(old.id);
    const stopped=await row(old.id);
    assert.equal(stopped.status,'stopped'); assert.equal(stopped.next_attempt_at,null);
    assert.match(stopped.wait_reason,/no longer eligible/);
    const dto=(await operationDetail(old.id))!;
    assert.ok('status' in dto && 'waitReason' in dto);
    assert.equal(dto.status,'stopped'); assert.equal(dto.waitReason,stopped.wait_reason);
    assert.equal((await row(batch.id)).status,'active');
    await assert.rejects(sql.begin(tx=>requireExecution(tx,{runId:old.id,stepVersion:1,generation:0})),/stale|eligible/);
    await recoverFrom(old.id); assert.deepEqual(await row(old.id),stopped);
    assert.deepEqual((await sql`SELECT * FROM receipts WHERE id=${receiptId}`)[0],receipt);
    assert.deepEqual(await sql`SELECT * FROM receipt_attempts WHERE receipt_id=${receiptId}`,attempts);
    for (const [id,fresh] of [[a,freshA],[b,freshB]] as const) assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE control_source_id=${id}`)[0]!.active_run_id,fresh.id);
  } finally {process.env.COLLECT_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';}
  // The valid batch owns the original receipt and waits the full unknown interval.
  await recoverFrom(old.id); assert.equal((await sql`SELECT status FROM receipts WHERE id=${receiptId}`)[0]!.status,'unknown');
  await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receiptId}`;
  await recoverFrom(old.id);
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${receiptId}`)[0]!.status,'failed');
  assert.equal((await row(old.id)).status,'stopped'); assert.equal((await row(batch.id)).status,'active');
  await assert.rejects(paidRequest(request,lose,await options(batch.id)),/transport loss/);
  await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receiptId}`;
  await recoverFrom(old.id);
  assert.equal((await row(batch.id)).status,'needs_review'); assert.equal(calls,2);
  assert.equal((await sql`SELECT attempts,status FROM receipts WHERE id=${receiptId}`)[0]!.attempts,2);
  assert.equal((await sql`SELECT status FROM receipts WHERE id=${receiptId}`)[0]!.status,'unknown');
});

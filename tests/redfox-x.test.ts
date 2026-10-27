import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createAccountQuery } from "@aihot/backend/providers/redfox/queries";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { resumeRun } from "@aihot/backend/providers/operations/store";

const key = "synthetic-redfox-key";
const accountId = String(1234567890123456789n + BigInt(Date.now()));
let hits = 0, redirectHits = 0, disconnect = false;
let answer = {status:200,body:`{"code":2000,"data":{"userId":${accountId},"username":"synthetic","displayName":"Synthetic account"}}`,headers:{} as Record<string,string>};
const target = http.createServer((_req,res)=>{redirectHits++;res.end("unexpected");});
const server = http.createServer((req,res)=>{
  hits++; if (disconnect) { req.socket.destroy(); return; } assert.equal(req.headers.redfox_api_key,key);
  assert.equal(req.url,"/story/api/x/userInfo");
  req.resume(); req.on("end",()=>{res.writeHead(answer.status,{"content-type":"application/json",...answer.headers});res.end(answer.body);});
});
let saved: Record<string,unknown>;
before(async()=>{
  await new Promise<void>(resolve=>target.listen(0,"127.0.0.1",resolve));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  process.env.REDFOX_TEST_BASE_URL = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  process.env.REDFOX_API_KEY = key; process.env.REDFOX_CALLS_ENABLED = "true";
  config.allowPrivateNetworkFetch = true;
  saved = (await sql`SELECT * FROM budgets WHERE service = 'redfox.query'`)[0]!;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;
});
after(async()=>{
  await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;
  process.env.REDFOX_CALLS_ENABLED="false"; delete process.env.REDFOX_API_KEY;
  await new Promise<void>(resolve=>server.close(()=>resolve())); await new Promise<void>(resolve=>target.close(()=>resolve()));
  await stopBoss(); await closeDb();
});
const runOf = async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const create = (restId=BigInt("0x"+randomUUID().replaceAll("-","").slice(0,24)).toString())=>createAccountQuery({restId},"redfox-test",tag());
const step = async(id:number)=>{const r=await runOf(id);return executeOperationStep(id,r.step_version,randomUUID());};

test("account query persists exact large IDs, consumes raw receipt and reuses across consumers",async()=>{
  const run = await createAccountQuery({screenName:"synthetic"},"redfox-test",tag());
  const before=hits; await step(run.id); assert.equal(hits,before+1); assert.equal((await runOf(run.id)).status,"completed");
  const [result] = await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;
  assert.equal(result!.data.userId,accountId);
  const [receipt] = await sql`SELECT * FROM receipts WHERE id=${result!.receipt_id}`;
  assert.equal(receipt!.response.status,200); assert.ok(receipt!.response.body.includes(accountId));
  assert.equal(receipt!.cost_basis,"estimated");
  delete process.env.REDFOX_API_KEY; process.env.REDFOX_CALLS_ENABLED="false";
  try { const second=await createAccountQuery({screenName:"synthetic"},"redfox-test",tag()); await step(second.id); assert.equal((await runOf(second.id)).status,"completed"); assert.equal(hits,before+1); }
  finally {process.env.REDFOX_API_KEY=key;process.env.REDFOX_CALLS_ENABLED="true";}
});

test("missing key and missing budget cannot create attempts or dispatch",async()=>{
  const before=hits;
  delete process.env.REDFOX_API_KEY;
  const missingKey=await create(); await step(missingKey.id);
  assert.equal((await runOf(missingKey.id)).status,"waiting"); assert.equal((await runOf(missingKey.id)).current_receipt_id,null);
  process.env.REDFOX_API_KEY=key;
  await sql`DELETE FROM budgets WHERE service='redfox.query'`;
  try { const missingBudget=await create(); await step(missingBudget.id); assert.equal((await runOf(missingBudget.id)).current_receipt_id,null); assert.match((await runOf(missingBudget.id)).wait_reason,/unconfigured/); }
  finally {await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES ('redfox.query',1000,10000,100000)`;}
  assert.equal(hits,before);
});

test("malformed received response is retained, redacted and locally replayable without repurchase",async()=>{
  const previous=answer; answer={status:200,body:`{broken ${key}`,headers:{}};
  try {
    const run=await create(); const before=hits; await step(run.id);
    const state=await runOf(run.id); assert.equal(state.status,"needs_review");
    const [receipt]=await sql`SELECT * FROM receipts WHERE id=${state.current_receipt_id}`;
    assert.equal(receipt!.status,"received"); assert.equal(receipt!.response.body,"{broken [REDACTED]");
    await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:1,generation:state.generation}));
    process.env.REDFOX_CALLS_ENABLED="false"; delete process.env.REDFOX_API_KEY;
    try {await step(run.id);assert.equal((await runOf(run.id)).status,"needs_review");}
    finally {process.env.REDFOX_CALLS_ENABLED="true";process.env.REDFOX_API_KEY=key;}
    assert.equal(hits,before+1);
  } finally {answer=previous;}
});

test("302 persists its raw response without following or exposing the credential",async()=>{
  const previous=answer; answer={status:302,body:`redirect ${key}`,headers:{location:`http://127.0.0.1:${(target.address() as {port:number}).port}/sink`}};
  try {
    const run=await create(); await step(run.id); const state=await runOf(run.id);
    assert.equal(state.status,"needs_review"); assert.equal(redirectHits,0);
    const [receipt]=await sql`SELECT response FROM receipts WHERE id=${state.current_receipt_id}`;
    assert.equal(receipt!.response.status,302); assert.equal(receipt!.response.body,"redirect [REDACTED]");
    assert.equal(JSON.stringify(receipt).includes(key),false);
  } finally {answer=previous;}
});

test("account result binding checks whole query and stable identity without changing source permissions",async()=>{
  const { importXAccountResult }=await import("@aihot/backend/providers/redfox/import-account");
  const { preflightXReplacement }=await import("@aihot/backend/sources/x-replacement");
  const { createNativeSubscription }=await import("@aihot/backend/sources/native-migration");
  const run=await createAccountQuery({screenName:"synthetic"},"redfox-test",tag()); await step(run.id);
  const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`;
  const sourceId=`redfox-bind-${tag()}`, bad=`redfox-multi-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,first_party) VALUES
    (${sourceId},'Synthetic binding','x_search','{"query":"from:synthetic"}','isolated',false,false),
    (${bad},'Synthetic multi','x_search','{"query":"from:synthetic OR from:another"}','isolated',false,false)`;
  await sql.begin(tx=>createNativeSubscription(tx,sourceId));
  await assert.rejects(importXAccountResult(result!.id,{sourceId:bad,reason:"test"},"test",tag()),/complete single-account/);
  await importXAccountResult(result!.id,{sourceId,reason:"explicit stable identity"},"test",tag());
  const [auditBefore]=await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`source:${sourceId}`} AND action='source.bind_account'`;
  await importXAccountResult(result!.id,{sourceId,reason:"same target again"},"test",tag());
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`source:${sourceId}`} AND action='source.bind_account'`)[0]!.n,auditBefore!.n);
  const [s]=await sql`SELECT * FROM sources WHERE id=${sourceId}`;
  assert.equal(s!.participation_mode,"isolated"); assert.equal(s!.site_fulltext,false);assert.equal(s!.first_party,false);
  const [binding]=await sql`SELECT * FROM source_account_bindings WHERE source_id=${sourceId}`;
  assert.equal(binding!.id_value,accountId);
  const before=hits, preflight=await preflightXReplacement(sourceId,"redfox");
  assert.equal(preflight!.mapping.restId,accountId);
  assert.equal(preflight!.checks.find(c=>c.key==="article")!.conclusion,"supported");
  assert.equal(preflight!.checks.find(c=>c.key==="execution")!.conclusion,"supported");
  assert.equal(hits,before);
  const [after]=await sql`SELECT updated_at FROM sources WHERE id=${sourceId}`;
  assert.equal(after!.updated_at.toISOString(),s!.updated_at.toISOString());
  await sql`UPDATE sources SET participation_mode='editorial' WHERE id=${sourceId}`;
  assert.equal((await preflightXReplacement(sourceId,"redfox"))!.checks.find(c=>c.key==="article")!.conclusion,"unsupported");
  const copy=`redfox-copy-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode) VALUES (${copy},'Synthetic duplicate','x_search','{"query":"from:synthetic"}','isolated')`;
  await assert.rejects(importXAccountResult(result!.id,{sourceId:copy,reason:"must conflict"},"test",tag()),/another source/);
});

async function recoverActiveFixtures(ids:number[]){
  const {recoverOperations}=await import("@aihot/backend/providers/operations/recovery");
  const [population]=await sql`SELECT count(*)::int AS count FROM operation_runs WHERE status IN ('active','waiting')`;
  for(let i=0;i<Math.ceil(population!.count/200)+2;i++){
    await recoverOperations();
    if((await Promise.all(ids.map(runOf))).every(r=>r.status==='active'))return;
  }
  assert.fail('Fixture not active after bounded recovery cursor scan');
}

test("temporary read-only rejection preserves each raw attempt and retries the same key within a bound",async()=>{
  const { recoverOperations }=await import("@aihot/backend/providers/operations/recovery");
  const previous=answer;answer={status:429,body:'{"code":4004,"msg":"synthetic throttle"}',headers:{"retry-after":"7"}};
  try {
    const run=await create(); await step(run.id);const first=await runOf(run.id);
    assert.equal(first.status,"waiting");assert.equal(first.retry_count,1);
    assert.ok(first.next_attempt_at.getTime()-Date.now()>5000);
    const [attempt]=await sql`SELECT response,status FROM receipt_attempts WHERE receipt_id=${first.current_receipt_id}`;
    assert.equal(attempt!.status,"failed");assert.equal(attempt!.response.status,429);
    for(let i=0;i<3;i++) {
      await sql`UPDATE receipt_attempts SET finished_at=now()-interval '2 hours' WHERE receipt_id=(SELECT current_receipt_id FROM operation_runs WHERE id=${run.id}) AND status='failed'`;
      await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 minute' WHERE id=${run.id}`;
      await recoverActiveFixtures([run.id]);await step(run.id);
    }
    const end=await runOf(run.id);assert.equal(end.status,"needs_review");
    assert.equal(end.current_receipt_id,first.current_receipt_id);
    const [receipt]=await sql`SELECT attempts,status FROM receipts WHERE id=${first.current_receipt_id}`;
    assert.equal(receipt!.attempts,4);assert.equal(receipt!.status,"received");
    const [preserved]=await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE receipt_id=${first.current_receipt_id} AND response IS NOT NULL`;
    assert.equal(preserved!.n,3);
  } finally {answer=previous;}
});

test("shared Retry-After blocks every consumer until the original absolute deadline and fences equal-body attempts",async()=>{
  const {retryReceivedRejection}=await import("@aihot/backend/providers/receipts");
  const {receiptOptions}=await import("@aihot/backend/providers/operations/store");
  const {xAccount}=await import("@aihot/backend/providers/redfox/x");
  const {RedfoxRetryableResponseError}=await import("@aihot/backend/providers/redfox/client");
  const previous=answer;answer={status:429,body:'{"code":4004}',headers:{"retry-after":"7200"}};
  try {
    const input={screenName:`r${Date.now().toString(36)}`},first=await createAccountQuery(input,"test",tag()),second=await createAccountQuery(input,"test",tag());
    const before=hits;await step(first.id);const a=await runOf(first.id);await step(second.id);const b=await runOf(second.id);
    assert.equal(hits,before+1);assert.equal(a.status,"waiting");assert.equal(b.status,"waiting");assert.equal(b.retry_count,0);
    assert.ok(a.next_attempt_at.getTime()-Date.now()>7_100_000);assert.equal(b.next_attempt_at.getTime(),a.next_attempt_at.getTime());
    const [shared]=await sql`SELECT attempts,response,cost,received_at FROM receipts WHERE id=${a.current_receipt_id}`;
    assert.equal(shared!.attempts,1);assert.equal(shared!.response,null);assert.equal(shared!.cost,null);assert.equal(shared!.received_at,null);
    assert.equal((await sql`SELECT count(*)::int AS n FROM receipt_attempts WHERE receipt_id=${a.current_receipt_id}`)[0]!.n,1);
    await sql`UPDATE receipt_attempts SET finished_at=now()-interval '3 hours' WHERE receipt_id=${a.current_receipt_id}`;
    await sql.begin(tx=>resumeRun(tx,{runId:second.id,stepVersion:1,generation:b.generation}));
    const resumed=await runOf(second.id);
    let rejected:InstanceType<typeof RedfoxRetryableResponseError>|undefined;
    try {await xAccount(input,resumed.input.window,receiptOptions({runId:second.id,stepVersion:1,generation:resumed.generation}));}
    catch(error){assert.ok(error instanceof RedfoxRetryableResponseError);rejected=error;}
    assert.ok(rejected);assert.equal(rejected.attempt,2);assert.equal(hits,before+2);
    assert.equal(await sql.begin(tx=>retryReceivedRejection(tx,rejected!.receiptId,1,rejected!.response,rejected!.message)),false);
    assert.equal((await sql`SELECT status FROM receipts WHERE id=${a.current_receipt_id}`)[0]!.status,"received");
    assert.equal(await sql.begin(tx=>retryReceivedRejection(tx,rejected!.receiptId,2,rejected!.response,rejected!.message)),true);
    assert.equal(await sql.begin(tx=>retryReceivedRejection(tx,rejected!.receiptId,2,rejected!.response,rejected!.message)),false);
    await sql`UPDATE operation_runs SET status='needs_review' WHERE id IN (${first.id},${second.id})`;
  } finally {answer=previous;}
});

test("first transport loss waits on the original receipt deadline and retries globally only once",async()=>{
  const {recoverOperations}=await import("@aihot/backend/providers/operations/recovery");
  disconnect=true;
  const before=hits;
  try {
    const first=await create(),id=first.id;await step(id);
    const run=await runOf(id);assert.equal(run.status,"waiting");
    const [receipt]=await sql`SELECT * FROM receipts WHERE id=${run.current_receipt_id}`;
    assert.equal(receipt!.status,"unknown");assert.equal(run.next_attempt_at.getTime(),receipt!.updated_at.getTime()+30*60_000);
    const second=await createAccountQuery(first.input.parameters,"redfox-test",tag());await step(second.id);
    assert.equal((await runOf(second.id)).current_receipt_id,receipt!.id);assert.equal(hits,before+1);
    await recoverOperations();assert.equal((await runOf(id)).status,"waiting");assert.equal(hits,before+1);
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receipt!.id}`;
    await recoverActiveFixtures([id,second.id]);assert.equal((await runOf(id)).status,"active");assert.equal((await runOf(second.id)).status,"active");
    await step(id);assert.equal((await runOf(id)).status,"needs_review");
    await step(second.id);assert.equal((await runOf(second.id)).status,"needs_review");
    assert.equal(hits,before+2);
    const [same]=await sql`SELECT * FROM receipts WHERE id=${receipt!.id}`;assert.equal(same!.logical_key,receipt!.logical_key);assert.equal(same!.attempts,2);
    await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${receipt!.id}`;
    await recoverOperations();assert.equal(hits,before+2);assert.equal((await runOf(id)).status,"needs_review");
  } finally {disconnect=false;}
});

import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { controlOperation } from "@aihot/backend/providers/operations/read";
import { updateSource } from "@aihot/backend/admin/sources";
import { republishKey } from "@aihot/backend/jobs/publication";
import { stopBoss, QUEUES } from "@aihot/backend/jobs/queue";
import { createNativeSubscription, migrateNativeSources } from "@aihot/backend/sources/native-migration";
import { preflightXReplacement } from "@aihot/backend/sources/x-replacement";
import { preflightMpReplacement } from "@aihot/backend/sources/mp-replacement";
import { migrationArguments } from "../scripts/migrate-native-collection.ts";
import { collectRequestedSource } from "../scripts/collect.ts";
import { createCollection } from "@aihot/backend/sources/collection-commands";

process.env.COLLECT_ENABLED = "false";
process.env.REDFOX_CALLS_ENABLED = "false";
const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async () => { fetches++; throw new Error("Unexpected external request"); };
const sourceIds: string[] = [];
const renamedSourceIds: string[] = [];
after(async () => {
  globalThis.fetch = originalFetch;
  try {
    if (sourceIds.length) await sql.begin(async tx => {
      const runs = await tx`SELECT r.id,r.job_id FROM operation_runs r JOIN collection_subscriptions s ON s.id=r.subscription_id WHERE s.control_source_id IN ${tx(sourceIds)}`;
      const jobIds = runs.filter(r => r.job_id).map(r => r.job_id as string);
      if (jobIds.length) await tx`UPDATE pgboss.job SET state='cancelled',completed_on=now() WHERE id IN ${tx(jobIds)} AND state IN ('created','retry','active')`;
      if (renamedSourceIds.length) {
        await tx`UPDATE pgboss.job SET state='cancelled',completed_on=now() WHERE name=${QUEUES.republishSource} AND data->>'sourceId' IN ${tx(renamedSourceIds)} AND state IN ('created','retry','active')`;
        await tx`DELETE FROM settings WHERE key IN ${tx(renamedSourceIds.map(republishKey))}`;
      }
      await tx`UPDATE collection_subscriptions SET active_run_id=NULL WHERE control_source_id IN ${tx(sourceIds)}`;
      if (runs.length) {
        const runIds = runs.map(r => r.id as number);
        await tx`DELETE FROM operation_results WHERE run_id IN ${tx(runIds)}`;
        await tx`DELETE FROM operation_runs WHERE id IN ${tx(runIds)}`;
      }
      await tx`DELETE FROM collection_subscriptions WHERE control_source_id IN ${tx(sourceIds)}`;
      await tx`DELETE FROM fetch_runs WHERE source_id IN ${tx(sourceIds)}`;
      await tx`DELETE FROM sources WHERE id IN ${tx(sourceIds)}`;
    });
  } finally {
    try { await stopBoss(); } finally { await closeDb(); }
  }
});

async function source(kind: "x_search" | "mp_account", config: Record<string, unknown> | null | unknown[] | string | number | boolean, enabled = true) {
  const id = `migration-closeout-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,config,enabled,participation_mode,site_fulltext,syndicate_fulltext,cursor,interval_minutes)
    VALUES (${id},'Synthetic closeout',${kind},${JSON.stringify(config)}::text::jsonb,${enabled},'isolated',false,false,${sql.json({lastTweetId:"123",synthetic:true})},37)`;
  sourceIds.push(id);
  return id;
}

test("migration CLI accepts explicit scope and refuses incomplete/unknown arguments", () => {
  assert.deepEqual(migrationArguments(["--old-writers-stopped"]), {oldWritersStopped:true});
  assert.deepEqual(migrationArguments(["--source","a","--old-writers-stopped","--source","b","--source","a"]), {oldWritersStopped:true,sourceIds:["a","b"]});
  for (const args of [[],["--source","a"],["--old-writers-stopped","--source"],["--old-writers-stopped","--source",""],["--old-writers-stopped","--source","--bad"],["--old-writers-stopped","--all"],["--old-writers-stopped","--old-writers-stopped"]]) assert.throws(() => migrationArguments(args));
});

test("migration blocks malformed native configurations without changing snapshots or permissions", async () => {
  const cases: Array<["x_search" | "mp_account",Record<string,unknown> | null | unknown[] | string | number | boolean]> = [
    ["x_search",null],["mp_account",[]],["x_search","invalid"],["mp_account",17],["x_search",true],
    ["x_search",{query:{}}],["x_search",{query:"  "}],["x_search",{query:"from:synthetic",searchType:"People"}],
    ["x_search",{query:"from:synthetic",unimplemented:true}],["mp_account",{ghid:123}],["mp_account",{wxid:" "}],
  ];
  for (const [kind,config] of cases) {
    const id = await source(kind,config,false);
    const [before] = await sql`SELECT * FROM sources WHERE id=${id}`;
    assert.deepEqual(await migrateNativeSources({oldWritersStopped:true,sourceIds:[id]}),{inspected:1,created:1,blocked:1});
    const [sub] = await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`;
    const [run] = await sql`SELECT * FROM operation_runs WHERE id=${sub!.active_run_id}`;
    const [types] = await sql`SELECT jsonb_typeof(s.config) AS source_type, jsonb_typeof(c.config) AS subscription_type
      FROM sources s JOIN collection_subscriptions c ON c.control_source_id=s.id WHERE s.id=${id}`;
    const expectedType = config === null ? "null" : Array.isArray(config) ? "array" : typeof config;
    assert.equal(types!.source_type,expectedType,JSON.stringify({config,types}));
    assert.equal(types!.subscription_type,expectedType,JSON.stringify({config,types,stored:sub!.config}));
    const previews = kind === "x_search"
      ? [await preflightXReplacement(id,"redfox"),await preflightXReplacement(id,"socialdata")]
      : [await preflightMpReplacement(id,"redfox"),await preflightMpReplacement(id,"dajiala")];
    for (const preview of previews) {
      assert.ok(preview);
      assert.equal(preview.supported,false);
      if (config === null || typeof config !== "object" || Array.isArray(config)) {
        const check = preview.checks.find(c => c.key === "configuration");
        assert.equal(check?.conclusion,"unsupported");
        assert.match(check!.evidence,/配置不是有效对象.*先修正/);
      }
    }
    assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${sub!.id}`)[0],sub);
    assert.deepEqual(before!.config,config);
    assert.deepEqual(sub!.config,before!.config); assert.equal(sub!.interval_minutes,37); assert.equal(sub!.enabled,false);
    assert.deepEqual(sub!.progress,before!.cursor);
    assert.equal(run!.status,"needs_review"); assert.equal(run!.step_key,"migration.review");
    assert.match(run!.wait_reason,/configuration is invalid/); assert.equal(run!.input.recoveryUnavailable,true);
    assert.deepEqual(run!.limits,{steps:0,retries:0}); assert.equal(run!.job_id,null);
    await assert.rejects(controlOperation(run!.id,"resume",{stepVersion:run!.step_version,generation:run!.generation,reason:"Synthetic verification"},"test"),/Legacy request input is unavailable/);
    assert.deepEqual((await sql`SELECT * FROM operation_runs WHERE id=${run!.id}`)[0],run);
    assert.deepEqual((await sql`SELECT * FROM sources WHERE id=${id}`)[0],before);
    assert.deepEqual(await migrateNativeSources({oldWritersStopped:true,sourceIds:[id]}),{inspected:1,created:0,blocked:1});
  }
  await assert.rejects(migrateNativeSources({oldWritersStopped:true,sourceIds:[]}));
  assert.equal(fetches,0);
});

test("replacement preflight does not fall back from a null subscription config to valid source config", async () => {
  for (const [kind,config] of [["x_search",{query:"from:synthetic"}],["mp_account",{wxid:"synthetic-wx"}]] as const) {
    const id = await source(kind,config,false);
    await sql.begin(tx => createNativeSubscription(tx,id));
    await sql`UPDATE collection_subscriptions SET config='null'::jsonb WHERE control_source_id=${id}`;
    const [before] = await sql`SELECT * FROM sources WHERE id=${id}`;
    const [sub] = await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`;
    const previews = kind === "x_search"
      ? [await preflightXReplacement(id,"redfox"),await preflightXReplacement(id,"socialdata")]
      : [await preflightMpReplacement(id,"redfox"),await preflightMpReplacement(id,"dajiala")];
    for (const preview of previews) {
      assert.ok(preview);
      assert.equal(preview.supported,false);
      const check = preview.checks.find(c => c.key === "configuration");
      assert.equal(check?.conclusion,"unsupported");
      assert.match(check!.evidence,/配置不是有效对象.*先修正/);
    }
    assert.equal(sub!.config,null);
    assert.deepEqual((await sql`SELECT * FROM sources WHERE id=${id}`)[0],before);
    assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${sub!.id}`)[0],sub);
  }
  assert.equal(fetches,0);
});

test("null migrated configs survive metadata edits and can be explicitly repaired without changing source snapshots", async () => {
  for (const [kind,config] of [["x_search",{query:"from:synthetic"}],["mp_account",{wxid:"synthetic-wx"}]] as const) {
    const id = await source(kind,null,false);
    await migrateNativeSources({oldWritersStopped:true,sourceIds:[id]});
    const [before] = await sql`SELECT * FROM sources WHERE id=${id}`;
    const [sub] = await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`;
    const renamed = await updateSource(id,{version:before!.updated_at.toISOString(),patch:{name:"Renamed invalid configuration",interval_minutes:41}},"migration-test");
    renamedSourceIds.push(id);
    assert.ok(renamed);
    assert.equal(renamed.config,null);
    assert.equal(renamed.interval_minutes,41);
    const [metadataSource] = await sql`SELECT * FROM sources WHERE id=${id}`;
    const [metadataSub] = await sql`SELECT * FROM collection_subscriptions WHERE id=${sub!.id}`;
    assert.deepEqual(metadataSource,{...before,name:"Renamed invalid configuration",updated_at:metadataSource!.updated_at});
    assert.deepEqual(metadataSub,{...sub,interval_minutes:41,execution_version:sub!.execution_version,edit_version:sub!.edit_version+1,updated_at:metadataSub!.updated_at});
    assert.equal((await sql`SELECT jsonb_typeof(config) AS type FROM collection_subscriptions WHERE id=${sub!.id}`)[0]!.type,"null");
    const repaired = await updateSource(id,{version:metadataSource!.updated_at.toISOString(),patch:{config}},"migration-test");
    assert.ok(repaired);
    assert.deepEqual(repaired.config,config);
    const [repairedSource] = await sql`SELECT * FROM sources WHERE id=${id}`;
    const [repairedSub] = await sql`SELECT * FROM collection_subscriptions WHERE id=${sub!.id}`;
    assert.deepEqual(repairedSource,{...metadataSource,updated_at:repairedSource!.updated_at});
    assert.deepEqual(repairedSub,{...metadataSub,config,active_run_id:null,execution_version:metadataSub!.execution_version+1,edit_version:metadataSub!.edit_version+1,updated_at:repairedSub!.updated_at});
    assert.equal(fetches,0);
  }
});

test("valid configs retain new progress on rerun and native CLI only queues shared operations", async () => {
  for (const [kind,config] of [["x_search",{query:"from:synthetic",searchType:"Top"}],["mp_account",{wxid:"synthetic-wx"}]] as const) {
    const id = await source(kind,config);
    await sql.begin(tx => createNativeSubscription(tx,id));
    await sql`UPDATE collection_subscriptions SET progress=${sql.json({advanced:true})} WHERE control_source_id=${id}`;
    assert.deepEqual(await migrateNativeSources({oldWritersStopped:true,sourceIds:[id]}),{inspected:1,created:0,blocked:0});
    assert.deepEqual((await sql`SELECT progress FROM collection_subscriptions WHERE control_source_id=${id}`)[0]!.progress,{advanced:true});
    const result = await collectRequestedSource(id);
    assert.ok("runId" in result);
    const [run] = await sql`SELECT * FROM operation_runs WHERE id=${result.runId}`;
    assert.equal(run!.actor,"cli"); assert.equal(run!.provider,kind==="x_search"?"socialdata":"dajiala");
    assert.equal(run!.status,"active"); assert.equal(run!.current_receipt_id,null); assert.ok(run!.job_id);
    assert.equal((await sql`SELECT count(*)::int AS n FROM operation_results WHERE run_id=${run!.id}`)[0]!.n,0);
    await assert.rejects(collectRequestedSource(id),/occupied/);
  }
  const missing = await source("x_search",{query:"from:synthetic"});
  await assert.rejects(collectRequestedSource(missing),/explicit subscription migration/);
  const disabled = await source("mp_account",{ghid:"synthetic"},false);
  await sql.begin(tx => createNativeSubscription(tx,disabled));
  await assert.rejects(createCollection(disabled,{actor:"test",key:tag(),reason:"schedule"}),/disabled/);
  const forced = await collectRequestedSource(disabled);
  assert.ok("runId" in forced);
  const [forcedRun] = await sql`SELECT * FROM operation_runs WHERE id=${forced.runId}`;
  assert.equal(forcedRun!.input.forceSourceId,disabled);
  assert.deepEqual(forcedRun!.input.commandIntent,{sourceId:disabled,reason:"manual",force:true});
  await assert.rejects(collectRequestedSource(disabled),/occupied/);
  await assert.rejects(collectRequestedSource(`absent-${tag()}`),/not found/);
  assert.equal(fetches,0);
});


test("RSS CLI preserves the direct collection path and its local configuration failure", async () => {
  const id = `migration-rss-${tag()}`;
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode) VALUES (${id},'Synthetic RSS','rss','{}','isolated')`;
  sourceIds.push(id);
  const result = await collectRequestedSource(id);
  assert.equal("runId" in result,false);
  assert.equal(result.status,"failed");
  assert.equal((await sql`SELECT count(*)::int AS n FROM fetch_runs WHERE source_id=${id}`)[0]!.n,1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM collection_subscriptions WHERE control_source_id=${id}`)[0]!.n,0);
  assert.equal(fetches,0);
});

test("native CLI preserves forced manual collection for a disabled X source", async () => {
  const id = await source("x_search",{query:"from:synthetic"},false);
  await sql.begin(tx => createNativeSubscription(tx,id));
  await assert.rejects(createCollection(id,{actor:"test",key:tag(),reason:"schedule"}),/disabled/);
  const result = await collectRequestedSource(id);
  assert.ok("runId" in result);
  const [run] = await sql`SELECT * FROM operation_runs WHERE id=${result.runId}`;
  assert.equal(run!.input.forceSourceId,id);
  assert.deepEqual(run!.input.commandIntent,{sourceId:id,reason:"manual",force:true});
  await assert.rejects(collectRequestedSource(id),/occupied/);
  assert.equal(fetches,0);
});

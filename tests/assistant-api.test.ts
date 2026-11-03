import { allowTestBudgetScope, assertConfiguredTestDatabase, gate, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { buildApp } from "../apps/api/src/app.ts";
import { config } from "@aihot/backend/config";
import { listBudgetScopes } from "@aihot/backend/admin/settings";
test("assistant HTTP identity, quote hint binding and cross-entry admission", async () => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const assistantScopes = (await listBudgetScopes()).filter((row) => row.service === "assistant.text");
  assert.deepEqual(assistantScopes.map((row) => row.scope).sort(), ["admin", "member"]);
  const [priorXhsPolicy] = await sql`SELECT value FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;
  const restoreBudgetScope = await allowTestBudgetScope(["assistant.text"], "member");
  const unique = tag(),
    model = `api-${unique}`;
  const supplier = await stub(() => ({ choices: [] }));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const prior = config.devAdmin;
  try {
    await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.xiaohongshu-creator','{"acceptingNew":true,"revision":1}'::jsonb,'test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    config.devAdmin = null;
    Object.assign(process.env, {
      ASSISTANT_ENABLED: "true",
      ASSISTANT_CALLS_ENABLED: "true",
      ASSISTANT_MODEL_VERIFIED: "true",
      ASSISTANT_MODEL: "default",
      LLM_MODEL: model,
      LLM_BASE_URL: supplier.url + "/v1",
      LLM_API_KEY: "synthetic-key",
      ASSISTANT_TOKENIZER: "cl100k_base",
      MODEL_CALLS_ENABLED: "true",
    });
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
    const a = await createSiteUser(
      { username: `aa_${unique}`, displayName: "A", password: "synthetic-assistant-password" },
      "test",
    );
    const b = await createSiteUser(
      { username: `ab_${unique}`, displayName: "B", password: "synthetic-assistant-password" },
      "test",
    );
    await grantCredits(a.id, { amount: 100, reason: "API fixture credits" }, "test", randomUUID());
    await saveToolPrice(
      {
        kind: "assistant-turn",
        provider: "assistant",
        model,
        baseCredits: 7,
        enabled: true,
        reason: "API fixture price",
      },
      "test",
    );
    const login = await loginSiteUser({ username: a.username, password: "synthetic-assistant-password" }),
      other = await loginSiteUser({ username: b.username, password: "synthetic-assistant-password" });
    const headers = {
        cookie: `aihot_user=${login.token}`,
        "x-csrf-token": login.principal.csrf,
        "idempotency-key": randomUUID(),
      },
      otherHeaders = {
        cookie: `aihot_user=${other.token}`,
        "x-csrf-token": other.principal.csrf,
        "idempotency-key": randomUUID(),
      };
    app = await buildApp();
    const api = app;
    assert.equal((await api.inject({ url: "/api/assistant/options" })).statusCode, 401);
    assert.equal(
      (
        await api.inject({
          method: "POST",
          url: "/api/assistant/sessions",
          headers: { cookie: headers.cookie },
          payload: { assistantId: "creative" },
        })
      ).statusCode,
      403,
    );
    const options = await api.inject({ url: "/api/assistant/options", headers });
    assert.equal(options.statusCode, 200);
    assert.equal(options.json().assistants.length, 2);
    assert.match(String(options.headers["cache-control"]), /no-store/);
    const create = async (assistantId: string) => {
      const r = await api.inject({
        method: "POST",
        url: "/api/assistant/sessions",
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: { assistantId },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().sessionId;
    };
    const first = await create("creative"),
      second = await create("xiaohongshu"),
      third = await create("creative");
    assert.equal(
      (await api.inject({ url: `/api/assistant/sessions/${first}`, headers: otherHeaders })).statusCode,
      404,
    );
    const input = {
      message: "材料：产品重100克，请改写",
      expectedRevision: 1,
      taskHint: { actionId: "xiaohongshu-rewrite" },
    };
    const quote = async (id: string) => {
      const r = await api.inject({
        method: "POST",
        url: `/api/assistant/sessions/${id}/quote`,
        headers,
        payload: input,
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    const q1 = await quote(first),
      q2 = await quote(second),
      q3 = await quote(third);
    const submit = (id: string, quoteId: string, taskHint: unknown = input.taskHint) =>
      api.inject({
        method: "POST",
        url: `/api/assistant/sessions/${id}/turns`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: { ...input, taskHint, quoteId },
      });
    assert.equal((await submit(second, q1.quoteId)).statusCode, 409);
    assert.equal((await submit(first, q1.quoteId, null)).statusCode, 409);
    assert.equal((await submit(first, q1.quoteId)).statusCode, 202);
    assert.equal((await submit(second, q2.quoteId)).statusCode, 202);
    assert.equal((await submit(third, q3.quoteId)).statusCode, 409);
    const [count] = await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${a.id}`;
    assert.equal(count.n, 2);
    assert.equal(supplier.hits(), 0);
    assert.equal(
      (await api.inject({ url: `/api/assistant/sessions/${first}/events?after=0`, headers: otherHeaders }))
        .statusCode,
      404,
    );
    // The read projection uses ordinal facts, not UUID order or private execution payloads.
    const read = async () => (await api.inject({ url: `/api/assistant/sessions/${second}`, headers })).json();
    const fixture = await read();
    assert.deepEqual(fixture.turn.activities, [{ id: `request:${fixture.turn.turnId}`, kind: "request_received", state: "completed" }]);
    const [laterId, earlierId] = [randomUUID(), randomUUID()].sort();
    const secret = "PRIVATE_ACTIVITY_SENTINEL_provider_prompt_skill_reference";
    await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash,decision)
      VALUES (${earlierId},${fixture.turn.turnId},1,1,${sql.json({ secret })},${secret},${sql.json({ secret })}),
      (${laterId},${fixture.turn.turnId},2,3,${sql.json({ secret })},${secret},NULL)`;
    const localIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const names = ["load_skill", "read_skill_reference", "save_draft", "private_unknown_tool"];
    for (let i = 0; i < names.length; i++) {
      await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,state,result)
        VALUES (${localIds[i]!},${fixture.turn.turnId},${earlierId},${i},${randomUUID()},${names[i]!},${sql.json({ secret })},'completed',${sql.json({ secret })})`;
    }
    const searchId = randomUUID();
    await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input)
      VALUES (${searchId},${fixture.turn.turnId},${laterId},0,${randomUUID()},'search_xhs_notes',${sql.json({ keyword: "咖啡".repeat(100) })})`;
    await sql`UPDATE operation_runs SET step_version=3 WHERE id=${fixture.turn.runId}`;
    const activity = (snapshot: Awaited<ReturnType<typeof read>>, id: string) => snapshot.turn.activities.find((item: { id: string }) => item.id === id);
    const firstRead = await read();
    assert.deepEqual(firstRead.turn.activities.map((item: { kind: string }) => item.kind),
      ["request_received", "model_request", "load_skill", "read_skill_reference", "save_draft", "model_request", "search_xhs_notes"]);
    assert.equal(activity(firstRead, `model:${laterId}`).state, "preparing");
    assert.equal(activity(firstRead, `call:${searchId}`).state, "preparing");
    assert.equal(activity(firstRead, `call:${searchId}`).keyword.length, 120);
    assert(!JSON.stringify(firstRead).includes(secret));
    assert(!JSON.stringify(firstRead.turn.activities).includes("private_unknown_tool"));
    assert.deepEqual((await read()).turn.activities, firstRead.turn.activities);
    assert.equal((await api.inject({ url: `/api/assistant/sessions/${second}`, headers: otherHeaders })).statusCode, 404);
    await sql`UPDATE assistant_tool_calls SET input=${sql.json({ keyword: { secret } })} WHERE id=${searchId}`;
    assert.equal(activity(await read(), `call:${searchId}`).keyword, undefined);
    await sql`UPDATE assistant_tool_calls SET input=${sql.json({ keyword: "咖啡" })} WHERE id=${searchId}`;
    const [receipt] = await sql`INSERT INTO receipts(logical_key,service,purpose,status,request,response)
      VALUES (${randomUUID()},'assistant.text','assistant.turn','pending',${sql.json({ secret })},${sql.json({ secret })}) RETURNING id`;
    await sql`UPDATE assistant_model_steps SET receipt_id=${receipt.id} WHERE id=${laterId}`;
    assert.equal(activity(await read(), `model:${laterId}`).state, "running");
    await sql`UPDATE operation_runs SET status='waiting',wait_reason='assistant:budget' WHERE id=${fixture.turn.runId}`;
    assert.equal(activity(await read(), `model:${laterId}`).state, "waiting");
    await sql`UPDATE operation_runs SET status='active',wait_reason=NULL WHERE id=${fixture.turn.runId}`;
    await sql`UPDATE receipts SET status='unknown' WHERE id=${receipt.id}`;
    assert.equal(activity(await read(), `model:${laterId}`).state, "needs_review");
    await sql`UPDATE receipts SET status='received' WHERE id=${receipt.id}`;
    assert.equal(activity(await read(), `model:${laterId}`).state, "completed");
    await sql`UPDATE assistant_tool_calls SET state='proposed' WHERE id=${searchId}`;
    assert.equal(activity(await read(), `call:${searchId}`).state, "waiting");
    const [child] = await sql`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,step_key)
      VALUES ('test',${randomUUID()},'fixture','fixture',1,'{}','fixture','fixture') RETURNING id`;
    await sql`UPDATE assistant_tool_calls SET state='running',child_run_id=${child.id} WHERE id=${searchId}`;
    assert.equal(activity(await read(), `call:${searchId}`).state, "preparing");
    await sql`UPDATE operation_runs SET current_receipt_id=${receipt.id} WHERE id=${child.id}`;
    await sql`UPDATE receipts SET status='pending' WHERE id=${receipt.id}`;
    assert.equal(activity(await read(), `call:${searchId}`).state, "running");
    await sql`UPDATE receipts SET status='unknown' WHERE id=${receipt.id}`;
    assert.equal(activity(await read(), `call:${searchId}`).state, "needs_review");
    await sql`UPDATE receipts SET status='received' WHERE id=${receipt.id}`;
    assert.equal(activity(await read(), `call:${searchId}`).state, "waiting");
    await sql`UPDATE operation_runs SET status='stopped' WHERE id=${child.id}`;
    assert.equal(activity(await read(), `call:${searchId}`).state, "stopped");
    await sql`UPDATE operation_runs SET status='needs_review' WHERE id=${fixture.turn.runId}`;
    assert.equal(activity(await read(), `call:${localIds[2]}`).state, "completed");
    assert.equal(activity(await read(), `model:${earlierId}`).state, "completed");
    // Stopped/review turns must keep reconciling receipts even without new assistant events.
    const eventSeqBeforeReceipt = (await read()).eventSeq;
    for (const status of ["stopped", "needs_review"]) {
      await sql`UPDATE operation_runs SET status=${status} WHERE id=${fixture.turn.runId}`;
      for (const receiptStatus of ["pending", "unknown", "received", "completed", "failed"]) {
        await sql`UPDATE receipts SET status=${receiptStatus} WHERE id=${receipt.id}`;
        const snapshot = await read();
        assert.equal(snapshot.turn.needsSnapshotRefresh, ["pending", "unknown"].includes(receiptStatus));
        assert.equal(snapshot.eventSeq, eventSeqBeforeReceipt);
      }
    }

    const [childOnlyReceipt] = await sql`INSERT INTO receipts(logical_key,service,purpose,status,request)
      VALUES (${randomUUID()},'assistant.text','assistant.turn','pending','{}') RETURNING id`;
    await sql`UPDATE operation_runs SET current_receipt_id=${childOnlyReceipt.id} WHERE id=${child.id}`;
    assert.equal((await read()).turn.needsSnapshotRefresh, true, "Child receipt alone keeps snapshots current");
    await sql`UPDATE receipts SET status='unknown' WHERE id=${childOnlyReceipt.id}`;
    assert.equal((await read()).turn.needsSnapshotRefresh, true);
    await sql`UPDATE receipts SET status='failed' WHERE id=${childOnlyReceipt.id}`;
    assert.equal((await read()).turn.needsSnapshotRefresh, false, "Stable review status does not poll snapshots forever");
    assert.equal(supplier.hits(), 0, "Snapshot reads must never call the model");
    const [afterReads] = await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${a.id}`;
    assert.equal(afterReads.n, count.n, "Snapshot reads must not create paid work");
    // Authentication can finish before the command obtains the member admission lock.
    const initial = (await api.inject({ url: `/api/assistant/sessions/${first}`, headers })).json();
    const stop = await api.inject({
      method: "POST",
      url: `/api/assistant/sessions/${first}/turns/${initial.turn.turnId}/stop`,
      headers,
      payload: { generation: initial.turn.generation },
    });
    assert.equal(stop.statusCode, 200);
    const stopped = (await api.inject({ url: `/api/assistant/sessions/${first}`, headers })).json();
    const locked = gate(),
      release = gate();
    const disable = sql.begin(async (tx) => {
      await tx`SELECT id FROM site_users WHERE id=${a.id} FOR NO KEY UPDATE`;
      locked.open();
      await release.promise;
      await tx`UPDATE site_users SET status='disabled' WHERE id=${a.id}`;
    });
    await locked.promise;
    const resumed = api
      .inject({
        method: "POST",
        url: `/api/assistant/sessions/${first}/turns/${stopped.turn.turnId}/resume`,
        headers,
        payload: { generation: stopped.turn.generation },
      })
      .then((response) => response);
    let admissionBlocked = false;
    try {
      for (let i = 0; i < 200; i++) {
        const [waiting] =
          await sql`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT status FROM site_users%'`;
        if (waiting.n) {
          admissionBlocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release.open();
      await disable;
    }
    assert(admissionBlocked, "The request must authenticate before waiting for admission");
    assert.equal((await resumed).statusCode, 403);
    const [unchanged] =
      await sql`SELECT status,generation,current_receipt_id,step_version FROM operation_runs WHERE id=${stopped.turn.runId}`;
    assert.equal(unchanged.status, "stopped");
    assert.equal(unchanged.generation, stopped.turn.generation);
    assert.equal(unchanged.current_receipt_id, null);
    assert.equal((await api.inject({ url: `/api/assistant/sessions/${first}`, headers })).statusCode, 401);
    config.devAdmin = { displayName: "Assistant recovery fixture" };
    const adminResume = await api.inject({
      method: "POST",
      url: `/api/admin/operations/runs/${stopped.turn.runId}/resume`,
      headers: { "x-csrf-token": "dev" },
      payload: {
        stepVersion: unchanged.step_version,
        generation: unchanged.generation,
        reason: "停用会员恢复应被拒绝",
      },
    });
    assert.equal(adminResume.statusCode, 409);
    assert.equal(adminResume.json().code, "conflict");
    assert.equal(supplier.hits(), 0);
  } finally {
    if (priorXhsPolicy) await sql`UPDATE settings SET value=${sql.json(priorXhsPolicy.value)} WHERE key='assistant.skills.xiaohongshu-creator'`;
    else await sql`DELETE FROM settings WHERE key='assistant.skills.xiaohongshu-creator'`;

    config.devAdmin = prior;
    await app?.close();
    await supplier.close();
    await stopBoss();
    await restoreBudgetScope();
    await closeDb();
  }
});

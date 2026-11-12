import { controlTurn, archiveSession } from "@aihot/backend/assistant/controls";
import { feeSettings, setFeeAuthorization } from "@aihot/backend/assistant/fees";
import { saveArtifact } from "@aihot/backend/assistant/store";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag, gate } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { grantCredits, saveToolPrice, reconcileCreditCharge } from "@aihot/backend/users/credits";
import { createSession, quoteTurn, submitTurn, sessionSnapshot, editArtifact, attachInput } from "@aihot/backend/assistant/sessions";
import { enqueueMessage, advanceMessageQueue, approveQueuedMessage, cancelQueuedMessage, resumeMessageQueue, recoverMessageQueues, refreshQueuedQuote } from "@aihot/backend/assistant/message-queue";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { buildApp } from "../apps/api/src/app.ts";
const completion = (name: string, input: unknown) => ({ id: "queue-fixture", created: 1, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: null,
  tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: "tool_calls" }] });
test("persisted queue HTTP → Worker → manual quote → approval → draft, without enqueue charges", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`; assertConfiguredTestDatabase(db.name, db.port);
  const restore = await allowTestBudgetScope(["assistant.text"], "member"), unique = tag(), model = `queue-${unique}`;
  const supplier = await stub((_hit, req) => {
    const body = JSON.parse(req.body), loaded = body.messages.filter((m: any) => m.role === "tool").map((m: any) => JSON.parse(m.content)).find((m: any) => m.activationId);
    if (!loaded) return completion("load_skill", { skillId: "general-writing", moduleId: "write" });
    return completion("save_draft", { activationId: loaded.activationId, kind: "text-draft", baseVersion: 0,
      content: { title: "排队交付", body: "依据用户材料完成的正文。", intent: "draft", titles: [], tags: [], sources: ["current-message"], partial: false, scope: "用户材料" } });
  });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    Object.assign(process.env, { ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true", ASSISTANT_MODEL: "default", LLM_MODEL: model,
      LLM_BASE_URL: supplier.url + "/v1", LLM_API_KEY: "synthetic-queue-key", ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true" });
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
    await saveToolPrice({ kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Synthetic FIFO test" }, "test");
    const user = await createSiteUser({ username: `queue_${unique}`, displayName: "Queue", password: "synthetic-queue-password" }, "test");
    await grantCredits(user.id, { amount: 100, reason: "Synthetic queue credits" }, "test", randomUUID());
    const login = await loginSiteUser({ username: user.username, password: "synthetic-queue-password" });
    const headers = { cookie: `aihot_user=${login.token}`, "x-csrf-token": login.principal.csrf };
    app = await buildApp();
    const post = async (url: string, payload: any, key = randomUUID()) => {
      const r = await app!.inject({ method: "POST", url, headers: { ...headers, "idempotency-key": key }, payload });
      assert(r.statusCode >= 200 && r.statusCode < 300, r.body); return r.json();
    };
    const { sessionId } = await createSession(user.id, { assistantId: "creative" }, randomUUID());
    const raw = { message: "先完成第一篇", expectedRevision: 1, inputIds: [], artifactVersions: [], skillSelection: { actionId: "general-writing" } };
    const q = await quoteTurn(user.id, sessionId, raw), first = await submitTurn(user.id, sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
    assert.deepEqual(q.additionalFeeKinds, []);
    const advance = async (id: number) => { const [r] = await sql`SELECT step_version FROM operation_runs WHERE id=${id}`; await executeOperationStep(id, r.step_version, randomUUID()); };
    const queued = { ...raw, message: "第二篇排队", expectedRevision: 2, skillSelection: { skillId: "general-writing" }, taskHint: { actionId: "general-writing" } }, key = randomUUID();
    const before = await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${user.id}`;
    const entry = await post(`/api/assistant/sessions/${sessionId}/queue`, queued, key);
    const duplicate = await post(`/api/assistant/sessions/${sessionId}/queue`, queued, key);
    assert.equal(duplicate.entryId, entry.entryId);
    assert.equal((await sql`SELECT count(*)::int n FROM member_tool_quotes WHERE user_id=${user.id}`)[0]!.n, before[0]!.n);
    assert.equal((await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${user.id}`)[0]!.n, 1);
    const response = await app.inject({ url: `/api/assistant/sessions/${sessionId}`, headers });
    assert.equal(response.json().queue.entries[0].state, "pending");
    assert.deepEqual(response.json().queue.entries[0].taskHint, queued.taskHint); assert.equal(supplier.hits(), 0);
    for (let i = 0; i < 4; i++) await advance(first.runId);
    let snapshot = await sessionSnapshot(user.id, sessionId);
    assert.equal(snapshot.turn?.status, "completed"); assert.equal(snapshot.queue!.entries[0]!.state, "quoted");
    assert.equal((await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${user.id}`)[0]!.n, 1);
    const proposal = snapshot.queue!.entries[0]!;
    assert.deepEqual(proposal.quote!.additionalFeeKinds, []);
    const approved = await post(`/api/assistant/sessions/${sessionId}/queue/${entry.entryId}/approve`, { quoteId: proposal.quote!.quoteId });
    const replay = await post(`/api/assistant/sessions/${sessionId}/queue/${entry.entryId}/approve`, { quoteId: proposal.quote!.quoteId });
    assert.equal(replay.turnId, approved.turnId);
    const [turn] = await sql`SELECT parent_operation_run_id,snapshot FROM assistant_turns WHERE id=${approved.turnId}`;
    assert.deepEqual(turn.snapshot.skillSelection, queued.skillSelection);
    assert.deepEqual(turn.snapshot.taskHint, queued.taskHint);
    for (let i = 0; i < 4; i++) await advance(turn.parent_operation_run_id);
    await recoverMessageQueues();
    snapshot = await sessionSnapshot(user.id, sessionId);
    assert.equal(snapshot.artifacts.length, 2); assert.equal(snapshot.queue!.entries[0]!.state, "submitted");
    const charges = await sql`SELECT amount,state FROM member_credit_charges WHERE user_id=${user.id}`;
    assert.equal(charges.length, 2); assert(charges.every(c => c.amount === 7 && c.state === "settled"));
    assert.equal(supplier.hits(), 4);
    let number = 0;
    const fixture = async (credits = 200) => {
      const u = await createSiteUser({ username: `queue_case_${unique}_${++number}`, displayName: "Queue case", password: "synthetic-password" }, "test");
      if(credits)await grantCredits(u.id, { amount: credits, reason: "Synthetic queue case" }, "test", randomUUID());
      const { sessionId: id } = await createSession(u.id, { assistantId: "creative" }, randomUUID());
      return { u, id, input: { ...raw, expectedRevision: 1, message: "队列需求" } };
    };
    const chargeCount = async (id: number) => (await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${id}`)[0]!.n;
    await t.test("automatic task fees preserve the sent mode and reserve once; manual and insufficient entries never auto-start", async () => {
      const automatic = await fixture(), key = randomUUID();
      const input = { ...automatic.input, confirmationMode: "automatic" as const };
      const queued = await enqueueMessage(automatic.u.id, automatic.id, input, key);
      let state = await sessionSnapshot(automatic.u.id, automatic.id);
      assert.equal(state.queue!.entries[0]!.state, "submitted");
      assert.equal(state.queue!.entries[0]!.confirmationMode, "automatic");
      assert.equal(state.turn!.credits!.amount, 7);
      assert.equal((await enqueueMessage(automatic.u.id, automatic.id, input, key)).entryId, queued.entryId);
      await Promise.all([advanceMessageQueue(automatic.u.id, automatic.id), recoverMessageQueues()]);
      assert.equal(await chargeCount(automatic.u.id), 1);
      const manual = await fixture();
      await enqueueMessage(manual.u.id, manual.id, { ...manual.input, confirmationMode: "manual" }, randomUUID());
      await recoverMessageQueues();
      assert.equal((await sessionSnapshot(manual.u.id, manual.id)).queue!.entries[0]!.state, "quoted");
      assert.equal(await chargeCount(manual.u.id), 0);
      const empty = await fixture(0), calls = supplier.hits();
      await enqueueMessage(empty.u.id, empty.id, { ...empty.input, confirmationMode: "automatic" }, randomUUID());
      state = await sessionSnapshot(empty.u.id, empty.id);
      assert.equal(state.turn, null);
      assert.equal(state.queue!.entries[0]!.state, "quoted");
      assert.match(state.queue!.entries[0]!.error!, /需要 7 积分，当前可用 0 积分，还差 7 积分/);
      await recoverMessageQueues(); await advanceMessageQueue(empty.u.id, empty.id);
      assert.equal(await chargeCount(empty.u.id), 0);
      assert.equal(supplier.hits(), calls);
    });
    await t.test("explicit automatic reprice continues once; manual refresh and stopped queue stay explicit", async () => {
      for (const mode of ["automatic", "manual"] as const) {
        const x = await fixture(0);
        const entry = await enqueueMessage(x.u.id, x.id, { ...x.input, confirmationMode: mode }, randomUUID());
        await grantCredits(x.u.id, { amount: 100, reason: "Synthetic recovery top-up" }, "test", randomUUID());
        await recoverMessageQueues();
        await sessionSnapshot(x.u.id, x.id);
        assert.equal(await chargeCount(x.u.id), 0, "credit reads and top-up never authorize a failed queue");
        const refreshed = await refreshQueuedQuote(x.u.id, x.id, entry.entryId);
        let state = await sessionSnapshot(x.u.id, x.id);
        assert.equal(state.queue!.entries[0]!.error, null);
        assert.equal(state.queue!.entries[0]!.state, mode === "automatic" ? "submitted" : "quoted");
        assert.equal(await chargeCount(x.u.id), mode === "automatic" ? 1 : 0);
        if (mode === "manual") await approveQueuedMessage(x.u.id, x.id, entry.entryId, { quoteId: refreshed.quote.quoteId });
        state = await sessionSnapshot(x.u.id, x.id);
        const run = state.turn!;
        await approveQueuedMessage(x.u.id, x.id, entry.entryId, { quoteId: refreshed.quote.quoteId });
        assert.equal(await chargeCount(x.u.id), 1);
        await controlTurn(x.u.id, x.id, run.turnId, "stop", { generation: run.generation });
      }
      const paused = await fixture();
      await sql`UPDATE assistant_sessions SET queue_paused=true WHERE id=${paused.id}`;
      const entry = await enqueueMessage(paused.u.id, paused.id, { ...paused.input, confirmationMode: "automatic" }, randomUUID());
      await assert.rejects(refreshQueuedQuote(paused.u.id, paused.id, entry.entryId), /不能报价/);
      assert.equal(await chargeCount(paused.u.id), 0);
      assert((await sessionSnapshot(paused.u.id, paused.id)).queue!.paused);
    });
    await t.test("two prepared quotes return in reverse order: first valid write wins without stale events", async () => {
      const x = await fixture(), queued = await enqueueMessage(x.u.id, x.id, x.input, randomUUID());
      const original = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.quote!;
      const barrier = holdTransactionOutcome(value => !!value?.quoteId && value.quoteId !== original.quoteId);
      try {
        const late = refreshQueuedQuote(x.u.id, x.id, queued.entryId);
        await barrier.reached.promise;
        const winner = await refreshQueuedQuote(x.u.id, x.id, queued.entryId);
        const beforeLate = await sessionSnapshot(x.u.id, x.id);
        barrier.release.open();
        assert.equal((await late).quote.quoteId, winner.quote.quoteId, "late preparation reads back the accepted quote");
        const afterLate = await sessionSnapshot(x.u.id, x.id);
        assert.deepEqual(afterLate.queue, beforeLate.queue);
        assert.equal(afterLate.eventSeq, beforeLate.eventSeq, "discarded preparations emit no queue event");
        assert.equal(await chargeCount(x.u.id), 0);
      } finally { barrier.release.open(); barrier.restore(); }
    });
    await t.test("late preparation cannot replace a different choice, revive cancellation or change a submitted entry", async () => {
      for (const change of ["choice", "cancel", "submit"] as const) {
        const x = await fixture(), queued = await enqueueMessage(x.u.id, x.id, x.input, randomUUID());
        const initial = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.quote!;
        const barrier = holdTransactionOutcome(value => !!value?.quoteId && value.quoteId !== initial.quoteId);
        try {
          const late = refreshQueuedQuote(x.u.id, x.id, queued.entryId);
          const rejected = assert.rejects(late, change === "choice" ? /选择已变化/ : /不能报价/);
          await barrier.reached.promise;
          if (change === "choice") await refreshQueuedQuote(x.u.id, x.id, queued.entryId, { taskChoice: { skillId: "general-writing", moduleId: "write", delivery: "writing" } });
          if (change === "cancel") await cancelQueuedMessage(x.u.id, x.id, queued.entryId);
          if (change === "submit") await approveQueuedMessage(x.u.id, x.id, queued.entryId, { quoteId: initial.quoteId });
          const current = await sessionSnapshot(x.u.id, x.id);
          barrier.release.open(); await rejected;
          const after = await sessionSnapshot(x.u.id, x.id);
          assert.deepEqual(after.queue, current.queue);
          assert.equal(after.eventSeq, current.eventSeq);
          assert.equal(await chargeCount(x.u.id), change === "submit" ? 1 : 0);
          if (change === "choice") {
            const [chosen] = await sql`SELECT prepared_input FROM assistant_message_queue WHERE id=${queued.entryId}`;
            await refreshQueuedQuote(x.u.id, x.id, queued.entryId);
            const [repriced] = await sql`SELECT prepared_input FROM assistant_message_queue WHERE id=${queued.entryId}`;
            assert.deepEqual(repriced.prepared_input.taskChoice, chosen.prepared_input.taskChoice, "a later simple reprice retains the user's accepted choice");
          }
        } finally { barrier.release.open(); barrier.restore(); }
      }
    });
    await t.test("Q1 submit rejection arriving after Q2 cannot overwrite its quote, error or event sequence", async () => {
      const x = await fixture(0), barrier = holdTransactionOutcome(() => false, error => error?.code === "insufficient_credits");
      const [price] = await sql`SELECT id,version FROM member_tool_prices WHERE kind='assistant-turn' AND model=${model}`;
      try {
        const old = enqueueMessage(x.u.id, x.id, { ...x.input, confirmationMode: "automatic" }, randomUUID());
        await barrier.reached.promise;
        const [entry] = await sql`SELECT id,quote FROM assistant_message_queue WHERE session_id=${x.id}`;
        await saveToolPrice({ id: price.id, expectedVersion: price.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 9, enabled: true, reason: "Synthetic Q2 price" }, "test");
        await refreshQueuedQuote(x.u.id, x.id, entry.id);
        const newer = await sessionSnapshot(x.u.id, x.id), q2 = newer.queue!.entries[0]!;
        assert.notEqual(q2.quote!.quoteId, entry.quote.quoteId);
        assert.equal(q2.quote!.amount, 9); assert.match(q2.error!, /需要 9/);
        barrier.release.open(); await old;
        const after = await sessionSnapshot(x.u.id, x.id);
        assert.deepEqual(after.queue, newer.queue);
        assert.equal(after.eventSeq, newer.eventSeq, "stale Q1 failure publishes no false change event");
        assert.equal(await chargeCount(x.u.id), 0);
      } finally {
        barrier.release.open(); barrier.restore();
        const [current] = await sql`SELECT version FROM member_tool_prices WHERE id=${price.id}`;
        await saveToolPrice({ id: price.id, expectedVersion: current.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Restore synthetic Q2 price" }, "test");
      }
    });
    await t.test("HTTP enqueue after completion and cancelling quoted heads immediately advance once", async () => {
      const completed = await sessionSnapshot(user.id, sessionId), input = { ...raw, expectedRevision: completed.revision };
      const path = `/api/assistant/sessions/${sessionId}/queue`, key = randomUUID();
      const firstQueued = await post(path, input, key);
      const secondQueued = await post(path, { ...input, message: "取消后立即报价" });
      let state = await sessionSnapshot(user.id, sessionId);
      assert.equal(state.queue!.entries.find(e => e.id === firstQueued.entryId)!.state, "quoted");
      const before = await chargeCount(user.id), hits = supplier.hits();
      assert.equal((await post(path, input, key)).entryId, firstQueued.entryId);
      await Promise.all([post(`${path}/${firstQueued.entryId}/cancel`, {}), post(`${path}/${firstQueued.entryId}/cancel`, {})]);
      state = await sessionSnapshot(user.id, sessionId);
      const secondQuote = state.queue!.entries.find(e => e.id === secondQueued.entryId)!;
      assert.equal(secondQuote.state, "quoted");
      const settings = await feeSettings(user.id, sessionId);
      const auth = (await setFeeAuthorization(user.id, sessionId, { enabled: true, expectedVersion: 0, totalLimit: 70, allowSearch: false, turnPrice: settings.prices.turn, searchPrice: null })).authorization!;
      const autoKey = randomUUID(), autoInput = { ...input, message: "取消后立即自动准入", autoAuthorizationId: auth.id };
      const auto = await post(path, autoInput, autoKey);
      await Promise.all([post(`${path}/${secondQueued.entryId}/cancel`, {}), post(`${path}/${secondQueued.entryId}/cancel`, {})]);
      state = await sessionSnapshot(user.id, sessionId);
      assert.equal(state.queue!.entries.find(e => e.id === auto.entryId)!.state, "quoted", "new tasks never inherit old automatic spend permission");
      await post(path, autoInput, autoKey);
      assert.equal(await chargeCount(user.id), before);
      assert.equal(supplier.hits(), hits, "command admission queues Worker work without calling a model");
      await cancelQueuedMessage(user.id,sessionId,auto.entryId);
    });
    await t.test("post-commit quote rejection preserves original command and can recover explicitly", async () => {
      const x = await fixture(), key = randomUUID();
      const [price] = await sql`SELECT id,version FROM member_tool_prices WHERE kind='assistant-turn' AND model=${model}`;
      await sql`UPDATE assistant_sessions SET queue_paused=true WHERE id=${x.id}`;
      const queued = await enqueueMessage(x.u.id,x.id,x.input,key);
      await saveToolPrice({ id: price.id, expectedVersion: price.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: false, reason: "Synthetic unavailable price" }, "test");
      await resumeMessageQueue(x.u.id,x.id);
      const failed = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!;
      assert.equal(failed.state, "pending"); assert(failed.error); assert.equal(await chargeCount(x.u.id), 0);
      assert.equal((await enqueueMessage(x.u.id, x.id, x.input, key)).entryId, queued.entryId);
      const [disabled] = await sql`SELECT version FROM member_tool_prices WHERE id=${price.id}`;
      await saveToolPrice({ id: price.id, expectedVersion: disabled.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Restore synthetic price" }, "test");
      await resumeMessageQueue(x.u.id, x.id);
      assert.equal((await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.state, "quoted");
      assert.equal(await chargeCount(x.u.id), 0);
    });
    await t.test("FIFO, duplicate tabs, cancellation replay and no line jumping", async () => {
      const x = await fixture(), requestKey = randomUUID();
      const duplicates = await Promise.all(Array.from({ length: 3 }, () => enqueueMessage(x.u.id, x.id, x.input, requestKey)));
      assert(duplicates.every(e => e.entryId === duplicates[0]!.entryId));
      const cancelled = await enqueueMessage(x.u.id, x.id, { ...x.input, message: "取消的第二条" }, randomUUID());
      const third = await enqueueMessage(x.u.id, x.id, { ...x.input, message: "第三条" }, randomUUID());
      await cancelQueuedMessage(x.u.id, x.id, cancelled.entryId);
      await cancelQueuedMessage(x.u.id, x.id, cancelled.entryId);
      await assert.rejects(cancelQueuedMessage(user.id, x.id, third.entryId));
      assert.equal(await chargeCount(x.u.id), 0);
      await advanceMessageQueue(x.u.id, x.id);
      const state = await sessionSnapshot(x.u.id, x.id), head = state.queue!.entries[0]!;
      await assert.rejects(approveQueuedMessage(x.u.id, x.id, third.entryId, { quoteId: head.quote!.quoteId }), /顺序/);
      const directQuote = await quoteTurn(x.u.id, x.id, x.input);
      await assert.rejects(submitTurn(x.u.id, x.id, { ...x.input, quoteId: directQuote.quoteId }, randomUUID()), /排队需求/);
      const result = await Promise.all(Array.from({ length: 2 }, () => approveQueuedMessage(x.u.id, x.id, head.id, { quoteId: head.quote!.quoteId })));
      assert.equal(result[0]!.turnId, result[1]!.turnId); assert.equal(await chargeCount(x.u.id), 1);
      const [running] = await sql`SELECT parent_operation_run_id FROM assistant_turns WHERE id=${result[0]!.turnId}`;
      for (let i = 0; i < 4; i++) await advance(running.parent_operation_run_id);
      const next = (await sessionSnapshot(x.u.id, x.id)).queue!.entries.find(e => e.id === third.entryId)!;
      assert.equal(next.state, "quoted");
      await cancelQueuedMessage(x.u.id, x.id, third.entryId);
      assert.equal(await chargeCount(x.u.id), 1);
    });
    await t.test("frozen exact artifact version; revision, expired quote and price changes require renewed confirmation", async () => {
      const x = await fixture();
      const content = { title: "原稿", body: "v1原文", intent: "draft" as const, titles: [], tags: [], sources: ["current-message"], partial: false, scope: "材料" };
      const artifact = await sql.begin(tx => saveArtifact(tx, { sessionId: x.id, baseVersion: 0, kind: "text-draft", content,
        sourceSnapshot: [{ id: "current-message", kind: "user-material", label: "材料", url: null }] }));
      const queued = await enqueueMessage(x.u.id, x.id, { ...x.input, artifactVersions: [{ artifactId: artifact.artifactId, version: 1 }] }, randomUUID());
      await advanceMessageQueue(x.u.id, x.id);
      const initial = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.quote!;
      await editArtifact(x.u.id, x.id, artifact.artifactId, { baseVersion: 1, kind: "text-draft", content: { ...content, body: "v2原文" } });
      assert.equal((await sessionSnapshot(x.u.id, x.id)).revision, 1, "editing another artifact version does not change frozen input revision");
      const materialLogin = await loginSiteUser({ username: x.u.username, password: "synthetic-password" });
      const upload = await app!.inject({ method: "POST", url: "/api/tools/assets", headers: { cookie: `aihot_user=${materialLogin.token}`, "x-csrf-token": materialLogin.principal.csrf,
        "idempotency-key": randomUUID(), "content-type": "multipart/form-data; boundary=queue-material" },
        payload: Buffer.from('--queue-material\r\nContent-Disposition: form-data; name="file"; filename="new.md"\r\nContent-Type: text/markdown\r\n\r\n新关联材料\r\n--queue-material--\r\n') });
      assert.equal(upload.statusCode, 201, upload.body);
      await attachInput(x.u.id, x.id, { assetKey: upload.json().key }, randomUUID());
      const changed = await approveQueuedMessage(x.u.id, x.id, queued.entryId, { quoteId: initial.quoteId });
      assert('requote' in changed && changed.requote); assert.equal(await chargeCount(x.u.id), 0);
      await refreshQueuedQuote(x.u.id,x.id,queued.entryId);
      let current = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.quote!;
      await sql`UPDATE member_tool_quotes SET expires_at=now()-interval '1 second' WHERE id=${current.quoteId}`;
      const expired = await approveQueuedMessage(x.u.id, x.id, queued.entryId, { quoteId: current.quoteId });
      assert('requote' in expired && expired.requote);
      await refreshQueuedQuote(x.u.id,x.id,queued.entryId);
      current = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.quote!;
      const [price] = await sql`SELECT id,version FROM member_tool_prices WHERE kind='assistant-turn' AND model=${model}`;
      await saveToolPrice({ id: price.id, expectedVersion: price.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 9, enabled: true, reason: "Synthetic price change" }, "test");
      const repriced = await approveQueuedMessage(x.u.id, x.id, queued.entryId, { quoteId: current.quoteId });
      assert('requote' in repriced && repriced.requote); assert.equal(await chargeCount(x.u.id), 0);
      await refreshQueuedQuote(x.u.id,x.id,queued.entryId);
      current = (await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.quote!; assert.equal(current.amount, 9);
      const accepted = await approveQueuedMessage(x.u.id, x.id, queued.entryId, { quoteId: current.quoteId });
      const [saved] = await sql`SELECT snapshot FROM assistant_turns WHERE id=${accepted.turnId!}`;
      assert.equal(saved.snapshot.selected[0].version, 1);
      const state = await sessionSnapshot(x.u.id, x.id);
      await controlTurn(x.u.id, x.id, accepted.turnId!, "stop", { generation: state.turn!.generation });
      const [latestPrice] = await sql`SELECT version FROM member_tool_prices WHERE id=${price.id}`;
      await saveToolPrice({ id: price.id, expectedVersion: latestPrice.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Restore synthetic price" }, "test");
    });
    await t.test("new queued tasks do not inherit legacy automatic authorization",async()=>{
      const x=await fixture(),prices=(await feeSettings(x.u.id,x.id)).prices;
      const auth=(await setFeeAuthorization(x.u.id,x.id,{enabled:true,expectedVersion:0,totalLimit:70,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
      const entry=await enqueueMessage(x.u.id,x.id,{...x.input,autoAuthorizationId:auth.id},randomUUID());
      let state=await sessionSnapshot(x.u.id,x.id);assert.equal(state.queue!.entries[0]!.state,'quoted');assert.equal(await chargeCount(x.u.id),0);
      const run=await approveQueuedMessage(x.u.id,x.id,entry.entryId,{quoteId:state.queue!.entries[0]!.quote!.quoteId});assert(run.turnId);
      assert.equal((await sql`SELECT count(*)::int n FROM assistant_auto_charges WHERE turn_id=${run.turnId!}`)[0]!.n,0);
      for(let i=0;i<4;i++)await advance((await sessionSnapshot(x.u.id,x.id)).turn!.runId);
      assert.equal((await feeSettings(x.u.id,x.id)).authorization!.used,0);
    });
    await t.test("historical accepted queue retains its original automatic authorization and single-tool charge",async()=>{
      const x=await fixture(),prices=(await feeSettings(x.u.id,x.id)).prices;
      const auth=(await setFeeAuthorization(x.u.id,x.id,{enabled:true,expectedVersion:0,totalLimit:70,allowSearch:false,turnPrice:prices.turn,searchPrice:null})).authorization!;
      await sql`UPDATE assistant_sessions SET queue_paused=true WHERE id=${x.id}`;
      const entry=await enqueueMessage(x.u.id,x.id,{...x.input,autoAuthorizationId:auth.id},randomUUID());
      const {candidates}=await import('@aihot/backend/assistant/catalog');
      const historical=await candidates('creative',{actionId:'general-writing'},{'general-writing':'2'});
      await sql`UPDATE assistant_message_queue SET admission_snapshot=jsonb_set(admission_snapshot,'{candidates}',${sql.json(historical as never)}) WHERE id=${entry.entryId}`;
      await resumeMessageQueue(x.u.id,x.id);
      const state=await sessionSnapshot(x.u.id,x.id);assert.equal(state.queue!.entries[0]!.state,'submitted');
      const [charge]=await sql`SELECT pricing_snapshot FROM member_credit_charges WHERE root_run_id=${state.turn!.runId}`;assert.equal(charge!.pricing_snapshot.task,undefined);
      assert.equal((await feeSettings(x.u.id,x.id)).authorization!.used,7);
      await controlTurn(x.u.id,x.id,state.turn!.turnId,'stop',{generation:state.turn!.generation});
    });
    await t.test("stop and completion share session lock; queue stays paused until explicit continuation", async () => {
      const x = await fixture(), quote = await quoteTurn(x.u.id, x.id, x.input), run = await submitTurn(x.u.id, x.id, { ...x.input, quoteId: quote.quoteId }, randomUUID());
      await enqueueMessage(x.u.id, x.id, { ...x.input, expectedRevision: 2, message: "停止后不得自动开始" }, randomUUID());
      const observed = await sessionSnapshot(x.u.id, x.id);
      for (let i = 0; i < 3; i++) await advance(run.runId);
      const state = await sessionSnapshot(x.u.id, x.id);
      assert(state.turn!.generation > observed.turn!.generation, "Worker advanced after the last browser poll");
      await assert.rejects(controlTurn(x.u.id, x.id, run.turnId, "stop", { generation: state.turn!.generation + 1 }), /状态已变化/);
      await Promise.all([controlTurn(x.u.id, x.id, run.turnId, "stop", { generation: observed.turn!.generation }), advance(run.runId)]);
      const chargesBeforeReplay = await sql`SELECT * FROM member_credit_charges WHERE user_id=${x.u.id}`;
      await controlTurn(x.u.id, x.id, run.turnId, "stop", { generation: observed.turn!.generation });
      assert.deepEqual(await sql`SELECT * FROM member_credit_charges WHERE user_id=${x.u.id}`, chargesBeforeReplay);
      await assert.rejects(controlTurn(x.u.id, x.id, run.turnId, "resume", { generation: observed.turn!.generation }), /状态已变化/);
      await advanceMessageQueue(x.u.id, x.id);
      const stopped = await sessionSnapshot(x.u.id, x.id); assert(stopped.queue!.paused);
      assert(["pending", "quoted"].includes(stopped.queue!.entries[0]!.state)); assert.equal(await chargeCount(x.u.id), 1);
      const [charge] = await sql`SELECT id,state FROM member_credit_charges WHERE user_id=${x.u.id}`;
      if (charge.state === "review") {
        await assert.rejects(resumeMessageQueue(x.u.id, x.id), /积分仍待核对/);
        await reconcileCreditCharge(charge.id, { consume: 7, reason: "Synthetic stopped response accounted for" }, "test", randomUUID());
      }
      await resumeMessageQueue(x.u.id, x.id);
      assert.equal((await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.state, "quoted");
      await archiveSession(x.u.id, x.id, false);
      await assert.rejects(resumeMessageQueue(x.u.id, x.id), /归档/);
    });
    await t.test("stale stop of completed turn also stops a successor already dispatched", async () => {
      const x = await fixture(), quote = await quoteTurn(x.u.id, x.id, x.input), first = await submitTurn(x.u.id, x.id, { ...x.input, quoteId: quote.quoteId }, randomUUID());
      const observed = await sessionSnapshot(x.u.id, x.id);
      const prices = (await feeSettings(x.u.id, x.id)).prices;
      const auth = (await setFeeAuthorization(x.u.id, x.id, { enabled: true, expectedVersion: 0, totalLimit: 70, allowSearch: false, turnPrice: prices.turn, searchPrice: null })).authorization!;
      const entry = await enqueueMessage(x.u.id, x.id, { ...x.input, expectedRevision: 2, message: "下一条", autoAuthorizationId: auth.id }, randomUUID());
      for (let i = 0; i < 4; i++) await advance(first.runId);
      const prepared = (await sessionSnapshot(x.u.id, x.id)).queue!.entries.find(row => row.id === entry.entryId)!;
      assert.equal(prepared.state, "quoted");
      const second = await approveQueuedMessage(x.u.id,x.id,entry.entryId,{quoteId:prepared.quote!.quoteId});
      await controlTurn(x.u.id, x.id, first.turnId, "stop", { generation: observed.turn!.generation });
      const stopped = await sessionSnapshot(x.u.id, x.id);
      assert.equal(stopped.turn!.turnId, second.turnId); assert.equal(stopped.turn!.status, "stopped"); assert(stopped.queue!.paused);
      const charges = await sql`SELECT * FROM member_credit_charges WHERE user_id=${x.u.id} ORDER BY id`;
      await controlTurn(x.u.id, x.id, first.turnId, "stop", { generation: observed.turn!.generation });
      assert.deepEqual(await sql`SELECT * FROM member_credit_charges WHERE user_id=${x.u.id} ORDER BY id`, charges);
      assert.equal(await chargeCount(x.u.id), 2);
    });
    await t.test("old stop cannot affect independent requests or a resumed generation", async () => {
      const x = await fixture(), quote = await legacyQuoteTurn(x.u.id, x.id, x.input), first = await submitTurn(x.u.id, x.id, { ...x.input, quoteId: quote.quoteId }, randomUUID());
      for (let i = 0; i < 4; i++) await advance(first.runId);
      const completed = await sessionSnapshot(x.u.id, x.id), nextInput = { ...x.input, expectedRevision: completed.revision, message: "独立新请求" };
      const nextQuote = await legacyQuoteTurn(x.u.id, x.id, nextInput), second = await submitTurn(x.u.id, x.id, { ...nextInput, quoteId: nextQuote.quoteId }, randomUUID());
      await assert.rejects(controlTurn(x.u.id, x.id, first.turnId, "stop", { generation: 0 }), /独立新回合/);
      let state = await sessionSnapshot(x.u.id, x.id);
      assert.equal(state.turn!.status, "active"); assert.equal(state.queue!.paused, false);
      const observed = state.turn!.generation;
      await controlTurn(x.u.id, x.id, second.turnId, "stop", { generation: observed });
      state = await sessionSnapshot(x.u.id, x.id);
      const stoppedGeneration = state.turn!.generation;
      await controlTurn(x.u.id, x.id, second.turnId, "resume", { generation: stoppedGeneration });
      const resumed = await sessionSnapshot(x.u.id, x.id);
      await controlTurn(x.u.id, x.id, second.turnId, "stop", { generation: observed });
      state = await sessionSnapshot(x.u.id, x.id);
      assert.equal(state.turn!.status, "active"); assert.equal(state.turn!.generation, resumed.turn!.generation);
      await controlTurn(x.u.id, x.id, second.turnId, "stop", { generation: state.turn!.generation });
      assert.equal((await sessionSnapshot(x.u.id, x.id)).turn!.status, "stopped");
    });
    await t.test("unknown stopped receipt blocks queue until original charge is reconciled", async () => {
      const x = await fixture(), quote = await quoteTurn(x.u.id, x.id, x.input), run = await submitTurn(x.u.id, x.id, { ...x.input, quoteId: quote.quoteId }, randomUUID());
      await enqueueMessage(x.u.id, x.id, { ...x.input, expectedRevision: 2 }, randomUUID());
      const [receipt] = await sql`INSERT INTO receipts(logical_key,service,purpose,status,attempts) VALUES (${randomUUID()},'assistant.text','assistant.turn','unknown',1) RETURNING id`;
      await sql`UPDATE operation_runs SET current_receipt_id=${receipt.id} WHERE id=${run.runId}`;
      await controlTurn(x.u.id, x.id, run.turnId, "stop", { generation: 0 });
      await assert.rejects(resumeMessageQueue(x.u.id, x.id), /在途或结果未知/);
      const [charge] = await sql`SELECT id FROM member_credit_charges WHERE user_id=${x.u.id}`;
      await reconcileCreditCharge(charge.id, { consume: 0, reason: "Synthetic unknown outcome reviewed" }, "test", randomUUID());
      await resumeMessageQueue(x.u.id, x.id);
      assert.equal((await sessionSnapshot(x.u.id, x.id)).queue!.entries[0]!.state, "quoted");
      assert.equal((await sql`SELECT status FROM receipts WHERE id=${receipt.id}`)[0]!.status, "unknown", "historical receipt is not rewritten to authorize the next request");
    });
    await t.test("at most ten pending requests and rejected owners cannot enqueue", async () => {
      const x = await fixture();
      for (let i = 0; i < 10; i++) await enqueueMessage(x.u.id, x.id, { ...x.input, message: `待处理${i}` }, randomUUID());
      await assert.rejects(enqueueMessage(x.u.id, x.id, x.input, randomUUID()), /最多等待10条/);
      await assert.rejects(enqueueMessage(user.id, x.id, x.input, randomUUID()), /不可访问/);
      assert.equal(await chargeCount(x.u.id), 0);
      await archiveSession(x.u.id, x.id, true);
    });

  } finally { await app?.close(); await supplier.close(); await stopBoss(); await restore(); await closeDb(); }
});

/** Frozen pre-task quote fixture for the historical stop/resume contract only. */
async function legacyQuoteTurn(userId:number,id:string,raw:unknown){
 const {snapshotInput}=await import('@aihot/backend/assistant/sessions');const {quoteTool}=await import('@aihot/backend/users/credits');
 const prepared=await snapshotInput(sql,userId,id,raw);return quoteTool(userId,prepared.intent);
}

/** Hold one completed transaction result outside its locks, at the real async boundary. */
function holdTransactionOutcome(matches: (value: any) => boolean, fails: (error: any) => boolean = () => false) {
  const reached = gate(), release = gate(), original = sql.begin.bind(sql);
  let waiting = true;
  sql.begin = (async (options: any, callback?: any) => {
    try {
      const value = callback ? await original(options, callback) : await original(options);
      if (waiting && matches(value)) { waiting = false; reached.open(); await release.promise; }
      return value;
    } catch (error) {
      if (waiting && fails(error)) { waiting = false; reached.open(); await release.promise; }
      throw error;
    }
  }) as typeof sql.begin;
  return { reached, release, restore: () => { sql.begin = original; } };
}

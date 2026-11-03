import { additionalFeeKinds } from "@aihot/backend/assistant/catalog";
import { quoteTool } from "@aihot/backend/users/credits";
import { catalog } from "@aihot/backend/assistant/catalog";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { assistantOptions, createSession, snapshotInput, submitTurn, sessionSnapshot } from "@aihot/backend/assistant/sessions";
import { answerTurn, controlTurn } from "@aihot/backend/assistant/controls";
import { decideCall, prepareSearch, activeTools, sourceCandidates } from "@aihot/backend/assistant/tools";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { recoverAssistantChildren } from "@aihot/backend/assistant/execution";
import { releaseOperationReceipt } from "@aihot/backend/providers/operations/recovery";
import { controlOperation } from "@aihot/backend/providers/operations/read";
import { config } from "@aihot/backend/config";
const completion = (name: string, input: unknown) => ({
  id: "fixture",
  created: 1,
  model: "fixture",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
});
test("assistant receipts, request limits, approvals and stop retain financial boundaries", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const restoreBudgetScope = await allowTestBudgetScope(["assistant.text", "redfox.query"], "member");
  const unique = tag(),
    model = `recovery-${unique}`;
  let mode = "malformed",
    counter = 0;
  const supplier = await stub((_hit, req) => {
    const body = JSON.parse(req.body);
    if (mode === "malformed") return { choices: [] };
    if (mode === "text-only") return { id: "text-only", created: 1, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: "这是一条尚未交付稿件的文字回复。" }, finish_reason: "stop" }] };
    if (mode === "question") return completion("ask_question", { text: "请补充材料" });
    const rewrite = mode.startsWith("m2-");
    const xhs = mode.startsWith("search") || rewrite;
    const moduleId = rewrite ? "M2" : xhs ? "M1" : "write",
      skillId = xhs ? "xiaohongshu-creator" : "general-writing";
    if (mode === "limit" || !body.tools.some((x: any) => x.function.name === "save_draft"))
      return completion("load_skill", { skillId, moduleId });
    const activationId = JSON.parse(
      body.messages.find((m: any) => m.role === "tool" && m.content.includes("activationId")).content,
    ).activationId;
    if (rewrite) return completion("save_draft", {
      activationId, kind: "xhs-note", baseVersion: 0,
      content: {
        title: "测试改写✨", body: "保留用户给出的事实🌿📖。", intent: "rewrite", titles: [],
        tags: mode === "m2-no-tags" ? [] : ["改写", "材料"],
        sources: ["current-message"], partial: false, scope: "用户给定材料",
      },
    });
    if (mode === "fake-source")
      return completion("save_draft", {
        activationId,
        kind: "text-draft",
        baseVersion: 0,
        content: {
          title: "伪引用",
          body: "稿件",
          intent: "draft",
          titles: [],
          tags: [],
          sources: ["https://made-up.invalid"],
          partial: false,
          scope: "材料",
        },
      });
    if (mode === "search-again" || !body.messages.some((m: any) => m.role === "tool" && m.content.includes("limited")))
      return completion("search_xhs_notes", {
        activationId,
        keyword: `测试相机-${unique}`,
        startDate: "2026-10-23",
        endDate: "2026-10-29",
      });
    const research = JSON.parse(
      body.messages.find((m: any) => m.role === "tool" && m.content.includes("limited")).content,
    );
    return completion("save_draft", {
      activationId,
      kind: "xhs-note",
      baseVersion: 0,
      content: {
        title: "测试笔记",
        body: "按真实材料写的测试笔记",
        intent: "draft",
        titles: ["A", "B", "C"],
        tags: ["相机", "测试", "材料", "写作", "样例"],
        sources: [`search:${research.results[0].id}`],
        partial: true,
        scope: "仅1条研究样本",
      },
    });
  });
  const redfox = await stub(() => ({
    articles: [
      {
        id: "fixture-note",
        title: "真实桩笔记",
        desc: "内容",
        shareInfoLink: "https://www.xiaohongshu.com/explore/fixture-note",
      },
    ],
    latestHotArticles: [],
  }));
  const previousPrivate = config.allowPrivateNetworkFetch;
  try {
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
      REDFOX_TEST_BASE_URL: redfox.url,
      REDFOX_API_KEY: "synthetic-key",
      REDFOX_CALLS_ENABLED: "true",
    });
    config.allowPrivateNetworkFetch = true;
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','redfox.query')`;
    await saveToolPrice(
      {
        kind: "assistant-turn",
        provider: "assistant",
        model,
        baseCredits: 7,
        enabled: true,
        reason: "Fixture assistant price",
      },
      "test",
    );
    await saveToolPrice(
      {
        kind: "query",
        provider: "redfox",
        model: "3X8FGEEM",
        parameterMatch: { "parameters.keyword": `测试相机-${unique}` },
        baseCredits: 3,
        enabled: true,
        reason: "Fixture child price",
      },
      "test",
    );
    const setup = async (assistantId: "creative" | "xiaohongshu" = "creative") => {
      const user = await createSiteUser(
        {
          username: `ar_${unique}_${++counter}`,
          displayName: "Fixture",
          password: "synthetic-assistant-password",
        },
        "test",
      );
      await grantCredits(user.id, { amount: 100, reason: "Fixture credits" }, "test", randomUUID());
      const { sessionId } = await createSession(user.id, { assistantId }, randomUUID());
      const raw = { message: "已确认材料写稿", expectedRevision: 1 };
      const quote = await quoteTurn(user.id, sessionId, raw);
      const submitKey = randomUUID();
      const submitted = { ...raw, quoteId: quote.quoteId };
      const result = await submitTurn(user.id, sessionId, submitted, submitKey);
      if (mode.startsWith("search")) {
        // Recovery fixtures exercise already accepted v2 requests. New v3 M1 is covered in assistant-xhs-research.
        const old = (await catalog()).find((p) => p.manifest.skillId === "xiaohongshu-creator" && p.manifest.version === "2")!.manifest;
        const frozen = old.modules.map((m) => ({ skillId: old.skillId, version: old.version, packageHash: old.packageHash,
          moduleId: m.moduleId, moduleVersion: m.version, moduleHash: m.hash, description: m.description }));
        await sql`UPDATE assistant_turns SET snapshot=jsonb_set(snapshot,'{candidates}',${sql.json(frozen)}) WHERE id=${result.turnId}`;
      }
      return { user, sessionId, submitted, submitKey, ...result };
    };
    const advance = async (runId: number) => {
      const [r] = await sql`SELECT * FROM operation_runs WHERE id=${runId}`;
      await executeOperationStep(runId, r.step_version, randomUUID());
    };
    const approvedSearch = async () => {
      mode = "search";
      const x = await setup("xiaohongshu");
      for (let i = 0; i < 4; i++) await advance(x.runId);
      const proposal = (await sessionSnapshot(x.user.id, x.sessionId)).turn!.calls[0]!;
      await decideCall(x.user.id, x.sessionId, proposal.callId, true, { proposalRevision: 1 }, randomUUID());
      const [call] = await sql`SELECT * FROM assistant_tool_calls WHERE id=${proposal.callId}`;
      return { ...x, call };
    };
    await t.test("closed or missing member budget rejects new work but preserves accepted command replay", async () => {
      const x = await setup();
      const { sessionId } = await createSession(x.user.id, { assistantId: "creative" }, randomUUID());
      const input = { message: "新的材料", expectedRevision: 1 };
      const quoted = await quoteTurn(x.user.id, sessionId, input);
      const restore = await allowTestBudgetScope(["assistant.text"], "member");
      const [before] = await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${x.user.id}`;
      try {
        for (const state of ["zero", "missing"]) {
          if (state === "zero") await sql`UPDATE budget_scopes SET per_minute=0 WHERE service='assistant.text' AND scope='member'`;
          else await sql`DELETE FROM budget_scopes WHERE service='assistant.text' AND scope='member'`;
          assert((await assistantOptions(x.user.id)).assistants.every((a) => !a.available));
          await assert.rejects(quoteTurn(x.user.id, sessionId, input), /预算/);
          await assert.rejects(submitTurn(x.user.id, sessionId, { ...input, quoteId: quoted.quoteId }, randomUUID()), /预算/);
          assert.deepEqual(await submitTurn(x.user.id, x.sessionId, x.submitted, x.submitKey), { turnId: x.turnId, runId: x.runId });
        }
        const [after] = await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${x.user.id}`;
        assert.deepEqual(after, before);
      } finally {
        // The helper restores existing rows with UPDATE, so restore the deliberately removed fixture first.
        await sql`INSERT INTO budget_scopes(service,scope) VALUES ('assistant.text','member') ON CONFLICT DO NOTHING`;
        await restore();
      }
    });
    await t.test("committed text-only response is idempotent and cannot be resumed into a delivery", async () => {
      mode = "text-only";
      const x = await setup(), before = supplier.hits();
      await advance(x.runId);
      const first = await sessionSnapshot(x.user.id, x.sessionId);
      assert.equal(first.turn!.status, "needs_review");
      const countText = (s: typeof first) => s.messages.filter((m) => m.role === "assistant" && m.text).length;
      assert.equal(countText(first), 1);
      // A recovery wakeup reaching an already committed decision must not append the response again.
      await sql`UPDATE operation_runs SET status='active' WHERE id=${x.runId}`;
      await advance(x.runId);
      const again = await sessionSnapshot(x.user.id, x.sessionId);
      assert.equal(countText(again), 1);
      assert.equal(supplier.hits(), before + 1);
      await controlTurn(x.user.id, x.sessionId, x.turnId, "stop", { generation: again.turn!.generation });
      const stopped = await sessionSnapshot(x.user.id, x.sessionId);
      assert.equal(stopped.turn!.canResume, false);
      await assert.rejects(controlTurn(x.user.id, x.sessionId, x.turnId, "resume", { generation: stopped.turn!.generation }), /交付|继续/);
      const [run] = await sql`SELECT step_version,generation FROM operation_runs WHERE id=${x.runId}`;
      await assert.rejects(controlOperation(x.runId, "resume", { stepVersion: run.step_version, generation: run.generation, reason: "核对文字回复" }, "admin:91001"), /交付|继续/);
      const [facts] = await sql`SELECT
        (SELECT count(*)::int FROM operation_results WHERE run_id=${x.runId}) results,
        (SELECT count(*)::int FROM assistant_tool_calls WHERE turn_id=${x.turnId}) calls,
        (SELECT count(*)::int FROM member_credit_charges WHERE root_run_id=${x.runId}) charges`;
      assert.deepEqual(facts, { results: 1, calls: 0, charges: 1 });
    });
    await t.test("account disablement after authentication rejects a new answer but permits accepted answer replay", async () => {
      mode = "question";
      const x = await setup();
      await advance(x.runId); await advance(x.runId);
      const before = await sessionSnapshot(x.user.id, x.sessionId);
      const answer = { questionId: before.turn!.question!.questionId, expectedRevision: before.revision, answer: "已确认材料" };
      // Models the command after HTTP authentication succeeded but account disablement committed before its transaction.
      await sql`UPDATE site_users SET status='disabled' WHERE id=${x.user.id}`;
      await assert.rejects(answerTurn(x.user.id, x.sessionId, x.turnId, answer), /停用/);
      const unchanged = await sessionSnapshot(x.user.id, x.sessionId);
      assert.equal(unchanged.revision, before.revision);
      assert.equal(unchanged.messages.length, before.messages.length);
      assert.equal(unchanged.turn!.phase, "waiting_question");
      await sql`UPDATE site_users SET status='active' WHERE id=${x.user.id}`;
      await answerTurn(x.user.id, x.sessionId, x.turnId, answer);
      const accepted = await sessionSnapshot(x.user.id, x.sessionId);
      await sql`UPDATE site_users SET status='disabled' WHERE id=${x.user.id}`;
      assert.deepEqual(await answerTurn(x.user.id, x.sessionId, x.turnId, answer), { turnId: x.turnId });
      assert.equal((await sessionSnapshot(x.user.id, x.sessionId)).messages.length, accepted.messages.length);
    });
    await t.test("member assistant budget cannot fall back to the admin pool or total cap", async () => {
      const restoreAdmin = await allowTestBudgetScope(["assistant.text"], "admin");
      const x = await setup(), before = supplier.hits();
      const [chargeBefore] = await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id=${x.runId}`;
      await sql`UPDATE budget_scopes SET per_minute=0 WHERE service='assistant.text' AND scope='member'`;
      try {
        await advance(x.runId);
        assert.equal(supplier.hits(), before);
        const [r] = await sql`SELECT status,current_receipt_id FROM operation_runs WHERE id=${x.runId}`;
        assert.equal(r.status, "waiting");
        assert.equal(r.current_receipt_id, null);
        const [attempts] = await sql`SELECT count(*)::int n FROM receipt_attempts a JOIN receipts p ON p.id=a.receipt_id
          WHERE p.subject IN (SELECT id::text FROM assistant_model_steps WHERE turn_id=${x.turnId})`;
        assert.equal(attempts.n, 0);
        const [chargeAfter] = await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id=${x.runId}`;
        assert.deepEqual(chargeAfter, chargeBefore);
      } finally {
        await sql`UPDATE budget_scopes SET per_minute=10000 WHERE service='assistant.text' AND scope='member'`;
        await restoreAdmin();
      }
      const snapshot = await sessionSnapshot(x.user.id, x.sessionId);
      await controlTurn(x.user.id, x.sessionId, x.turnId, "stop", { generation: snapshot.turn!.generation });
    });
    await t.test("malformed HTTP 200 stays received and local replay never buys again", async () => {
      mode = "malformed";
      const x = await setup();
      const before = supplier.hits();
      await advance(x.runId);
      const [r] = await sql`SELECT * FROM operation_runs WHERE id=${x.runId}`;
      assert.equal(r.status, "needs_review");
      const [receipt] = await sql`SELECT * FROM receipts WHERE id=${r.current_receipt_id}`;
      assert.equal(receipt.status, "received");
      const [attempt] = await sql`SELECT budget_scope FROM receipt_attempts WHERE receipt_id=${receipt.id}`;
      assert.equal(attempt.budget_scope, "member");
      assert.match(receipt.response.body, /choices/);
      await controlTurn(x.user.id, x.sessionId, x.turnId, "stop", { generation: r.generation });
      const stopped = await sessionSnapshot(x.user.id, x.sessionId);
      await controlTurn(x.user.id, x.sessionId, x.turnId, "resume", { generation: stopped.turn!.generation });
      await advance(x.runId);
      assert.equal(supplier.hits(), before + 1);
    });
    await t.test(
      "received response survives a failed business commit and recovery consumes it once",
      async () => {
        mode = "limit";
        const x = await setup(),
          before = supplier.hits();
        await sql.unsafe(
          `CREATE FUNCTION assistant_test_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.decision IS NOT NULL THEN RAISE EXCEPTION 'synthetic commit interruption'; END IF; RETURN NEW; END $$`,
        );
        await sql.unsafe(
          `CREATE TRIGGER assistant_test_fail_commit BEFORE UPDATE ON assistant_model_steps FOR EACH ROW EXECUTE FUNCTION assistant_test_fail_commit()`,
        );
        try {
          await advance(x.runId);
        } finally {
          await sql.unsafe("DROP TRIGGER assistant_test_fail_commit ON assistant_model_steps");
          await sql.unsafe("DROP FUNCTION assistant_test_fail_commit()");
        }
        const [r] = await sql`SELECT * FROM operation_runs WHERE id=${x.runId}`;
        const [receipt] = await sql`SELECT status FROM receipts WHERE id=${r.current_receipt_id}`;
        assert.equal(receipt.status, "received");
        const [count] = await sql`SELECT count(*)::int n FROM assistant_tool_calls WHERE turn_id=${x.turnId}`;
        assert.equal(count.n, 0);
        assert.equal(r.status, "needs_review");
        const detail = await controlOperation(
          x.runId,
          "resume",
          {
            stepVersion: r.step_version,
            generation: r.generation,
            reason: "核对后复用已有响应",
          },
          "admin:91001",
        );
        assert.equal(detail!.inputs.assistant!.parentRunId, x.runId);
        const [owner] = await sql`SELECT actor,generation FROM operation_runs WHERE id=${x.runId}`;
        assert.equal(owner.actor, `user:${x.user.id}`);
        assert.equal(owner.generation, r.generation + 1);
        const [audit] =
          await sql`SELECT actor,reason FROM audit_log WHERE subject=${`operation:${x.runId}`} AND action='operation.resume' ORDER BY id DESC LIMIT 1`;
        assert.deepEqual(audit, { actor: "admin:91001", reason: "核对后复用已有响应" });
        process.env.ASSISTANT_CALLS_ENABLED = "false";
        process.env.MODEL_CALLS_ENABLED = "false";
        try {
          await advance(x.runId);
        } finally {
          process.env.ASSISTANT_CALLS_ENABLED = "true";
          process.env.MODEL_CALLS_ENABLED = "true";
        }
        assert.equal(supplier.hits(), before + 1);
        const [after] = await sql`SELECT status FROM receipts WHERE id=${r.current_receipt_id}`;
        assert.equal(after.status, "completed");
      },
    );
    await t.test("unknown assistant request cannot use automatic read-only release", async () => {
      mode = "malformed";
      const x = await setup();
      await advance(x.runId);
      const [r] = await sql`SELECT * FROM operation_runs WHERE id=${x.runId}`;
      await sql`UPDATE receipts SET status='unknown',updated_at=now()-interval '1 hour' WHERE id=${r.current_receipt_id}`;
      await assert.rejects(
        () =>
          controlOperation(
            x.runId,
            "resume",
            {
              stepVersion: r.step_version,
              generation: r.generation,
              reason: "未知请求不能重买",
            },
            "admin:91001",
          ),
        /未知或在途请求/,
      );
      const [unchanged] = await sql`SELECT generation,status FROM operation_runs WHERE id=${x.runId}`;
      assert.deepEqual(unchanged, { generation: r.generation, status: r.status });
      await sql`UPDATE operation_runs SET status='active' WHERE id=${x.runId}`;
      const before = supplier.hits();
      assert.equal((await releaseOperationReceipt(r.current_receipt_id)).released, false);
      await advance(x.runId);
      assert.equal(supplier.hits(), before);
      assert.equal((await sessionSnapshot(x.user.id, x.sessionId)).turn?.status, "needs_review");
    });
    await t.test("8 real attempts include repeated load; ninth refused before HTTP", async () => {
      mode = "limit";
      const x = await setup(),
        before = supplier.hits();
      for (let i = 0; i < 17; i++) await advance(x.runId);
      assert.equal(supplier.hits() - before, 8);
      const [turn] = await sql`SELECT model_calls FROM assistant_turns WHERE id=${x.turnId}`;
      assert.equal(turn.model_calls, 8);
      const [a] = await sql`SELECT count(*)::int n FROM assistant_activations WHERE turn_id=${x.turnId}`;
      assert.equal(a.n, 1);
    });
    await t.test("invented source cannot save or settle", async () => {
      mode = "fake-source";
      const x = await setup();
      for (let i = 0; i < 4; i++) await advance(x.runId);
      assert.equal((await sessionSnapshot(x.user.id, x.sessionId)).artifacts.length, 0);
      const [c] = await sql`SELECT state FROM member_credit_charges WHERE root_run_id=${x.runId}`;
      assert.equal(c.state, "review");
    });
    await t.test(
      "child quote is independent, duplicate approval is atomic, real child result resumes parent",
      async () => {
        mode = "search";
        const x = await setup("xiaohongshu");
        for (let i = 0; i < 4; i++) await advance(x.runId);
        const s = await sessionSnapshot(x.user.id, x.sessionId);
        assert.equal(s.turn?.phase, "waiting_approval");
        const call = s.turn!.calls[0]!;
        assert.equal(call.quote?.amount, 3);
        const before = redfox.hits();
        await assert.rejects(() =>
          decideCall(
            x.user.id + 99999,
            x.sessionId,
            call.callId,
            true,
            { proposalRevision: 1 },
            randomUUID(),
          ),
        );
        await Promise.all([
          decideCall(x.user.id, x.sessionId, call.callId, true, { proposalRevision: 1 }, randomUUID()),
          decideCall(x.user.id, x.sessionId, call.callId, true, { proposalRevision: 1 }, randomUUID()),
        ]);
        const [c] = await sql`SELECT * FROM assistant_tool_calls WHERE id=${call.callId}`;
        assert(c.child_run_id);
        assert.equal(redfox.hits(), before);
        await advance(x.runId);
        const [waiting] = await sql`SELECT generation,step_version FROM operation_runs WHERE id=${x.runId}`;
        // These tests drive the real dispatcher directly, so retire the already executed parent
        // queue entries just as pg-boss does before checking the newly enqueued continuation.
        await sql`UPDATE pgboss.job SET state='completed' WHERE name='operations.execute' AND data->>'runId'=${String(x.runId)}`;
        await advance(c.child_run_id);
        const [awakened] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
        assert.equal(awakened.status, "active", "the actual child dispatcher wakes its parent without the recovery cron");
        assert.equal(awakened.generation, waiting.generation + 1);
        const jobs = await sql`SELECT id,state FROM pgboss.job WHERE name='operations.execute' AND data->>'runId'=${String(x.runId)} AND state IN ('created','retry')`;
        assert.deepEqual(jobs.map(job => job.id), [awakened.job_id]);
        const [finishedChild] = await sql`SELECT step_version FROM operation_runs WHERE id=${c.child_run_id}`;
        await executeOperationStep(c.child_run_id, finishedChild.step_version, randomUUID());
        await recoverAssistantChildren(c.child_run_id);
        const [replayed] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
        assert.deepEqual(replayed, awakened, "duplicate delivery and recovery do not enqueue or fence the parent again");
        await advance(x.runId);
        await advance(x.runId);
        await advance(x.runId);
        const final = await sessionSnapshot(x.user.id, x.sessionId);
        assert.equal(final.turn?.status, "completed");
        assert.equal(final.artifacts.length, 1);
        assert.equal(redfox.hits(), before + 1);
        const charges =
          await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id IN (${x.runId},${c.child_run_id})`;
        assert.deepEqual(charges.map((c) => c.amount).sort(), [3, 7]);
        assert(charges.every((c) => c.state === "settled"));
        const attempts = await sql`SELECT a.budget_scope FROM receipt_attempts a WHERE a.receipt_id IN
          (SELECT receipt_id FROM assistant_model_steps WHERE turn_id=${x.turnId}
           UNION SELECT receipt_id FROM operation_results WHERE run_id=${c.child_run_id})`;
        assert(attempts.length >= 3);
        assert(attempts.every((a) => a.budget_scope === "member"));
      },
    );
    await t.test("parent post-step reconciliation covers a child that finished before its waiting commit", async () => {
      const x = await approvedSearch();
      // The child commits before the parent's waiting state is visible, so its notification has
      // nothing to wake. Reproduce the late wait commit and deliver the already-finished parent
      // step again: its post-step check must reconcile this race without the recovery scanner.
      await advance(x.call.child_run_id);
      const [parent] = await sql`SELECT status,generation,step_version FROM operation_runs WHERE id=${x.runId}`;
      assert.equal(parent.status, "active");
      await sql`UPDATE assistant_turns SET phase='waiting_child' WHERE id=${x.turnId}`;
      await sql`UPDATE operation_runs SET status='waiting',wait_reason='assistant:waiting_child' WHERE id=${x.runId}`;
      await sql`UPDATE pgboss.job SET state='completed' WHERE name='operations.execute' AND data->>'runId'=${String(x.runId)}`;
      const before = supplier.hits();
      await executeOperationStep(x.runId, parent.step_version, randomUUID());
      const [woken] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
      assert.equal(woken.status, "active");
      assert.equal(woken.generation, parent.generation + 1);
      assert(woken.job_id);
      assert.equal(supplier.hits(), before, "reconciliation only queues local continuation");
      for (let i = 0; i < 3; i++) await advance(x.runId);
      assert.equal((await sessionSnapshot(x.user.id, x.sessionId)).turn?.status, "completed");
    });
    await t.test("targeted child reconciliation ignores consumed history and preserves other waits and stopped parents", async () => {
      const x = await approvedSearch();
      await advance(x.runId);
      await advance(x.call.child_run_id);
      await advance(x.runId);
      // A previous, already consumed search in the same turn is not a completion signal for
      // the currently running child. Ask through the same turn's normal model/approval path.
      mode = "search-again";
      await advance(x.runId);
      await advance(x.runId);
      const [second] = await sql`SELECT id FROM assistant_tool_calls WHERE turn_id=${x.turnId} AND state='proposed'`;
      await decideCall(x.user.id, x.sessionId, second.id, true, { proposalRevision: 1 }, randomUUID());
      const [call] = await sql`SELECT * FROM assistant_tool_calls WHERE id=${second.id}`;
      await advance(x.runId);
      mode = "search";
      const [waiting] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
      const before = redfox.hits();
      assert.equal(await recoverAssistantChildren(x.runId), 0);
      assert.equal(await recoverAssistantChildren(call.child_run_id), 0);
      const [unchanged] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
      assert.deepEqual(unchanged, waiting);
      assert.equal(redfox.hits(), before);
      // Finish the current child while each protected parent state is visible. Neither the
      // targeted post-step notification nor the fallback scan may turn it into executable work.
      await sql`UPDATE assistant_turns SET phase='waiting_question' WHERE id=${x.turnId}`;
      await sql`UPDATE operation_runs SET wait_reason='assistant:waiting_question' WHERE id=${x.runId}`;
      await advance(call.child_run_id);
      for (const phase of ["waiting_question", "waiting_approval"]) {
        await sql`UPDATE assistant_turns SET phase=${phase} WHERE id=${x.turnId}`;
        await sql`UPDATE operation_runs SET wait_reason=${`assistant:${phase}`} WHERE id=${x.runId}`;
        const [expected] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
        assert.equal(await recoverAssistantChildren(call.child_run_id), 0);
        const [actual] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
        assert.deepEqual(actual, expected);
      }
      await sql`UPDATE assistant_turns SET phase='waiting_child' WHERE id=${x.turnId}`;
      await sql`UPDATE operation_runs SET status='stopped',wait_reason='Stopped by owner' WHERE id=${x.runId}`;
      const [stopped] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
      assert.equal(await recoverAssistantChildren(call.child_run_id), 0);
      await recoverAssistantChildren();
      const [stillStopped] = await sql`SELECT status,generation,job_id FROM operation_runs WHERE id=${x.runId}`;
      assert.deepEqual(stillStopped, stopped);
    });
    await t.test("legacy draft argument failure is corrected without repeating approved research; ownership conflicts stay closed", async () => {
      for (const badId of ["invented-slug", randomUUID()]) {
        mode = "search";
        const x = await setup("xiaohongshu");
        for (let i = 0; i < 4; i++) await advance(x.runId);
        const proposal = (await sessionSnapshot(x.user.id, x.sessionId)).turn!.calls[0]!;
        await decideCall(x.user.id, x.sessionId, proposal.callId, true, { proposalRevision: 1 }, randomUUID());
        const [search] = await sql`SELECT * FROM assistant_tool_calls WHERE id=${proposal.callId}`;
        const before = redfox.hits();
        await advance(x.runId);
        await advance(search.child_run_id);
        await advance(x.runId);
        await advance(x.runId);
        const [draft] = await sql`SELECT c.*,s.request_snapshot FROM assistant_tool_calls c JOIN assistant_model_steps s ON s.id=c.model_step_id WHERE c.turn_id=${x.turnId} AND c.name='save_draft'`;
        assert(draft);
        assert(!Object.hasOwn(draft.request_snapshot.tools.save_draft.schema.properties, "artifactId"), "new sessions cannot invent draft IDs");
        // Simulate the old persisted schema and arguments, already accepted before this fix.
        const oldSnapshot = structuredClone(draft.request_snapshot);
        oldSnapshot.tools.save_draft.schema.properties.artifactId = { type: "string" };
        await sql`UPDATE assistant_model_steps SET request_snapshot=${sql.json(oldSnapshot)} WHERE id=${draft.model_step_id}`;
        await sql`UPDATE assistant_tool_calls SET input=${sql.json({ ...draft.input, artifactId: badId })} WHERE id=${draft.id}`;
        await advance(x.runId);
        const failedSnapshot = await sessionSnapshot(x.user.id, x.sessionId);
        assert.equal(failedSnapshot.artifacts.length, 0);
        assert.equal(redfox.hits(), before + 1);
        const [bad] = await sql`SELECT state,input,result FROM assistant_tool_calls WHERE id=${draft.id}`;
        assert.equal(bad.input.artifactId, badId, "original arguments remain evidence");
        if (badId !== "invented-slug") {
          assert.equal(failedSnapshot.turn?.status, "needs_review", "valid UUID with no owned artifact is not a parameter retry");
          assert.equal(bad.state, "pending");
          continue;
        }
        assert.equal(bad.state, "failed");
        assert.deepEqual(bad.result.fields, ["artifactId"]);
        assert.equal(bad.result.error, "invalid_tool_arguments");
        assert.equal(failedSnapshot.turn!.activities!.find((a) => a.callId === draft.id)?.state, "failed");
        const [messagesBefore] = await sql`SELECT count(*)::int n FROM assistant_messages WHERE turn_id=${x.turnId} AND role='tool' AND model_message::text LIKE '%invalid_tool_arguments%'`;
        assert.equal(messagesBefore.n, 1);
        await advance(x.runId);
        await advance(x.runId);
        const final = await sessionSnapshot(x.user.id, x.sessionId);
        assert.equal(final.turn?.status, "completed");
        assert.equal(final.artifacts.length, 1);
        assert.equal(redfox.hits(), before + 1);
        const [turn] = await sql`SELECT * FROM assistant_turns WHERE id=${x.turnId}`;
        const { tools: active } = await sql.begin((tx) => activeTools(tx, turn));
        assert.deepEqual(active.save_draft.schema.properties.artifactId.enum, [final.artifacts[0]!.artifactId]);
        assert.equal(active.save_draft.schema.properties.artifactId.format, "uuid");
        const artifactId = final.artifacts[0]!.artifactId;
        const selected = [1, 1, 2].map((version) => ({ artifact_id: artifactId, version, content: { title: "相同标题" } }));
        const sources = await sql.begin((tx) => sourceCandidates(tx, { ...turn, snapshot: { ...turn.snapshot, selected } }));
        assert.deepEqual(sources.filter((source) => source.kind === "artifact").map((source) => source.id),
          [`artifact:${artifactId}:1`, `artifact:${artifactId}:2`]);
        assert.equal(selected.length, 3, "source projection does not rewrite frozen input");
        const [messagesAfter] = await sql`SELECT count(*)::int n FROM assistant_messages WHERE turn_id=${x.turnId} AND role='tool' AND model_message::text LIKE '%invalid_tool_arguments%'`;
        assert.equal(messagesAfter.n, 1);
        const charges = await sql`SELECT amount,state FROM member_credit_charges WHERE root_run_id IN (${x.runId},${search.child_run_id})`;
        assert.equal(charges.length, 2);
        assert.deepEqual(charges.map((c) => c.amount).sort(), [3, 7]);
        assert(charges.every((c) => c.state === "settled"));
        assert.equal(final.turn!.activities!.find((a) => a.callId === draft.id)?.state, "failed");
      }
    });
    await t.test("M2 saves its primary title without imposing alternative-title or tag counts", async () => {
      for (const missingTags of [false, true]) {
        mode = missingTags ? "m2-no-tags" : "m2-single-title";
        const before = redfox.hits();
        const x = await setup("xiaohongshu");
        for (let i = 0; i < 4; i++) await advance(x.runId);
        const snapshot = await sessionSnapshot(x.user.id, x.sessionId);
        assert.equal(redfox.hits(), before, "M2 does not query research");
        assert.equal(snapshot.turn?.status, "completed");
        assert.equal(snapshot.artifacts.length, 1);
        assert.equal(snapshot.artifacts[0]!.content.title, "测试改写✨");
        assert.deepEqual(snapshot.artifacts[0]!.content.titles, []);
        assert.deepEqual(snapshot.artifacts[0]!.content.tags, missingTags ? [] : ["改写", "材料"]);
        const [charge] = await sql`SELECT state,consumed FROM member_credit_charges WHERE root_run_id=${x.runId}`;
        assert.equal(charge.state, "settled");
        assert.equal(charge.consumed, 7);
      }
    });
    await t.test("assistant search cannot bypass cost eligibility at quote or approval; completed approval still replays", async () => {
      mode = "search";
      const x = await setup("xiaohongshu");
      for (let i = 0; i < 3; i++) await advance(x.runId);
      const [turn] = await sql`SELECT t.*,s.owner_user_id FROM assistant_turns t JOIN assistant_sessions s ON s.id=t.session_id WHERE t.id=${x.turnId}`;
      const [call] = await sql`SELECT * FROM assistant_tool_calls WHERE turn_id=${x.turnId} AND name='search_xhs_notes'`;
      const [cost] = await sql`SELECT source_url FROM service_prices WHERE service='redfox.query' AND model='3X8FGEEM' AND currency='CNY'`;
      assert(cost?.source_url, "Approved search fixture needs its seeded cost basis");
      const removeCost = () => sql`UPDATE service_prices SET source_url=NULL WHERE service='redfox.query' AND model='3X8FGEEM' AND currency='CNY'`;
      const restoreCost = () => sql`UPDATE service_prices SET source_url=${cost.source_url} WHERE service='redfox.query' AND model='3X8FGEEM' AND currency='CNY'`;
      const before = redfox.hits();
      try {
        await removeCost();
        await assert.rejects(prepareSearch(turn, call), /成本尚未核定/);
        await restoreCost();
        await advance(x.runId);
        await removeCost();
        await assert.rejects(decideCall(x.user.id, x.sessionId, call.id, true, { proposalRevision: 1 }, randomUUID()), /成本尚未核定/);
        const [unchanged] = await sql`SELECT state,child_run_id FROM assistant_tool_calls WHERE id=${call.id}`;
        assert.deepEqual(unchanged, { state: "proposed", child_run_id: null });
        const [charges] = await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${x.user.id}`;
        assert.equal(charges.n, 1, "Only the original assistant charge exists");
        await restoreCost();
        await decideCall(x.user.id, x.sessionId, call.id, true, { proposalRevision: 1 }, randomUUID());
        const [approved] = await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${call.id}`;
        await removeCost();
        const replay = await decideCall(x.user.id, x.sessionId, call.id, true, { proposalRevision: 1 }, randomUUID());
        assert.equal(replay.childRunId, approved.child_run_id);
        assert.equal(redfox.hits(), before);
      } finally {
        await restoreCost();
        const snapshot = await sessionSnapshot(x.user.id, x.sessionId);
        await controlTurn(x.user.id, x.sessionId, x.turnId, "stop", { generation: snapshot.turn!.generation });
      }
    });
    await t.test("deactivated member cannot dispatch an approved child", async () => {
      mode = "search";
      const x = await setup("xiaohongshu");
      for (let i = 0; i < 4; i++) await advance(x.runId);
      const snapshot = await sessionSnapshot(x.user.id, x.sessionId),
        call = snapshot.turn!.calls[0]!;
      await decideCall(x.user.id, x.sessionId, call.callId, true, { proposalRevision: 1 }, randomUUID());
      const [c] = await sql`SELECT child_run_id FROM assistant_tool_calls WHERE id=${call.callId}`;
      const before = redfox.hits();
      await sql`UPDATE site_users SET status='disabled' WHERE id=${x.user.id}`;
      await advance(c.child_run_id);
      assert.equal(redfox.hits(), before);
      const [attempt] = await sql`SELECT current_receipt_id FROM operation_runs WHERE id=${c.child_run_id}`;
      assert.equal(attempt.current_receipt_id, null);
    });
    await t.test("stop racing approval leaves no executable orphan child", async () => {
      mode = "search";
      const x = await setup("xiaohongshu");
      for (let i = 0; i < 4; i++) await advance(x.runId);
      const s = await sessionSnapshot(x.user.id, x.sessionId),
        call = s.turn!.calls[0]!;
      await Promise.allSettled([
        decideCall(x.user.id, x.sessionId, call.callId, true, { proposalRevision: 1 }, randomUUID()),
        controlTurn(x.user.id, x.sessionId, x.turnId, "stop", { generation: s.turn!.generation }),
      ]);
      const [r] = await sql`SELECT status FROM operation_runs WHERE id=${x.runId}`;
      if (r.status !== "stopped") {
        const latest = await sessionSnapshot(x.user.id, x.sessionId);
        await controlTurn(x.user.id, x.sessionId, x.turnId, "stop", { generation: latest.turn!.generation });
      }
      const children =
        await sql`SELECT r.status FROM operation_runs r JOIN assistant_tool_calls c ON c.child_run_id=r.id WHERE c.turn_id=${x.turnId}`;
      assert(children.every((c) => c.status === "stopped"));
    });
  } finally {
    config.allowPrivateNetworkFetch = previousPrivate;
    await supplier.close();
    await redfox.close();
    await stopBoss();
    await restoreBudgetScope();
    await closeDb();
  }
});

/** Historical single-tool quote fixture. Current task entry is covered in assistant-task-entry.test.ts. */
async function quoteTurn(userId:number,id:string,raw:unknown) {
 await (await import("@aihot/backend/assistant/config")).requireAvailable();
 const prepared=await snapshotInput(sql,userId,id,raw);
 return {...await quoteTool(userId,prepared.intent),additionalFeeKinds:await additionalFeeKinds(prepared.snapshot.candidates)};
}

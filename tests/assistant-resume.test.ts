import { quoteLegacyTurn, submitLegacyTurn as submitTurn } from "./assistant-legacy-fixture.ts";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, quoteTool, reconcileCreditCharge, saveToolPrice } from "@aihot/backend/users/credits";
import { createSession,   sessionSnapshot } from "@aihot/backend/assistant/sessions";
import { controlTurn } from "@aihot/backend/assistant/controls";
import { controlOperation, operationDetail } from "@aihot/backend/providers/operations/read";
import { advanceRun, createRun, saveResult } from "@aihot/backend/providers/operations/store";

test("historical general-writing v2 resume admits the complete group and preserves its financial and waiting boundaries", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const restoreBudgetScope = await allowTestBudgetScope(["assistant.text"], "member");
  const unique = tag(),
    model = `resume-${unique}`;
  const supplier = await stub(() => {
    throw new Error("Resume must not call a provider");
  });
  let counter = 0;
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
    });
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
    for (const [kind, provider] of [
      ["assistant-turn", "assistant"],
      ["query", "redfox"],
    ] as const)
      await saveToolPrice(
        { kind, provider, model, baseCredits: 1, enabled: true, reason: "Resume fixture price" },
        "test",
      );
    const member = async () => {
      const user = await createSiteUser(
        {
          username: `rr_${unique}_${++counter}`,
          displayName: "Resume fixture",
          password: "synthetic-assistant-password",
        },
        "test",
      );
      await grantCredits(user.id, { amount: 100, reason: "Resume fixture credits" }, "test", randomUUID());
      return user;
    };
    const start = async (user?: Awaited<ReturnType<typeof member>>) => {
      user ??= await member();
      const { sessionId } = await createSession(user.id, { assistantId: "creative" }, randomUUID());
      const input = { message: "基于已确认材料写稿", expectedRevision: 1, skillSelection: {actionId:"general-writing"} };
      const q = await quoteTurn(user.id, sessionId, input);
      return {
        user,
        sessionId,
        ...(await submitTurn(user.id, sessionId, { ...input, quoteId: q.quoteId }, randomUUID())),
      };
    };
    type Fixture = Awaited<ReturnType<typeof start>>;
    const run = async (id: number) =>
      (
        await sql`SELECT id,status,generation,step_version,job_id,current_receipt_id FROM operation_runs WHERE id=${id}`
      )[0]!;
    const command = async (x: Fixture, action: "stop" | "resume") =>
      controlTurn(x.user.id, x.sessionId, x.turnId, action, { generation: (await run(x.runId)).generation });
    const adminCommand = async (x: Fixture, action: "stop" | "resume" | "abandon", runId = x.runId) => {
      const r = await run(runId);
      return controlOperation(
        runId,
        action,
        { stepVersion: r.step_version, generation: r.generation, reason: "恢复专项管理员核对" },
        "admin:91001",
      );
    };
    const ordinary = async (x: Fixture, child = false) => {
      const input = { fixture: randomUUID(), ...(child ? { assistantParentTurnId: x.turnId } : {}) };
      const intent = { kind: "query" as const, provider: "redfox", model, input };
      const q = await quoteTool(x.user.id, intent);
      return sql.begin((tx) =>
        createRun(tx, {
          actor: `user:${x.user.id}`,
          commandKey: randomUUID(),
          provider: "redfox",
          operationKey: "redfox.sync.query",
          contractVersion: 1,
          input,
          stepKey: "redfox.sync.query",
          authorization: { quoteId: q.quoteId, intent },
        }),
      );
    };
    const checkpoint = async (x: Fixture, phase: string, childCount = 0) => {
      const question =
        phase === "waiting_question" ? { questionId: randomUUID(), text: "选择写作风格" } : null;
      const children = [];
      if (childCount) {
        const stepId = randomUUID();
        await sql`INSERT INTO assistant_model_steps(id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash) VALUES (${stepId},${x.turnId},1,1,'{}',${randomUUID()})`;
        for (let i = 0; i < childCount; i++) {
          const child = await ordinary(x, true);
          await sql`INSERT INTO assistant_tool_calls(id,turn_id,model_step_id,ordinal,upstream_id,name,input,state,child_run_id) VALUES (${randomUUID()},${x.turnId},${stepId},${i},${`call_${i}`},'search_xhs_notes','{}','running',${child.id})`;
          children.push(child);
        }
      }
      await sql`UPDATE assistant_turns SET phase=${phase},pending_question=${question ? sql.json(question) : null} WHERE id=${x.turnId}`;
      await sql`UPDATE operation_runs SET status='waiting',wait_reason=${`assistant:${phase}`} WHERE id=${x.runId}`;
      return { question, children };
    };
    const completeChild = async (id: number) => {
      const r = await run(id),
        execution = { runId: id, stepVersion: r.step_version, generation: r.generation };
      await sql.begin(async (tx) => {
        await saveResult(tx, execution, { itemKey: "query", kind: "query_summary", data: { count: 0 } });
        await advanceRun(tx, execution, null);
      });
    };
    const countActive = async (x: Fixture) =>
      (
        await sql`SELECT count(*)::int n FROM operation_runs WHERE actor=${`user:${x.user.id}`} AND status IN ('active','waiting')`
      )[0]!.n;

    await t.test("every phase rejects the sixth active task without changing the checkpoint", async () => {
      for (const phase of ["executing", "waiting_question", "waiting_approval", "waiting_child"]) {
        const x = await start();
        const { children } = await checkpoint(x, phase, phase === "waiting_child" ? 1 : 0);
        for (const child of children) await completeChild(child.id);
        await command(x, "stop");
        for (let i = 0; i < 5; i++) await ordinary(x);
        const before = await run(x.runId);
        await assert.rejects(() => command(x, "resume"), /同时最多执行 5 个任务/);
        await assert.rejects(() => adminCommand(x, "resume"), /同时最多执行 5 个任务/);
        assert.deepEqual(await run(x.runId), before);
        assert.equal(await countActive(x), 5);
      }
    });

    await t.test("resume preserves question and approval waits without queueing the parent", async () => {
      for (const phase of ["waiting_question", "waiting_approval", "waiting_child"]) {
        const x = await start();
        const { question, children } = await checkpoint(x, phase, phase === "waiting_child" ? 1 : 0);
        for (const child of children) await completeChild(child.id);
        await command(x, "stop");
        for (let i = 0; i < 4; i++) await ordinary(x);
        const before = await run(x.runId);
        await command(x, "resume");
        const after = await run(x.runId),
          snapshot = await sessionSnapshot(x.user.id, x.sessionId);
        assert.equal(after.status, "waiting");
        assert.equal(after.generation, before.generation + 1);
        assert.equal(after.job_id, null);
        assert.equal(snapshot.turn!.phase, phase);
        assert.deepEqual(snapshot.turn!.question, question);
        assert.equal(await countActive(x), 5);
        for (const child of children) assert.equal((await run(child.id)).status, "completed");
      }
    });

    await t.test("a parent and two stopped children are admitted atomically", async () => {
      const x = await start(),
        { children } = await checkpoint(x, "waiting_child", 2);
      await adminCommand(x, "stop");
      const others = [];
      for (let i = 0; i < 3; i++) others.push(await ordinary(x));
      const before = await Promise.all([x.runId, ...children.map((c) => c.id)].map(run));
      const [jobsBefore] =
        await sql`SELECT count(*)::int n FROM pgboss.job WHERE data->>'runId' IN ${sql([x.runId, ...children.map((c) => c.id)].map(String))}`;
      await assert.rejects(() => command(x, "resume"), /同时最多执行 5 个任务/);
      await assert.rejects(() => adminCommand(x, "resume"), /同时最多执行 5 个任务/);
      assert.deepEqual(await Promise.all([x.runId, ...children.map((c) => c.id)].map(run)), before);
      const [jobsAfter] =
        await sql`SELECT count(*)::int n FROM pgboss.job WHERE data->>'runId' IN ${sql([x.runId, ...children.map((c) => c.id)].map(String))}`;
      assert.equal(jobsAfter.n, jobsBefore.n);
      await sql`UPDATE operation_runs SET status='stopped' WHERE id=${others[0]!.id}`;
      await adminCommand(x, "resume");
      assert.equal((await run(x.runId)).status, "waiting");
      for (const child of children) assert.equal((await run(child.id)).status, "active");
      assert.equal(await countActive(x), 5);
    });

    await t.test("resume still enforces the two-parent limit", async () => {
      const x = await start();
      await checkpoint(x, "waiting_question");
      await command(x, "stop");
      await start(x.user);
      await start(x.user);
      await assert.rejects(() => command(x, "resume"), /最多执行2个助手回合/);
      await assert.rejects(() => adminCommand(x, "resume"), /最多执行2个助手回合/);
      assert.equal((await run(x.runId)).status, "stopped");
      assert.equal(await countActive(x), 2);
    });

    await t.test("a finalized stopped child disables resume and cannot reopen either charge", async () => {
      const x = await start(),
        { children } = await checkpoint(x, "waiting_child", 1),
        child = children[0]!;
      await command(x, "stop");
      const [charge] = await sql`SELECT id FROM member_credit_charges WHERE root_run_id=${child.id}`;
      await reconcileCreditCharge(charge.id, { consume: 0, reason: "已确认没有交付" }, "test", randomUUID());
      const before = await Promise.all([x.runId, child.id].map(run));
      assert.equal((await sessionSnapshot(x.user.id, x.sessionId)).turn!.canResume, false);
      await assert.rejects(() => command(x, "resume"), /积分已结算或释放/);
      await assert.rejects(() => adminCommand(x, "resume"), /积分已结算或释放/);
      assert.deepEqual(await Promise.all([x.runId, child.id].map(run)), before);
      const [after] = await sql`SELECT state FROM member_credit_charges WHERE id=${charge.id}`;
      assert.equal(after.state, "released");
    });

    await t.test(
      "parent finalization, pending/unknown receipts and superseding turns keep resume fenced",
      async () => {
        const finalized = await start();
        await command(finalized, "stop");
        const [charge] = await sql`SELECT id FROM member_credit_charges WHERE root_run_id=${finalized.runId}`;
        await reconcileCreditCharge(
          charge.id,
          { consume: 0, reason: "已确认没有交付" },
          "test",
          randomUUID(),
        );
        assert.equal((await sessionSnapshot(finalized.user.id, finalized.sessionId)).turn!.canResume, false);
        await assert.rejects(() => command(finalized, "resume"), /积分已结算或释放/);
        for (const status of ["pending", "unknown"])
          for (const atChild of [false, true]) {
            const x = await start(),
              { children } = await checkpoint(x, "waiting_child", atChild ? 1 : 0);
            const [receipt] =
              await sql`INSERT INTO receipts(logical_key,service,purpose,status,attempts,updated_at) VALUES (${randomUUID()},'assistant.text','assistant.turn',${status},1,now()-interval '1 day') RETURNING id`;
            await sql`UPDATE operation_runs SET current_receipt_id=${receipt.id} WHERE id=${atChild ? children[0]!.id : x.runId}`;
            await command(x, "stop");
            assert.equal((await sessionSnapshot(x.user.id, x.sessionId)).turn!.canResume, false);
            await assert.rejects(() => command(x, "resume"), /未知或在途请求/);
            await assert.rejects(() => adminCommand(x, "resume"), /未知或在途请求/);
            const [after] = await sql`SELECT status,attempts FROM receipts WHERE id=${receipt.id}`;
            assert.deepEqual(after, { status, attempts: 1 });
          }
        const old = await start();
        await command(old, "stop");
        const snapshot = await sessionSnapshot(old.user.id, old.sessionId);
        const input = { message: "新的创作要求", expectedRevision: snapshot.revision };
        const q = await quoteTurn(old.user.id, old.sessionId, input);
        await submitTurn(old.user.id, old.sessionId, { ...input, quoteId: q.quoteId }, randomUUID());
        await assert.rejects(() => command(old, "resume"), /不能恢复旧回合/);
        await assert.rejects(() => adminCommand(old, "resume"), /不能恢复旧回合/);
      },
    );
    await t.test("administrator controls route through the parent and keep member permissions", async () => {
      const x = await start(),
        { children } = await checkpoint(x, "waiting_child", 1),
        child = children[0]!;
      const detail = await operationDetail(child.id);
      assert.equal(detail!.inputs.assistant!.parentRunId, x.runId);
      assert.equal(detail!.nextAction, "assistant-parent");
      for (const action of ["resume", "stop", "abandon"] as const)
        await assert.rejects(() => adminCommand(x, action, child.id), /子任务须通过关联的父回合/);
      await assert.rejects(() => adminCommand(x, "abandon"), /不支持通用放弃/);
      await adminCommand(x, "stop");
      const stopped = await run(x.runId);
      await assert.rejects(
        () =>
          controlOperation(
            x.runId,
            "resume",
            {
              stepVersion: stopped.step_version,
              generation: stopped.generation,
              reason: "会员不能走管理员通道",
            },
            `user:${x.user.id}`,
          ),
        /请从助手会话控制/,
      );
      await sql`UPDATE operation_runs SET status='needs_review' WHERE id IN (${x.runId},${child.id})`;
      await adminCommand(x, "resume");
      assert.equal((await run(x.runId)).status, "waiting");
      assert.equal((await run(child.id)).status, "active");
      await adminCommand(x, "stop");
      await sql`UPDATE site_users SET status='disabled' WHERE id=${x.user.id}`;
      await assert.rejects(() => command(x, "resume"), /账号已停用/);
      await assert.rejects(() => adminCommand(x, "resume"), /账号已停用/);
      assert.equal((await run(x.runId)).status, "stopped");
      assert.equal((await run(child.id)).status, "stopped");
    });
    assert.equal(supplier.hits(), 0);
  } finally {
    await supplier.close();
    await stopBoss();
    await restoreBudgetScope();
    await closeDb();
  }
});

const quoteTurn=(userId:number,sessionId:string,raw:unknown)=>quoteLegacyTurn(userId,sessionId,raw,{"general-writing": "2"});

import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { creditHash } from "@aihot/backend/users/credits-core";
import { createSession, quoteTurn, submitTurn } from "@aihot/backend/assistant/sessions";
import { enqueueMessage, approveQueuedMessage } from "@aihot/backend/assistant/message-queue";
import { researchClock } from "@aihot/backend/assistant/xhs-research";
import { quoteLegacyTurn, submitLegacyTurn } from "./assistant-legacy-fixture.ts";

test("assistant quotes preserve their exact Shanghai business date across midnight", async t => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
  const restore = await allowTestBudgetScope(["assistant.text", "redfox.query"], "member");
  const supplier = await stub(() => ({})), model = `quote-clock-${tag()}`;
  const before = new Date("2030-01-01T15:59:50Z"), after = new Date("2030-01-01T16:00:10Z");
  Object.assign(process.env, { ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true",
    ASSISTANT_MODEL: "default", LLM_MODEL: model, LLM_BASE_URL: supplier.url + "/v1", LLM_API_KEY: "synthetic-clock-key",
    ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true", REDFOX_TEST_BASE_URL: supplier.url,
    REDFOX_API_KEY: "synthetic-clock-key", REDFOX_CALLS_ENABLED: "true" });
  const input = { message: "写一段散步感想", expectedRevision: 1, skillSelection: { skillId: "general-writing" },
    taskChoice: { skillId: "general-writing", moduleId: "write", delivery: "writing" } };
  const fixture = async () => {
    const [user] = await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`clock-${tag()}`},'clock','synthetic') RETURNING id`;
    const userId = Number(user!.id);
    await grantCredits(userId, { amount: 100, reason: "Synthetic clock fixture" }, "test", randomUUID());
    const { sessionId } = await createSession(userId, { assistantId: "creative" }, randomUUID());
    return { userId, sessionId };
  };
  const dateQuote = async (quoteId: string, date = before) => {
    // PostgreSQL now() is independent of Node's mocked clock.
    await sql`UPDATE member_tool_quotes SET created_at=${date} WHERE id=${quoteId}`;
  };
  const assertFrozen = async (turnId: string, quoteId: string) => {
    const [turn] = await sql`SELECT snapshot FROM assistant_turns WHERE id=${turnId}`;
    const [quote] = await sql`SELECT input_hash FROM member_tool_quotes WHERE id=${quoteId}`;
    assert.deepEqual(turn!.snapshot.researchClock, researchClock(before));
    const { queuePreviousTurnId, ...quotedSnapshot } = turn!.snapshot;
    assert.equal(creditHash({ kind: "assistant-turn", provider: "assistant", model, input: quotedSnapshot }), quote!.input_hash);
    return turn!.snapshot;
  };
  try {
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('assistant.text','redfox.query')`;
    for (const skill of ["general-writing", "xiaohongshu-creator"]) {
      await sql`INSERT INTO settings(key,value,updated_by) VALUES (${`assistant.skills.${skill}`},'{"acceptingNew":true,"revision":1}','test')
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    }
    await saveToolPrice({ kind: "assistant-turn", provider: "assistant", model, baseCredits: 7, enabled: true, reason: "Synthetic clock price" }, "test");
    const [queryPrice] = await sql`SELECT id,version FROM member_tool_prices WHERE kind='query' AND provider='redfox' AND model='3X8FGEEM' AND tier='' AND parameter_match='{}'::jsonb`;
    await saveToolPrice({ ...(queryPrice ? { id: queryPrice.id, expectedVersion: queryPrice.version } : {}),
      kind: "query", provider: "redfox", model: "3X8FGEEM", baseCredits: 3, enabled: true, reason: "Synthetic clock query" }, "test");
    await sql`INSERT INTO service_prices(service,model,currency,per_request,source_url) VALUES ('redfox.query','3X8FGEEM','CNY',0.001,'http://localhost/synthetic-clock')
      ON CONFLICT(service,model) DO UPDATE SET source_url=EXCLUDED.source_url`;
    t.mock.timers.enable({ apis: ["Date"], now: before });

    await t.test("direct confirmation freezes the quoted date, rejects changed input and reserves once on replay", async () => {
      t.mock.timers.setTime(before.getTime());
      const f = await fixture(), q = await quoteTurn(f.userId, f.sessionId, input);
      await dateQuote(q.quoteId);
      t.mock.timers.setTime(after.getTime());
      await assert.rejects(submitTurn(f.userId, f.sessionId, { ...input, message: "另一篇内容", quoteId: q.quoteId }, randomUUID()), (e: any) => e.code === "quote_changed");
      await assert.rejects(submitTurn(f.userId, f.sessionId, { ...input, researchClock: researchClock(before), quoteId: q.quoteId }, randomUUID()));
      const key = randomUUID(), accepted = await submitTurn(f.userId, f.sessionId, { ...input, quoteId: q.quoteId }, key);
      assert.deepEqual(await submitTurn(f.userId, f.sessionId, { ...input, quoteId: q.quoteId }, key), accepted);
      await assertFrozen(accepted.turnId, q.quoteId);
      const [charged] = await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${f.userId}`;
      assert.equal(charged!.n, 1);
    });
    await t.test("queued approval also recovers a snapshot prepared just before its quote was inserted after midnight", async () => {
      t.mock.timers.setTime(before.getTime());
      const f = await fixture(), entry = await enqueueMessage(f.userId, f.sessionId, { ...input, confirmationMode: "manual" }, randomUUID());
      const [row] = await sql`SELECT quote FROM assistant_message_queue WHERE id=${entry.entryId}`;
      await dateQuote(row!.quote.quoteId, after);
      t.mock.timers.setTime(after.getTime());
      const accepted = await approveQueuedMessage(f.userId, f.sessionId, entry.entryId, { quoteId: row!.quote.quoteId });
      assert(accepted.turnId);
      assert.equal((await approveQueuedMessage(f.userId, f.sessionId, entry.entryId, { quoteId: row!.quote.quoteId })).turnId, accepted.turnId);
      const [turn] = await sql`SELECT snapshot FROM assistant_turns WHERE id=${accepted.turnId}`;
      assert.deepEqual(turn!.snapshot.researchClock, researchClock(before));
      assert.equal(turn!.snapshot.confirmationMode, "manual");
    });
    await t.test("historical single-tool quotes retain their original authorization contract", async () => {
      t.mock.timers.setTime(before.getTime());
      const f = await fixture(), raw = { message: input.message, expectedRevision: 1, skillSelection: input.skillSelection };
      const q = await quoteLegacyTurn(f.userId, f.sessionId, raw, { "general-writing": "2" });
      assert.equal(q.task, undefined);
      await dateQuote(q.quoteId);
      t.mock.timers.setTime(after.getTime());
      const accepted = await submitLegacyTurn(f.userId, f.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
      const snapshot = await assertFrozen(accepted.turnId, q.quoteId);
      assert.equal(snapshot.taskScope, undefined);
    });
    await t.test("research retains its quoted range and query limit rather than shifting to the confirmation date", async () => {
      t.mock.timers.setTime(before.getTime());
      const f = await fixture(), raw = { ...input, message: "查询2029-12-02至2029-12-31的相机笔记，写一篇选购笔记",
        skillSelection: { actionId: "xiaohongshu-write" },
        taskChoice: { skillId: "xiaohongshu-creator", moduleId: "M1", delivery: "writing" } };
      const q = await quoteTurn(f.userId, f.sessionId, raw);
      await dateQuote(q.quoteId);
      t.mock.timers.setTime(after.getTime());
      const accepted = await submitTurn(f.userId, f.sessionId, { ...raw, quoteId: q.quoteId }, randomUUID());
      const snapshot = await assertFrozen(accepted.turnId, q.quoteId);
      assert.deepEqual(snapshot.taskScope.research, JSON.parse(q.task!.scope).research);
      assert.equal(snapshot.taskScope.research.maximumQueries, 1);
      assert.equal(snapshot.taskScope.research.startDate, "2029-12-02");
    });
    await t.test("matching the prior date never bypasses quote expiry or a changed price", async () => {
      t.mock.timers.setTime(before.getTime());
      const f = await fixture(), q = await quoteTurn(f.userId, f.sessionId, input);
      await dateQuote(q.quoteId);
      await sql`UPDATE member_tool_quotes SET expires_at=${after} WHERE id=${q.quoteId}`;
      t.mock.timers.setTime(after.getTime());
      await assert.rejects(submitTurn(f.userId, f.sessionId, { ...input, quoteId: q.quoteId }, randomUUID()), (e: any) => e.code === "quote_expired");
      await sql`UPDATE member_tool_quotes SET expires_at=${new Date(after.getTime() + 60_000)} WHERE id=${q.quoteId}`;
      const [price] = await sql`SELECT id,version FROM member_tool_prices WHERE kind='assistant-turn' AND model=${model}`;
      await saveToolPrice({ id: price!.id, expectedVersion: price!.version, kind: "assistant-turn", provider: "assistant", model, baseCredits: 8, enabled: true, reason: "Synthetic clock changed price" }, "test");
      await assert.rejects(submitTurn(f.userId, f.sessionId, { ...input, quoteId: q.quoteId }, randomUUID()), (e: any) => e.code === "price_changed");
      const [charged] = await sql`SELECT count(*)::int n FROM member_credit_charges WHERE user_id=${f.userId}`;
      assert.equal(charged!.n, 0);
    });
    assert.equal(supplier.hits(), 0, "quote confirmation never calls paid providers");
  } finally {
    t.mock.timers.reset();
    await restore();
    await stopBoss();
    await supplier.close();
    await closeDb();
  }
});

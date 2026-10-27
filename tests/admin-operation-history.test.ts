import { assertConfiguredTestDatabase } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { buildApp } from "../apps/api/src/app.ts";

test("admin execution history filters persisted subscription membership before the global limit", async () => {
  const actor = `history-${randomUUID()}`, originalFetch = globalThis.fetch, previousAdmin = config.devAdmin;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const subscriptions: number[] = [];
  try {
    const [identity] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
    assertConfiguredTestDatabase(identity!.name, identity!.port);
    app = await buildApp();
    globalThis.fetch = async () => { throw new Error("Reading execution history must not call a supplier"); };
    for (let i = 0; i < 3; i++) {
      const [row] = await sql`INSERT INTO collection_subscriptions(provider, platform, operation_key, contract_version, interval_minutes)
        VALUES ('agentkey', 'douyin', 'synthetic.query', 1, 30) RETURNING id`;
      subscriptions.push(row!.id);
    }
    const [first, second, unused] = subscriptions;
    const insert = async (subscriptionId: number | null, status: string, members: number[] = []) => {
      const [row] = await sql`INSERT INTO operation_runs(actor, command_key, subscription_id, provider, operation_key, contract_version, input, input_hash, status, step_key)
        VALUES (${actor}, ${randomUUID()}, ${subscriptionId}, 'agentkey', 'synthetic.query', 1,
          ${sql.json({ mode: "collection", members: members.map(subscriptionId => ({ subscriptionId })) })}, 'synthetic', ${status}, 'query') RETURNING id`;
      return row!.id as number;
    };
    const batch = await insert(null, "completed", [first!, second!]);
    const completed = await insert(first!, "completed", [first!]);
    const waiting = await insert(first!, "waiting", [first!]);
    const failed = await insert(second!, "failed", [second!]);
    await sql`INSERT INTO operation_runs(actor, command_key, provider, operation_key, contract_version, input, input_hash, status, step_key)
      SELECT ${actor}, 'unrelated-' || n, 'redfox', 'synthetic.query', 1, '{}', 'synthetic', 'completed', 'query'
      FROM generate_series(1, 105) n`;

    const url = "/api/admin/operations/runs";
    config.devAdmin = null;
    assert.equal((await app.inject({ url: `${url}?subscriptionId=${first}` })).statusCode, 401);
    config.devAdmin = { displayName: "Synthetic history admin" };
    const snapshot = async () => (await sql`SELECT
      (SELECT count(*) FROM operation_runs) AS runs,
      (SELECT count(*) FROM operation_results) AS results,
      (SELECT count(*) FROM receipt_attempts) AS attempts,
      (SELECT count(*) FROM collection_subscriptions WHERE active_run_id IS NOT NULL) AS active`)[0];
    const before = await snapshot();
    const get = async (query: string) => {
      const response = await app!.inject({ url: url + query });
      assert.equal(response.statusCode, 200, response.body);
      assert.match(String(response.headers["cache-control"]), /no-store/);
      return response.json().rows as Array<{ id: number; subscriptionId: number | null; status: string }>;
    };
    const global = await get("");
    assert.equal(global.length, 100);
    assert(!global.some(row => [batch, completed, waiting, failed].includes(row.id)));
    assert.deepEqual((await get(`?subscriptionId=${first}`)).map(row => row.id), [waiting, completed, batch]);
    assert.deepEqual((await get(`?subscriptionId=${second}`)).map(row => row.id), [failed, batch]);
    assert.deepEqual((await get(`?subscriptionId=${first}&status=completed`)).map(row => row.id), [completed, batch]);
    assert.deepEqual(await get(`?subscriptionId=${unused}`), []);
    const waitingRows = await get("?status=waiting");
    assert(waitingRows.some(row => row.id === waiting));
    assert(waitingRows.every(row => row.status === "waiting"));
    for (const value of ["", "0", "-1", "1.5", "abc", "9007199254740992", "1%20OR%201%3D1"]) {
      assert.equal((await app.inject({ url: `${url}?subscriptionId=${value}` })).statusCode, 400, value);
    }
    for (const value of ["", "done", "all", "completed,failed"]) {
      assert.equal((await app.inject({ url: `${url}?status=${value}` })).statusCode, 400, value);
    }
    assert.deepEqual(await snapshot(), before);
  } finally {
    globalThis.fetch = originalFetch;
    config.devAdmin = previousAdmin;
    await sql`DELETE FROM operation_runs WHERE actor = ${actor}`;
    if (subscriptions.length) await sql`DELETE FROM collection_subscriptions WHERE id IN ${sql(subscriptions)}`;
    await app?.close();
    await closeDb();
  }
});

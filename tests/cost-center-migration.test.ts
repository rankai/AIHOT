import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";

after(closeDb);

test("0091 upgrades 0090 data without changing receipts, budgets, credits or assistant history", async () => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database!.name, database!.port);

  const migration = await readFile(
    new URL("../database/migrations/0091_cost_center.sql", import.meta.url),
    "utf8",
  );
  const rollback = new Error("rollback synthetic 0091 upgrade");
  const suffix = tag();
  const sessionId = randomUUID();
  const turnId = randomUUID();
  const stepId = randomUUID();
  const service = `upgrade-${suffix}`;

  await assert.rejects(
    sql.begin(async (tx) => {
      // Return the isolated schema to the 0090 shape inside a transaction. The migration and all
      // synthetic old data are then exercised exactly as an upgrade; the final rollback avoids
      // leaving the shared test database in a downgraded state.
      await tx`DROP TABLE assistant_model_step_activations`;
      await tx.unsafe(`
        DROP INDEX receipt_attempts_started_idx;
        DROP INDEX receipt_attempts_provider_started_idx;
        DROP INDEX receipt_attempts_owner_started_idx;
        DROP INDEX receipt_attempts_operation_run_idx;
        DROP INDEX receipt_attempts_wan_submission_idx;
        DROP INDEX receipt_attempts_wan_task_identity_idx;
        DROP INDEX assistant_model_steps_receipt_idx;
        ALTER TABLE receipt_attempts
          DROP CONSTRAINT receipt_attempts_owner_identity_check,
          DROP COLUMN billing_provider,
          DROP COLUMN upstream_provider,
          DROP COLUMN operation_id,
          DROP COLUMN model_id,
          DROP COLUMN environment,
          DROP COLUMN operation_run_id,
          DROP COLUMN owner_user_id,
          DROP COLUMN owner_kind,
          DROP COLUMN price_snapshot;
        ALTER TABLE assistant_model_steps DROP COLUMN cost_context_version;
      `);

      const [siteUser] = await tx<{ id: number }[]>`
        INSERT INTO site_users(username,display_name,password_hash)
        VALUES (${`upgrade-${suffix}`},'Upgrade fixture','synthetic-password-hash')
        RETURNING id`;
      const [run] = await tx<{ id: number }[]>`
        INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key)
        VALUES (${`user:${siteUser!.id}`},${randomUUID()},'assistant','upgrade.synthetic',1,'{}',${`run-${suffix}`},'completed','upgrade')
        RETURNING id`;
      const [receipt] = await tx<{ id: number }[]>`
        INSERT INTO receipts(logical_key,service,model,purpose,status,request,response,attempts)
        VALUES (${`upgrade-${suffix}`},'deepseek','upgrade-model','upgrade.synthetic','completed','{}','{}',1)
        RETURNING id`;
      await tx`
        INSERT INTO receipt_attempts(
          receipt_id,attempt,service,model,origin,status,usage,cost,currency,cost_basis,started_at,finished_at
        ) VALUES (
          ${receipt!.id},1,'deepseek','upgrade-model','live','received',
          ${tx.json({ prompt_tokens: 7, completion_tokens: 3 })},0.000123,'CNY','estimated',
          '2035-03-01T00:00:00.000Z','2035-03-01T00:00:01.000Z'
        )`;
      await tx`
        INSERT INTO budgets(service,per_minute,per_hour,per_day)
        VALUES (${service},11,22,33)`;
      await tx`
        INSERT INTO member_credit_accounts(user_id,available,reserved)
        VALUES (${siteUser!.id},123,45)`;
      await tx`
        INSERT INTO member_credit_entries(
          user_id,kind,amount,available_delta,reserved_delta,available_after,reserved_after,actor,command_key,input_hash,reason
        ) VALUES (
          ${siteUser!.id},'grant',123,123,0,123,0,'migration-test',${`credit-${suffix}`},${`hash-${suffix}`},'Synthetic upgrade fixture'
        )`;
      await tx`
        INSERT INTO assistant_sessions(
          id,owner_user_id,assistant_id,assistant_name,profile_version,title,command_key,command_hash
        ) VALUES (
          ${sessionId},${siteUser!.id},'creative','创作助手','v1','Upgrade fixture',${randomUUID()},${`session-${suffix}`}
        )`;
      await tx`
        INSERT INTO assistant_turns(id,session_id,parent_operation_run_id,command_key,command_hash,snapshot)
        VALUES (${turnId},${sessionId},${run!.id},${randomUUID()},${`turn-${suffix}`},'{}')`;
      await tx`
        INSERT INTO assistant_model_steps(
          id,turn_id,model_ordinal,operation_step_version,request_snapshot,request_hash,receipt_id
        ) VALUES (${stepId},${turnId},1,1,'{}',${`step-${suffix}`},${receipt!.id})`;

      await tx.unsafe(migration);

      const [attempt] = await tx<{
        service: string;
        model: string;
        cost: string;
        billing_provider: string | null;
        operation_id: string | null;
        owner_kind: string | null;
        price_snapshot: unknown;
      }[]>`
        SELECT service,model,cost::text,billing_provider,operation_id,owner_kind,price_snapshot
        FROM receipt_attempts WHERE receipt_id=${receipt!.id} AND attempt=1`;
      assert.deepEqual(
        { ...attempt, cost: undefined },
        {
          service: "deepseek",
          model: "upgrade-model",
          cost: undefined,
          billing_provider: null,
          operation_id: null,
          owner_kind: null,
          price_snapshot: null,
        },
      );
      assert.equal(Number(attempt!.cost), 0.000123);

      const [budget] = await tx`SELECT per_minute,per_hour,per_day FROM budgets WHERE service=${service}`;
      assert.deepEqual({ ...budget }, { per_minute: 11, per_hour: 22, per_day: 33 });
      const [account] = await tx`
        SELECT available,reserved FROM member_credit_accounts WHERE user_id=${siteUser!.id}`;
      assert.deepEqual({ ...account }, { available: 123, reserved: 45 });
      const [entry] = await tx`
        SELECT amount,available_after,reserved_after FROM member_credit_entries
        WHERE actor='migration-test' AND command_key=${`credit-${suffix}`}`;
      assert.deepEqual({ ...entry }, { amount: 123, available_after: 123, reserved_after: 0 });
      const [step] = await tx`
        SELECT receipt_id,cost_context_version FROM assistant_model_steps WHERE id=${stepId}`;
      assert.deepEqual({ ...step }, { receipt_id: receipt!.id, cost_context_version: null });

      const [objects] = await tx<{
        table_name: string | null;
        submission_index_name: string | null;
        task_identity_index_name: string | null;
      }[]>`
        SELECT
          to_regclass('assistant_model_step_activations')::text AS table_name,
          to_regclass('receipt_attempts_wan_submission_idx')::text AS submission_index_name,
          to_regclass('receipt_attempts_wan_task_identity_idx')::text AS task_identity_index_name`;
      assert.equal(objects!.table_name, "assistant_model_step_activations");
      assert.equal(objects!.submission_index_name, "receipt_attempts_wan_submission_idx");
      assert.equal(objects!.task_identity_index_name, "receipt_attempts_wan_task_identity_idx");

      throw rollback;
    }),
    (error) => error === rollback,
  );
});

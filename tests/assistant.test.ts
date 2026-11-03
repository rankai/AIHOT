import { quoteLegacyTurn, submitLegacyTurn as submitTurn } from "./assistant-legacy-fixture.ts";
import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import {
  createSession,
  quoteTurn as currentQuoteTurn,
  sessionSnapshot,
  editArtifact,
  artifactVersions,
} from "@aihot/backend/assistant/sessions";
import { handoff, archiveSession } from "@aihot/backend/assistant/controls";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { modelPolicy, modelCredential } from "@aihot/backend/assistant/config";
import { responseUsage } from "@aihot/backend/assistant/model";
import { switchModel } from "@aihot/backend/admin/models";
import { bindings } from "@aihot/backend/assistant/bindings";
import { catalog } from "@aihot/backend/assistant/catalog";
const complete = (name: string, input: unknown) => ({
  id: "completion",
  object: "chat.completion",
  created: 1,
  model: "fixture",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: JSON.stringify(input) } }],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
});
test("historical multi-module authorization preserves local activation, artifacts, ownership and handoff replay", async (t) => {
  const [db] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const restoreBudgetScope = await allowTestBudgetScope(["assistant.text"], "member");
  const unique = tag(),
    model = `fixture-${unique}`;
  const priorPolicies=await sql`SELECT key,value FROM settings WHERE key IN ('assistant.skills.general-writing','assistant.skills.xiaohongshu-creator')`;
  let inputSource = "current-message";
  const supplier = await stub((_hit, req) => {
    const body = JSON.parse(req.body);
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(body.model, model);
    assert.equal(body.enable_thinking, false);
    assert.equal(body.top_p, 0.9);
    const tools = body.tools.map((x: any) => x.function.name);
    if (!tools.includes("save_draft")) return complete("load_skill", { skillId: "general-writing", moduleId: "write" });
    const loaded = body.messages.find((m: any) => m.role === "tool" && m.content.includes("activationId"));
    const activationId = JSON.parse(loaded.content).activationId;
    return complete("save_draft", {
      activationId,
      kind: "text-draft",
      baseVersion: 0,
      content: {
        title: "测试稿",
        body: "用户确认的材料：产品重100克。",
        intent: "rewrite",
        titles: [],
        tags: [],
        sources: [inputSource],
        partial: false,
        scope: "用户给定材料",
      },
    });
  });
  try {
    for(const skill of ['general-writing','xiaohongshu-creator'])await sql`INSERT INTO settings(key,value,updated_by) VALUES (${`assistant.skills.${skill}`},'{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    Object.assign(process.env, {
      ASSISTANT_ENABLED: "true",
      ASSISTANT_CALLS_ENABLED: "true",
      ASSISTANT_MODEL_VERIFIED: "true",
      ASSISTANT_MODEL: "default",
      LLM_MODEL: model,
      LLM_EXTRA_JSON: JSON.stringify({ enable_thinking: false, top_p: 0.9 }),
      LLM_BASE_URL: supplier.url + "/v1",
      LLM_API_KEY: "synthetic-assistant-key",
      ASSISTANT_TOKENIZER: "cl100k_base",
      MODEL_CALLS_ENABLED: "true",
    });
    // Existing capability selection and credential fields are the only model authority.
    await switchModel("assistant", "default", "fixture model selection", "test");
    process.env.ASSISTANT_MODEL = "qwen3.7-flash";
    const frozen = await modelPolicy();
    assert.equal(frozen.key, "default");
    assert.equal(frozen.version, 2);
    assert.equal(frozen.apiKeyEnv, "LLM_API_KEY");
    assert(!JSON.stringify(frozen).includes("synthetic-assistant-key"));
    assert.equal(modelCredential(frozen), "synthetic-assistant-key");
    process.env.LLM_MODEL = "changed-after-snapshot";
    process.env.LLM_API_KEY = "synthetic-rotated-key";
    assert.equal(modelCredential(frozen), "synthetic-rotated-key");
    process.env.LLM_BASE_URL = supplier.url + "/changed";
    assert.throws(() => modelCredential(frozen), /端点配置已变化/);
    process.env.LLM_BASE_URL = supplier.url + "/v1";
    delete process.env.LLM_API_KEY;
    assert.throws(() => modelCredential(frozen), /凭据未配置/);
    assert.throws(() => modelCredential({ model, baseURL: supplier.url, tokenizer: "cl100k_base" }), /旧版或无效/);
    process.env.LLM_API_KEY = "synthetic-assistant-key";
    process.env.LLM_MODEL = model;
    process.env.LLM_EXTRA_JSON = JSON.stringify({ model: "unsafe-override" });
    await assert.rejects(() => modelPolicy());
    process.env.LLM_EXTRA_JSON = JSON.stringify(frozen.extra);
    process.env.ASSISTANT_MODEL = "default";
    await switchModel("assistant", null, "fixture restore selection", "test");
    assert.equal((await modelPolicy()).key, "default");
    assert.equal(responseUsage('{"usage":{"prompt_tokens":-1,"completion_tokens":"3"}}'), null);
    assert.equal(responseUsage("invalid json"), null);
    assert.equal(supplier.hits(), 0);
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
    const a = await createSiteUser(
      { username: `assistant_a_${unique}`, displayName: "A", password: "synthetic-assistant-password" },
      "test",
    );
    const b = await createSiteUser(
      { username: `assistant_b_${unique}`, displayName: "B", password: "synthetic-assistant-password" },
      "test",
    );
    await grantCredits(a.id, { amount: 100, reason: "Assistant fixture credits" }, "test", randomUUID());
    const unpricedSession = await createSession(a.id, { assistantId: "creative" }, randomUUID());
    await assert.rejects(() => currentQuoteTurn(a.id, unpricedSession.sessionId, { message: "尚未定价", expectedRevision: 1 }),
      (error: any) => error.code === "skill_unavailable");
    assert.equal(supplier.hits(), 0);
    await saveToolPrice(
      {
        kind: "assistant-turn",
        provider: "assistant",
        model,
        baseCredits: 7,
        enabled: true,
        reason: "Assistant fixture price",
      },
      "test",
    );
    const { sessionId } = await createSession(a.id, { assistantId: "creative" }, randomUUID());
    const raw = { message: "将产品重100克改写成文章", expectedRevision: 1, taskHint: { actionId: "general-writing" } };
    const quote = await quoteTurn(a.id, sessionId, raw);
    process.env.LLM_EXTRA_JSON = JSON.stringify({ enable_thinking: false, top_p: 0.8 });
    await assert.rejects(() => submitTurn(a.id, sessionId, { ...raw, quoteId: quote.quoteId }, randomUUID()));
    process.env.LLM_EXTRA_JSON = JSON.stringify({ enable_thinking: false, top_p: 0.9 });
    const key = randomUUID();
    const submitted = await submitTurn(a.id, sessionId, { ...raw, quoteId: quote.quoteId }, key);
    assert.deepEqual(await submitTurn(a.id, sessionId, { ...raw, quoteId: quote.quoteId }, key), submitted);
    const advance = async () => {
      const [run] = await sql`SELECT * FROM operation_runs WHERE id=${submitted.runId}`;
      assert.equal(run.status, "active", JSON.stringify(run));
      await executeOperationStep(run.id, run.step_version, randomUUID());
    };
    // Execution must use the accepted model and extra even after live defaults change.
    process.env.LLM_MODEL = "changed-after-submit";
    process.env.LLM_EXTRA_JSON = JSON.stringify({ enable_thinking: true });
    await advance();
    await advance();
    assert.equal(supplier.hits(), 1);
    // A later module must affect only subsequent model requests, never the selection step.
    const [frozenTurn] = await sql`SELECT snapshot FROM assistant_turns WHERE id=${submitted.turnId}`;
    const [selectionStep] = await sql`SELECT id FROM assistant_model_steps WHERE turn_id=${submitted.turnId} ORDER BY model_ordinal LIMIT 1`;
    const additional = frozenTurn!.snapshot.candidates.find((candidate: any) => candidate.moduleId === "M2");
    assert(additional, "creative fixture exposes the second module");
    const laterActivation = randomUUID();
    await sql`INSERT INTO assistant_activations(id,turn_id,model_step_id,identity_hash,candidate) VALUES (${laterActivation},${submitted.turnId},${selectionStep!.id},${`cost-fixture-${laterActivation}`},${sql.json(additional)})`;
    await advance();
    await advance();
    const costSteps = await sql`SELECT s.cost_context_version,count(a.activation_id)::int AS activations FROM assistant_model_steps s LEFT JOIN assistant_model_step_activations a ON a.model_step_id=s.id WHERE s.turn_id=${submitted.turnId} GROUP BY s.id ORDER BY s.model_ordinal`;
    assert.deepEqual(costSteps.map(s => [s.cost_context_version, s.activations]), [[1, 0], [1, 2]]);
    const owners = await sql`SELECT a.operation_run_id,a.owner_kind,a.owner_user_id,a.billing_provider,a.operation_id,a.model_id FROM receipt_attempts a JOIN assistant_model_steps s ON s.receipt_id=a.receipt_id WHERE s.turn_id=${submitted.turnId}`;
    assert(owners.every(owner => owner.operation_run_id === submitted.runId && owner.owner_kind === "member" && owner.owner_user_id === a.id));
    assert(owners.every(owner => owner.billing_provider === null && owner.operation_id === "chat.completions" && owner.model_id === model));
    const snapshot = await sessionSnapshot(a.id, sessionId);
    assert.equal(snapshot.turn?.status, "completed");
    assert.equal(snapshot.artifacts.length, 1);
    assert.equal(supplier.hits(), 2);
    const receipts = await sql`SELECT r.usage,r.cost,r.request FROM receipts r JOIN assistant_model_steps s ON s.receipt_id=r.id WHERE s.turn_id=${submitted.turnId}`;
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.deepEqual(receipt.usage, { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 });
      assert.equal(receipt.cost, null);
      assert(!JSON.stringify(receipt.request).includes("synthetic-assistant-key"));
    }
    const [charge] = await sql`SELECT state,consumed FROM member_credit_charges WHERE root_run_id=${submitted.runId}`;
    assert.equal(charge.state, "settled");
    assert.equal(charge.consumed, 7);
    await assert.rejects(() => sessionSnapshot(b.id, sessionId));
    const artifact = snapshot.artifacts[0]!;
    const changed = await editArtifact(a.id, sessionId, artifact.artifactId, {
      baseVersion: 1,
      kind: artifact.kind,
      content: { ...artifact.content, body: "人工修订，产品仍重100克。" },
    });
    assert.equal(changed.version, 2);
    assert.equal((await artifactVersions(a.id, sessionId, artifact.artifactId)).versions.length, 2);
    await assert.rejects(() =>
      editArtifact(a.id, sessionId, artifact.artifactId, {
        baseVersion: 1,
        kind: artifact.kind,
        content: artifact.content,
      }),
    );

    const hkey = randomUUID(),
      request = {
        targetAssistantId: "xiaohongshu",
        artifactId: artifact.artifactId,
        version: artifact.version,
        brief: "换成小红书语气",
      };
    // Handoff is new admission: restore a currently priced model after proving frozen execution.
    process.env.LLM_MODEL=model;
    process.env.LLM_EXTRA_JSON=JSON.stringify({enable_thinking:false,top_p:0.9});
    const target = await handoff(a.id, sessionId, request, hkey);
    assert.deepEqual(await handoff(a.id, sessionId, request, hkey), target);
    assert.equal((await sessionSnapshot(a.id, target.targetSessionId)).inputs.length, 1);
    assert.equal(supplier.hits(), 2);
    await archiveSession(a.id, target.targetSessionId, true);
    await assert.rejects(
      () => handoff(a.id, sessionId, request, hkey),
      (e: any) => e.statusCode === 410,
    );
    const packages = await catalog();
    assert.equal(packages.length, bindings.length);
    assert.deepEqual(packages.filter(p => p.manifest.skillId === "xiaohongshu-creator").map(p => p.manifest.version).sort(), bindings.filter(b=>b.skillId==="xiaohongshu-creator").map(b=>b.version).sort());
    for(const version of ["2","3"])assert(packages.some(p=>p.manifest.skillId==="xiaohongshu-creator"&&p.manifest.version===version),"historical snapshots remain available");
  } finally {
    for(const skill of ['general-writing','xiaohongshu-creator']){const key=`assistant.skills.${skill}`,old=priorPolicies.find(p=>p.key===key);if(old)await sql`UPDATE settings SET value=${sql.json(old.value)} WHERE key=${key}`;else await sql`DELETE FROM settings WHERE key=${key}`;}
    await supplier.close();
    await stopBoss();
    await restoreBudgetScope();
    await closeDb();
  }
});

const quoteTurn=(userId:number,sessionId:string,raw:unknown)=>quoteLegacyTurn(userId,sessionId,raw,{"general-writing":"2","xiaohongshu-creator":"3","wechat-write":"1","image-generator":"1","claude-image-generation":"1","ai-image-generator":"1"});

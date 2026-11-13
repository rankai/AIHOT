import { assertConfiguredTestDatabase, allowTestBudgetScope, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { listSessions, sessionSnapshot, createSession, quoteTurn, submitTurn } from "@aihot/backend/assistant/sessions";
import { renameSession, restoreSession, archiveSession } from "@aihot/backend/assistant/controls";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { enqueueMessage } from "@aihot/backend/assistant/message-queue";
import { buildApp } from "../apps/api/src/app.ts";

test("history uses exact tuple cursors and owner filters; metadata CAS preserves execution and revision", async () => {
  const [db] = await sql`SELECT current_database() name`;
  assertConfiguredTestDatabase(db.name);
  const unique = tag();
  const owner = await createSiteUser({ username: `ha_${unique}`, displayName: "History A", password: "synthetic-history-password" }, "test");
  const other = await createSiteUser({ username: `hb_${unique}`, displayName: "History B", password: "synthetic-history-password" }, "test");
  const ids: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    for (let index = 0; index < 58; index++) {
      const id = randomUUID(); ids.push(id);
      await sql`INSERT INTO assistant_sessions(id,owner_user_id,assistant_id,assistant_name,profile_version,title,brief,command_key,command_hash,created_at) VALUES (${id},${owner.id},'creative','创作助手','1',${index === 57 ? 'Old Needle %_\\ literal' : `History ${index}`},'',${randomUUID()},'fixture','2026-01-01T00:00:00.123456Z')`;
    }
    const page = await listSessions(owner.id, {});
    assert.equal(page.sessions.length, 50); assert.ok(page.nextCursor);
    assert.equal(page.sessions[0].createdAt, '2026-01-01T00:00:00.123456Z');
    const second = await listSessions(owner.id, { cursor: page.nextCursor });
    assert.equal(second.sessions.length, 8); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...page.sessions,...second.sessions].map(row => row.sessionId)).size,58);
    await sql`UPDATE assistant_sessions SET created_at='2025-01-01T00:00:00.123456Z' WHERE id=${ids[57]}`;
    assert(!(await listSessions(owner.id, {})).sessions.some(row => row.sessionId === ids[57]));
    assert.equal((await listSessions(owner.id, { title: 'nEeDlE %_\\' })).sessions[0].sessionId, ids[57]);
    assert.equal((await listSessions(owner.id, { title: '%_' })).sessions.length,1);
    assert.equal((await listSessions(other.id, {})).sessions.length,0);
    assert.equal((await listSessions(owner.id, { assistantId: 'xiaohongshu' })).sessions.length,0);
    await assert.rejects(() => listSessions(owner.id,{before:'2027-01-01T00:00:00Z',cursor:page.nextCursor}));
    assert.equal((await listSessions(owner.id,{before:'2026-01-01T00:00:00.123456Z'})).sessions.length,1);
    await assert.rejects(() => listSessions(owner.id,{cursor:'garbage'}));
    const id=ids[57];
    const before=await sessionSnapshot(owner.id,id);
    const facts = async () => (await sql`SELECT revision,queue_paused,queue_resume_turn_id,active_turn_id,(SELECT count(*) FROM assistant_turns WHERE session_id=${id}) AS turns,(SELECT count(*) FROM assistant_message_queue WHERE session_id=${id}) AS queued FROM assistant_sessions WHERE id=${id}`)[0];
    const originalFacts=await facts();
    await renameSession(owner.id,id,{originalTitle:before.title,title:'  Renamed  '});
    assert.deepEqual(await facts(),originalFacts);
    await renameSession(owner.id,id,{originalTitle:before.title,title:'Renamed'});
    await assert.rejects(() => renameSession(owner.id,id,{originalTitle:before.title,title:'Stale'}), /其他页面/);
    await assert.rejects(() => renameSession(other.id,id,{originalTitle:'Renamed',title:'Hijack'}), /不可访问/);
    assert.equal((await sessionSnapshot(owner.id,id)).revision,before.revision);
    await archiveSession(owner.id,id,false);
    const archived=await sessionSnapshot(owner.id,id);
    assert.ok(archived.archivedAt); assert.equal(archived.queue?.paused,true);
    const archivedFacts=await facts();
    assert.equal((await listSessions(owner.id,{archived:'true',title:'Renamed'})).sessions[0].sessionId,id);
    assert.equal((await listSessions(owner.id,{title:'Renamed'})).sessions.length,0);
    await restoreSession(owner.id,id,{archivedAt:archived.archivedAt});
    await restoreSession(owner.id,id,{archivedAt:archived.archivedAt});
    assert.deepEqual(await facts(),archivedFacts);
    await archiveSession(owner.id,id,false);
    await assert.rejects(() => restoreSession(owner.id,id,{archivedAt:archived.archivedAt}), /状态已变化/);
    const rearchived=await sessionSnapshot(owner.id,id);
    await assert.rejects(() => restoreSession(other.id,id,{archivedAt:rearchived.archivedAt}), /不可访问/);
    app=await buildApp();
    const login=await loginSiteUser({username:owner.username,password:'synthetic-history-password'});
    const headers={cookie:`aihot_user=${login.token}`,'x-csrf-token':login.principal.csrf};
    const unauthorized=await app.inject({method:'POST',url:`/api/assistant/sessions/${id}/restore`,payload:{archivedAt:rearchived.archivedAt}});
    assert.equal(unauthorized.statusCode,401);
    const csrf=await app.inject({method:'POST',url:`/api/assistant/sessions/${id}/rename`,headers:{cookie:headers.cookie},payload:{originalTitle:'Renamed',title:'No csrf'}});
    assert.equal(csrf.statusCode,403);
    const restored=await app.inject({method:'POST',url:`/api/assistant/sessions/${id}/restore`,headers,payload:{archivedAt:rearchived.archivedAt}});
    assert.equal(restored.statusCode,200,restored.body); assert.match(String(restored.headers['cache-control']),/no-store/);
    const renamed=await app.inject({method:'POST',url:`/api/assistant/sessions/${id}/rename`,headers,payload:{originalTitle:'Renamed',title:'HTTP rename'}});
    assert.equal(renamed.statusCode,200,renamed.body);
    const listed=await app.inject({method:'GET',url:'/api/assistant/sessions?title=HTTP',headers});
    assert.equal(listed.json().sessions[0].sessionId,id);
    await archiveSession(owner.id,id,true);
    await assert.rejects(() => restoreSession(owner.id,id,{archivedAt:rearchived.archivedAt}), /不可访问/);
    assert.equal((await listSessions(owner.id,{archived:'true',title:'HTTP'})).sessions.length,0);
  } finally {
    await app?.close();
    await stopBoss();

  }
});


test("rename keeps a valid quote usable; archive restoration leaves a real reserved task and paused queue untouched", async () => {
  const restoreBudget = await allowTestBudgetScope(["assistant.text"], "member");
  const supplier = await stub(() => { throw new Error("metadata must never execute a model"); });
  const model = `history-${tag()}`;
  Object.assign(process.env, { ASSISTANT_ENABLED: "true", ASSISTANT_CALLS_ENABLED: "true", ASSISTANT_MODEL_VERIFIED: "true", ASSISTANT_MODEL: "default", LLM_MODEL: model, LLM_BASE_URL: supplier.url + "/v1", LLM_API_KEY: "synthetic", ASSISTANT_TOKENIZER: "cl100k_base", MODEL_CALLS_ENABLED: "true" });
  try {
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
    await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.general-writing','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    await saveToolPrice({kind:'assistant-turn',provider:'assistant',model,baseCredits:7,enabled:true,reason:'History scope fixture'},'test');
    const user=await createSiteUser({username:`hq_${tag()}`,displayName:'History quote',password:'synthetic-history-password'},'test');
    await grantCredits(user.id,{amount:100,reason:'History fixture'},'test',randomUUID());
    const {sessionId}=await createSession(user.id,{assistantId:'creative',title:'Quoted title'},randomUUID());
    const input={message:'写一段春日散步感想',expectedRevision:1,skillSelection:{skillId:'general-writing'},taskChoice:{skillId:'general-writing',moduleId:'write',delivery:'writing'}};
    const quote=await quoteTurn(user.id,sessionId,input);
    await renameSession(user.id,sessionId,{originalTitle:'Quoted title',title:'Renamed with valid quote'});
    assert.equal((await sessionSnapshot(user.id,sessionId)).revision,1);
    const turn=await submitTurn(user.id,sessionId,{...input,quoteId:quote.quoteId},randomUUID());
    await enqueueMessage(user.id,sessionId,{message:'下一条草稿',expectedRevision:(await sessionSnapshot(user.id,sessionId)).revision,skillSelection:{skillId:'general-writing'},taskChoice:input.taskChoice},randomUUID());
    await archiveSession(user.id,sessionId,false);
    const archived=await sessionSnapshot(user.id,sessionId);
    const facts=async()=>({
      session:(await sql`SELECT revision,active_turn_id,queue_paused,queue_resume_turn_id FROM assistant_sessions WHERE id=${sessionId}`)[0],
      turns:await sql`SELECT * FROM assistant_turns WHERE session_id=${sessionId}`,
      runs:await sql`SELECT * FROM operation_runs WHERE id=${turn.runId}`,
      queue:await sql`SELECT * FROM assistant_message_queue WHERE session_id=${sessionId}`,
      credits:(await sessionSnapshot(user.id,sessionId)).turn?.credits,
    });
    const before=await facts();
    assert.equal(before.session.queue_paused,true); assert.equal(before.queue.length,1);
    assert.equal(before.credits?.amount,7);
    await restoreSession(user.id,sessionId,{archivedAt:archived.archivedAt});
    assert.deepEqual(await facts(),before);
    assert.equal(supplier.hits(),0);
  } finally {
    await stopBoss(); await restoreBudget(); await supplier.close(); await closeDb();
  }
});

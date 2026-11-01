/** Local-only manual acceptance harness. Uses the real API and Worker functions, fake model only.
 * Run with a verified *_test DB and Node24, then web dev with API_BASE_URL=http://127.0.0.1:4178.
 */
import { stub, assertConfiguredTestDatabase, allowTestBudgetScope, tag } from "../setup.ts";
import { randomUUID } from "node:crypto";
import { sql, closeDb } from "@aihot/backend/db";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { createSession } from "@aihot/backend/assistant/sessions";
import { advanceMessageQueue } from "@aihot/backend/assistant/message-queue";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../apps/api/src/app.ts";
const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
assertConfiguredTestDatabase(database.name, database.port);
const restore = await allowTestBudgetScope(["assistant.text"], "member"), suffix = tag(), model = `queue-browser-${suffix}`;
const modelStub = await stub(async (_hit, req) => {
  await new Promise(resolve => setTimeout(resolve, Number(process.env.TEST_MODEL_DELAY_MS) || 1200));
  const request = JSON.parse(req.body), loaded = request.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content)).find((m: any) => m.activationId);
  let name = 'load_skill', input: unknown = { skillId: 'general-writing', moduleId: 'write' };
  const messages = request.messages.filter((m: any) => m.role === 'user');
  if (loaded) {
    if (messages.some((m: any) => m.content.includes('请先提问')) && messages.length < 3) { name = 'ask_question'; input = { text: '请补充这篇稿件的目标读者。' }; }
    else { name = 'save_draft'; input = { activationId: loaded.activationId, kind: 'text-draft', baseVersion: 0,
      content: { title: '本地合成稿件', body: '这是本地测试模型依据排队需求返回的合成正文，用于检验真实保存和积分状态。', intent: 'draft', titles: [], tags: [], sources: ['current-message'], partial: false, scope: '合成材料测试' } }; }
  }
  return { id: 'local-fixture', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: 'tool_calls' }] };
});
Object.assign(process.env, { ASSISTANT_ENABLED: 'true', ASSISTANT_CALLS_ENABLED: 'true', ASSISTANT_MODEL_VERIFIED: 'true', ASSISTANT_MODEL: 'default',
  LLM_MODEL: model, LLM_BASE_URL: modelStub.url + '/v1', LLM_API_KEY: 'synthetic-browser-key', ASSISTANT_TOKENIZER: 'cl100k_base', MODEL_CALLS_ENABLED: 'true' });
await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
await saveToolPrice({ kind: 'assistant-turn', provider: 'assistant', model, baseCredits: 7, enabled: true, reason: 'Local queue browser fixture' }, 'test');
const username = `queue_browser_${suffix}`, password = 'synthetic-browser-password';
const user = await createSiteUser({ username, displayName: '排队交互测试', password }, 'test');
await grantCredits(user.id, { amount: 10000, reason: 'Synthetic browser credits' }, 'test', randomUUID());
const session = await createSession(user.id, { assistantId: 'creative', title: '排队交互验收' }, randomUUID());
const api = await buildApp(); await api.listen({ host: '127.0.0.1', port: 4178 });
let running = false;
const timer = setInterval(async () => {
  if (running) return; running = true;
  try {
    const rows = await sql`SELECT id,step_version FROM operation_runs WHERE actor=${`user:${user.id}`} AND provider='assistant' AND status='active' ORDER BY id LIMIT 2`;
    for (const row of rows) await executeOperationStep(row.id, row.step_version, randomUUID());
    const sessions = await sql`SELECT id FROM assistant_sessions WHERE owner_user_id=${user.id} AND deleted_at IS NULL AND archived_at IS NULL`;
    for (const s of sessions) await advanceMessageQueue(user.id, s.id);
  } catch (e) { console.error(e instanceof Error ? e.message : 'Fixture worker error'); }
  finally { running = false; }
}, 1500);
console.log(JSON.stringify({ api: 'http://127.0.0.1:4178', web: 'http://127.0.0.1:4179', username, password, sessionPath: `/assistant/sessions/${session.sessionId}` }));
async function stop() { clearInterval(timer); await api.close(); await modelStub.close(); await stopBoss(); await restore(); await closeDb(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);

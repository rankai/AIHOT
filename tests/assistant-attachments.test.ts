import { assertConfiguredTestDatabase, allowTestBudgetScope, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { assetPath, listAssets, assetMetadata } from "@aihot/backend/operations/assets";
import { ATTACHMENT_TEXT_BYTES, parseAttachmentText } from "@aihot/backend/operations/attachment-text";
import { readAssistantAttachment } from "@aihot/backend/assistant/attachments";
import { attachInput, createSession, sessionSnapshot, quoteTurn, submitTurn } from "@aihot/backend/assistant/sessions";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { docxFixture, paragraph } from "./docx-fixture.ts";
import { DOCX_MIME, DOCX_BYTES } from "@aihot/backend/operations/docx";
import { buildApp } from "../apps/api/src/app.ts";

const body = (data: Buffer, filename: string, mime: string) => Buffer.concat([
  Buffer.from(`--text-fixture\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`), data,
  Buffer.from("\r\n--text-fixture--\r\n"),
]);

test("TXT and MD parser rejects empty, invalid UTF8, NUL and oversized input without interpreting markup", () => {
  for (const format of ["txt", "md"] as const) {
    assert.equal(parseAttachmentText(Buffer.from("# 文本 <script>plain()</script>"), format).bodyText, "# 文本 <script>plain()</script>");
    for (const bytes of [Buffer.from([255]), Buffer.from(" \n"), Buffer.from("a\0b"), Buffer.alloc(ATTACHMENT_TEXT_BYTES + 1, 65)])
      assert.throws(() => parseAttachmentText(bytes, format));
  }
});

test("private text assets reuse upload identity, ownership and assistant reference deletion protection", async (t) => {
  const [database] = await sql`SELECT current_database() name,inet_server_port() port`;
  assertConfiguredTestDatabase(database.name, database.port);
  const originalDir = config.dataDir;
  config.dataDir = await mkdtemp(path.join(tmpdir(), "aihot-assistant-attachments-"));
  process.env.ASSISTANT_ENABLED = "true";
  const api = await buildApp();
  const user = await createSiteUser({ username: `txt_${tag()}`, displayName: "Text fixture", password: "synthetic-attachment-password" }, "test");
  const other = await createSiteUser({ username: `txt_${tag()}`, displayName: "Other fixture", password: "synthetic-attachment-password" }, "test");
  const login = await loginSiteUser({ username: user.username, password: "synthetic-attachment-password" });
  const headers = { cookie: `aihot_user=${login.token}`, "x-csrf-token": login.principal.csrf };
  const upload = (data: Buffer, filename = "notes.md", mime = "text/markdown", key = randomUUID()) => api.inject({
    method: "POST", url: "/api/tools/assets", headers: { ...headers, "content-type": "multipart/form-data; boundary=text-fixture", "idempotency-key": key }, payload: body(data, filename, mime),
  });
  try {
    await t.test("validation precedes registration and includes real per-file transport byte limit", async () => {
      for (const [bytes, filename, mime, status] of [
        [Buffer.from([255]), "a.txt", "text/plain", 422], [Buffer.from(" \n"), "a.md", "text/markdown", 422],
        [Buffer.from("a\0b"), "a.txt", "text/plain", 422], [Buffer.from("plain"), "a.png", "text/plain", 415],
        [Buffer.from("plain"), "a.md", "image/png", 422], [Buffer.alloc(ATTACHMENT_TEXT_BYTES + 1, 65), "a.txt", "text/plain", 413],
      ] as const) assert.equal((await upload(bytes, filename, mime)).statusCode, status);
      assert.equal((await sql`SELECT count(*)::int n FROM stored_files WHERE owner_actor=${`user:${user.id}`}`)[0].n, 0);
    });
    const command = randomUUID(), text = "# 中文资料\n<script>as plain text</script>", bytes = Buffer.from(text);
    const first = await upload(bytes, "notes.MD", "application/octet-stream", command);
    assert.equal(first.statusCode, 201, first.body);
    const asset = first.json();
    assert.equal(asset.kind, "text"); assert.equal(asset.contentType, "text/markdown");
    assert.equal((await upload(bytes, "notes.MD", "application/octet-stream", command)).json().key, asset.key);
    assert.equal((await upload(Buffer.from("changed"), "notes.MD", "application/octet-stream", command)).statusCode, 409);
    assert.equal((await api.inject({ url: asset.contentUrl, headers })).body, text);
    const extracted = await readAssistantAttachment(`user:${user.id}`, asset.key);
    assert.equal(extracted.text, text); assert.match(extracted.source.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(readAssistantAttachment(`user:${other.id}`, asset.key), { statusCode: 404 });
    const { sessionId } = await createSession(user.id, { assistantId: "creative" }, randomUUID());
    const attachCommand = randomUUID();
    const input = await attachInput(user.id, sessionId, { assetKey: asset.key }, attachCommand);
    assert.equal((await attachInput(user.id, sessionId, { assetKey: asset.key }, attachCommand)).inputId, input.inputId);
    assert.equal((await sql`SELECT count(*)::int n FROM assistant_session_inputs WHERE session_id=${sessionId}`)[0].n, 1);
    const deletion = await api.inject({ method: "DELETE", url: `/api/tools/assets/${encodeURIComponent(asset.key)}`, headers });
    assert.equal(deletion.statusCode, 409, deletion.body);
    await t.test("oversized context keeps the private file but cannot become an assistant input", async () => {
      const result = await upload(Buffer.from("x".repeat(30_001)), "long.txt", "text/plain");
      assert.equal(result.statusCode, 201);
      await assert.rejects(attachInput(user.id, sessionId, { assetKey: result.json().key }, randomUUID()), { statusCode: 413 });
      assert.equal((await api.inject({ url: result.json().contentUrl, headers })).statusCode, 200);
      assert.equal((await sql`SELECT count(*)::int n FROM assistant_session_inputs WHERE session_id=${sessionId}`)[0].n, 1);
    });
    await t.test("missing or modified source refuses new reference while stored snapshot remains readable", async () => {
      await writeFile(assetPath(asset.key), "tampered");
      await assert.rejects(readAssistantAttachment(`user:${user.id}`, asset.key), { statusCode: 409 });
      await unlink(assetPath(asset.key));
      await assert.rejects(readAssistantAttachment(`user:${user.id}`, asset.key), { statusCode: 409 });
      assert.equal((await sessionSnapshot(user.id, sessionId)).inputs.find(item => item.id === input.inputId)?.text, text);
    });
    await t.test("long DOCX, TXT and MD names retain the extension needed by preview and binding", async () => {
      const {sessionId:longSession} = await createSession(user.id,{assistantId:"creative"},randomUUID());
      for (const [extension,mime] of [["docx",DOCX_MIME],["txt","text/plain"],["md","text/markdown"]] as const) {
        const text = `长文件名 ${extension} 材料`;
        const result = await upload(extension === "docx" ? docxFixture(paragraph(text)) : Buffer.from(text),`${"a".repeat(205)}.${extension}`,mime);
        assert.equal(result.statusCode,201,result.body);
        const asset = result.json(); assert.equal(asset.filename.length,200); assert(asset.filename.endsWith(`.${extension}`));
        const preview = await api.inject({url:`/api/assistant/attachments/${encodeURIComponent(asset.key)}/text`,headers});
        assert.equal(preview.statusCode,200,preview.body); assert.equal(preview.json().text,text);
        assert.equal((await attachInput(user.id,longSession,{assetKey:asset.key},randomUUID())).text,text);
      }
    });
    await t.test("DOCX API upload, private preview, frozen input and local model delivery use one extraction", async () => {
      const secretText = "私有 DOCX 正文 unique fixture：产品重100克。";
      const bytes = docxFixture(paragraph(secretText));
      const command = randomUUID();
      const before = await sql`SELECT (SELECT count(*) FROM assistant_sessions WHERE owner_user_id=${user.id}) sessions,(SELECT count(*) FROM operation_runs WHERE actor=${`user:${user.id}`}) runs,(SELECT count(*) FROM receipt_attempts) receipts`;
      for (const [content, status] of [[Buffer.from("invalid"),422], [docxFixture(""),422], [docxFixture(paragraph("x".repeat(30001))),413], [Buffer.alloc(DOCX_BYTES+1),413]] as const) assert.equal((await upload(content,"invalid.docx",DOCX_MIME)).statusCode,status);
      const first = await upload(bytes,"notes.docx",DOCX_MIME,command);
      assert.equal(first.statusCode,201,first.body);
      const asset = first.json(); assert.equal(asset.kind,"document"); assert.equal(asset.contentType,DOCX_MIME);
      const persisted = (await sql`SELECT metadata FROM stored_files WHERE key=${asset.key}`)[0].metadata.extraction;
      assert.equal(persisted.text,secretText);
      assert.equal((await upload(bytes,"notes.docx",DOCX_MIME,command)).json().key,asset.key);
      assert.deepEqual((await sql`SELECT metadata FROM stored_files WHERE key=${asset.key}`)[0].metadata.extraction,persisted);
      assert.equal((await upload(docxFixture(paragraph("different")),"notes.docx",DOCX_MIME,command)).statusCode,409);
      const preview = `/api/assistant/attachments/${encodeURIComponent(asset.key)}/text`;
      assert.equal((await api.inject({url:preview})).statusCode,401);
      const otherLogin=await loginSiteUser({username:other.username,password:"synthetic-attachment-password"});
      assert.equal((await api.inject({url:preview,headers:{cookie:`aihot_user=${otherLogin.token}`}})).statusCode,404);
      const read = await api.inject({url:preview,headers}); assert.equal(read.statusCode,200,read.body); assert.equal(read.json().text,secretText); assert.match(String(read.headers["cache-control"]),/no-store/);
      assert.deepEqual((await api.inject({url:asset.contentUrl,headers})).rawPayload,bytes);
      for(const projection of [first.json(),await listAssets(),await assetMetadata(asset.key),(await api.inject({url:"/api/tools/assets",headers})).json(),await sql`SELECT * FROM audit_log WHERE subject=${asset.key}`]) assert(!JSON.stringify(projection).includes(secretText));
      assert.deepEqual(await sql`SELECT (SELECT count(*) FROM assistant_sessions WHERE owner_user_id=${user.id}) sessions,(SELECT count(*) FROM operation_runs WHERE actor=${`user:${user.id}`}) runs,(SELECT count(*) FROM receipt_attempts) receipts`,before);
      const {sessionId:docSession}=await createSession(user.id,{assistantId:"creative"},randomUUID());
      await assert.rejects(attachInput(other.id,docSession,{assetKey:asset.key},randomUUID()),{statusCode:404});
      const input=await attachInput(user.id,docSession,{assetKey:asset.key},randomUUID()); assert.equal(input.text,secretText);
      let calls=0;
      const supplier=await stub((_hit,req)=>{
        const body=JSON.parse(req.body); assert(JSON.stringify(body.messages).includes(secretText));
        const loaded=body.messages.find((m:any)=>m.role==="tool" && m.content.includes("activationId"));
        const name=loaded?"save_draft":"load_skill";
        const args=loaded?{activationId:JSON.parse(loaded.content).activationId,kind:"text-draft",baseVersion:0,content:{title:"DOCX 合成稿",body:secretText,intent:"rewrite",titles:[],tags:[],sources:[`input:${input.inputId}`],partial:false,scope:"上传材料"}}:{skillId:"general-writing",moduleId:"write"};
        calls++;
        return {id:`docx-${calls}`,object:"chat.completion",created:1,model:"fixture",choices:[{index:0,message:{role:"assistant",content:null,tool_calls:[{id:`call_${calls}`,type:"function",function:{name,arguments:JSON.stringify(args)}}]},finish_reason:"tool_calls"}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}};
      });
      const restoreBudget=await allowTestBudgetScope(["assistant.text"],"member");
      try {
        const model=`docx-${tag()}`;
        Object.assign(process.env,{ASSISTANT_CALLS_ENABLED:"true",ASSISTANT_MODEL_VERIFIED:"true",ASSISTANT_MODEL:"default",LLM_MODEL:model,LLM_BASE_URL:supplier.url+"/v1",LLM_API_KEY:"synthetic-docx",ASSISTANT_TOKENIZER:"cl100k_base",MODEL_CALLS_ENABLED:"true"});
        await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='assistant.text'`;
        await sql`INSERT INTO settings(key,value,updated_by) VALUES ('assistant.skills.general-writing','{"acceptingNew":true,"revision":1}','test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
        await saveToolPrice({kind:"assistant-turn",provider:"assistant",model,baseCredits:7,enabled:true,reason:"DOCX local fixture"},"test");
        await grantCredits(user.id,{amount:100,reason:"DOCX local fixture"},"test",randomUUID());
        const raw={message:"请根据附件改写短文",expectedRevision:input.revision,inputIds:[input.inputId],skillSelection:{skillId:"general-writing"},taskChoice:{skillId:"general-writing",moduleId:"write",delivery:"writing"}};
        const quote=await quoteTurn(user.id,docSession,raw), key=randomUUID();
        const accepted=await submitTurn(user.id,docSession,{...raw,quoteId:quote.quoteId},key);
        assert.deepEqual(await submitTurn(user.id,docSession,{...raw,quoteId:quote.quoteId},key),accepted);
        const frozen=(await sql`SELECT snapshot FROM assistant_turns WHERE id=${accepted.turnId}`)[0].snapshot;
        assert(frozen.selected.some((m:any)=>m.text===secretText && m.source.extractionVersion===persisted.version));
        await writeFile(assetPath(asset.key),"tampered");
        await assert.rejects(readAssistantAttachment(`user:${user.id}`,asset.key),{statusCode:409});
        assert.equal((await sessionSnapshot(user.id,docSession)).inputs.find(i=>i.id===input.inputId)?.text,secretText);
        for(let i=0;i<10;i++) {
          const [run]=await sql`SELECT * FROM operation_runs WHERE id=${accepted.runId}`;
          if(run.status!=="active")break;
          await executeOperationStep(run.id,run.step_version,randomUUID());
        }
        const done=await sessionSnapshot(user.id,docSession);
        assert(done.artifacts.some(a=>a.content.body===secretText),JSON.stringify(done.turn));
        assert.equal(calls,2); assert.equal(done.turn?.credits?.amount,7);
      } finally { await restoreBudget(); await supplier.close(); }
    });
    await sql`UPDATE assistant_sessions SET deleted_at=now() WHERE id=${sessionId}`;
    assert.equal((await api.inject({ method: "DELETE", url: `/api/tools/assets/${encodeURIComponent(asset.key)}`, headers })).statusCode, 200);
  } finally {
    await api.close(); await stopBoss(); await closeDb();
    await rm(config.dataDir, { recursive: true, force: true }); config.dataDir = originalDir;
  }
});

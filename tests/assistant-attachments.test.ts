import { assertConfiguredTestDatabase, tag } from "./setup.ts";
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
import { assetPath } from "@aihot/backend/operations/assets";
import { ATTACHMENT_TEXT_BYTES, parseAttachmentText } from "@aihot/backend/operations/attachment-text";
import { readAssistantAttachment } from "@aihot/backend/assistant/attachments";
import { attachInput, createSession, sessionSnapshot } from "@aihot/backend/assistant/sessions";
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
    await sql`UPDATE assistant_sessions SET deleted_at=now() WHERE id=${sessionId}`;
    assert.equal((await api.inject({ method: "DELETE", url: `/api/tools/assets/${encodeURIComponent(asset.key)}`, headers })).statusCode, 200);
  } finally {
    await api.close(); await closeDb();
    await rm(config.dataDir, { recursive: true, force: true }); config.dataDir = originalDir;
  }
});

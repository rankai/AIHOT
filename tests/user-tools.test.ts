import { allowTestBudgetScope, assertConfiguredTestDatabase, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import sharp from "sharp";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { grantCredits, saveToolPrice } from "@aihot/backend/users/credits";
import { normalizeToolInput } from "@aihot/backend/users/tool-input";
import { projectToolResult } from "@aihot/backend/users/tool-results";
import { createAccountQuery } from "@aihot/backend/providers/redfox/queries";
import { parseAiSearchPoll } from "@aihot/backend/providers/redfox/ai-search";
import { parseMediaTool } from "@aihot/backend/providers/redfox/media-tools";
import { parseXiaohongshu } from "@aihot/backend/providers/redfox/xiaohongshu-parser";
import { parseHotResearch } from "@aihot/backend/providers/redfox/hot-research";
import { executeOperationStep } from "@aihot/backend/providers/operations/execute";
import { buildApp } from "../apps/api/src/app.ts";

test("member tools keep task, asset, quote and execution ownership through the real API", async t => {
  const unique = tag(), admin = `tools-test:${unique}`, usernameA = `tools_a_${unique}`, usernameB = `tools_b_${unique}`;
  const password = "synthetic-tools-password-123", screenName = `t${unique}`.slice(0, 15), prompt = `Synthetic picture ${unique}`;
  const previousAdmin = config.devAdmin, previousPrivate = config.allowPrivateNetworkFetch;
  const previousEnv = Object.fromEntries(["REDFOX_TEST_BASE_URL", "REDFOX_API_KEY", "REDFOX_CALLS_ENABLED", "MODEL_CALLS_ENABLED"].map(key => [key, process.env[key]]));
  const [db] = await sql`SELECT current_database() AS name,inet_server_port() AS port`;
  assertConfiguredTestDatabase(db.name, db.port);
  const supplier = await stub(() => ({ code: 2000, data: { userId: "99123456789", username: screenName, displayName: "Synthetic account", secret: "SENSITIVE_RAW_SENTINEL" } }));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let restoreScope: (() => Promise<void>) | undefined;
  let savedBudget: { per_minute: number; per_hour: number; per_day: number } | undefined;
  try {
    config.devAdmin = null; config.allowPrivateNetworkFetch = true;
    process.env.REDFOX_TEST_BASE_URL = supplier.url; process.env.REDFOX_API_KEY = "synthetic-member-tools-key";
    process.env.REDFOX_CALLS_ENABLED = "true"; process.env.MODEL_CALLS_ENABLED = "false";
    restoreScope = await allowTestBudgetScope(["redfox.query"],"member");
    [savedBudget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='redfox.query'`;
    assert(savedBudget, "The migrated test database must contain the redfox.query budget");
    await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;
    const a = await createSiteUser({ username: usernameA, displayName: "Tools A", password }, admin);
    const b = await createSiteUser({ username: usernameB, displayName: "Tools B", password }, admin);
    const loginA = await loginSiteUser({ username: usernameA, password }), loginB = await loginSiteUser({ username: usernameB, password });
    const headersA = { cookie: `aihot_user=${loginA.token}`, "x-csrf-token": loginA.principal.csrf, "idempotency-key": randomUUID() };
    const headersB = { cookie: `aihot_user=${loginB.token}`, "x-csrf-token": loginB.principal.csrf, "idempotency-key": randomUUID() };
    await grantCredits(a.id, { amount: 100, reason: "Synthetic member tools test" }, admin, randomUUID());
    await grantCredits(b.id, { amount: 100, reason: "Synthetic member tools test" }, admin, randomUUID());
    for (const price of [
      { kind: "x-account", model: "", tier: "", parameterMatch: { screenName } },
      { kind: "images", model: "gptImage2", tier: "1k", parameterMatch: { prompt, n: 1 } },
    ]) await saveToolPrice({ ...price, provider: "redfox", baseCredits: 7, imageCredits: 0, videoSecondCredits: 0, referenceCredits: 0, enabled: true, reason: "Synthetic test price" }, admin);
    app = await buildApp();
    const api = app;
    const quote = async (kind: string, input: Record<string, unknown>, headers = headersA) => {
      const response = await api.inject({ method: "POST", url: "/api/tools/quote", headers, payload: { kind, input } });
      assert.equal(response.statusCode, 200, response.body); return response.json();
    };

    await t.test("anonymous, admin-only identity, CSRF and supplier-account boundaries are enforced", async () => {
      assert.equal((await api.inject({ url: "/api/tools/options" })).statusCode, 401);
      config.devAdmin = { displayName: "Synthetic administrator" };
      assert.equal((await api.inject({ url: "/api/tools/options" })).statusCode, 401);
      config.devAdmin = null;
      const options = await api.inject({ url: "/api/tools/options", headers: headersA });
      assert.equal(options.statusCode, 200, options.body); assert.match(String(options.headers["cache-control"]), /no-store/);
      assert(options.json().operations.length > 100);
      assert(!options.json().operations.some((o: { platform: string }) => o.platform === "redfox-account"));
      for (const id of ["API_1792651427872", "API_1792651427970", "API_1792651512423", "API_1792651658984"]) assert(options.json().operations.some((o: { id: string }) => o.id === id));
      for (const engine of ["qianwenProducts", "doubaoProducts"]) assert(options.json().aiSearch.engines.some((o: { engine: string }) => o.engine === engine));
      assert.equal(options.json().images.models.find((o: { model: string }) => o.model === "seedreamLite").generationAvailable, false);
      assert.equal(options.json().xhsComments.dataNumMax, 1000);
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: { cookie: headersA.cookie }, payload: { kind: "x-account", input: { screenName } } })).statusCode, 403);
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: { ...headersA, origin: "https://cross-site.invalid" }, payload: { kind: "x-account", input: { screenName } } })).statusCode, 403);
      for (const operationId of ["API_1792036841619", "API_1792043329817"]) {
        const response = await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersA, payload: { kind: "query", input: { provider: "redfox", operationId, parameters: {} } } });
        assert.equal(response.statusCode, 403, response.body);
      }
      assert.equal((await api.inject({ url: "/api/admin/me", headers: headersA })).statusCode, 401);
      assert.equal(supplier.hits(), 0);
    });

    await t.test("retired image generation fails before quoting or reserving member credits", async () => {
      const [before] = await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${a.id}`;
      const response = await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersA, payload: { kind: "images", input: { model: "seedreamLite", prompt, size: "2K", fileKeys: [] } } });
      assert.equal(response.statusCode, 400, response.body); assert.match(response.body, /停止新生成/);
      const [quotes] = await sql`SELECT count(*)::int AS n FROM member_tool_quotes WHERE user_id=${a.id}`;
      assert.equal(quotes.n, 0);
      const [after] = await sql`SELECT available,reserved FROM member_credit_accounts WHERE user_id=${a.id}`;
      assert.deepEqual(after, before); assert.equal(supplier.hits(), 0);
    });

    let runId = 0;
    await t.test("quote acceptance, private pagination, idempotency, and local worker completion settle once", async () => {
      const q = await quote("x-account", { screenName });
      assert.equal(q.amount, 7); assert.equal(supplier.hits(), 0);
      const payload = { input: { screenName }, quoteId: q.quoteId }, commandHeaders = { ...headersA, "idempotency-key": randomUUID() };
      const accepted = await api.inject({ method: "POST", url: "/api/tools/x-account", headers: commandHeaders, payload });
      assert.equal(accepted.statusCode, 202, accepted.body); runId = accepted.json().runId;
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/x-account", headers: commandHeaders, payload })).json().runId, runId);
      const acceptedAgain = await api.inject({ method: "POST", url: "/api/tools/x-account", headers: { ...commandHeaders, "idempotency-key": randomUUID() }, payload });
      assert.equal(acceptedAgain.statusCode, 409, acceptedAgain.body);
      const aList = await api.inject({ url: "/api/tools/runs", headers: headersA }), bList = await api.inject({ url: "/api/tools/runs", headers: headersB });
      assert(aList.json().rows.some((r: { id: number }) => r.id === runId)); assert.equal(bList.json().rows.length, 0);
      assert.equal((await api.inject({ url: `/api/tools/runs?after=${runId}`, headers: headersA })).json().rows.length, 0);
      const own = await api.inject({ url: `/api/tools/runs/${runId}`, headers: headersA });
      assert.equal(own.statusCode, 200); assert.equal(own.json().charge.state, "reserved"); assert.match(String(own.headers["cache-control"]), /no-store/);
      for (const suffix of ["", "?after=0", "/results/export"]) assert.equal((await api.inject({ url: `/api/tools/runs/${runId}${suffix}`, headers: headersB })).statusCode, 404);
      assert.equal((await api.inject({ method: "POST", url: `/api/tools/runs/${runId}/stop`, headers: headersB, payload: { stepVersion: 1, generation: 0, reason: "Not the owner" } })).statusCode, 404);
      await assert.rejects(createAccountQuery({ screenName }, `user:${a.id}`, randomUUID()), /报价/);
      const [run] = await sql`SELECT * FROM operation_runs WHERE id=${runId}`;
      await executeOperationStep(runId, run.step_version, run.job_id);
      const done = await api.inject({ url: `/api/tools/runs/${runId}`, headers: headersA });
      assert.equal(done.statusCode, 200, done.body); assert.equal(done.json().status, "completed", done.body);
      assert.equal(done.json().charge.state, "settled"); assert.equal(done.json().charge.consumed, 7);
      assert.equal(done.json().results[0].details.username, screenName);
      const attempts = await sql`SELECT a.budget_scope FROM receipt_attempts a
        WHERE a.receipt_id IN (SELECT receipt_id FROM operation_results WHERE run_id=${runId})`;
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].budget_scope, "member");
      assert(!done.body.includes("SENSITIVE_RAW_SENTINEL")); assert(!done.body.includes("receiptId")); assert(!done.body.includes("command_key"));
      const [finished] = await sql`SELECT * FROM operation_runs WHERE id=${runId}`;
      await executeOperationStep(runId, finished.step_version, finished.job_id ?? run.job_id);
      assert.equal(supplier.hits(), 1);
      const [count] = await sql`SELECT count(*)::int AS n FROM member_credit_entries WHERE user_id=${a.id} AND kind='consume'`;
      assert.equal(count.n, 1);
    });

    await t.test("changed and expired quote inputs cannot create a task or reserve more credits", async () => {
      const q = await quote("x-account", { screenName });
      const changed = await api.inject({ method: "POST", url: "/api/tools/x-account", headers: { ...headersA, "idempotency-key": randomUUID() }, payload: { quoteId: q.quoteId, input: { screenName: "another_account" } } });
      assert.equal(changed.statusCode, 409, changed.body);
      await sql`UPDATE member_tool_quotes SET expires_at=now()-interval '1 second' WHERE id=${q.quoteId}`;
      const expired = await api.inject({ method: "POST", url: "/api/tools/x-account", headers: { ...headersA, "idempotency-key": randomUUID() }, payload: { quoteId: q.quoteId, input: { screenName } } });
      assert.equal(expired.statusCode, 409, expired.body);
      const [rows] = await sql`SELECT count(*)::int AS n FROM operation_runs WHERE actor=${`user:${a.id}`}`;
      assert.equal(rows.n, 1);
    });

    await t.test("owned asynchronous recovery reuses one charge and the remaining total query limits", async () => {
      const inquiryText = `Recovery ${unique}`;
      await saveToolPrice({ kind: "ai-search", provider: "redfox", model: "kimiK3", tier: "", parameterMatch: { inquiryText }, baseCredits: 9, enabled: true, reason: "Synthetic recovery price" }, admin);
      const q = await quote("ai-search", { engine: "kimiK3", inquiryText });
      const response = await api.inject({ method: "POST", url: "/api/tools/ai-search", headers: { ...headersA, "idempotency-key": randomUUID() }, payload: { input: { engine: "kimiK3", inquiryText }, quoteId: q.quoteId } });
      assert.equal(response.statusCode, 202, response.body); const originalId = response.json().runId;
      // Simulate already persisted supplier submission and one query, followed by a local deadline.
      await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES
        (${originalId},1,'submission','ai_search_task',${sql.json({ taskId: `owned-${unique}`, family: "kimi", engine: "kimiK3" })}),
        (${originalId},2,'poll:0','ai_search_task',${sql.json({ taskId: `owned-${unique}`, status: "processing" })})`;
      await sql`UPDATE operation_runs SET status='needs_review',step_key='redfox.ai_search.poll',step_version=3,
        progress=${sql.json({ taskId: `owned-${unique}`, pollSequence: 1, externalAttempts: 3 })} WHERE id=${originalId}`;
      const normalized = await normalizeToolInput(`user:${a.id}`, "ai-search/query", { runId: originalId });
      assert.equal(normalized.intent.model, "kimiK3"); assert.equal(normalized.commandInput.family, "kimi");
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersB, payload: { kind: "ai-search/query", input: { runId: originalId } } })).statusCode, 404);
      const recoveryQuote = await quote("ai-search/query", { runId: originalId });
      assert.equal(recoveryQuote.amount, 0); assert.equal(recoveryQuote.recoveryOfRunId, originalId);
      const key = randomUUID(), payload = { input: { runId: originalId }, quoteId: recoveryQuote.quoteId };
      const recovered = await api.inject({ method: "POST", url: "/api/tools/ai-search/query", headers: { ...headersA, "idempotency-key": key }, payload });
      assert.equal(recovered.statusCode, 202, recovered.body); const childId = recovered.json().runId;
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/ai-search/query", headers: { ...headersA, "idempotency-key": key }, payload })).json().runId, childId);
      const [child] = await sql`SELECT * FROM operation_runs WHERE id=${childId}`;
      assert.equal(child.input.parameters.taskId, `owned-${unique}`); assert.equal(child.limits.polls, 59); assert.equal(child.limits.externalAttempts, 97);
      const links = await sql`SELECT * FROM member_credit_run_links WHERE run_id IN ${sql([originalId, childId])}`;
      assert.equal(links.length, 2); assert.equal(links[0].charge_id, links[1].charge_id);
      const [reserved] = await sql`SELECT count(*)::int AS n FROM member_credit_entries WHERE run_id=${originalId} AND kind='reserve'`;
      assert.equal(reserved.n, 1);
      const old = await api.inject({ url: `/api/tools/runs/${originalId}`, headers: headersA });
      assert.deepEqual(old.json().actions, []); assert.equal(old.json().recoveryKind, null);
      assert.equal(old.json().continuationRunId, childId); assert.equal(old.json().originRunId, null);
      const continued = await api.inject({ url: `/api/tools/runs/${childId}`, headers: headersA });
      assert.equal(continued.json().originRunId, originalId); assert.equal(continued.json().continuationRunId, null);
      assert.equal(continued.json().title, "Kimi K3 搜索"); assert.equal(continued.json().summary, inquiryText);
      assert.equal((await api.inject({ url: `/api/tools/runs/${childId}`, headers: headersB })).statusCode, 404);
      // Even a persisted credit link must not bridge differing run owners.
      await sql`UPDATE operation_runs SET actor=${`user:${b.id}`} WHERE id=${childId}`;
      try {
        const hiddenParent = await api.inject({ url: `/api/tools/runs/${originalId}`, headers: headersA });
        const hiddenChild = await api.inject({ url: `/api/tools/runs/${childId}`, headers: headersB });
        assert.equal(hiddenParent.json().continuationRunId, null); assert.equal(hiddenChild.json().originRunId, null);
        assert(!hiddenChild.body.includes(inquiryText));
      } finally { await sql`UPDATE operation_runs SET actor=${`user:${a.id}`} WHERE id=${childId}`; }
      assert.equal((await api.inject({ method: "POST", url: `/api/tools/runs/${originalId}/resume`, headers: headersA, payload: { stepVersion: 3, generation: old.json().generation, reason: "Duplicate parent" } })).statusCode, 409);
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersA, payload: { kind: "ai-search/query", input: { runId: originalId } } })).statusCode, 409);
      assert.equal(supplier.hits(), 1);
    });

    await t.test("upload, Range download, deletion and every private-input reference remain owner scoped", async () => {
      const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#114455" } }).png().toBuffer();
      const boundary = `test-${unique}`;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const uploaded = await api.inject({ method: "POST", url: "/api/tools/assets", headers: { ...headersA, "content-type": `multipart/form-data; boundary=${boundary}`, "idempotency-key": randomUUID() }, payload: body });
      assert.equal(uploaded.statusCode, 201, uploaded.body); const asset = uploaded.json();
      assert.equal(asset.contentType, "image/png"); assert.equal(asset.owner_actor, undefined);
      assert((await api.inject({ url: "/api/tools/assets", headers: headersA })).json().items.some((file: { key: string }) => file.key === asset.key));
      assert.equal((await api.inject({ url: "/api/tools/assets", headers: headersB })).json().items.length, 0);
      const [ownUpload] = await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,file_key) VALUES (${runId},1,${randomUUID()},'media_upload','{}',${asset.key}) RETURNING id`;
      const choices = (await api.inject({ url: "/api/tools/assets", headers: headersA })).json().items.find((file: { key: string }) => file.key === asset.key).uploads;
      assert(choices.some((row: { resultId: number }) => row.resultId === ownUpload.id));
      assert.equal((await api.inject({ url: "/api/tools/assets", headers: headersB })).json().items.length, 0);

      const range = await api.inject({ url: asset.contentUrl, headers: { ...headersA, range: "bytes=0-7" } });
      assert.equal(range.statusCode, 206, range.body); assert.deepEqual(range.rawPayload, png.subarray(0, 8)); assert.match(String(range.headers["cache-control"]), /no-store/);
      for (const method of ["GET", "DELETE"] as const) assert.equal((await api.inject({ method, url: `/api/tools/assets/${encodeURIComponent(asset.key)}`, headers: headersB })).statusCode, 404);
      assert.equal((await api.inject({ url: asset.contentUrl, headers: headersB })).statusCode, 404);
      const imageInput = { prompt, resolution: "1k", size: "1:1", n: 1, fileKeys: [asset.key] };
      const ownQuote = await quote("images", imageInput); assert.equal(ownQuote.amount, 7);
      for (const input of [
        { kind: "images", input: imageInput }, { kind: "media-upload", input: { fileKey: asset.key } },
        { kind: "videos", input: { prompt: "Video", aspectRatio: "16:9", duration: 4, resolution: "480p", generateAudio: false, returnLastFrame: false, imageWithRoles: [{ fileKey: asset.key, role: "reference_image" }] } },
      ]) assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersB, payload: input })).statusCode, 404);
      const [result] = await sql`SELECT id FROM operation_results WHERE run_id=${runId} LIMIT 1`;
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersB, payload: { kind: "x-tweet", input: { tweetId: "123", sourceResultId: result.id } } })).statusCode, 404);
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersB, payload: { kind: "images/query", input: { runId } } })).statusCode, 404);
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersA, payload: { kind: "images/query", input: { taskId: "arbitrary-vendor-task" } } })).statusCode, 400);
      assert.equal((await api.inject({ method: "POST", url: "/api/tools/quote", headers: headersA, payload: { kind: "xhs-comments", input: { opusId: "123", dataNum: -1 } } })).statusCode, 400);
      assert.equal(supplier.hits(), 1);
      assert.equal((await api.inject({ method: "DELETE", url: `/api/tools/assets/${encodeURIComponent(asset.key)}`, headers: headersA })).statusCode, 200);
      assert.equal((await api.inject({ url: asset.contentUrl, headers: headersA })).statusCode, 404);
    });

    await t.test("projection selects business fields and rejects executable URLs, raw records and receipts", () => {
      const result = projectToolResult({ id: 1, kind: "ai_search_answer", data: { result: { content: "Answer <script>plain text</script>" }, record: { title: "Source", apiKey: "SECRET" }, response: { secret: "SECRET" }, receiptId: 55, url: "javascript:alert(1)", formats: [{ format: "txt", resourceUrl: "https://example.test/subtitle.txt" }] } });
      assert.equal(result.text, "Answer <script>plain text</script>"); assert.equal(result.url, null); assert.equal(result.links[0].url, "https://example.test/subtitle.txt");
      assert(!JSON.stringify(result).includes("SECRET")); assert(!JSON.stringify(result).includes("receiptId"));
    });
    await t.test("all AI search families expose their normalized answer and transcription retains text and timing", () => {
      for (const family of ["kimi", "yuanbao", "qianwen", "baidu", "doubao", "deepseek"] as const) {
        const parsed = parseAiSearchPoll(family, { taskId: "synthetic-result", status: "completed", completed: true, result: { content: `Answer from ${family}`, raw: "SECRET" } }, "synthetic-result");
        const answer = projectToolResult({ id: 1, kind: "ai_search_answer", data: { family, ...parsed.facts } });
        assert.equal(answer.text, `Answer from ${family}`); assert(!JSON.stringify(answer).includes("SECRET"));
      }
      const transcript = projectToolResult({ id: 2, kind: "transcription", data: { text: "完整转写正文", stampSents: [{ textSeg: "完整转写正文", start: "0", end: "2000" }], timestampUnit: "milliseconds" } });
      assert.match(transcript.text, /完整转写正文/); assert.match(transcript.text, /0 · 2000/); assert.equal(transcript.details.segmentCount, 1);
    });
    await t.test("media and subtitle queries expose downloadable tracks and video descriptions accurately", () => {
      const parsed = parseMediaTool("API_1792051516512", { title: "Video title", text: "Video description only", duration: 50, subtitles: [{ languageName: "中文", languageTag: "zh", urls: [{ format: "srt", url: "https://example.test/subtitle.srt" }] }] }, { url: "https://example.test/video" });
      const track = projectToolResult({ id: 1, ...parsed[0] }), summary = projectToolResult({ id: 2, ...parsed[1] });
      assert.equal(track.title, "Video title"); assert.equal(track.text, "Video description only");
      assert.equal(track.links[0].url, "https://example.test/subtitle.srt"); assert.equal(track.details.languageTag, "zh");
      assert.equal(summary.details.textMeaning, "video-description"); assert.equal(summary.details.subtitleFilesFetched, false);
      const check = parseMediaTool("API_1791881343238", { originalContent: "待检查正文", content: "<span class=\"banned-word\">待检查</span>正文", prohibitedWordsType: ["行业词", "通用词"] }, { content: "待检查正文" });
      const checked = projectToolResult({ id: 3, ...check[0] });
      assert.equal(checked.text, "待检查正文"); assert.equal(checked.details.prohibitedWordsType, "行业词、通用词");
      for (const kind of ["image", "video"] as const) {
        const result = projectToolResult({ id: 4, kind, data: { sourceUrl: `https://example.test/${kind}`, taskId: "own-task" }, file: { key: `uploads/redfox/${"a".repeat(64)}`, content_type: `${kind}/${kind === "image" ? "png" : "mp4"}`, bytes: 100, purpose: "operation-result", status: "available", sha256: "PRIVATE-DIGEST", created_at: new Date(0), metadata: { filename: `result.${kind === "image" ? "png" : "mp4"}`, kind } } });
        assert.equal(result.file?.kind, kind); assert.match(result.file!.contentUrl, /^\/api\/tools\/assets\//); assert(!JSON.stringify(result).includes("PRIVATE-DIGEST"));
      }
    });
    await t.test("platform work bodies, counts, aggregate research and public continuation values survive projection", () => {
      for (const [kind, field, value] of [["wechat_work", "articleContent", "<p>Article full text</p>"], ["instagram_work", "captionText", "Instagram caption"], ["kuaishou_work", "caption", "Kuaishou caption"], ["xiaohongshu_work", "workDesc", "Note body"], ["douyin_work", "aweme_desc", "Video caption"], ["x_research_work", "display_text", "Tweet display text"]]) {
        const result = projectToolResult({ id: 1, kind, data: { record: { [field]: value, followers_count: 17, apiKey: "SECRET" } } });
        assert.equal(result.text, value.replace(/<[^>]+>/g, "")); assert.equal(result.details.followers_count, 17); assert(!JSON.stringify(result).includes("SECRET"));
      }
      const notes = parseXiaohongshu("3X8FGEEM", { articles: [], hotTopics: [{ topic: "Topic A", articleCount: 12, totalInteractiveCount: 123 }], relatedSearches: [{ keyword: "Related B", articleCount: 3 }] }, {});
      const research = projectToolResult({ id: 2, ...notes[0] }); assert.match(research.text, /Topic A · 12 · 123/); assert.match(research.text, /Related B · 3/);
      const hotspots = parseHotResearch("9Y4EX7RW", [{ keyword: "Group", plats: ["weibo"], hotSpotList: [{ title: "Hot story", hotCount: "55", url: "https://example.test/hot" }] }]);
      const hotspot = projectToolResult({ id: 3, ...hotspots[0] }); assert.match(hotspot.text, /Hot story · 55/); assert.equal(hotspot.links[0].url, "https://example.test/hot");
      const page = projectToolResult({ id: 4, kind: "query_summary", data: { count: 1, pagination: { cursor: "next-public-page", hasMore: true, authToken: "SECRET" } } });
      assert.equal(page.details["pagination.cursor"], "next-public-page"); assert.equal(page.details["pagination.hasMore"], true); assert(!JSON.stringify(page).includes("SECRET"));
    });
  } finally {
    // Unique fixtures remain in this disposable database: their ledger and audit history are append-only.
    try {
      await restoreScope?.();
      if (savedBudget) await sql`UPDATE budgets SET per_minute=${savedBudget.per_minute},per_hour=${savedBudget.per_hour},per_day=${savedBudget.per_day} WHERE service='redfox.query'`;
    } finally {
      config.devAdmin = previousAdmin; config.allowPrivateNetworkFetch = previousPrivate;
      for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      try { await app?.close(); } finally {
        try { await supplier.close(); } finally {
          try { await stopBoss(); } finally { await closeDb(); }
        }
      }
    }
  }
});

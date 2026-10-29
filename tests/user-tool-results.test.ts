import { assertConfiguredTestDatabase, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { finished } from "node:stream/promises";
import { test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { createSiteUser } from "@aihot/backend/users/accounts";
import { loginSiteUser } from "@aihot/backend/users/auth";
import { exportUserToolResults } from "@aihot/backend/users/tools";
import { platformToolCatalog } from "@aihot/backend/providers/redfox/catalog";
import { buildApp } from "../apps/api/src/app.ts";

test("member result delivery separates process, exports a complete snapshot and filters before pagination", async t => {
  const unique = tag(), password = "synthetic-results-password-123", admin = `results-test:${unique}`;
  const previousAdmin = config.devAdmin;
  const [db] = await sql`SELECT current_database() AS name,inet_server_port() AS port`;
  assertConfiguredTestDatabase(db.name, db.port);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    config.devAdmin = null;
    const a = await createSiteUser({ username: `results_a_${unique}`, displayName: "Results A", password }, admin);
    const b = await createSiteUser({ username: `results_b_${unique}`, displayName: "Results B", password }, admin);
    const loginA = await loginSiteUser({ username: `results_a_${unique}`, password });
    const loginB = await loginSiteUser({ username: `results_b_${unique}`, password });
    const headersA = { cookie: `aihot_user=${loginA.token}` }, headersB = { cookie: `aihot_user=${loginB.token}` };
    app = await buildApp(); const api = app;
    const run = async (operation: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}, owner = a.id, status = "completed", provider = "redfox") => {
      const [row] = await sql`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key)
        VALUES (${`user:${owner}`},${randomUUID()},${provider},${operation},1,${sql.json({ parameters, ...extra } as never)},'synthetic',${status},${operation}) RETURNING id`;
      return row.id as number;
    };
    const result = async (runId: number, kind: string, data: Record<string, unknown>) => {
      const [row] = await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data)
        VALUES (${runId},1,${randomUUID()},${kind},${sql.json(data as never)}) RETURNING id`;
      return row.id as number;
    };

    await t.test("sixty process rows cannot hide the answer, citations, empty summaries or final media", async () => {
      const id = await run("redfox.ai_search.submit", { engine: "kimiK3", inquiryText: "How do results work?", apiKey: "PRIVATE_INPUT_SENTINEL" });
      for (let index = 0; index < 60; index++) await result(id, "ai_search_task", { status: "processing", taskId: "synthetic-task", apiKey: "PRIVATE_RESULT_SENTINEL" });
      await result(id, "ai_search_answer", { text: "The final answer", token: "PRIVATE_RESULT_SENTINEL" });
      await result(id, "ai_search_citation", { title: "Primary source", url: "https://example.test/source" });
      const response = await api.inject({ url: `/api/tools/runs/${id}`, headers: headersA }), detail = response.json();
      assert.equal(response.statusCode, 200, response.body); assert.match(String(response.headers["cache-control"]), /no-store/);
      assert.equal(detail.resultCount, 2); assert.equal(detail.processCount, 60);
      assert.deepEqual(detail.results.map((row: { kind: string }) => row.kind), ["ai_search_answer", "ai_search_citation"]);
      assert.equal(detail.results[0].text, "The final answer"); assert.equal(detail.nextResultCursor, null);
      assert.equal(detail.process.length, 50); assert(detail.nextProcessCursor);
      assert.equal(detail.title, "Kimi K3 搜索"); assert.equal(detail.summary, "How do results work?");
      assert(!response.body.includes("PRIVATE_"));
      const next = await api.inject({ url: `/api/tools/runs/${id}?section=process&after=${detail.nextProcessCursor}`, headers: headersA });
      assert.equal(next.json().process.length, 10); assert.equal(next.json().nextProcessCursor, null); assert.deepEqual(next.json().results, []);
      for (const suffix of ["", "?section=process&after=0", "/results/export"]) assert.equal((await api.inject({ url: `/api/tools/runs/${id}${suffix}`, headers: headersB })).statusCode, 404);
      const empty = await run("redfox.sync.query", { keyword: "empty query" });
      await result(empty, "query_summary", { count: 0 });
      assert.equal((await api.inject({ url: `/api/tools/runs/${empty}`, headers: headersA })).json().results[0].details.count, 0);
      const comments = await run("redfox.xhs_comments.submit", { opusId: "empty-comments" });
      await result(comments, "xhs_comment_task", { taskId: "empty-comments" });
      await result(comments, "xhs_comment_task", { status: "completed", actualCount: 0 });
      const commentDetail = (await api.inject({ url: `/api/tools/runs/${comments}`, headers: headersA })).json();
      assert.equal(commentDetail.resultCount, 1); assert.equal(commentDetail.processCount, 1); assert.equal(commentDetail.results[0].details.actualCount, 0);
      for (const [operation, processKind, finalKinds] of [
        ["redfox.image.generate", "image_task", ["image"]], ["redfox.video.generate", "video_task", ["video", "image"]],
        ["redfox.transcript.submit", "transcription_task", ["transcription"]],
      ] as const) {
        const media = await run(operation, { prompt: "Synthetic media" });
        for (const kind of [processKind, "image_reference", "video_reference", ...finalKinds]) await result(media, kind, { text: "Synthetic" });
        const mediaDetail = (await api.inject({ url: `/api/tools/runs/${media}`, headers: headersA })).json();
        assert.deepEqual(mediaDetail.results.map((row: { kind: string }) => row.kind), finalKinds); assert.equal(mediaDetail.processCount, 3);
      }
    });

    await t.test("product search cards and references survive private detail and export without vendor extensions", async () => {
      const { parseAiSearchPoll } = await import("@aihot/backend/providers/redfox/ai-search");
      for (const family of ["qianwenProducts", "doubaoProducts"] as const) {
        const id = await run("redfox.ai_search.submit", { engine: family, inquiryText: "Synthetic product search" });
        const card = { title: "测试商品", price: "¥12–20", originPrice: null, sales: "1万+", itemId: "90071992547409931", sourceSeq: "source_a", pos: 0, url: "https://example.test/item", image: "javascript:unsafe", apiKey: "PRIVATE_PRODUCT_SENTINEL" };
        const reference = { id: "90071992547409932", index: 1, title: "独立搜索参考", url: "https://example.test/source", token: "PRIVATE_REFERENCE_SENTINEL" };
        const parsed = parseAiSearchPoll(family, { taskId: "synthetic", status: "completed", result: { content: "测试回答", cardData: [card], searchGuid: [reference] } }, "synthetic");
        await result(id, "ai_search_answer", { ...parsed.facts, family });
        const response = await api.inject({ url: `/api/tools/runs/${id}`, headers: headersA }), row = response.json().results[0];
        assert.equal(response.statusCode, 200, response.body); assert.equal(row.text, "测试回答");
        assert.deepEqual(row.products.cardData, [{ title: card.title, price: card.price, originPrice: null, sales: card.sales, itemId: card.itemId, sourceSeq: card.sourceSeq, pos: 0, url: card.url, image: null }]);
        assert.equal(row.products.searchGuid.length, family === "doubaoProducts" ? 1 : 0);
        assert(!response.body.includes("PRIVATE_")); assert(!response.body.includes("javascript:"));
        let exported = ""; for await (const chunk of await exportUserToolResults(a.id, id)) exported += chunk;
        assert.deepEqual(JSON.parse(exported).results[0].products, row.products);
        assert.equal((await api.inject({ url: `/api/tools/runs/${id}/results/export`, headers: headersB })).statusCode, 404);
      }
    });

    await t.test("new Zhihu result fields retain authors, continuation and hot-search facts", async () => {
      const { parseZhihu } = await import("@aihot/backend/providers/redfox/zhihu");
      const id = await run("redfox.sync.query", { articleId: "123" });
      const rows = [
        ...parseZhihu("API_1792651427872", { opusId: "123", type: "article", opusUrl: "https://zhuanlan.zhihu.com/p/123", title: "文章", content: "正文", authorUid: "456", authorNickname: "作者", publishTime: 1000 }, { articleId: "123" }),
        ...parseZhihu("API_1792651427970", { items: [{ id: "789", content: "评论正文", nickname: "评论者", avatorUrl: "https://example.test/avatar", publishTime: "1000" }], nextUrl: "https://example.test/comments?offset=20" }, { articleId: "123" }),
        ...parseZhihu("API_1792651658984", [{ title: "热点", hotValue: "120万", label: "热", rank: 0 }], {}),
      ];
      for (const row of rows) await result(id, row.kind, row.data);
      const response = await api.inject({ url: `/api/tools/runs/${id}`, headers: headersA }), details = response.json().results;
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(details[0].details.authorNickname, "作者"); assert.equal(details[0].details.publishTimeUnit, "seconds");
      assert.equal(details[1].details.commentId, "789"); assert.equal(details[1].text, "评论正文");
      assert.deepEqual(details[1].links, [{ label: "avatarUrl", url: "https://example.test/avatar" }]);
      assert.equal(details[2].details["paging.data.nextUrl"], "https://example.test/comments?offset=20");
      assert.equal(details[3].details.hotValue, "120万"); assert.equal(details[3].details.rank, 0);
    });

    await t.test("Bilibili parser facts survive safe projection and export", async () => {
      const { parseAgentKeyBilibili } = await import("@aihot/backend/providers/agentkey/bilibili-parser");
      const { bilibiliCommentsRoute, bilibiliRelationRoute } = await import("@aihot/backend/providers/agentkey/bilibili-contract");
      const { projectToolResult } = await import("@aihot/backend/users/tool-results");
      const response = (data: unknown) => ({ httpStatus: 200, envelope: { provider: "TikHub", data: { code: 200, data } } });
      const message = "完整评论".repeat(400);
      const parsed = parseAgentKeyBilibili(response({ code: 0, data: { replies: [{ rpid_str: "101", oid_str: "202", mid_str: "303", root_str: "0", parent_str: "0", content: { message }, member: { mid: "303", uname: "作者" }, like: 22, rcount: 11 }] } }), bilibiliCommentsRoute, { av_id: "202" });
      const dto = projectToolResult({ id: 1, ...parsed.candidates[0] });
      assert.equal(dto.text, message); assert.equal(dto.details.authorName, "作者"); assert.equal(dto.details.likeCount, 22); assert.equal(dto.details.replyCount, 11);
      const relation = parseAgentKeyBilibili(response({ mid: "303", following: 100, follower: 9876 }), bilibiliRelationRoute, { uid: "303" });
      const id = await run("agentkey.query", { uid: "303" });
      await result(id, "query_summary", relation.summary);
      let data = ""; for await (const chunk of await exportUserToolResults(a.id, id)) data += chunk;
      assert.equal(JSON.parse(data).results[0].details.followerCount, 9876);
    });

    await t.test("expired process rows keep their section and real query keys remain searchable", async () => {
      const id = await run("redfox.image.generate", { screen_name: "retention_account" });
      for (let i = 0; i < 60; i++) await result(id, "result_expired", { originalKind: "image_task", expiredAt: "2001-01-01" });
      await result(id, "image", { width: 64 });
      const detail = (await api.inject({ url: `/api/tools/runs/${id}`, headers: headersA })).json();
      assert.equal(detail.resultCount, 1); assert.equal(detail.processCount, 60);
      assert.equal(detail.results[0].kind, "image");
      const history = (await api.inject({ url: "/api/tools/runs?q=retention_account", headers: headersA })).json();
      assert(history.rows.some((row: { id: number; summary: string }) => row.id === id && row.summary === "retention_account"));
    });

    await t.test("complete export uses the safe DTO and excludes writes committed after its snapshot", async () => {
      const id = await run("redfox.sync.query", { keyword: "all results" });
      for (let index = 0; index < 125; index++) await result(id, "query_summary", { title: `Result ${index}`, text: "content ".repeat(300), count: index, rawSecret: "PRIVATE_EXPORT_SENTINEL" });
      const first = (await api.inject({ url: `/api/tools/runs/${id}`, headers: headersA })).json();
      assert.equal(first.results.length, 50); assert(first.nextResultCursor); assert.equal(first.resultCount, 125);
      const page2 = (await api.inject({ url: `/api/tools/runs/${id}?after=${first.nextResultCursor}`, headers: headersA })).json();
      assert.equal(page2.results.length, 50); assert.equal(page2.results[0].details.count, 50);
      const stream = await exportUserToolResults(a.id, id);
      await result(id, "query_summary", { title: "A later result", count: 999 });
      let body = ""; for await (const chunk of stream) body += chunk.toString();
      const snapshot = JSON.parse(body);
      assert.equal(snapshot.resultCount, 125); assert.equal(snapshot.results.length, 125); assert.equal(snapshot.nextCursor, null);
      assert(snapshot.snapshotAt); assert.equal(snapshot.lastResultId, snapshot.results.at(-1).id);
      assert(!body.includes("A later result")); assert(!body.includes("PRIVATE_EXPORT_SENTINEL"));
      const download = await api.inject({ url: `/api/tools/runs/${id}/results/export`, headers: headersA });
      assert.equal(download.statusCode, 200, download.body); assert.equal(download.json().results.length, 126);
      assert.match(String(download.headers["content-disposition"]), /attachment/); assert.match(String(download.headers["cache-control"]), /no-store/);
      // More cancellations than the default pool size must release their cursor and transaction.
      for (let index = 0; index < 12; index++) {
        const aborted = await exportUserToolResults(a.id, id), closed = finished(aborted).catch(() => {});
        aborted.destroy(); await closed;
      }
      assert.equal((await sql`SELECT 1 AS healthy`)[0].healthy, 1);
    });

    await t.test("real provider query targets remain identifiable and searchable before pagination", async () => {
      const { parseAgentKeyQuery } = await import("@aihot/backend/providers/agentkey/queries");
      const { parseSynchronousQuery } = await import("@aihot/backend/providers/redfox/synchronous");
      const agentKey: [string, string, string | number, Record<string, unknown>?][] = [
        ["x.account_profile", "screen_name", "review_control"],
        ["TIN1NMTZ", "av_id", "298791"], ["bilibili.comments", "bv_id", "BV1xx411c7mD"],
        ["QEQLCKD6", "sec_user_id", "review_douyin_user"], ["FK67XDVQ", "aweme_id", "7398123456789"],
        ["KR1LPTBF", "note_id", "review_xhs_note"], ["xiaohongshu.topic_posts", "page_id", "review_xhs_topic"],
        ["douyin.comment_replies", "item_id", "7398123456790", { comment_id: "981234" }],
        ["douyin.topic_posts", "ch_id", "7398123456791"],
      ];
      const redfox: typeof agentKey = [
        ["6C4A77XR", "account", "review_wechat"], ["KUQYSQNX", "wxId", "gh_review123"], ["KUQYSQNX", "bizInfo", "review_biz"],
        ["XEO0QQNF", "workUuid", "review_uuid"], ["I3CIBRI2", "articleUrl", "https://mp.weixin.qq.com/s/review?secret=PRIVATE_URL_SECRET#fragment"],
        ["I3CIBRI2", "articleUrl", "HTTPS://mp.weixin.qq.com/s/reviewcase?secret=PRIVATE_URL_SECRET#fragment"],
        ["QEQLCKD6", "authorUrl", "https://www.douyin.com/user/review"], ["QEQLCKD6", "secUserId", "review_sec_user"],
        ["QSL2ZSXM", "uniqueName", "review_douyin"], ["QSL2ZSXM", "shortId", "812345"],
        ["0OT1E306", "workUrl", "https://www.douyin.com/video/7398123456789"],
        ["KR1LPTBF", "workLink", "https://www.xiaohongshu.com/explore/review"],
        ["XN3ULENA", "redId", "review_red"], ["XN3ULENA", "userid", "review_user_id"],
        ["TIN1NMTZ", "bvId", "BV1xx411c7mD"], ["EH53TOT7", "mid", "298792"],
        ["VPA67I98", "accountUrl", "https://space.bilibili.com/298793"],
        ["GC5SC5HS", "searchQuery", "review youtube"], ["Z9M88QI8", "codeOrUrl", "ReviewABC123"],
        ["OVUTOTCV", "nickname", "review nickname"], ["27DQ6SF9", "kwaiId", "review_kwai"],
        ["27DQ6SF9", "threeXId", "review_three_x"], ["UOM99OQI", "photoId", "review_photo"],
        ["4QS1F8DE", "name", "review toutiao"], ["4BOZ9DLE", "authorId", "298794", { page: 1 }],
        ["API_1789097000710", "articleId", "298795"], ["API_1789097000761", "svId", "298796"],
        ["API_1789097000814", "uk", "review_uk"], ["API_1789097000858", "keyWord", "review baijiahao", { pn: "0" }],
        ["API_1789095347662", "keword", "review zhihu", { offset: "0" }],
        ["API_1791446025175", "itemId", "7398123456792", { commentId: "981235", cursor: 0, count: 20 }],
      ];
      const samples: { id: number; summary: string }[] = [];
      for (const [provider, cases] of [["agentkey", agentKey], ["redfox", redfox]] as const) {
        for (const [operationId, field, value, extra] of cases) {
          const parameters = { [field]: value, ...extra };
          const parsed = (() => {
            try { return provider === "agentkey" ? parseAgentKeyQuery({ provider, operationId, parameters }) : parseSynchronousQuery({ operationId, parameters }); }
            catch (cause) { throw new Error(`Invalid fixture: ${provider}/${operationId}/${field}`, { cause }); }
          })();
          const operation = "route" in parsed ? parsed.route.operationKey : "redfox.sync.query";
          const summary = String((parsed.parameters as Record<string, unknown>)[field]).replace(/[?#].*$/, "");
          const command = { operationId, mode: "query", members: [] };
          const id = await run(operation, parsed.parameters, command, a.id, "completed", provider);
          await run(operation, parsed.parameters, command, b.id, "completed", provider);
          samples.push({ id, summary });
        }
      }
      // Every target is older than an entire unfiltered page; search must filter before LIMIT.
      for (let i = 0; i < 55; i++) await run("redfox.sync.query", { keyword: `Unrelated history ${i}` });
      for (const sample of samples) {
        const response = await api.inject({ url: `/api/tools/runs?q=${encodeURIComponent(sample.summary)}`, headers: headersA });
        assert.equal(response.statusCode, 200, response.body);
        const rows = response.json().rows;
        assert(rows.some((row: { id: number; summary: string }) => row.id === sample.id && row.summary === sample.summary), `Missing query target: ${sample.summary}`);
        assert(rows.every((row: { id: number }) => samples.some(own => own.id === row.id)), "Foreign or unrelated tasks must not leak into search");
      }
      const opaque = await run("redfox.sync.query", { token: "PRIVATE_OPAQUE_SENTINEL", pageToken: "PRIVATE_OPAQUE_SENTINEL", cursor: "PRIVATE_OPAQUE_SENTINEL" });
      assert.equal((await api.inject({ url: `/api/tools/runs/${opaque}`, headers: headersA })).json().summary, "");
      for (const secret of ["PRIVATE_OPAQUE_SENTINEL", "PRIVATE_URL_SECRET"]) {
        assert.deepEqual((await api.inject({ url: `/api/tools/runs?q=${secret}`, headers: headersA })).json().rows, []);
      }
    });

    await t.test("history searches safe input and concrete catalog labels before selecting its cursor page", async () => {
      const catalog = await platformToolCatalog(), tool = catalog.find(item => item.platform !== "redfox-account")!;
      const old = await run("redfox.sync.query", { keyword: "Literal 100%_\\ needle", token: "PRIVATE_SEARCH_SENTINEL" }, { operationId: tool.id });
      for (let index = 0; index < 55; index++) await run("redfox.image.generate", { model: "gptImage25", prompt: `Image page ${index}` });
      await run("redfox.sync.query", { keyword: "Literal 100%_\\ needle foreign" }, { operationId: tool.id }, b.id);
      const search = (await api.inject({ url: `/api/tools/runs?q=${encodeURIComponent("100%_\\")}`, headers: headersA })).json();
      assert.deepEqual(search.rows.map((row: { id: number }) => row.id), [old]); assert.equal(search.rows[0].title, tool.label);
      const byTitle = (await api.inject({ url: `/api/tools/runs?q=${encodeURIComponent(tool.label)}`, headers: headersA })).json();
      assert(byTitle.rows.some((row: { id: number }) => row.id === old));
      assert.deepEqual((await api.inject({ url: "/api/tools/runs?q=PRIVATE_SEARCH_SENTINEL", headers: headersA })).json().rows, []);
      const images = (await api.inject({ url: "/api/tools/runs?category=images&status=completed", headers: headersA })).json();
      assert.equal(images.rows.length, 50); assert(images.nextCursor); assert(images.rows.every((row: { category: string }) => row.category === "images"));
      const rest = (await api.inject({ url: `/api/tools/runs?category=images&status=completed&after=${images.nextCursor}`, headers: headersA })).json();
      assert(rest.rows.length >= 5); assert(!rest.rows.some((row: { id: number }) => images.rows.some((previous: { id: number }) => previous.id === row.id)));
      const waiting = await run("redfox.video.generate", { prompt: "Waiting video" }, {}, a.id, "waiting");
      assert.deepEqual((await api.inject({ url: "/api/tools/runs?category=videos&status=waiting", headers: headersA })).json().rows.map((row: { id: number }) => row.id), [waiting]);
      const source = await run("redfox.transcript.submit", { url: "https://person:password@example.test/video?token=PRIVATE_URL_SECRET#fragment" });
      const sourceDetail = (await api.inject({ url: `/api/tools/runs/${source}`, headers: headersA })).json();
      assert.equal(sourceDetail.summary, "https://example.test/video");
      const fake = await run("redfox.ai_search.query", { taskId: "own-task" }, { memberRecovery: { parentRunId: old } });
      const fakeDetail = (await api.inject({ url: `/api/tools/runs/${fake}`, headers: headersA })).json();
      assert.equal(fakeDetail.originRunId, null); assert(!fakeDetail.summary.includes("needle"));
      for (const suffix of ["status=invalid", "category=invalid", `q=${"x".repeat(121)}`, "after=0"]) assert.equal((await api.inject({ url: `/api/tools/runs?${suffix}`, headers: headersA })).statusCode, 400);
    });
  } finally {
    config.devAdmin = previousAdmin;
    try { await app?.close(); } finally { try { await stopBoss(); } finally { await closeDb(); } }
  }
});

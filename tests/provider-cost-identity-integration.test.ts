import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { mpArticle, mpHistory } from "@aihot/backend/providers/dajiala";
import { jinaRead } from "@aihot/backend/providers/jina";
import { getArticle, getTweet, searchTweets } from "@aihot/backend/providers/socialdata";

let server: http.Server;
let savedBudgets: Array<{ service: string; per_minute: number; per_hour: number; per_day: number }> = [];
let savedEnv: Record<string, string | undefined> = {};
let base = "";

before(async () => {
  const tweet = {
    id_str: "1234567890123456789",
    tweet_created_at: "2026-10-31T00:00:00.000Z",
    full_text: "Synthetic post",
    user: { name: "Synthetic", screen_name: "synthetic" },
  };
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      res.setHeader("content-type", url.pathname.startsWith("/https://") ? "text/plain" : "application/json");
      if (url.pathname.startsWith("/https://")) {
        res.end("Title: Synthetic Jina page\nURL Source: https://example.test/article\n\nMarkdown Content:\nSynthetic body");
      } else if (url.pathname === "/twitter/search") {
        res.end(JSON.stringify({ tweets: [tweet], next_cursor: null }));
      } else if (url.pathname.startsWith("/twitter/article/")) {
        res.end(JSON.stringify({ article: { title: "Synthetic article" } }));
      } else if (url.pathname.startsWith("/twitter/tweets/")) {
        res.end(JSON.stringify(tweet));
      } else if (url.pathname === "/fbmain/monitor/v3/post_history") {
        res.end(JSON.stringify({
          code: 0,
          data: [{ position: 1, url: "https://mp.weixin.qq.com/s?__biz=synthetic&mid=1&idx=1&sn=synthetic", title: "Synthetic MP post", post_time: 1 }],
          remain_money: 1,
        }));
      } else if (url.pathname === "/fbmain/monitor/v3/article_detail") {
        res.end(JSON.stringify({ code: 0, title: "Synthetic MP post", content: "Synthetic article body" }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  savedBudgets = await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('jina','socialdata','dajiala')`;
  await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('jina','socialdata','dajiala')`;
  savedEnv = {
    JINA_API_KEY: process.env.JINA_API_KEY,
    JINA_BASE_URL: process.env.JINA_BASE_URL,
    SOCIALDATA_API_KEY: process.env.SOCIALDATA_API_KEY,
    SOCIALDATA_BASE_URL: process.env.SOCIALDATA_BASE_URL,
    DAJIALA_KEY: process.env.DAJIALA_KEY,
    DAJIALA_BASE_URL: process.env.DAJIALA_BASE_URL,
  };
  Object.assign(process.env, {
    JINA_API_KEY: "synthetic-jina-key",
    JINA_BASE_URL: base,
    SOCIALDATA_API_KEY: "synthetic-socialdata-key",
    SOCIALDATA_BASE_URL: base,
    DAJIALA_KEY: "synthetic-dajiala-key",
    DAJIALA_BASE_URL: base,
  });
  config.allowPrivateNetworkFetch = true;
});

after(async () => {
  for (const row of savedBudgets) {
    await sql`UPDATE budgets SET per_minute=${row.per_minute},per_hour=${row.per_hour},per_day=${row.per_day} WHERE service=${row.service}`;
  }
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

async function attempt(subject: string) {
  const [row] = await sql<{ billing_provider: string | null; operation_id: string; model_id: string | null }[]>`
    SELECT a.billing_provider,a.operation_id,a.model_id
    FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
    WHERE r.subject=${subject} ORDER BY a.id DESC LIMIT 1`;
  assert.ok(row, `missing receipt attempt for ${subject}`);
  return row;
}

test("custom adapter endpoints persist explicit unknown provider identities without changing operations", async () => {
  const jinaSubject = `jina-${tag()}`;
  await jinaRead(`https://example.test/${tag()}`, { purpose: "identity_test", subject: jinaSubject });
  assert.deepEqual(await attempt(jinaSubject), { billing_provider: null, operation_id: "reader.read", model_id: null });

  const searchSubject = `search-${tag()}`;
  await searchTweets("from:synthetic", { purpose: "identity_test", subject: searchSubject, window: tag() });
  assert.deepEqual(await attempt(searchSubject), { billing_provider: null, operation_id: "twitter.search", model_id: null });

  const articleSubject = `article-${tag()}`;
  await getArticle(`article-${tag()}`, { purpose: "identity_test", subject: articleSubject });
  assert.deepEqual(await attempt(articleSubject), { billing_provider: null, operation_id: "twitter.article", model_id: null });

  const tweetSubject = `tweet-${tag()}`;
  await getTweet(`tweet-${tag()}`, { purpose: "identity_test", subject: tweetSubject });
  assert.deepEqual(await attempt(tweetSubject), { billing_provider: null, operation_id: "twitter.tweets", model_id: null });

  const historySubject = `history-${tag()}`;
  await mpHistory("synthetic-ghid", { subject: historySubject, window: tag() });
  assert.deepEqual(await attempt(historySubject), { billing_provider: null, operation_id: "post_history", model_id: null });

  const mpArticleSubject = `mp-article-${tag()}`;
  await mpArticle("https://mp.weixin.qq.com/s?__biz=synthetic", { subject: mpArticleSubject, identity: tag() });
  assert.deepEqual(await attempt(mpArticleSubject), { billing_provider: null, operation_id: "article_detail", model_id: null });
});

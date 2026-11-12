import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_HEADERS, safeAccountReturn, safeAssistantReturn, assistantCreditsHref } from "../app/features/account/data.ts";

test("account sign-in returns only to same-origin reader pages", () => {
  assert.equal(safeAccountReturn("/tools?view=images&taskId=123"), "/tools?view=images&taskId=123");
  assert.equal(safeAccountReturn("/account"), "/account");
  assert.equal(safeAccountReturn("/assistant/sessions/owned?view=artifacts"), "/assistant/sessions/owned?view=artifacts");
  assert.equal(safeAccountReturn("/tools/assistant?from=bookmark"), "/tools/assistant?from=bookmark");
  assert.equal(safeAccountReturn("/"), "/");
  for (const unsafe of [null, "", "https://other.test/", "//other.test/", "/\\other.test", "/%2f%2fother.test", "/%5cother.test", "/%0aother.test", "/admin", "/admin/users", "/api/account/logout", "/login?return=/account", "/register", "/%61dmin", "/tools/../admin", "/%", "/\tother.test"]) {
    assert.equal(safeAccountReturn(unsafe), "/tools", String(unsafe));
  }
  assert.equal(ACCOUNT_HEADERS["Cache-Control"], "private, no-store");
});

test("credit navigation carries only a safe assistant destination", () => {
  for (const path of ["/assistant", "/assistant/xiaohongshu", "/assistant/sessions/owned-session#assistant-fees"]) {
    assert.equal(safeAssistantReturn(path), path);
    const href = new URL(assistantCreditsHref(path), "https://site.test");
    assert.equal(href.pathname, "/account");
    assert.equal(href.hash, "#account-credits");
    assert.deepEqual([...href.searchParams.entries()], [["assistantReturn", path]]);
  }
  for (const path of [null, "", "//evil.test", "https://evil.test/assistant", "/assistant?message=private", "/assistant/sessions/owned?quoteId=private", "/assistant/sessions/../admin", "/assistant/%2f%2fevil.test", "/assistant/sessions/%5cevil", "/assistant\n", "/account", "/assistant/sessions/owned#secret"]) {
    assert.equal(safeAssistantReturn(path), null, String(path));
    assert.equal(assistantCreditsHref(path ?? undefined), "/account#account-credits");
  }
});

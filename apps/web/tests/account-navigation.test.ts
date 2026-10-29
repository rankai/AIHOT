import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCOUNT_HEADERS, safeAccountReturn } from "../app/features/account/data.ts";

test("account sign-in returns only to same-origin reader pages", () => {
  assert.equal(safeAccountReturn("/tools?view=images&taskId=123"), "/tools?view=images&taskId=123");
  assert.equal(safeAccountReturn("/account"), "/account");
  assert.equal(safeAccountReturn("/"), "/");
  for (const unsafe of [null, "", "https://other.test/", "//other.test/", "/\\other.test", "/%2f%2fother.test", "/%5cother.test", "/%0aother.test", "/admin", "/admin/users", "/api/account/logout", "/login?return=/account", "/register", "/%61dmin", "/tools/../admin", "/%", "/\tother.test"]) {
    assert.equal(safeAccountReturn(unsafe), "/tools", String(unsafe));
  }
  assert.equal(ACCOUNT_HEADERS["Cache-Control"], "private, no-store");
});

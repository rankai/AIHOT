import assert from "node:assert/strict";
import { test } from "node:test";
import { platformParameters, safeExternalUrl, type PlatformOperation } from "../app/features/admin/platform-types.ts";
const base = { id: "test", platform: "weibo", label: "测试", purpose: "query", schedulableType: null };
test("descriptor fields preserve string work pages, convert integer account pages, and omit empty optional choices", () => {
  const operation: PlatformOperation = { ...base, fields: [
    { name: "page", label: "作品页码", type: "string", required: true, constraints: { pattern: "^[1-9][0-9]*$", max: Number.MAX_SAFE_INTEGER } },
    { name: "accountPage", label: "账号页码", type: "integer", required: true, constraints: { min: 1, max: Number.MAX_SAFE_INTEGER } },
    { name: "extParam", label: "认证", type: "select", required: false, options: [{ value: "0", label: "普通" }] },
  ] };
  assert.deepEqual(platformParameters(operation, { page: "100", accountPage: "100", extParam: "" }), { page: "100", accountPage: 100 });
  for (const page of ["0", "-1", "1.5", "9007199254740992"]) assert.throws(() => platformParameters(operation, { page, accountPage: "1" }));
});
test("upstream links reject credentials and executable schemes while preserving safe HTTP(S) destinations", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com/image", "//example.com/image"]) assert.equal(safeExternalUrl(value), null);
  assert.equal(safeExternalUrl("https://weibo.com/123/456"), "https://weibo.com/123/456");
});

test("optional booleans preserve omitted, false and true as separate wire values; offsets keep the documented step", () => {
  const operation: PlatformOperation = { ...base, platform: "wechat", fields: [
    { name: "offset", label: "偏移量", type: "integer", required: false, default: 0, constraints: { min: 0, step: 20, max: Number.MAX_SAFE_INTEGER } },
    { name: "exactMatch", label: "精准匹配", type: "boolean", required: false, default: false },
  ] };
  assert.deepEqual(platformParameters(operation, { offset: "20", exactMatch: "false" }), { offset: 20, exactMatch: false });
  assert.deepEqual(platformParameters(operation, { offset: "0", exactMatch: "true" }), { offset: 0, exactMatch: true });
  assert.deepEqual(platformParameters(operation, { offset: "", exactMatch: "" }), {});
  assert.throws(() => platformParameters(operation, { offset: "21", exactMatch: "false" }), /20/);
  assert.throws(() => platformParameters(operation, { exactMatch: "0" }));
});

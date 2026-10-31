import assert from "node:assert/strict";
import { test } from "node:test";
import { dajialaBillingProvider } from "@aihot/backend/providers/dajiala";
import { jinaBillingProvider } from "@aihot/backend/providers/jina";
import { socialDataBillingProvider } from "@aihot/backend/providers/socialdata";
import { wanPriceRule, wanReadyPriceSnapshot } from "@aihot/backend/providers/aliyun/wan-client";

test("only exact documented provider origins prove billing identity", () => {
  assert.equal(jinaBillingProvider("https://r.jina.ai"), "jina");
  assert.equal(jinaBillingProvider("https://r.jina.ai/"), "jina");
  assert.equal(socialDataBillingProvider("https://api.socialdata.tools"), "socialdata");
  assert.equal(socialDataBillingProvider("https://api.socialdata.tools///"), "socialdata");
  assert.equal(dajialaBillingProvider("https://www.dajiala.com"), "dajiala");
  assert.equal(dajialaBillingProvider("https://www.dajiala.com/"), "dajiala");

  for (const base of [
    "http://r.jina.ai",
    "https://r.jina.ai/v1",
    "https://r.jina.ai.evil.test",
    "https://user@r.jina.ai",
    "https://r.jina.ai?proxy=1",
    "https://r.jina.ai#proxy",
    "https://api.socialdata.tools/proxy",
    "https://api.socialdata.tools.evil.test",
    "https://www.dajiala.com/proxy",
    "https://www.dajiala.com.evil.test",
  ]) {
    assert.equal(jinaBillingProvider(base), null, base);
    assert.equal(socialDataBillingProvider(base), null, base);
    assert.equal(dajialaBillingProvider(base), null, base);
  }
});

test("Wan turns a frozen per-second rule into separate ready price evidence", () => {
  const rule = {
    unit: "second",
    perSecondCny: "0.6",
    currency: "CNY",
    basis: "documented-estimate",
    ruleVersion: "wan2.2-animate-mix-2026-10-29",
    date: "2026-10-29",
    sourceUrl: "https://help.aliyun.com/zh/model-studio/wan2-2-animate-mix",
  } as const;
  assert.deepEqual(wanPriceRule(rule), rule);
  assert.deepEqual(wanReadyPriceSnapshot(
    { service: "aliyun.wan.video", model: "wan2.2-animate-mix" },
    rule,
    new Date("2026-10-31T01:02:03.000Z"),
  ), {
    version: 1,
    state: "ready",
    service: "aliyun.wan.video",
    model: "wan2.2-animate-mix",
    currency: "CNY",
    perRequest: null,
    inputPerMtok: null,
    cachedInputPerMtok: null,
    outputPerMtok: null,
    sourceUrl: rule.sourceUrl,
    verifiedOn: "2026-10-29",
    selectedAt: "2026-10-31T01:02:03.000Z",
    unit: "second",
    perSecondCny: "0.6",
    ruleVersion: rule.ruleVersion,
    date: "2026-10-29",
  });
});

test("Wan rejects incomplete, mistyped, and impossible frozen price rules", () => {
  const rule = {
    unit: "second",
    perSecondCny: "0.6",
    currency: "CNY",
    basis: "documented-estimate",
    ruleVersion: "wan2.2-animate-mix-2026-10-29",
    date: "2026-10-29",
    sourceUrl: "https://help.aliyun.com/zh/model-studio/wan2-2-animate-mix",
  };
  const invalidValues = {
    unit: "millisecond",
    perSecondCny: "1.0",
    currency: "USD",
    basis: "actual",
    ruleVersion: "bad version",
    date: "2026-02-30",
  };
  for (const [field, value] of Object.entries(invalidValues)) {
    assert.equal(wanPriceRule({ ...rule, [field]: value }), null, field);
  }
  assert.equal(wanPriceRule({ ...rule, perSecondCny: 0.6 }), null);
  assert.equal(wanPriceRule({ ...rule, sourceUrl: 1 }), null);
});

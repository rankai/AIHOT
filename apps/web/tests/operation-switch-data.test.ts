import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionPreflightMatches, collectionTargets, mpLibrary, sameCollectionTarget, type CollectionPreflight } from "../app/features/admin/operation-switch-data.ts";

const source = { id: "mp-current", kind: "mp_account", version: "2026-10-20T12:00:00+08:00", subscriptionVersion: 7 };
const preflight: CollectionPreflight = {
  sourceId: source.id, target: "redfox", library: "wide", sourceVersion: "2026-10-20T04:00:00.000Z", subscriptionVersion: 7,
  mappingVersion: 1, supported: true, mapping: {}, checks: [{ key: "permission:list", source: "latest receipt", conclusion: "unverified", evidence: "尚未核实，不额外付费探测" }],
};

test("source kind determines the native target without requesting SocialData for MP", () => {
  assert.deepEqual(collectionTargets("mp_account"), ["redfox", "dajiala", "agentkey"]);
  assert.deepEqual(collectionTargets("x_search"), ["redfox", "socialdata"]);
  assert.deepEqual(collectionTargets("external"), []);
});

test("same Redfox provider permits an explicit library change but not the already saved configuration", () => {
  assert.equal(sameCollectionTarget("mp_account", "redfox", "redfox", "wide", "wide"), true);
  assert.equal(sameCollectionTarget("mp_account", "redfox", "redfox", "wide", "premium"), false);
  assert.equal(sameCollectionTarget("mp_account", "redfox", "redfox", "premium", "wide"), false);
  assert.equal(sameCollectionTarget("mp_account", "dajiala", "redfox", null, "wide"), false);
  assert.equal(sameCollectionTarget("mp_account", "dajiala", "dajiala", null, "premium"), true);
  assert.equal(sameCollectionTarget("x_search", "redfox", "redfox", null, "premium"), true);
});

test("only Redfox uses a library; AgentKey and native preflights still check source versions", () => {
  assert.equal(collectionPreflightMatches(preflight, source, "wide"), true);
  assert.equal(collectionPreflightMatches(preflight, source, "premium"), false);
  const native = { ...preflight, target: "dajiala" as const };
  assert.equal(collectionPreflightMatches(native, source, "premium"), true);
  assert.equal(collectionPreflightMatches({ ...native, library: "premium" }, source, "premium"), true);
  const agentkey = { ...preflight, target: "agentkey" as const, library: null };
  assert.equal(collectionPreflightMatches(agentkey, source, "wide"), true);
  assert.equal(collectionPreflightMatches(agentkey, source, "premium"), true);
  assert.equal(collectionPreflightMatches(agentkey, { ...source, subscriptionVersion: 8 }, "wide"), false);
  assert.equal(sameCollectionTarget("mp_account", "agentkey", "agentkey", null, "wide"), true);
});

test("preflight cannot be reused for a different source, kind or changed source/subscription version", () => {
  assert.equal(collectionPreflightMatches({ ...preflight, sourceId: "another-mp" }, source, "wide"), false);
  assert.equal(collectionPreflightMatches({ ...preflight, target: "socialdata" }, source, "wide"), false);
  assert.equal(collectionPreflightMatches(preflight, { ...source, version: "2026-10-20T12:00:01+08:00" }, "wide"), false);
  assert.equal(collectionPreflightMatches(preflight, { ...source, subscriptionVersion: 8 }, "wide"), false);
});

test("X preflight remains independent of MP library and unavailable MP library data is not invented", () => {
  const x = { ...source, kind: "x_search" };
  const p = { ...preflight, library: undefined, target: "socialdata" as const };
  assert.equal(collectionPreflightMatches(p, x, "wide"), true);
  assert.equal(collectionPreflightMatches(p, x, "premium"), true);
  assert.equal(collectionPreflightMatches({ ...preflight, library: undefined }, source, "wide"), false);
  assert.equal(mpLibrary("wide"), "wide");
  assert.equal(mpLibrary("premium"), "premium");
  assert.equal(mpLibrary("auto"), null);
  assert.equal(mpLibrary(undefined), null);
});

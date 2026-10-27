import {collectionOperationIds} from "@aihot/backend/sources/platform-subscriptions";
import {contentSubscription} from "@aihot/backend/sources/subscriptions";
import {after, before, test} from "node:test";
import assert from "node:assert/strict";
import {assertConfiguredTestDatabase} from "./setup.ts";
import {sql, closeDb} from "@aihot/backend/db";
import {config} from "@aihot/backend/config";
import {stopBoss} from "@aihot/backend/jobs/queue";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";
import {xResearchDescriptors} from "@aihot/backend/providers/agentkey/x-contract";
import {weiboResearchDescriptors} from "@aihot/backend/providers/agentkey/weibo-contract";
import {bilibiliResearchDescriptors} from "@aihot/backend/providers/agentkey/bilibili-contract";
import {xiaohongshuResearchDescriptors} from "@aihot/backend/providers/agentkey/xiaohongshu-contract";
import {toutiaoResearchDescriptors} from "@aihot/backend/providers/agentkey/toutiao-contract";
import {wechatResearchDescriptors} from "@aihot/backend/providers/agentkey/wechat-contract";
import {douyinSnapshotDescriptors, douyinSuggestDescriptor} from "@aihot/backend/providers/agentkey/douyin-contract";
import {collectionConfig, collectionDraft, providerOperation, queryProviders} from "../apps/web/app/features/admin/collection-subscription-data.ts";
import {subscriptionExecutionChanges, type CollectionSubscription} from "../apps/web/app/features/admin/collection-subscription-types.ts";

const fixtures = [
  {id:"TXQPVGJG", platform:"weibo", detail:"API_1789098514899", parameters:{keyword:"AI", searchType:"61", page:"1"}, agentKeyParameters:{query:"AI"}},
  {id:"LEN9QXR3", platform:"bilibili", detail:"TIN1NMTZ", parameters:{keyword:"AI", page:"1"}, agentKeyParameters:{keyword:"AI"}},
  {id:"VPA67I98", platform:"bilibili", detail:"TIN1NMTZ", parameters:{mid:"123"}, agentKeyParameters:{user_id:"123"}},
  {id:"384C6W6B", platform:"xiaohongshu", detail:"KR1LPTBF", parameters:{keyword:"AI"}, agentKeyParameters:{keyword:"AI"}},
  {id:"XN3ULENA", platform:"xiaohongshu", detail:"KR1LPTBF", parameters:{userid:"synthetic-user"}, agentKeyParameters:{user_id:"synthetic-user"}},
] as const;
const priceModels = [...new Set([...fixtures.flatMap(f=>[f.id,f.detail]), "8IQD0BJC", "I3CIBRI2", "5K5EG87P"])];
const rfPrice = {amount:0.731, currency:"CNY", basis:"estimated"} as const;
const akPrice = {amount:0.2, currency:"credits", basis:"estimated"} as const;
let operations: PlatformOperationDescriptor[] = [];
let originalPrices: Record<string, unknown>[] = [];
let app: Awaited<ReturnType<typeof import("../apps/api/src/app.ts").buildApp>> | undefined;
let previousAdmin: typeof config.devAdmin;

before(async()=>{
  const [db] = await sql`SELECT current_database() AS name, inet_server_port() AS port`;
  assertConfiguredTestDatabase(db!.name, db!.port);
  originalPrices = await sql`SELECT * FROM service_prices WHERE service='redfox.collect' AND model IN ${sql(priceModels)}`;
  for (const model of priceModels) await sql`INSERT INTO service_prices(service,model,currency,per_request) VALUES('redfox.collect',${model},'CNY',${rfPrice.amount}) ON CONFLICT(service,model) DO UPDATE SET currency=EXCLUDED.currency,per_request=EXCLUDED.per_request`;
  const {buildApp} = await import("../apps/api/src/app.ts");
  app = await buildApp();
  previousAdmin = config.devAdmin;
  config.devAdmin = {displayName:"Synthetic provider descriptor test"};
  const response = await app.inject({method:"GET",url:"/api/admin/redfox/operations"});
  assert.equal(response.statusCode, 200, response.body);
  operations = response.json();
});

after(async()=>{
  config.devAdmin = previousAdmin;
  await app?.close();
  await sql`DELETE FROM service_prices WHERE service='redfox.collect' AND model IN ${sql(priceModels)}`;
  if (originalPrices.length) await sql`INSERT INTO service_prices ${sql(originalPrices)}`;
  await stopBoss();
  await closeDb();
});

function operation(id: string) {
  const value = operations.find(o=>o.id===id);
  assert.ok(value, `Actual API descriptor ${id}`);
  return value;
}

for (const fixture of fixtures) {
  test(`actual operations DTO retains Redfox price and detail capability for ${fixture.id}`,()=>{
    const base = operation(fixture.id), rf = providerOperation(base,"redfox"), ak = providerOperation(base,"agentkey");
    const expectedAkPrice = {...akPrice, amount:fixture.platform==="xiaohongshu"?2:0.2};
    assert.deepEqual(base.collectionProviders?.map(p=>p.id), ["redfox","agentkey"]);
    assert.deepEqual(rf.collectionPrice, rfPrice);
    assert.equal(rf.collectionCapabilities?.detailEnrichment, true);
    assert.deepEqual(rf.collectionCapabilities?.detailOperations?.map(d=>d.operationId), [fixture.detail]);
    assert.deepEqual(rf.collectionCapabilities?.detailOperations?.[0]?.price, rfPrice);
    assert.deepEqual(ak.collectionPrice, expectedAkPrice);
    assert.equal(ak.collectionCapabilities?.detailEnrichment, true);
    assert.deepEqual(ak.collectionCapabilities?.detailOperations?.map(d=>d.operationId), [fixture.detail]);
    assert.deepEqual(ak.collectionCapabilities?.detailOperations?.[0]?.price, expectedAkPrice);
  });

  test(`actual Web draft/config keeps enabled Redfox detail on unchanged save for ${fixture.id}`,()=>{
    const base = operation(fixture.id);
    const initial: CollectionSubscription = {sourceId:"descriptor-source",sourceRequired:true,id:991, platform:fixture.platform, name:"Existing subscription", provider:"redfox", operationId:fixture.id, parameters:fixture.parameters, enabled:false, intervalMinutes:30, enrichDetails:true, detailOperationId:fixture.detail, limits:{pages:3,items:100,details:20}, editVersion:1, executionVersion:1, nextRunAt:null, activeRun:null};
    const draft = collectionDraft(base, initial);
    assert.equal(draft.enrichDetails, true);
    const saved = collectionConfig(base, draft, fixture.platform);
    assert.equal(saved.enrichDetails, true);
    assert.equal(saved.detailOperationId, fixture.detail);
    assert.deepEqual(saved.limits, initial.limits);
    assert.deepEqual(saved.parameters, initial.parameters);
    assert.equal(subscriptionExecutionChanges(initial, saved), false);
  });

  test(`actual AgentKey ${fixture.id} keeps one page and explicit bounded details`,()=>{
    const base = operation(fixture.id);
    const draft = {...collectionDraft(base, null, {operationId:base.id,provider:"agentkey",sequence:1,values:fixture.agentKeyParameters}),sourceId:"descriptor-source",name:"AgentKey subscription"};
    const single = collectionConfig(base, {...draft,pages:8,details:7});
    assert.deepEqual(single.limits, {pages:1,items:100,details:0});
    const enriched = collectionConfig(base, {...draft,pages:8,enrichDetails:true,detailOperationId:fixture.detail,details:2});
    assert.equal(enriched.enrichDetails,true);
    assert.deepEqual(enriched.limits,{pages:1,items:100,details:2});
    assert.throws(()=>collectionConfig(base,{...draft,enrichDetails:true,details:2}), /请选择.*详情目标/);
  });
}

test("actual X DTO keeps query providers separate from collection providers and zero-detail snapshots",()=>{
  for (const id of ["ABJQXHUE","5QY3G5TY"]) {
    const base = operation(id);
    assert.deepEqual(queryProviders(base).map(p=>p.id),["redfox","agentkey"]);
    assert.deepEqual(base.collectionProviders?.map(p=>p.id),["agentkey"]);
    assert.equal(providerOperation(base,"redfox").collectionCapabilities?.detailEnrichment,false);
    const values: Record<string,string> = id==="ABJQXHUE"?{tweet_id:"123"}:{screen_name:"synthetic"};
    const draft = {...collectionDraft(base,null,{operationId:id,provider:"agentkey",sequence:1,values}),name:"X snapshot"};
    assert.deepEqual(collectionConfig(base,draft).limits,{pages:1,items:100,details:0});
    assert.throws(()=>collectionConfig(base,{...draft,enrichDetails:true,details:1,detailOperationId:"x.detail"}),/零详情/);
  }
  const search = operation("5K5EG87P");
  assert.deepEqual(search.collectionProviders?.map(p=>p.id),["redfox","agentkey"]);
  assert.deepEqual(providerOperation(search,"redfox").collectionPrice,rfPrice);
  assert.deepEqual(providerOperation(search,"agentkey").collectionPrice,akPrice);
});

test("actual WeChat query variants retain their separate fields and AgentKey query limits",()=>{
  const base = operation("8IQD0BJC"), rf = providerOperation(base,"redfox"), ak = providerOperation(base,"agentkey");
  assert.deepEqual(base.collectionProviders?.map(p=>p.id),["redfox","agentkey"]);
  assert.deepEqual(rf.fields.map(f=>f.name),["account","wxId","bizInfo","offset","sortType"]);
  assert.deepEqual(ak.fields.map(f=>f.name),["username","offset"]);
  assert.deepEqual(ak.collectionPrice,{amount:2,currency:"credits",basis:"estimated"});
  assert.deepEqual(ak.collectionCapabilities,{detailEnrichment:false,detailOperations:[]});
  assert.equal(ak.schedulableType,null);
});

test("actual AgentKey-only descriptors preserve their existing contracts",()=>{
  const expected = [...xResearchDescriptors,...weiboResearchDescriptors,...bilibiliResearchDescriptors,...xiaohongshuResearchDescriptors,...toutiaoResearchDescriptors,...wechatResearchDescriptors,...douyinSnapshotDescriptors,douyinSuggestDescriptor];
  for (const descriptor of expected) assert.deepEqual(operation(descriptor.id),JSON.parse(JSON.stringify({...descriptor,...((collectionOperationIds as readonly string[]).includes(descriptor.id)?{collectionCapabilities:{...descriptor.collectionCapabilities,sourceRequired:contentSubscription({platform:descriptor.platform,config:{operationId:descriptor.id}})}}:{})})),descriptor.id);
});

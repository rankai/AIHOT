import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { endSession, passwordLogin, sessionPrincipal } from "@aihot/backend/admin/auth";
import { buildApp } from "../apps/api/src/app.ts";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { saveResult } from "@aihot/backend/providers/operations/store";
import { adminHandler } from "../apps/api/src/routes/admin-auth.ts";

const T = tag();
const previousPassword = config.adminPassword;
const previousDevAdmin = config.devAdmin;
let app: Awaited<ReturnType<typeof buildApp>>;
let sessionCookie: string;
let headers: { cookie: string; "x-csrf-token": string };
const source = { id: `test-admin-errors-${T}`, name: "", kind: "rss", config: { feedUrl: `https://example.invalid/${T}/feed` } };

before(async () => {
  config.adminPassword = `synthetic-admin-password-${T}`;
  config.devAdmin = null;
  const login = await passwordLogin(config.adminPassword, "/admin", "invariant-test");
  sessionCookie = `aihot_admin=${login.token}`;
  const principal = await sessionPrincipal(sessionCookie);
  assert.ok(principal && !principal.dev);
  headers = { cookie: sessionCookie, "x-csrf-token": principal.csrf };
  app = await buildApp();
  app.get("/api/admin/test-internal-error", adminHandler(async () => { throw new Error("synthetic internal failure"); }));
});

after(async () => {
  await app?.close();
  if (sessionCookie) await endSession(sessionCookie);
  config.adminPassword = previousPassword;
  config.devAdmin = previousDevAdmin;
  await stopBoss();
  await closeDb();
});

test("invalid admin input remains behind session and CSRF checks", async () => {
  const unauthenticated = await app.inject({ method: "POST", url: "/api/admin/sources", payload: source });
  assert.equal(unauthenticated.statusCode, 401);
  const noCsrf = await app.inject({ method: "POST", url: "/api/admin/sources", headers: { cookie: sessionCookie }, payload: source });
  assert.equal(noCsrf.statusCode, 403);
});

test("an admin can correct rejected input and successfully resubmit", async () => {
  const invalid = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: source });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, "invalid_request");
  assert.match(invalid.json().detail, /name/);
  assert.equal(invalid.json().detail.startsWith("["), false);
  const corrected = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: { ...source, name: "Synthetic source" } });
  assert.equal(corrected.statusCode, 200);
  assert.equal(corrected.json().created, true);
});

test("source conflicts and internal failures keep distinct error responses", async () => {
  const conflict = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: { ...source, name: "Duplicate ID", config: { feedUrl: `https://example.invalid/${T}/other` } } });
  assert.equal(conflict.statusCode, 409);
  const internal = await app.inject({ method: "GET", url: "/api/admin/test-internal-error", headers });
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.json().code, "internal_error");
});

test("malformed unrelated cookies do not break an authenticated session", async () => {
  for (const cookie of [`unrelated=%; ${sessionCookie}`, `${sessionCookie}; unrelated=%`]) {
    const response = await app.inject({ method: "GET", url: "/api/admin/me", headers: { cookie } });
    assert.equal(response.statusCode, 200);
  }
});

test("malformed session cookies are unauthenticated rather than a service failure", async () => {
  for (const cookie of ["aihot_admin=%", "unrelated=%", "unrelated=%25"]) {
    const response = await app.inject({ method: "GET", url: "/api/admin/me", headers: { cookie } });
    assert.equal(response.statusCode, 401);
  }
});

test("native commands require idempotency and expose asynchronous runs with paged results", async () => {
  const id = `native-api-${T}`;
  const malformedId = `native-malformed-${T}`;
  await sql`INSERT INTO sources(id,name,kind,config,enabled,participation_mode) VALUES (${malformedId},'Malformed historical fixture','x_search','null'::jsonb,false,'isolated')`;
  try {
  const created = await app.inject({method:"POST",url:"/api/admin/sources",headers,payload:{id,name:"Native API fixture",kind:"x_search",config:{query:`from:api_${T}`}}});
  assert.equal(created.statusCode,200);
  const preflight = await app.inject({method:"GET",url:`/api/admin/sources/${id}/collection/preflight?target=redfox`,headers});
  assert.equal(preflight.statusCode,200);
  for (const path of [`/api/admin/sources/${id}/fetch`,`/api/admin/sources/${id}/preview`]) {
    assert.equal((await app.inject({method:"POST",url:path,headers})).statusCode,400);
    const keyed = {...headers,"idempotency-key":`${T}-${path.endsWith("fetch")?"fetch":"preview"}`};
    const response = await app.inject({method:"POST",url:path,headers:keyed});
    assert.equal(response.statusCode,202);
    const {runId} = response.json();
    const again = await app.inject({method:"POST",url:path,headers:keyed});
    assert.equal(again.statusCode,202); assert.equal(again.json().runId,runId);
    const stale = await app.inject({method:"POST",url:`/api/admin/operations/runs/${runId}/stop`,headers,payload:{stepVersion:1,generation:999,reason:"stale synthetic control"}});
    assert.equal(stale.statusCode,409);
    const otherIntent = await app.inject({method:"POST",url:`/api/admin/sources/${id}/${path.endsWith("fetch")?"preview":"fetch"}`,headers:keyed});
    assert.equal(otherIntent.statusCode,409);
    if (path.endsWith("fetch")) {
      const occupied = await app.inject({method:"POST",url:path,headers:{...headers,"idempotency-key":`${T}-occupied`}});
      assert.equal(occupied.statusCode,409);
    }
    await sql.begin(async(tx)=>{ for(let i=0;i<3;i++) await saveResult(tx,{runId,stepVersion:1,generation:0},{itemKey:`item-${i}`,kind:"synthetic",data:{i}}); });
    const detail = await app.inject({method:"GET",url:`/api/admin/operations/runs/${runId}`,headers});
    assert.equal(detail.statusCode,200); assert.equal(detail.json().status,"active");
    const first = (await app.inject({method:"GET",url:`/api/admin/operations/runs/${runId}/results?limit=2`,headers})).json();
    assert.equal(first.results.length,2); assert.ok(first.nextCursor);
    const second = (await app.inject({method:"GET",url:`/api/admin/operations/runs/${runId}/results?limit=2&cursor=${first.nextCursor}`,headers})).json();
    assert.equal(second.results.length,1); assert.equal(second.nextCursor,null);
    assert.equal(new Set([...first.results,...second.results].map((r:{id:number})=>r.id)).size,3);
    assert.equal((await sql`SELECT current_receipt_id FROM operation_runs WHERE id=${runId}`)[0]!.current_receipt_id,null);
  }
  } finally {
    await sql`DELETE FROM sources WHERE id=${malformedId}`;
  }
});

test("Redfox account POST requires session, CSRF and idempotency, while GET only reads its run",async()=>{
  const url="/api/admin/redfox/x/accounts/query",payload={screenName:"synthetic"};
  assert.equal((await app.inject({method:"POST",url,payload})).statusCode,401);
  assert.equal((await app.inject({method:"POST",url,payload,headers:{cookie:sessionCookie}})).statusCode,403);
  assert.equal((await app.inject({method:"POST",url,payload,headers})).statusCode,400);
  const keyed={...headers,"idempotency-key":`${T}-redfox-query`};
  const response=await app.inject({method:"POST",url,payload,headers:keyed});
  assert.equal(response.statusCode,202);
  const {runId}=response.json();
  assert.equal((await app.inject({method:"POST",url,payload,headers:keyed})).json().runId,runId);
  assert.equal((await app.inject({method:"POST",url,payload:{restId:"123"},headers:keyed})).statusCode,409);
  const detail=await app.inject({method:"GET",url:`/api/admin/operations/runs/${runId}`,headers});
  assert.equal(detail.statusCode,200); assert.equal(detail.json().receiptId,null);
  assert.deepEqual(detail.json().inputs.parameters,payload);
});

test("replacement HTTP reports unsupported as 422 and stale preview as 409 without mutating ownership",async()=>{
  const id=`native-api-${T}`,url=`/api/admin/sources/${id}/collection`;
  const preview=await app.inject({method:"GET",url:`${url}/preflight?target=redfox`,headers});assert.equal(preview.statusCode,200);
  const p=preview.json();assert.equal(p.supported,false);
  const before=(await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`)[0];
  const command={target:"redfox",sourceVersion:p.sourceVersion,subscriptionVersion:p.subscriptionVersion,mappingVersion:p.mappingVersion,reason:"synthetic unsupported"};
  assert.equal((await app.inject({method:"POST",url:`${url}/switch`,headers,payload:command})).statusCode,422);
  assert.equal((await app.inject({method:"POST",url:`${url}/switch`,headers,payload:{...command,subscriptionVersion:p.subscriptionVersion+1}})).statusCode,409);
  assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE control_source_id=${id}`)[0],before);
});

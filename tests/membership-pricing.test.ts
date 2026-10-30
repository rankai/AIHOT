import { assertConfiguredTestDatabase, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { confirmMembershipPayment, getMembership, nextMembershipMonth } from '@aihot/backend/users/membership';
import { applyApprovedMemberPrices, assertMemberCostEligible, memberPriceCatalog } from '@aihot/backend/users/member-pricing';
import { getCreditPage, grantCredits, quoteTool, saveToolPrice, listToolPrices } from '@aihot/backend/users/credits';
import { quoteUserTool, submitUserTool } from '@aihot/backend/users/tools';
import { createSiteUser } from '@aihot/backend/users/accounts';
import { loginSiteUser } from '@aihot/backend/users/auth';
import { passwordLogin, sessionPrincipal } from '@aihot/backend/admin/auth';
import { registerAdminCredits } from '../apps/api/src/routes/admin-credits.ts';
import { registerUserTools } from '../apps/api/src/routes/user-tools.ts';
import { registerUserCredits } from '../apps/api/src/routes/user-credits.ts';
const actor='test:membership';
before(async () => { const [db] = await sql`SELECT current_database() AS name`; assertConfiguredTestDatabase(db!.name); });
after(closeDb);
async function member() { const [user] = await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`membership-${tag()}`},'Synthetic membership','synthetic-no-login') RETURNING id`;return Number(user!.id); }
const body = (reference=tag()) => ({planId:'basic',received:true,receiptReference:reference,reason:'Synthetic offline receipt'});
test('calendar month clamps Shanghai month-end, including leap years', () => {
 assert.equal(nextMembershipMonth(new Date('2024-01-31T15:00:00Z')).toISOString(),'2024-02-29T15:00:00.000Z');
 assert.equal(nextMembershipMonth(new Date('2025-01-31T15:00:00Z')).toISOString(),'2025-02-28T15:00:00.000Z');
 assert.equal(nextMembershipMonth(new Date('2025-01-31T16:00:00Z')).toISOString(),'2025-02-28T16:00:00.000Z');
});
test('concurrent idempotent payment grants once; global receipt reuse and changed input reject',async()=>{
 const id=await member(),other=await member(),input=body(),key=tag();
 const [a,b]=await Promise.all([confirmMembershipPayment(id,input,actor,key),confirmMembershipPayment(id,input,actor,key)]);
 assert.equal(a.id,b.id);assert.equal(a.amountFen,9900);assert.equal((await getCreditPage(id)).balance.available,10000);
 await assert.rejects(confirmMembershipPayment(id,{...input,planId:'studio'},actor,key),/幂等/);
 await assert.rejects(confirmMembershipPayment(other,input,actor,tag()),/收款编号/);
 await assert.rejects(confirmMembershipPayment(id,{...body(),received:false},actor,tag()));
 await assert.rejects(sql`UPDATE member_membership_payments SET reason='changed' WHERE id=${a.id}`,/append-only/);
 const [audit]=await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${`user:${id}`} AND action='membership.payment.confirm'`;
 assert.equal(audit!.n,1);
});
test('renewal starts at expiry, active switching rejects, expired switching keeps existing credits',async()=>{
 const id=await member();const first=await confirmMembershipPayment(id,body(),actor,tag());
 const renewal=await confirmMembershipPayment(id,body(),actor,tag());assert.equal(renewal.periodStart,first.periodEnd);
 assert.equal(renewal.periodEnd,nextMembershipMonth(new Date(first.periodEnd)).toISOString());
 await assert.rejects(confirmMembershipPayment(id,{...body(),planId:'creator'},actor,tag()),/原套餐/);
 await sql`UPDATE member_memberships SET starts_at=now()-interval '2 months',expires_at=now()-interval '1 day' WHERE user_id=${id}`;
 assert.equal((await getMembership(id)).membership!.status,'expired');
 await confirmMembershipPayment(id,{...body(),planId:'creator'},actor,tag());
 assert.equal((await getCreditPage(id)).balance.available,53000);assert.equal((await getMembership(id)).membership!.planId,'creator');
});
test('wallet limit failure rolls back receipt, membership and audit',async()=>{
 const id=await member();await sql`INSERT INTO member_credit_accounts(user_id,available) VALUES (${id},1000000000000)`;
 const input=body();await assert.rejects(confirmMembershipPayment(id,input,actor,tag()),/余额/);
 assert.equal((await getMembership(id)).payments.length,0);assert.equal((await getMembership(id)).membership,null);
});
test('concurrent distinct receipts serialize renewal and reject duplicate cross-user receipt',async()=>{
 const id=await member(),input=body();const outcomes=await Promise.allSettled([confirmMembershipPayment(id,input,actor,tag()),confirmMembershipPayment(id,input,actor,tag())]);
 assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);
 await Promise.all([confirmMembershipPayment(id,body(),actor,tag()),confirmMembershipPayment(id,body(),actor,tag())]);
 const page=await getMembership(id);assert.equal(page.payments.length,3);assert.equal((await getCreditPage(id)).balance.available,30000);
});
test('approved price action is idempotent and catalog uses live price rules',async()=>{
 const before=await memberPriceCatalog(true);assert.equal(before.offers.filter(offer=>offer.kind==='query').length,127);assert.ok(before.offers.every(offer=>offer.provider!=='agentkey'));
 const a=await applyApprovedMemberPrices(actor),b=await applyApprovedMemberPrices(actor);assert.equal(b.applied,false);assert.equal(a.version,b.version);
 const catalog=await memberPriceCatalog();const offer=catalog.offers.find(row=>row.kind==='images')!;
 const price=offer.prices!.find(price=>price.parameterMatch.n===1)!;assert.ok(price);
 const {updatedAt,version,...input}=price;
 await saveToolPrice({...input,expectedVersion:version,baseCredits:price.baseCredits+1,reason:'Synthetic price update'},actor);
 assert.equal((await memberPriceCatalog()).offers.find(row=>row.kind==='images')!.prices!.find(row=>row.id===price.id)!.baseCredits,price.baseCredits+1);
 await saveToolPrice({...input,expectedVersion:version+1,reason:'Restore synthetic price'},actor);
 const id=await member();assert.equal((await quoteUserTool(id,{kind:'ai-search',input:{engine:'kimiK3',inquiryText:'synthetic'}})).amount,60);
 assert.equal((await quoteUserTool(id,{kind:'transcriptions',input:{platform:'videoUrl',url:'https://example.test/video'}})).amount,30);
});
test('unknown specs cannot quote or submit through broad prices or stale quotes; no reservations or tasks',async()=>{
 const id=await member();await grantCredits(id,{amount:20000,reason:'Synthetic credits'},actor,tag());
 const input={prompt:'synthetic',resolution:'1k',size:'1:1',n:2,fileKeys:[]};
 const broad=(await listToolPrices()).prices.find(price=>price.kind==='images' && price.model==='gptImage2' && price.tier==='1k' && Object.keys(price.parameterMatch).length===0);
 await saveToolPrice({...(broad ? {id:broad.id,expectedVersion:broad.version} : {}),kind:'images',provider:'redfox',model:'gptImage2',tier:'1k',parameterMatch:{},baseCredits:1,enabled:true,reason:'Synthetic legacy broad price'},actor);
 const quote=await quoteTool(id,{kind:'images',provider:'redfox',model:'gptImage2',tier:'1k',input,imageCount:2,referenceCount:0});
 await assert.rejects(quoteUserTool(id,{kind:'images',input}),/成本尚未核定/);
 await assert.rejects(submitUserTool(id,'images',{input,quoteId:quote.quoteId},tag()),/成本尚未核定/);
 assert.equal((await getCreditPage(id)).balance.reserved,0);
 const [runs]=await sql`SELECT count(*)::int AS n FROM operation_runs WHERE actor=${`user:${id}`}`;assert.equal(runs!.n,0);
 await assert.rejects(assertMemberCostEligible({kind:'videos',provider:'redfox',model:'seedance',tier:'720p',input:{},videoSeconds:8,referenceCount:3}),/成本尚未核定/);
 const seed={kind:'videos' as const,provider:'redfox',model:'seedance',tier:'480p',videoSeconds:8,referenceCount:3,input:{duration:8,generateAudio:true,imageWithRoles:['a','b','c'].map(fileKey=>({fileKey,role:'reference_image'}))}};
 await assertMemberCostEligible(seed);
 await assert.rejects(assertMemberCostEligible({...seed,videoSeconds:9}),/成本尚未核定/);
 await assert.rejects(assertMemberCostEligible({...seed,input:{...seed.input,generateAudio:false}}),/成本尚未核定/);
 await assert.rejects(assertMemberCostEligible({kind:'query',provider:'agentkey',model:'x.search',input:{}}),/成本尚未核定/);
 await assertMemberCostEligible({kind:'videos/query',provider:'redfox',model:'seedance',tier:'720p',input:{},recoveryRunId:1});
});
test('membership HTTP endpoints reject anonymous, non-admin, missing CSRF and wrong origin',async()=>{
 const original={siteUrl:config.siteUrl,devAdmin:config.devAdmin,adminPassword:config.adminPassword};const app=Fastify();
 try {
 config.siteUrl='https://membership.test';config.devAdmin=null;config.adminPassword=`synthetic-${tag()}`;
 const user=await createSiteUser({username:`membership-http-${tag()}`,displayName:'Test member',password:'SyntheticPassword2026'},actor);
 const session=await loginSiteUser({username:user.username,password:'SyntheticPassword2026'});
 const cookie=`aihot_user=${session.token}`;const admin=await passwordLogin(config.adminPassword,'/admin','test'),adminCookie=`aihot_admin=${admin.token}`;const principal=await sessionPrincipal(adminCookie);
 registerAdminCredits(app);registerUserCredits(app);registerUserTools(app);await app.ready();
 const endpoint=`/api/admin/users/${user.id}/membership`,payload=body();
 assert.equal((await app.inject({url:'/api/account/membership'})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:endpoint,headers:{cookie},payload})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:endpoint,headers:{cookie:adminCookie},payload})).statusCode,403);
 const headers={cookie:adminCookie,'x-csrf-token':principal!.csrf,origin:config.siteUrl,'idempotency-key':tag()};
 assert.equal((await app.inject({method:'POST',url:endpoint,headers:{...headers,origin:'https://wrong.test'},payload})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:endpoint,headers,payload})).statusCode,200);
 const own=await app.inject({url:'/api/account/membership?userId=999999',headers:{cookie}});assert.equal(own.statusCode,200);assert.equal(own.json().membership.planId,'basic');assert.equal(own.json().payments[0].receiptReference,undefined);assert.equal(own.json().payments[0].reason,undefined);
 const input={prompt:'synthetic HTTP unknown spec',resolution:'1k',size:'1:1',n:2,fileKeys:[]};
 const stale=await quoteTool(user.id,{kind:'images',provider:'redfox',model:'gptImage2',tier:'1k',input,imageCount:2,referenceCount:0});
 const memberHeaders={cookie,'x-csrf-token':session.principal.csrf,origin:config.siteUrl,'idempotency-key':tag()};
 for (const [url,payload] of [['/api/tools/quote',{kind:'images',input}],['/api/tools/images',{input,quoteId:stale.quoteId}]] as const) {
  const denied=await app.inject({method:'POST',url,headers:memberHeaders,payload});assert.equal(denied.statusCode,409);assert.equal(denied.json().code,'cost_unverified');
 }
 assert.equal((await getCreditPage(user.id)).balance.reserved,0);
 }finally{Object.assign(config,original);await app.close();}
});

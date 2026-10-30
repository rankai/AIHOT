import { assertConfiguredTestDatabase, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import Fastify from 'fastify';
import { config } from '@aihot/backend/config';
import { createSiteUser } from '@aihot/backend/users/accounts';
import { loginSiteUser } from '@aihot/backend/users/auth';
import { registerAdmin } from '../apps/api/src/routes/admin.ts';
import { passwordLogin, sessionPrincipal, actorOf } from '@aihot/backend/admin/auth';
import { updateBudget, updateBudgetScope, listBudgetScopes } from '@aihot/backend/admin/settings';
import { paidRequest, BudgetExceededError, ProviderRejectedError, ReceiptUnknownError, logicalKeyFor } from '@aihot/backend/providers/receipts';
import type { ToolAuthorization } from '@aihot/contracts/credits';
import { abandonRun, createRun, receiptOptions, advanceRun, saveResult, setRunState, resumeRun, type RunRow } from '@aihot/backend/providers/operations/store';
import { getCreditPage, grantCredits, quoteTool, saveToolPrice } from '@aihot/backend/users/credits';
import { createImageGeneration, createImageQuery } from '@aihot/backend/providers/redfox/images';
import { createXhsComments } from '@aihot/backend/providers/redfox/xhs-comments';
import { stopBoss } from '@aihot/backend/jobs/queue';
const ownedRuns:number[]=[];
const admin=actorOf({userId:42,name:'Synthetic admin',dev:false,csrf:'unused'}),dev=actorOf({userId:null,name:'scope-test',dev:true,csrf:'unused'});
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);});
after(async()=>{try {for(const id of ownedRuns){const [row]=await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${id}`;if(row && !['completed','failed'].includes(row.status))await sql.begin(tx=>abandonRun(tx,execution(row),'Synthetic scope test cleanup'));}}finally{await stopBoss();await closeDb();}});
const caps=(n:number)=>({perMinute:n,perHour:n,perDay:n,reason:'Synthetic scoped budget'});
async function budget(total=20,member=10,adminCap=10){const service=`redfox.scope-${tag()}`;await updateBudget(service,caps(total),admin);await updateBudgetScope(service,'member',caps(member),admin);await updateBudgetScope(service,'admin',caps(adminCap),admin);return service;}
async function member(){const [row]=await sql`INSERT INTO site_users(username,display_name,password_hash) VALUES (${`scope-${tag()}`},'Synthetic scope member','synthetic') RETURNING id`;const id=Number(row!.id);await grantCredits(id,{amount:100,reason:'Synthetic allocation'},admin,tag());return id;}
async function run(actor=admin,extra:Record<string,unknown>={}){
 let authorization: ToolAuthorization | undefined;
 if(actor.startsWith('user:')){const price=await saveToolPrice({kind:'query',provider:'redfox',model:tag(),parameterMatch:{},baseCredits:5,enabled:true,reason:'Synthetic scope price'},admin);const intent={kind:'query' as const,provider:'redfox',model:price.model,input:{parameters:{}}};authorization={intent,quoteId:(await quoteTool(Number(actor.slice(5)),intent)).quoteId};}
 const created=await sql.begin(tx=>createRun(tx,{actor,commandKey:tag(),provider:'redfox',operationKey:'scope.synthetic',contractVersion:1,input:{budgetScope:'admin',...extra},stepKey:'scope.execute',authorization}));ownedRuns.push(created.id);return created;
}
const execution=(run:RunRow)=>({runId:run.id,stepVersion:run.step_version,generation:run.generation});
const request=(service:string)=>({service,purpose:'synthetic-scope',identity:tag()});
async function send(service:string,task:RunRow){return paidRequest(request(service),async()=>({response:{ok:true}}),receiptOptions(execution(task)));}
async function usage(service:string){return sql`SELECT budget_scope,count(*)::int AS n FROM receipt_attempts WHERE service=${service} GROUP BY budget_scope`;}

test('member and admin pools are independent; trusted actors override input and legacy NULL only spends total',async()=>{
 assert.equal(admin,'admin:42');assert.equal(dev,'dev:scope-test');
 const service=await budget(4,2,1),id=await member();
 await send(service,await run(admin));await assert.rejects(send(service,await run(dev)),error=>error instanceof BudgetExceededError && error.scope==='admin');
 await send(service,await run(`user:${id}`));await send(service,await run(`user:${id}`));
 await assert.rejects(send(service,await run(`user:${id}`)),error=>error instanceof BudgetExceededError && error.scope==='member');
 await paidRequest(request(service),async()=>({response:{legacy:true}}));
 await updateBudgetScope(service,'admin',caps(3),admin);
 await assert.rejects(send(service,await run(admin)),error=>error instanceof BudgetExceededError && error.scope===null);
 const rows=await usage(service);assert.equal(rows.find(row=>row.budget_scope==='member')!.n,2);assert.equal(rows.find(row=>row.budget_scope==='admin')!.n,1);assert.equal(rows.find(row=>row.budget_scope===null)!.n,1);
 const other=await budget(3,1,2),otherId=await member();await send(other,await run(`user:${otherId}`));await assert.rejects(send(other,await run(`user:${otherId}`)),BudgetExceededError);await send(other,await run(dev));
});
test('missing and zero scoped caps reject before dispatch or attempt creation',async()=>{
 const service=await budget(5,0,0),id=await member();let calls=0;
 await sql`DELETE FROM budget_scopes WHERE service=${service} AND scope='member'`;
 for(const actor of [`user:${id}`,admin])await assert.rejects(paidRequest(request(service),async()=>{calls++;return {response:{}};},receiptOptions(execution(await run(actor)))),BudgetExceededError);
 assert.equal(calls,0);assert.equal((await usage(service)).length,0);
 const view=(await listBudgetScopes()).find(row=>row.service===service && row.scope==='member');assert.equal(view!.per_day,0);
});
test('cross-pool concurrency shares total lock and cannot overshoot either cap',async()=>{
 const service=await budget(5,4,4),id=await member();const tasks=[];for(let i=0;i<4;i++)tasks.push(await run(`user:${id}`),await run(admin));
 const results=await Promise.allSettled(tasks.map(task=>send(service,task)));assert.equal(results.filter(result=>result.status==='fulfilled').length,5);
 const rows=await usage(service);assert.equal(rows.reduce((n,row)=>n+row.n,0),5);assert.ok(rows.every(row=>row.n<=4));
});
test('retries count, stored response reuse does not, unknown is not resent across pools',async()=>{
 const service=await budget(10,5,2),task=await run(admin),req=request(service),options=receiptOptions(execution(task));let calls=0;
 await assert.rejects(paidRequest(req,async()=>{calls++;throw new ProviderRejectedError('synthetic reject',429,true);},options),ProviderRejectedError);
 await paidRequest(req,async()=>{calls++;return {response:{ok:true}};},options);
 const reuse=await paidRequest(req,async()=>{calls++;return {response:{}};},options);assert.equal(reuse.reused,true);assert.equal(calls,2);
 const unknownService=await budget(),unknown=request(unknownService),a=await run(admin);
 await assert.rejects(paidRequest(unknown,async()=>{throw new Error('synthetic lost response');},receiptOptions(execution(a))),/lost response/);
 const b=await run(`user:${await member()}`);await assert.rejects(paidRequest(unknown,async()=>{calls++;return {response:{}};},receiptOptions(execution(b))),ReceiptUnknownError);
 assert.equal((await usage(unknownService))[0]!.n,1);assert.equal(calls,2);
});
test('three member wallets stay separate, admin uses no member credits, cross-user quote cannot be spent',async()=>{
 const ids=await Promise.all([member(),member(),member()]),service=await budget();
 for(const id of ids.slice(0,2)){const task=await run(`user:${id}`);const receipt=await send(service,task);await sql.begin(async tx=>{await saveResult(tx,execution(task),{itemKey:'empty',kind:'query_summary',data:{count:0},receiptId:receipt.receiptId});await advanceRun(tx,execution(task),null);});}
 await send(service,await run(admin));
 assert.deepEqual(await Promise.all(ids.map(async id=>(await getCreditPage(id)).balance.available)),[95,95,100]);
 const price=await saveToolPrice({kind:'query',provider:'redfox',model:tag(),baseCredits:5,enabled:true,reason:'Cross-user fixture'},admin),intent={kind:'query' as const,provider:'redfox',model:price.model,input:{}};
 const quote=await quoteTool(ids[0]!,intent);
 await assert.rejects(sql.begin(tx=>createRun(tx,{actor:`user:${ids[1]}`,commandKey:tag(),provider:'redfox',operationKey:'scope.cross-user',contractVersion:1,input:{},stepKey:'scope.execute',authorization:{intent,quoteId:quote.quoteId}})),/报价不存在/);
});
test('admin-initiated resume retains the original member attribution',async()=>{
 const id=await member(),service=await budget(),task=await run(`user:${id}`);
 await sql.begin(tx=>setRunState(tx,execution(task),'stopped','Synthetic admin pause'));
 const [stopped]=await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${task.id}`;
 await sql.begin(tx=>resumeRun(tx,execution(stopped!)));
 const [resumed]=await sql<RunRow[]>`SELECT * FROM operation_runs WHERE id=${task.id}`;
 await send(service,resumed!);assert.equal((await usage(service))[0]!.budget_scope,'member');assert.equal(resumed!.actor,`user:${id}`);
});
test('unknown admin image/comments reject new commands and call-only dispatch but retain stored response reuse',async()=>{
 const raw={prompt:'synthetic',resolution:'4k',size:'1:1',n:1,fileKeys:[]};
 await assert.rejects(createImageGeneration(raw,admin,tag()),/成本尚未核定/);
 await assert.rejects(createImageGeneration({...raw,resolution:'1k',n:2},dev,tag()),/成本尚未核定/);
 await assert.rejects(createXhsComments({opusId:'synthetic',dataNum:20},admin,tag()),/成本尚未核定/);
 const service=await budget(),task=await sql.begin(tx=>createRun(tx,{actor:admin,commandKey:tag(),provider:'redfox',operationKey:'redfox.image.generate',contractVersion:1,input:{parameters:raw},stepKey:'redfox.image.submit'}));
 ownedRuns.push(task.id);const req=request(service);let calls=0;
 await assert.rejects(paidRequest(req,async()=>{calls++;return {response:{}};},receiptOptions(execution(task))),/成本尚未核定/);
 assert.equal(calls,0);assert.equal((await usage(service)).length,0);assert.equal((await sql`SELECT id FROM receipts WHERE logical_key=${logicalKeyFor(req)}`).length,0);
 await sql`INSERT INTO receipts(logical_key,service,purpose,status,response,attempts) VALUES (${logicalKeyFor(req)},${service},'synthetic-scope','received','{"taskId":"stored"}',1)`;
 const reused=await paidRequest(req,async()=>{calls++;return {response:{}};},receiptOptions(execution(task)));assert.equal(reused.reused,true);assert.equal(calls,0);
 const query=await createImageQuery({taskId:'historical-task',model:'gptImage25'},admin,tag());ownedRuns.push(query.id);assert.equal(query.step_key,'redfox.image.poll');
 const allowed=await createImageGeneration({...raw,resolution:'1k'},admin,tag());ownedRuns.push(allowed.id);assert.equal(allowed.step_key,'redfox.image.submit');
});

test('scoped-budget HTTP writes require admin and CSRF, preserve total and audit the selected pool',async()=>{
 const original={siteUrl:config.siteUrl,devAdmin:config.devAdmin,adminPassword:config.adminPassword},app=Fastify();
 try {
  config.siteUrl='https://scoped-budget.test';config.devAdmin=null;config.adminPassword=`synthetic-${tag()}`;
  const user=await createSiteUser({username:`scope-http-${tag()}`,displayName:'Synthetic',password:'SyntheticScopePassword'},admin);
  const memberSession=await loginSiteUser({username:user.username,password:'SyntheticScopePassword'});
  const session=await passwordLogin(config.adminPassword,'/admin','scope-test'),cookie=`aihot_admin=${session.token}`,principal=await sessionPrincipal(cookie);
  registerAdmin(app);await app.ready();const service=await budget(9,0,0),url=`/api/admin/budgets/${service}/scopes/member`,payload=caps(3);
  assert.equal((await app.inject({method:'PUT',url,payload})).statusCode,401);
  assert.equal((await app.inject({method:'PUT',url,payload,headers:{cookie:`aihot_user=${memberSession.token}`}})).statusCode,401);
  assert.equal((await app.inject({method:'PUT',url,payload,headers:{cookie}})).statusCode,403);
  const response=await app.inject({method:'PUT',url,payload,headers:{cookie,'x-csrf-token':principal!.csrf,origin:config.siteUrl}});assert.equal(response.statusCode,200,response.body);
  const [total]=await sql`SELECT per_day FROM budgets WHERE service=${service}`;assert.equal(total!.per_day,9);
  const [pool]=await sql`SELECT per_day FROM budget_scopes WHERE service=${service} AND scope='member'`;assert.equal(pool!.per_day,3);
  const [entry]=await sql`SELECT actor,subject FROM audit_log WHERE action='budget.scope.update' AND subject=${`budget:${service}:member`} ORDER BY id DESC LIMIT 1`;assert.equal(entry!.actor,actorOf(principal!));
  const denied=await app.inject({method:'POST',url:'/api/admin/redfox/images',headers:{cookie,'x-csrf-token':principal!.csrf,'idempotency-key':tag()},payload:{model:'gptImage25',prompt:'synthetic',resolution:'1k',size:'1:1',fileKeys:[]}});assert.equal(denied.statusCode,409);assert.equal(denied.json().code,'cost_unverified');
 }finally{Object.assign(config,original);await app.close();}
});

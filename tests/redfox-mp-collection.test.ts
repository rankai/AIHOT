import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createNativeSubscription} from '@aihot/backend/sources/native-migration';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {importWechatResult} from '@aihot/backend/providers/redfox/import-wechat';
import {preflightMpReplacement,switchMpCollection} from '@aihot/backend/sources/mp-replacement';
import {createRedfoxMpCollection} from '@aihot/backend/sources/mp-commands';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {updateSource} from '@aihot/backend/admin/sources';
import {resumeRun,receiptOptions,claimRun} from '@aihot/backend/providers/operations/store';
import {queryWechat} from '@aihot/backend/providers/redfox/wechat';
let accountWxOnly=false,accountBizOnly=false;
let hits=0,disconnect=false,bodyContent='<p>Synthetic complete body</p><video><source type="video/mp4" src="/v.mp4"></video>',badAuthor=false;
let account={account:'synthetic-account',wxId:'gh_synthetic123',bizInfo:'SyntheticBiz'};
let listed:{workUuid:string;title:string;workUrl:string;bizInfo?:string;publishTime?:string}[]=[];
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 const p=JSON.parse(body);assert.equal(req.headers.redfox_api_key,'fake-mp');
 if(req.url?.endsWith('/accountInfo'))return void res.end(JSON.stringify({code:2000,data:accountWxOnly?{account:account.account,wxId:account.wxId}:accountBizOnly?{account:account.account,bizInfo:account.bizInfo}:account}));
 if(disconnect){req.socket.destroy();return;}
 const wide=req.url?.includes('/gzh/data/');
 if(req.url?.endsWith('/queryWorkList')){assert.equal(p.offset,0);assert.equal(p.sortType,wide?'2':'_2');assert.equal(wide?(p.wxId??p.bizInfo):p.account,wide?(p.wxId?account.wxId:account.bizInfo):account.account);return void res.end(JSON.stringify({code:2000,data:{list:listed,total:listed.length}}));}
 assert.ok(req.url?.endsWith('/workDetail')||req.url?.endsWith('/queryWork'));
 const item=listed.find(v=>v.workUuid===p.workUuid)!;res.end(JSON.stringify({code:2000,data:{...item,...(badAuthor?{bizInfo:'WrongBiz'}:{}),content:bodyContent,publishTime:item.publishTime??'2026-10-01 12:00:00',coverUrl:'https://example.com/synthetic-cover.png'}}));
 });});
let budgets:Record<string,unknown>[];
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-mp';process.env.DAJIALA_KEY='fake-unused';process.env.COLLECT_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.query','redfox.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.query','redfox.collect')`;});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute as number},per_hour=${b.per_hour as number},per_day=${b.per_day as number} WHERE service=${b.service as string}`;process.env.COLLECT_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;delete process.env.DAJIALA_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id:number){const r=await row(id);return executeOperationStep(id,r.step_version,randomUUID());}
async function source(initialized=true,binding=true){const token=randomUUID().replaceAll('-',''),id=tag();account={account:'display'+token,wxId:'gh_'+token,bizInfo:'Biz'+token};const sub=await sql.begin(async tx=>{await tx`INSERT INTO sources(id,name,kind,config,interval_minutes,site_fulltext,participation_mode) VALUES (${id},'Synthetic MP','mp_account',${tx.json({...(!accountBizOnly?{ghid:account.wxId}:{}),wxid:account.account})},73,true,'editorial')`;const sub=await createNativeSubscription(tx,id);if(initialized)await tx`UPDATE collection_subscriptions SET progress=${tx.json({lastCheckedAt:new Date().toISOString()})} WHERE id=${sub}`;return sub;});if(binding){const run=await createSynchronousQuery({operationId:'KUQYSQNX',parameters:accountBizOnly?{bizInfo:account.bizInfo}:{wxId:account.wxId}},'mp-test',tag());await step(run.id);const [r]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`;await importWechatResult(r!.id,{sourceId:id,reason:'Received author'},'mp-test',tag());}return {id,sub};}
async function switchTo(id:string,target:'redfox'|'dajiala',library:'wide'|'premium'='wide'){const p=await preflightMpReplacement(id,target,library);assert.equal(p!.supported,true,JSON.stringify(p!.checks));return switchMpCollection(id,{target,library,sourceVersion:p!.sourceVersion,subscriptionVersion:p!.subscriptionVersion,mappingVersion:p!.mappingVersion,reason:'Synthetic switch'},'mp-test');}
function post(premium=false){const id=tag();return {workUuid:id,title:'Synthetic MP article',workUrl:premium?`https://mp.weixin.qq.com/s/${id}`:`https://mp.weixin.qq.com/s?__biz=${account.bizInfo}&mid=${Date.now()}&idx=1&sn=${id}`,...(premium?{}:{bizInfo:account.bizInfo})};}
test('both libraries run list/detail/material; switches preserve source, subscription, permissions and interval',async()=>{
 const s=await source(),initial=hits;await preflightMpReplacement(s.id,'redfox');assert.equal(hits,initial);
 for(const library of ['wide','premium'] as const){await switchTo(s.id,'redfox',library);listed=[post(library==='premium')];const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);assert.equal((await row(run.id)).step_key,'redfox.wechat.detail');await step(run.id);assert.equal((await row(run.id)).status,'completed');const [r]=await sql`SELECT article_id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`;const [a]=await sql`SELECT * FROM articles WHERE id=${r!.article_id}`;assert.equal(a!.source_id,s.id);assert.match(a!.body_text,/Synthetic complete/);assert.equal(a!.media.some((m:any)=>m.confirmed===true),true);assert.equal(a!.body_html.includes('<source'),false);assert.equal(a!.backfill,true);assert.equal(a!.raw.redfoxMp.authorEvidence,'account-list-context');if(library==='wide'){
  const {scanVideoHistory,applyVideoHistoryEntry}=await import('@aihot/backend/content/video-history');
  await sql`UPDATE articles SET media='[]'::jsonb WHERE id=${r!.article_id}`;
  const manifest=await sql.begin('read only',tx=>scanVideoHistory(tx,5000)),entry=manifest.entries.find(e=>e.articleId===r!.article_id);assert.ok(entry,'retained MP full body proof');await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));
 }}
 await switchTo(s.id,'dajiala');const [sub]=await sql`SELECT * FROM collection_subscriptions WHERE id=${s.sub}`;const [src]=await sql`SELECT * FROM sources WHERE id=${s.id}`;assert.equal(sub!.provider,'dajiala');assert.equal(sub!.interval_minutes,73);assert.equal(src!.site_fulltext,true);assert.equal(src!.participation_mode,'editorial');assert.equal(sub!.progress.pageReceiptId,undefined);
});
test('missing evidence blocks only Redfox; PATCH preserves library and permission edits are not X Article restrictions',async()=>{
 const empty=await source(false,false);assert.equal((await preflightMpReplacement(empty.id,'redfox'))!.supported,false);assert.equal((await preflightMpReplacement(empty.id,'dajiala'))!.supported,true);await assert.rejects(preflightMpReplacement(empty.id,'redfox','invalid'));
 const s=await source();await switchTo(s.id,'redfox','premium');let [src]=await sql`SELECT * FROM sources WHERE id=${s.id}`;await updateSource(s.id,{version:src!.updated_at.toISOString(),patch:{config:{ghid:account.wxId,wxid:account.account,nickname:'New label'}}},'mp-test');assert.equal((await sql`SELECT config FROM collection_subscriptions WHERE id=${s.sub}`)[0]!.config.redfoxLibrary,'premium');[src]=await sql`SELECT * FROM sources WHERE id=${s.id}`;await assert.rejects(updateSource(s.id,{version:src!.updated_at.toISOString(),patch:{config:{ghid:account.wxId,redfoxLibrary:'wide'}}},'mp-test'),{code:'unsupported_configuration'});await updateSource(s.id,{version:src!.updated_at.toISOString(),patch:{participation_mode:'hot_signal',site_fulltext:false,interval_minutes:91}},'mp-test');assert.equal((await sql`SELECT interval_minutes FROM collection_subscriptions WHERE id=${s.sub}`)[0]!.interval_minutes,91);
});
test('received page/detail replay locally; switching fences an old retained page before new purchase or material',async()=>{
 const s=await source(false);await switchTo(s.id,'redfox');listed=[{...post(),publishTime:new Date().toISOString()}];const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);let r=await row(run.id);assert.ok(!r.input.source.cursor.lastCheckedAt);
 const execution=await sql.begin(tx=>claimRun(tx,{runId:r.id,stepVersion:r.step_version,generation:r.generation},randomUUID()));
 await queryWechat('1LDQ7E1C',{workUuid:listed[0]!.workUuid},r.input.window,receiptOptions(execution),'collect');
 const initial=hits;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal(hits,initial);const [saved]=await sql`SELECT a.backfill_reason FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id}`;assert.equal(saved!.backfill_reason,'first-import');}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='fake-mp';}
 const late=await source();await switchTo(late.id,'redfox');listed=[post()];const old=await createRedfoxMpCollection(late.id,{actor:'mp-test',key:tag(),reason:'manual'});
 await step(old.id);await switchTo(late.id,'redfox','premium');const before=hits;await step(old.id);assert.equal(hits,before);assert.equal((await sql`SELECT 1 FROM operation_results WHERE run_id=${old.id} AND article_id IS NOT NULL`).length,0);
});
test('first lost read is unknown/waiting; received wrong author stays review and never imports',async()=>{
 const s=await source(false);await switchTo(s.id,'redfox');listed=[post()];disconnect=true;const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});try{await step(run.id);}finally{disconnect=false;}assert.equal((await row(run.id)).status,'waiting');assert.ok(!(await sql`SELECT progress FROM collection_subscriptions WHERE id=${s.sub}`)[0]!.progress.lastCheckedAt);
 const s2=await source();await switchTo(s2.id,'redfox');listed=[post()];const r=await createRedfoxMpCollection(s2.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(r.id);badAuthor=true;try{await step(r.id);}finally{badAuthor=false;}assert.equal((await row(r.id)).status,'needs_review');assert.equal((await sql`SELECT 1 FROM operation_results WHERE run_id=${r.id} AND article_id IS NOT NULL`).length,0);
});
test('empty detail and listing summary never clear a complete stored body; already complete items avoid new detail calls',async()=>{
 const {upsertMaterial}=await import('@aihot/backend/content/materials');
 const s=await source();await switchTo(s.id,'redfox');listed=[post()];const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);
 const material=await upsertMaterial({sourceId:s.id,url:listed[0]!.workUrl,title:listed[0]!.title,bodyText:'Already complete body',bodyHtml:'<p>Already complete body</p>',bodyStatus:'ok',via:'import'});
 bodyContent='';try{await step(run.id);}finally{bodyContent='<p>Synthetic complete body</p>';}
 assert.equal((await row(run.id)).status,'completed');const [a]=await sql`SELECT body_text,body_html,body_status FROM articles WHERE id=${material.articleId}`;assert.equal(a!.body_text,'Already complete body');assert.equal(a!.body_status,'ok');assert.match(a!.body_html,/Already complete/);
 const next=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'}),initial=hits;await step(next.id);assert.equal((await row(next.id)).status,'completed');assert.equal(hits,initial);
});
test('HTTP preflight/switch dispatch is local, rejects stale/unsupported input, and collection stays within eight details',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic MP admin'};
 const s=await source();const initial=hits;
 try{
  const preview=await app.inject({url:`/api/admin/sources/${s.id}/collection/preflight?target=redfox&library=wide`});assert.equal(preview.statusCode,200);const p=preview.json();assert.equal(hits,initial);assert.equal(p.impact.delay,'T+1');
  const headers={'x-csrf-token':'dev'},payload={target:'redfox',library:'wide',sourceVersion:p.sourceVersion,subscriptionVersion:p.subscriptionVersion,mappingVersion:p.mappingVersion,reason:'Switch through API'};
  assert.equal((await app.inject({method:'POST',url:`/api/admin/sources/${s.id}/collection/switch`,headers,payload})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:`/api/admin/sources/${s.id}/collection/switch`,headers,payload})).statusCode,409);
  assert.equal((await app.inject({url:`/api/admin/sources/${s.id}/collection/preflight?target=redfox&library=other`})).statusCode,400);
  const first=await source(false);const accepted=(await preflightMpReplacement(first.id,'redfox'))!;assert.equal(accepted.impact.firstImport,true);assert.equal((await app.inject({method:'POST',url:`/api/admin/sources/${first.id}/collection/switch`,headers,payload:{...payload,sourceVersion:accepted.sourceVersion,subscriptionVersion:accepted.subscriptionVersion}})).statusCode,200);
 }finally{config.devAdmin=null;await app.close();}
 // source() changed the fixture account; select a fresh matching source for the bounded round.
 const bounded=await source(false);await switchTo(bounded.id,'redfox');listed=Array.from({length:10},()=>post());const before=hits;
 const run=await createRedfoxMpCollection(bounded.id,{actor:'mp-test',key:tag(),reason:'manual'});for(let i=0;i<9;i++)await step(run.id);
 assert.equal((await row(run.id)).status,'completed');assert.equal(hits-before,9);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND article_id IS NOT NULL`).length,8);
});
test('wxId-only binding accepts a newly observed unowned bizInfo by account context, never binds it, and rejects a foreign owner',async()=>{
 accountWxOnly=true;let s;try{s=await source();}finally{accountWxOnly=false;}
 await switchTo(s.id,'redfox');listed=[post()];const biz=account.bizInfo,run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='wechat' AND id_kind='bizInfo' AND id_value=${biz}`).length,0);
 accountWxOnly=true;let foreign;try{foreign=await source();}finally{accountWxOnly=false;}
 const owner=tag();await sql`INSERT INTO sources(id,name,kind) VALUES (${owner},'Other verified author','external')`;await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('wechat','bizInfo',${account.bizInfo},${owner},'{}')`;
 await switchTo(foreign.id,'redfox');listed=[post()];const bad=await createRedfoxMpCollection(foreign.id,{actor:'mp-test',key:tag(),reason:'manual'}),before=hits;await step(bad.id);assert.equal((await row(bad.id)).status,'needs_review');assert.equal(hits,before+1);assert.equal((await sql`SELECT 1 FROM operation_results WHERE run_id=${bad.id} AND article_id IS NOT NULL`).length,0);
});

test('bizInfo-only evidence constructs a wide request from a verified display account without inventing wxId',async()=>{
 accountBizOnly=true;let s;try{s=await source();}finally{accountBizOnly=false;}
 const p=(await preflightMpReplacement(s.id,'redfox'))!;assert.equal(p.supported,true);assert.deepEqual(p.mapping.parameters,{bizInfo:account.bizInfo});
 await switchTo(s.id,'redfox');listed=[post()];const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE source_id=${s.id} AND id_kind='wxId'`).length,0);
});
test('scheduled mapping rejection is observable per source and does not prevent a healthy native MP run',async()=>{
 const {scheduleMpReconcile}=await import('@aihot/backend/sources/mp');
 // Only isolate existing MP subscriptions for this scan; restore their original flags afterwards.
 const saved=await sql`SELECT c.id,c.enabled FROM collection_subscriptions c JOIN sources s ON s.id=c.control_source_id WHERE s.kind='mp_account'`;
 await sql`UPDATE collection_subscriptions c SET enabled=false FROM sources s WHERE s.id=c.control_source_id AND s.kind='mp_account'`;
 try{
  const blocked=await source();await switchTo(blocked.id,'redfox');await sql`DELETE FROM source_account_bindings WHERE source_id=${blocked.id}`;
  const native=await source(true,false),initial=hits;
  const result=await scheduleMpReconcile();
  assert.ok('blocked' in result && result.blocked?.some(b=>b.sourceId===blocked.id));assert.ok('blockedCount' in result && (result.blockedCount??0)>=1);
  const [run]=await sql`SELECT r.* FROM collection_subscriptions c JOIN operation_runs r ON r.id=c.active_run_id WHERE c.id=${native.sub}`;
  assert.equal(run!.provider,'dajiala');assert.equal(run!.step_key,'mp.list');assert.equal(hits,initial);
  await sql`UPDATE collection_subscriptions SET enabled=false WHERE id IN (${blocked.sub},${native.sub})`;
 }finally{for(const s of saved)await sql`UPDATE collection_subscriptions SET enabled=${s.enabled} WHERE id=${s.id}`;}
});
test('both libraries mark every first new material as first-import; completion alone advances the policy',async()=>{
 for(const library of ['wide','premium'] as const){
  const s=await source(false),initial=hits,p=(await preflightMpReplacement(s.id,'redfox',library))!;
  assert.equal(p.supported,true);assert.equal(p.impact.firstImport,true);assert.match(p.impact.firstImportNote!,/最多8条，全部标记历史回填/);assert.equal(hits,initial);assert.equal((await preflightMpReplacement(s.id,'dajiala'))!.impact.firstImport,undefined);
  await switchTo(s.id,'redfox',library);listed=[{...post(library==='premium'),publishTime:new Date().toISOString()},{...post(library==='premium'),publishTime:'2001-01-01 12:00:00'}];
  const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);await step(run.id);
  assert.ok(!(await sql`SELECT progress FROM collection_subscriptions WHERE id=${s.sub}`)[0]!.progress.lastCheckedAt);
  // A stopped first run keeps the same frozen cursor and does not mark the source initialized.
  const {controlOperation}=await import('@aihot/backend/providers/operations/read');let r=await row(run.id);await controlOperation(run.id,'stop',{stepVersion:r.step_version,generation:r.generation,reason:'Synthetic pause'},'mp-test');
  assert.ok(!(await sql`SELECT progress FROM collection_subscriptions WHERE id=${s.sub}`)[0]!.progress.lastCheckedAt);r=await row(run.id);await controlOperation(run.id,'resume',{stepVersion:r.step_version,generation:r.generation,reason:'Synthetic resume'},'mp-test');await step(run.id);
  assert.equal((await row(run.id)).status,'completed');const articles=await sql`SELECT a.backfill,a.backfill_reason,a.published_at FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id} ORDER BY z.id`;assert.equal(articles.length,2);for(const a of articles){assert.equal(a.backfill,true);assert.equal(a.backfill_reason,'first-import');}assert.ok(articles[0]!.published_at);assert.equal(articles[1]!.published_at,null);
  assert.equal((await preflightMpReplacement(s.id,'redfox',library))!.impact.firstImport,false);
  // Schedule/manual windows are already distinct upstream cache identities.
  listed=[{...post(library==='premium'),publishTime:new Date().toISOString()}];const next=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'schedule'});assert.ok((await row(next.id)).input.source.cursor.lastCheckedAt);await step(next.id);await step(next.id);assert.equal((await row(next.id)).status,'completed');const [fresh]=await sql`SELECT a.backfill,a.backfill_reason FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${next.id}`;assert.equal(fresh!.backfill,false);assert.equal(fresh!.backfill_reason,null);
 }
});
test('first-import reuse preserves the existing material owner, times and backfill flag',async()=>{
 const {upsertMaterial}=await import('@aihot/backend/content/materials');const s=await source(false);await switchTo(s.id,'redfox');listed=[{...post(),publishTime:new Date().toISOString()}];const run=await createRedfoxMpCollection(s.id,{actor:'mp-test',key:tag(),reason:'manual'});await step(run.id);
 const existing=await upsertMaterial({sourceId:s.id,url:listed[0]!.workUrl,title:listed[0]!.title,publishedAt:new Date(),bodyText:'Original body',bodyStatus:'ok',via:'import'});
 const fields=async()=> (await sql`SELECT source_id,url,published_at,published_at_claim,discovered_at,timeline_at,backfill,backfill_reason FROM articles WHERE id=${existing.articleId}`)[0];const before=await fields();await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.deepEqual(await fields(),before);
});

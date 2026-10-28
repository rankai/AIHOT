import {assertConfiguredTestDatabase,stub,tag} from './setup.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {receiptOptions,resumeRun} from '@aihot/backend/providers/operations/store';
import {createPlatformSubscription,startPlatformSubscription,schedulePlatformSubscriptions,updatePlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {parseZhihu,queryZhihu} from '@aihot/backend/providers/redfox/zhihu';
import {zhihuOperations,type ZhihuOperation} from '@aihot/backend/providers/redfox/zhihu-contract';
import {importZhihuResult} from '@aihot/backend/providers/redfox/import-zhihu';
import {workDetailOptions} from '@aihot/backend/providers/redfox/work-detail-options';
const search='API_1789095347662',detail='API_1792651427872',comments='API_1792651427970',account='API_1792651512423',hot='API_1792651658984';
const articleId=BigInt('0x'+randomUUID().replaceAll('-','')).toString();
const article={opusId:articleId,type:'article',opusUrl:`https://zhuanlan.zhihu.com/p/${articleId}`,title:'Synthetic Zhihu article',content:'<p>Verified body <b>bold</b></p><script>bad()</script>',publishTime:1700000000};
const comment={id:'90071992547409931',content:'Synthetic comment',nickname:'Commenter',avatorUrl:'https://example.test/avatar',urlToken:'commenter-token',likeNum:'12',publishTime:'1700000000'};
let data:unknown=article;
const wire:Array<{url:string;parameters:Record<string,unknown>}>=[];
const provider=await stub((_hit,request)=>{wire.push({url:request.url,parameters:JSON.parse(request.body!)});return {code:2000,data};});
let budgets:Array<{service:string;per_minute:number;per_hour:number;per_day:number}>=[];
const subs:number[]=[];
function on(){process.env.REDFOX_TEST_BASE_URL=provider.url;process.env.REDFOX_API_KEY='fake-zhihu';process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';}
function off(){process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;}
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);on();config.allowPrivateNetworkFetch=true;budgets=await sql`SELECT service,per_minute,per_hour,per_day FROM budgets WHERE service IN ('redfox.query','redfox.collect')`;await sql`UPDATE budgets SET per_minute=10000,per_hour=100000,per_day=1000000 WHERE service IN ('redfox.query','redfox.collect')`;});
after(async()=>{if(subs.length)await sql`UPDATE collection_subscriptions SET enabled=false,next_run_at=NULL WHERE id IN ${sql(subs)}`;for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;off();await provider.close();await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(operationId:ZhihuOperation,parameters:Record<string,unknown>,sourceResultId?:number){const run=await createSynchronousQuery({operationId,parameters,...(sourceResultId?{sourceResultId}:{})},'zhihu-test',tag());await step(run.id);const r=await row(run.id);assert.equal(r.status,'completed',r.wait_reason);return (await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`);}
async function source(){const id=tag();await sql`INSERT INTO sources(id,name,kind,config,enabled,participation_mode,site_fulltext,syndicate_fulltext) VALUES (${id},'Synthetic owner','external','{}',true,'editorial',false,false)`;return id;}
async function commentSub(extra:Record<string,unknown>={}){const s=await createPlatformSubscription({name:tag(),operationId:comments,parameters:{articleId},enabled:true,limits:{pages:1,items:1,details:0},...extra},'zhihu-test',tag());subs.push(s.id);return s;}

test('four documented query shapes retain values and reject broken detail/comment shapes',async()=>{
 for(const [op,p,payload,kind] of [[detail,{articleId},article,'zhihu_work'],[comments,{articleId,nextUrl:'opaque-next'},{items:[comment],nextUrl:'received-next'},'social_comment'],[account,{userId:'home-token'},{urlToken:'home-token',homeUrl:'https://www.zhihu.com/people/home-token',nickname:'Synthetic',fansNum:'123'},'zhihu_account'],[hot,{},[{title:'Synthetic hotspot',hotValue:'404 万',rank:0,label:'new'}],'zhihu_hot_search']] as const){data=payload;const results=await query(op,p);assert.equal(results[0]!.kind,kind);assert.equal(new URL(wire.at(-1)!.url,provider.url).pathname,zhihuOperations[op].path);assert.deepEqual(wire.at(-1)!.parameters,p);const [r]=await sql`SELECT service,cost FROM receipts WHERE id=${results[0]!.receipt_id}`;assert.equal(r!.service,'redfox.query');assert.equal(Number(r!.cost),0.06);}
 assert.equal(parseZhihu(comments,{items:[],nextUrl:null},{articleId})[0]!.data.count,0);assert.equal(parseZhihu(hot,[],{})[0]!.data.count,0);
 assert.throws(()=>parseZhihu(account,{},{}));assert.throws(()=>parseZhihu(hot,{items:[]},{}));
 for(const bad of [{},{items:null},{items:[{}]},{items:'[]'}])assert.throws(()=>parseZhihu(comments,bad,{articleId}));
 for(const bad of [{...article,opusId:'999'},{...article,type:'answer'},{...article,opusUrl:'https://evil.test/p/'+articleId},{...article,opusUrl:'https://zhuanlan.zhihu.com/p/999'},{...article,opusUrl:'https://zhuanlan.zhihu.com/p/'+articleId+'#x'}])assert.throws(()=>parseZhihu(detail,bad,{articleId}));
});
test('article search alone offers same-work detail; verified body/time import preserves selected owner and deduplicates',async()=>{
 data=[{opusId:articleId,title:'Search article'}];const [result]=await query(search,{offset:'0',keword:tag(),vertical:'article'});
 const options=await workDetailOptions(result!.id);assert.equal(options!.choices[0]!.operationId,detail);assert.deepEqual(options!.choices[0]!.parameters,{articleId});
 await assert.rejects(createSynchronousQuery({operationId:detail,parameters:{articleId:'999'},sourceResultId:result!.id},'zhihu-test',tag()));
 for(const vertical of [undefined,'answer','zvide']){data=[{opusId:articleId,title:'Other'}];const [r]=await query(search,{offset:'0',keword:tag(),...(vertical?{vertical}:{})});assert.deepEqual((await workDetailOptions(r!.id))!.choices,[]);}
 data=article;const [full]=await query(detail,{articleId},result!.id),sourceId=await source();
 const imported=await importZhihuResult(full!.id,{sourceId,reason:'Synthetic verified import'},'zhihu-test',tag());assert.ok(imported?.articleId);
 const [a]=await sql`SELECT a.*,s.participation_mode,s.site_fulltext FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=${imported.articleId}`;
 assert.equal(a!.source_id,sourceId);assert.equal(a!.body_status,'ok');assert.match(a!.body_text,/Verified body/);assert.doesNotMatch(a!.body_html,/<script/);assert.equal(a!.published_at.toISOString(),'2023-11-14T22:13:20.000Z');assert.equal(a!.participation_mode,'editorial');assert.equal(a!.site_fulltext,false);
 assert.equal((await importZhihuResult(full!.id,{sourceId,reason:'Repeated import'},'zhihu-test',tag()))!.articleId,imported.articleId);
 await assert.rejects(importZhihuResult(full!.id,{sourceId,reason:'wrong',supplement:{url:'https://zhuanlan.zhihu.com/p/999',evidence:'wrong'}},'zhihu-test',tag()),/cannot be replaced/);
});
test('article subscription enriches through original source, received detail replays without repurchase',async()=>{
 const sourceId=await source(),id=articleId+'1';
 const sub=await createPlatformSubscription({name:tag(),sourceId,operationId:search,parameters:{offset:'0',keword:tag(),vertical:'article'},enabled:true,enrichDetails:true,detailOperationId:detail,limits:{pages:1,items:1,details:1}},'zhihu-test',tag());subs.push(sub.id);
 const run=await startPlatformSubscription(sub.id,'zhihu-test',tag());data=[{opusId:id,title:'Article search'}];await step(run.id);await step(run.id);const current=await row(run.id);assert.equal(current.step_key,'redfox.platform.detail');
 data={...article,opusId:id,opusUrl:`https://zhuanlan.zhihu.com/p/${id}`};
 const response=await queryZhihu(detail,current.progress.detailParameters,String(current.input.window),receiptOptions({runId:run.id,stepVersion:current.step_version,generation:current.generation}),'collect');const hits=provider.hits();off();try{await step(run.id);}finally{on();}
 assert.equal(provider.hits(),hits);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);
 const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='zhihu_work' ORDER BY id`;assert.equal(results.length,2);assert.ok(results[0]!.article_id);assert.equal(results[0]!.article_id,results[1]!.article_id);assert.equal(results[1]!.source_id,sourceId);assert.equal(results[1]!.provenance.detailSourceResultId,results[0]!.id);
 assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.active_run_id,null);const [receipt]=await sql`SELECT attempts,service,cost FROM receipts WHERE id=${response.receiptId}`;assert.equal(receipt!.attempts,1);assert.equal(receipt!.service,'redfox.collect');assert.equal(Number(receipt!.cost),0.06);
});
test('comment snapshot schedules without source, truncates local records and releases occupancy',async()=>{
 data={items:[comment,{...comment,id:'second'}],nextUrl:'https://www.zhihu.com/next'};const sub=await commentSub();await sql`UPDATE collection_subscriptions SET next_run_at='2020-01-01' WHERE id=${sub.id}`;assert.ok(await schedulePlatformSubscriptions());const [started]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`;assert.ok(started!.active_run_id);const id=started!.active_run_id;await step(id);assert.equal((await row(id)).status,'completed');
 assert.deepEqual(wire.at(-1)!.parameters,{articleId});const rows=await sql`SELECT * FROM operation_results WHERE run_id=${id} ORDER BY id`;assert.equal(rows.length,2);const summary=rows[0]!.data;assert.equal(summary.count,2);assert.equal(summary.selectedCount,1);assert.equal(summary.processedCount,1);assert.equal(summary.unprocessedDueToLimit,1);assert.equal(summary.snapshot,true);assert.equal(summary.truncated,true);assert.equal(summary.stopReason,'item-limit');assert.equal(summary.nextParameters,null);assert.equal(summary.returnedPage.nextUrl,'https://www.zhihu.com/next');assert.equal(rows[1]!.provenance.sourcePageResultId,rows[0]!.id);assert.ok(rows.every(r=>!r.source_id&&!r.article_id));assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.active_run_id,null);
});
test('comment snapshot response replays once locally; empty and invalid outcomes remain distinct',async()=>{
 for(const items of [[comment],[]]){data={items,nextUrl:null};const sub=await commentSub(),run=await startPlatformSubscription(sub.id,'zhihu-test',tag());const response=await queryZhihu(comments,{articleId},String(run.input.window),receiptOptions({runId:run.id,stepVersion:run.step_version,generation:run.generation}),'collect');const hits=provider.hits();off();try{await step(run.id);await step(run.id);}finally{on();}assert.equal(provider.hits(),hits);assert.equal((await row(run.id)).status,'completed');const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(results.length,items.length+1);assert.equal(results.find(r=>r.kind==='query_summary')!.data.stopReason,'single-request');assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${response.receiptId}`)[0]!.attempts,1);}
 data={};const sub=await commentSub(),run=await startPlatformSubscription(sub.id,'zhihu-test',tag());await step(run.id);assert.equal((await row(run.id)).status,'needs_review');assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE run_id=${run.id}`)[0]!.n,0);
});
test('HTTP subscription contract rejects pagination/details/video while accepting omitted or false flags',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),previous=config.devAdmin;config.devAdmin={displayName:'Synthetic admin'};
 try{const catalog=(await app.inject({url:'/api/admin/redfox/operations'})).json();const definition=catalog.find((r:any)=>r.id===comments);assert.equal(definition.schedulableType,'list');assert.equal(definition.collectionCapabilities.sourceRequired,false);assert.equal(definition.collectionCapabilities.detailEnrichment,false);for(const id of [account,hot,detail])assert.equal(catalog.find((r:any)=>r.id===id).schedulableType,null);
 const base={name:tag(),operationId:comments,parameters:{articleId},enabled:false,limits:{pages:1,items:2,details:0}};
 for(const extra of [{parameters:{articleId,nextUrl:'next'}},{limits:{pages:2,items:2,details:0}},{limits:{pages:1,items:2,details:1}},{enrichDetails:true},{detailOperationId:detail},{detailPage:1},{autoDownloadVideo:true}]){const response=await app.inject({method:'POST',url:'/api/admin/redfox/collections',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{...base,...extra}});assert.ok([400,409,422].includes(response.statusCode),response.body);}
 for(const extra of [{},{enrichDetails:false,autoDownloadVideo:false}]){const response=await app.inject({method:'POST',url:'/api/admin/redfox/collections',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{...base,...extra}});assert.equal(response.statusCode,201,response.body);subs.push(response.json().id);}
 await assert.rejects(createPlatformSubscription({name:tag(),operationId:search,parameters:{offset:'0',keword:'x'}},'zhihu-test',tag()));
 }finally{config.devAdmin=previous;await app.close();}
});
test('edited or disabled comment subscription fences old received response',async()=>{
 for(const edit of [true,false]){data={items:[comment],nextUrl:null};const sub=await commentSub(),run=await startPlatformSubscription(sub.id,'zhihu-test',tag());await queryZhihu(comments,{articleId},String(run.input.window),receiptOptions({runId:run.id,stepVersion:run.step_version,generation:run.generation}),'collect');const [stored]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;
 await updatePlatformSubscription(sub.id,{editVersion:stored!.edit_version,config:{...stored!.config,provider:'redfox',enabled:edit,parameters:{articleId:edit?articleId+'9':articleId},intervalMinutes:stored!.interval_minutes,limits:stored!.limits}},'zhihu-test');const hits=provider.hits();await step(run.id);assert.equal(provider.hits(),hits);assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE run_id=${run.id}`)[0]!.n,0);assert.equal((await row(run.id)).status,'stopped');}
});

test('query and collection budget gates hold new requests, while received comments reuse at zero budget',async()=>{
 data={items:[comment],nextUrl:null};const sub=await commentSub(),run=await startPlatformSubscription(sub.id,'zhihu-test',tag());
 const response=await queryZhihu(comments,{articleId},String(run.input.window),receiptOptions({runId:run.id,stepVersion:run.step_version,generation:run.generation}),'collect');
 await sql`UPDATE budgets SET per_minute=0 WHERE service IN ('redfox.query','redfox.collect')`;const hits=provider.hits();
 try{
  await step(run.id);assert.equal((await row(run.id)).status,'completed');
  const q=await createSynchronousQuery({operationId:comments,parameters:{articleId}},'zhihu-test',tag());await step(q.id);assert.equal((await row(q.id)).status,'waiting');
  const blocked=await commentSub(),b=await startPlatformSubscription(blocked.id,'zhihu-test',tag());await step(b.id);assert.equal((await row(b.id)).status,'waiting');assert.equal(provider.hits(),hits);
  const [receipt]=await sql`SELECT attempts,service,cost FROM receipts WHERE id=${response.receiptId}`;assert.equal(receipt!.attempts,1);assert.equal(receipt!.service,'redfox.collect');assert.equal(Number(receipt!.cost),0.06);
 }finally{await sql`UPDATE budgets SET per_minute=10000 WHERE service IN ('redfox.query','redfox.collect')`;}
});

test('Zhihu price seed preserves configured prices and creates only the six intended estimates',async()=>{
 const {readFile}=await import('node:fs/promises');const migration=await readFile(new URL('../database/migrations/0079_zhihu_detail_research_prices.sql',import.meta.url),'utf8');
 const rollback=new Error('rollback test price override');
 await assert.rejects(sql.begin(async tx=>{
  await tx`UPDATE service_prices SET per_request=9.87 WHERE service='redfox.query' AND model=${detail}`;
  await tx.unsafe(migration);
  const prices=await tx`SELECT service,model,per_request FROM service_prices WHERE model IN ${tx([detail,comments,account,hot])}`;
  assert.equal(prices.length,6);assert.equal(Number(prices.find(p=>p.model===detail&&p.service==='redfox.query')!.per_request),9.87);
  assert.ok(prices.filter(p=>p.model!==detail||p.service!=='redfox.query').every(p=>Number(p.per_request)===0.06));
  throw rollback;
 }),error=>error===rollback);
});

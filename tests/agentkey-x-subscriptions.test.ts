import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createPlatformSubscription,startPlatformSubscription,updatePlatformSubscription,collectionProviderOptions,preflightPlatformSubscriptionProvider,switchPlatformSubscriptionProvider} from '@aihot/backend/sources/platform-subscriptions';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {recoverOperations} from '@aihot/backend/providers/operations/recovery';
import {agentKeyXOperations,xCollectionIds,xCollectionSearchInput,xSearchRoute} from '@aihot/backend/providers/agentkey/x-contract';
import {importXSearchResult} from '@aihot/backend/providers/redfox/import-x-search';
import {config as backendConfig} from '@aihot/backend/config';
import {stub,gate,tag,assertConfiguredTestDatabase} from './setup.ts';
const id=()=>BigInt('0x'+randomUUID().replaceAll('-','').slice(0,20)).toString();
const author=(uid=id())=>({rest_id:uid,screen_name:'sample',name:'Sample'});
const tweet=(a=author())=>({tweet_id:id(),text:'Synthetic received post',created_at:new Date().toISOString(),author:a});
const detail=(t:ReturnType<typeof tweet>)=>({...t,tweet_id:undefined,id:t.tweet_id});
const searchBody=(t= tweet())=>({timeline:[{...t,author:undefined,user_info:t.author,type:'tweet'}],next_cursor:'received-unfollowed'});
const saved=async(n:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${n}`)[0]!;
const step=async(n:number)=>{const r=await saved(n);await executeOperationStep(n,r.step_version,randomUUID());return saved(n);};
let budgets:any[]=[];const subscriptions:number[]=[];
before(async()=>{const [d]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(d!.name,d!.port);budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;});
after(async()=>{for(const n of subscriptions)await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${n}`;for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function create(operationId='5K5EG87P',parameters:Record<string,unknown>={keyword:'plain test'},extra:Record<string,unknown>={}){const sub=await createPlatformSubscription({name:'Synthetic X homepage',provider:'agentkey',operationId,parameters,enabled:true,limits:{pages:1,items:10,details:0},...extra},'test',tag());subscriptions.push(sub.id);return sub;}
async function withStub(body:unknown|(()=>Promise<unknown>),run:(calls:any[])=>Promise<void>){
 const calls:any[]=[];const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:.2,data:{code:200,data:typeof body==='function'?await body():body}}}};});
 const old={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-x-subscriptions',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'true',REDFOX_API_KEY:'fake-x-switch',REDFOX_CALLS_ENABLED:'false'});
 try{await run(calls);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
}
test('ten exact homepage subscription routes; basic keywords preserve bytes and advanced inputs stay Q only',async()=>{
 assert.equal(xCollectionIds.length,10);assert.deepEqual(xCollectionSearchInput.parse({keyword:'  人工智能 2026  '}),{keyword:'  人工智能 2026  ',search_type:'Top'});
 for(const keyword of ['from:sample','AI OR ML','AI AND ML','NOT news','-filter:replies','since:2026','AI/ML','"quoted"','a_b'])assert.throws(()=>xCollectionSearchInput.parse({keyword}));
 for(const operationId of ['ABJQXHUE','5QY3G5TY','x.account_posts'])assert.deepEqual(collectionProviderOptions(operationId).map(p=>p.id),['agentkey']);
 for(const extra of [{limits:{pages:2,items:2,details:0}},{limits:{pages:1,items:2,details:1}},{enrichDetails:true},{detailOperationId:'QCP75W33'},{parameters:{keyword:'plain',cursor:'x'}},{parameters:{keyword:'AI OR ML'}}])await assert.rejects(create('5K5EG87P',{keyword:'plain'},extra));
 for(const operationId of ['x.detail','x.account_profile'])await assert.rejects(create(operationId,operationId==='x.detail'?{tweet_id:'1'}:{screen_name:'sample'}));
 await assert.rejects(create('ABJQXHUE',{tweetId:'1'},{provider:'redfox'}));await assert.rejects(create('5QY3G5TY',{screenName:'sample'},{provider:'redfox'}));
 for(const operationId of xCollectionIds){
  const t=tweet(),member={user_id:t.author.rest_id,screen_name:'sample',name:'Sample'};
  const parameters:Record<string,unknown>=operationId==='5K5EG87P'?{keyword:'  plain keyword  '}:operationId==='ABJQXHUE'?{tweet_id:t.tweet_id}:operationId.includes('list_')?{list_id:'1'}:operationId.includes('community_')?{community_id:'2'}:operationId==='x.trending'?{}:{screen_name:'sample'};
  const body=operationId==='5K5EG87P'?searchBody(t):operationId==='x.account_posts'?{user:{profile:'sample',rest_id:t.author.rest_id},timeline:[t]}:operationId==='ABJQXHUE'?{...detail(t),thread:[{...detail(tweet()),conversation_id:t.tweet_id}]}:operationId==='x.followers'?{followers:[member]}:operationId==='5QY3G5TY'?{following:[member]}:operationId.endsWith('members')?{members:[member],next_cursor:'unfollowed'}:operationId==='x.trending'?{trends:[{name:'Synthetic term'}]}:{timeline:[t],cursor:'unfollowed'};
  await withStub(body,async calls=>{const sub=await create(operationId,parameters),run=await startPlatformSubscription(sub.id,'test',tag()),done=await step(run.id);assert.equal(done.status,'completed',done.wait_reason);assert.equal(calls.length,1);
   const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=rows.find(r=>r.kind==='query_summary')!,items=rows.filter(r=>r!==summary);assert.equal(summary.data.selectedCount,1);assert.equal(summary.data.unprocessedDueToLimit,0);assert.equal(summary.data.nextParameters,null);assert.equal(items.length,1);
   const material=['5K5EG87P','x.account_posts','x.list_posts','x.community_posts'].includes(operationId);assert.equal(!!items[0]!.article_id,material);if(material){const [a]=await sql`SELECT raw,body_status,body_text FROM articles WHERE id=${items[0]!.article_id}`;assert.equal(a!.raw.provider,'agentkey');assert.equal(a!.body_status,'pending');assert.equal(a!.body_text,null);}else assert.equal(items[0]!.source_id,null);
   const [receipt]=await sql`SELECT service,status,model FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.service,'agentkey.collect');assert.equal(receipt!.status,'completed');assert.equal(receipt!.model,agentKeyXOperations.find(o=>o.operationId===operationId)!.route.tool);
   const [state]=await sql`SELECT active_run_id,progress,next_run_at>now() AS scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(state!.active_run_id,null);assert.equal(state!.scheduled,true);assert.deepEqual(state!.progress,{pages:1,items:1,details:0,stopReason:'single-request',nextParameters:null});
  });
 }
});
test('actual account scope gates collection import; missing scope stays research, contradictions retain receipt for review',async()=>{
 for(const mode of ['missing','missingUid','missingHandle','match','numeric','wrongHandle','wrongUid','wrongAuthor']){
  const t=tweet(author('44196397')),scope={profile:'sample',rest_id:t.author.rest_id},body={timeline:[t],...(mode==='missing'?{}:{user:mode==='missingUid'?{profile:'sample'}:mode==='missingHandle'?{rest_id:t.author.rest_id}:mode==='wrongHandle'?{...scope,profile:'other'}:mode==='wrongUid'?{...scope,rest_id:'2'}:scope})};if(mode==='wrongAuthor')body.timeline=[{...t,author:author('2')}];
  await withStub(body,async calls=>{const sub=await create('x.account_posts',mode==='numeric'?{rest_id:44196397}:{screen_name:'sample'}),run=await startPlatformSubscription(sub.id,'test',tag()),done=await step(run.id),contradiction=mode.startsWith('wrong');assert.equal(done.status,contradiction?'needs_review':'completed',done.wait_reason);assert.equal(calls.length,1);
   const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;if(contradiction){assert.equal(rows.length,0);assert.equal((await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`)[0]!.status,'received');}
   else{const work=rows.find(r=>r.kind==='x_research_work')!;if(mode.startsWith('missing')){assert.equal(work.article_id,null);assert.equal(work.data.importable,false);assert.match(work.data.pendingReason,/scope/);await assert.rejects(importXSearchResult(work.id,{reason:'still missing'},'test',tag()),/scope/);}else assert.ok(work.article_id);}
  });
 }
});
test('item limits count pins and retweet research; empty and repeated homepage periods do not invent materials or pagination',async()=>{
 const t=tweet(),wrapper={...tweet(t.author),retweeted:{id:'123'},retweeted_tweet:{...tweet(),tweet_id:'123'}},body={user:{profile:'sample',rest_id:t.author.rest_id},pinned:t,timeline:[wrapper,tweet(t.author)],next_cursor:'never-follow'};
 await withStub(body,async calls=>{const sub=await create('x.account_posts',{screen_name:'sample'},{limits:{pages:1,items:2,details:0}});let firstArticle='';for(let period=0;period<2;period++){const run=await startPlatformSubscription(sub.id,'test',tag()),done=await step(run.id);assert.equal(done.status,'completed',done.wait_reason);const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`,summary=rows.find(r=>r.kind==='query_summary')!,works=rows.filter(r=>r.kind==='x_research_work');assert.equal(summary.data.count,3);assert.equal(summary.data.selectedCount,2);assert.equal(summary.data.unprocessedDueToLimit,1);assert.equal(summary.data.returnedPage.next_cursor,'never-follow');assert.equal(works[0]!.data.pinned,true);assert.ok(works[0]!.article_id);assert.equal(works[1]!.article_id,null);assert.match(works[1]!.data.pendingReason,/role/);if(period)assert.equal(works[0]!.article_id,firstArticle);else firstArticle=works[0]!.article_id;}assert.equal(calls.length,2);});
 await withStub({timeline:[]},async calls=>{const sub=await create(),run=await startPlatformSubscription(sub.id,'test',tag());assert.equal((await step(run.id)).status,'completed');const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(rows.length,1);assert.equal(rows[0]!.data.selectedCount,0);assert.equal(calls.length,1);assert.equal((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub.id}`)[0]!.active_run_id,null);});
});
test('process killed after received receipt recovers locally through existing scanner and releases occupancy',async()=>{
 await withStub(searchBody(),async calls=>{
  const sub=await create(),run=await startPlatformSubscription(sub.id,'test',tag()),ready=gate();let stderr='';
  const child=spawn(process.execPath,['--input-type=module','--eval',`
   import {sql} from '@aihot/backend/db';
   import {claimRun} from '@aihot/backend/providers/operations/store';
   import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
   import {xSearchRoute,xCollectionSearchInput} from '@aihot/backend/providers/agentkey/x-contract';
   const [run]=await sql\`SELECT * FROM operation_runs WHERE id=${run.id}\`;
   const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},run.job_id));
   await requestAgentKey(execution,run,xSearchRoute,xCollectionSearchInput.parse(run.input.parameters));
   console.log('RECEIVED');setInterval(()=>{},1000);
  `],{cwd:process.cwd(),env:{...process.env},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{if(String(chunk).includes('RECEIVED'))ready.open();});child.stderr.on('data',chunk=>{stderr+=chunk;});const exit=once(child,'exit');
  try{await Promise.race([ready.promise,exit.then(()=>{throw Error(`Child exited before receipt: ${stderr}`);})]);const state=await saved(run.id);assert.equal((await sql`SELECT status FROM receipts WHERE id=${state.current_receipt_id}`)[0]!.status,'received');child.kill('SIGKILL');await exit;assert.equal(calls.length,1);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
   process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';const [cursor]=await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`;await sql`UPDATE pgboss.job SET state='cancelled' WHERE id=${state.job_id}`;await sql`INSERT INTO settings(key,value,updated_by) VALUES('operations.recovery-cursor',${sql.json(run.id-1)},'x-test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
   try{const recovered=await recoverOperations();assert.equal(recovered.requeued,1);assert.equal(recovered.released,0);const done=await step(run.id);assert.equal(done.status,'completed',done.wait_reason);assert.equal(calls.length,1);const [s]=await sql`SELECT active_run_id,progress,next_run_at>now() scheduled FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(s!.active_run_id,null);assert.equal(s!.scheduled,true);assert.equal(s!.progress.items,1);assert.equal((await sql`SELECT attempts,status FROM receipts WHERE id=${state.current_receipt_id}`)[0]!.attempts,1);}
   finally{if(cursor)await sql`UPDATE settings SET value=${sql.json(cursor.value)} WHERE key='operations.recovery-cursor'`;else await sql`DELETE FROM settings WHERE key='operations.recovery-cursor'`;}
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
 });
});
test('exact basic-search provider switch preserves identity/history and blocks incompatible recipes without mutation',async()=>{
 await withStub({},async calls=>{
  const sub=await create('5K5EG87P',{keyword:'人工智能 2026',searchType:'Latest'},{provider:'redfox',enabled:false});const first=await preflightPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey'});assert.equal(first!.supported,true,JSON.stringify(first));assert.match(first!.impact.note,/0.2 credits/);
  const switched=await switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey',reason:'synthetic exact switch'},'test');assert.deepEqual(switched!.config.parameters,{keyword:'人工智能 2026',search_type:'Latest'});assert.equal(switched!.id,sub.id);await assert.rejects(switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'redfox',reason:'stale'},'test'));
  assert.equal((await preflightPlatformSubscriptionProvider(sub.id,{editVersion:2,targetProvider:'redfox'}))!.supported,true);await switchPlatformSubscriptionProvider(sub.id,{editVersion:2,targetProvider:'redfox',reason:'reverse'},'test');const [back]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;assert.deepEqual(back!.config.parameters,{keyword:'人工智能 2026',searchType:'Latest'});assert.deepEqual(back!.progress,{});assert.equal(back!.edit_version,3);assert.equal((await sql`SELECT id FROM audit_log WHERE action='subscription.switch_provider' AND subject=${`subscription:${sub.id}`}`).length,2);
  for(const delta of [{parameters:{keyword:'from:sample'}},{parameters:{keyword:'AI OR ML'}},{parameters:{keyword:'plain',cursor:''}},{limits:{pages:2,items:5,details:0}},{limits:{pages:1,items:5,details:1}}]){const bad=await create('5K5EG87P',{keyword:'plain'},{provider:'redfox',enabled:false,...delta}),[before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${bad.id}`;assert.equal((await preflightPlatformSubscriptionProvider(bad.id,{editVersion:1,targetProvider:'agentkey'}))!.supported,false);await assert.rejects(switchPlatformSubscriptionProvider(bad.id,{editVersion:1,targetProvider:'agentkey',reason:'unsupported'},'test'));assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${bad.id}`)[0],before);}
  const bad=await create('5K5EG87P',{keyword:'plain'},{provider:'redfox',enabled:false});await sql`UPDATE collection_subscriptions SET config=config||'{"enrichDetails":true,"detailOperationId":"QCP75W33"}'::jsonb WHERE id=${bad.id}`;const [before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${bad.id}`;assert.equal((await preflightPlatformSubscriptionProvider(bad.id,{editVersion:1,targetProvider:'agentkey'}))!.supported,false);await assert.rejects(switchPlatformSubscriptionProvider(bad.id,{editVersion:1,targetProvider:'agentkey',reason:'preserve detail'},'test'));assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${bad.id}`)[0],before);
  const spaces=await create('5K5EG87P',{keyword:'  preserve  '},{enabled:false});assert.equal((await preflightPlatformSubscriptionProvider(spaces.id,{editVersion:1,targetProvider:'redfox'}))!.supported,true);
  await switchPlatformSubscriptionProvider(spaces.id,{editVersion:1,targetProvider:'redfox',reason:'preserve exact whitespace'},'test');
  assert.deepEqual((await sql`SELECT config FROM collection_subscriptions WHERE id=${spaces.id}`)[0]!.config.parameters,{keyword:'  preserve  ',searchType:'Top'});
  const relation=await create('5QY3G5TY',{screen_name:'sample'},{enabled:false});assert.equal((await preflightPlatformSubscriptionProvider(relation.id,{editVersion:1,targetProvider:'redfox'}))!.supported,false);assert.equal(calls.length,0);
 });
});
test('late received response after provider switch or disable cannot write into current subscription',async()=>{
 for(const action of ['switch','disable']){const entered=gate(),release=gate();await withStub(async()=>{entered.open();await release.promise;return searchBody();},async calls=>{
  const sub=await create(),run=await startPlatformSubscription(sub.id,'test',tag()),executing=step(run.id);try{await entered.promise;
   if(action==='switch')await switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'redfox',reason:'late switch'},'test');
   else await updatePlatformSubscription(sub.id,{editVersion:1,config:{name:'Synthetic X homepage',provider:'agentkey',operationId:'5K5EG87P',parameters:{keyword:'plain test'},enabled:false,limits:{pages:1,items:10,details:0}}},'test');
   const [before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;release.open();const done=await executing;assert.equal(done.status,'stopped');assert.equal(calls.length,1);assert.equal((await sql`SELECT status FROM receipts WHERE id=${done.current_receipt_id}`)[0]!.status,'received');assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`)[0],before);
  }finally{release.open();await executing;}
 });}
});
test('API catalog exposes all ten generic schedules and keeps native X main independent',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),old=backendConfig.devAdmin;backendConfig.devAdmin={displayName:'Synthetic X S'};
 try{const reply=await app.inject({method:'GET',url:'/api/admin/redfox/operations'});assert.equal(reply.statusCode,200);for(const id of xCollectionIds){const op=reply.json().find((o:any)=>o.id===id);assert.equal(op.platform,'x-research');assert.ok(op.schedulableType);assert.ok(op.collectionProviders.some((p:any)=>p.id==='agentkey'));}for(const id of ['ABJQXHUE','5QY3G5TY']){const op=reply.json().find((o:any)=>o.id===id);assert.deepEqual(op.collectionProviders.map((p:any)=>p.id),['agentkey']);assert.deepEqual(op.queryProviders.map((p:any)=>p.id),['redfox','agentkey']);}for(const id of ['x.detail','x.account_profile'])assert.equal(reply.json().find((o:any)=>o.id===id).schedulableType,null);}
 finally{backendConfig.devAdmin=old;await app.close();}
});

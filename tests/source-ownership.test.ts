import {tag, gate, assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {newArticleId} from '@aihot/backend/lib/ids';
import {before, after, test} from 'node:test';
import {sql, closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {schedulePlatformSubscriptions, createPlatformSubscription, updatePlatformSubscription, startPlatformSubscription, listPlatformSubscriptions, switchPlatformSubscriptionProvider} from '@aihot/backend/sources/platform-subscriptions';
import {createSubscription, contentSubscription, importSource, lockSourceDeletion} from '@aihot/backend/sources/subscriptions';
import {createRun, lockRun, resumeRun, receiptOptions, advanceRun} from '@aihot/backend/providers/operations/store';
import {paidRequest} from '@aihot/backend/providers/receipts';
import {updateSource} from '@aihot/backend/admin/sources';
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);});
after(async()=>{await stopBoss();await closeDb();});
async function source(){const id=tag();await sql`INSERT INTO sources(id,name,kind) VALUES (${id},'Synthetic ownership','external')`;return id;}
const input=(sourceId?:string)=>({name:tag(),sourceId,provider:'redfox',operationId:'OWIBYU1V',parameters:{keyword:'synthetic'},enabled:true,limits:{pages:1,items:10,details:0}});
const execution=(r:{id:number;step_version:number;generation:number})=>({runId:r.id,stepVersion:r.step_version,generation:r.generation});
test('creation requires ownership, reads it back, freezes only members and permits two independent subscriptions',async()=>{
 await assert.rejects(createPlatformSubscription(input(),'test',tag()),/associated source/);
 const id=await source(),payload=input(id),a=await createPlatformSubscription(payload,'test',tag()),b=await createPlatformSubscription(input(id),'test',tag());
 assert.equal((await listPlatformSubscriptions()).find(s=>s.id===a.id)!.sourceId,id);
 const ar=await startPlatformSubscription(a.id,'test',tag()),br=await startPlatformSubscription(b.id,'test',tag());
 assert.equal(ar.input.members[0]!.sourceId,id);assert.equal(ar.input.sourceId,undefined);assert.notEqual(ar.id,br.id);
 await assert.rejects(updatePlatformSubscription(a.id,{editVersion:1,config:{...payload,sourceId:await source()}},'test'),/cannot change/);
 await updatePlatformSubscription(a.id,{editVersion:1,config:{...payload,sourceId:undefined,name:'Renamed'}},'test');
 assert.equal((await sql.begin(tx=>lockRun(tx,ar.id))).eligible.length,1);
 await sql.begin(tx=>advanceRun(tx,execution(ar),null));
 assert.equal((await sql.begin(tx=>importSource(tx,ar.input.members)))!.id,id);
 assert.equal(await sql.begin(tx=>importSource(tx,ar.input.members,'wrong')),null);
 assert.equal((await sql.begin(tx=>lockRun(tx,br.id))).eligible.length,1);
});
test('research snapshots remain unowned while topic content requires source',async()=>{
 for(const operationId of ['UAQ90A1F','douyin.comments','x.followers','bilibili.dynamics'])assert.equal(contentSubscription({config:{operationId}}),false);
 assert.equal(contentSubscription({config:{operationId:'douyin.topic_posts'}}),true);
 const sub=await createPlatformSubscription({name:tag(),operationId:'UAQ90A1F',parameters:{},enabled:true},'test',tag());
 const run=await startPlatformSubscription(sub.id,'test',tag());assert.equal(run.input.members[0]!.sourceId,null);
 assert.equal((await sql.begin(tx=>lockRun(tx,run.id))).eligible.length,1);
});
test('legacy unowned content rejects enabling without mutation but permits disabled management',async()=>{
 const payload=input(await source()),sub=await createPlatformSubscription({...payload,enabled:false},'test',tag());
 await sql`UPDATE collection_subscriptions SET config=config-'sourceId' WHERE id=${sub.id}`;
 const [before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;
 const {sourceId:_sourceId,...unowned}=payload;
 await assert.rejects(updatePlatformSubscription(sub.id,{editVersion:1,config:{...unowned,enabled:true}},'test'),/associated source/);
 assert.deepEqual((await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`)[0],before);
 const saved=await updatePlatformSubscription(sub.id,{editVersion:1,config:{...unowned,name:'Legacy paused management',enabled:false}},'test');
 const [row]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;
 assert.equal(saved!.editVersion,2);assert.equal(row!.enabled,false);assert.equal(row!.next_run_at,null);
 assert.equal(row!.config.sourceId,undefined);assert.equal(row!.config.name,'Legacy paused management');
});
test('unowned research snapshot can be enabled through the same update entry',async()=>{
 const config={name:tag(),operationId:'UAQ90A1F',parameters:{},enabled:false};
 const sub=await createPlatformSubscription(config,'test',tag());
 await updatePlatformSubscription(sub.id,{editVersion:1,config:{...config,enabled:true}},'test');
 const [row]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;
 assert.equal(row!.enabled,true);assert.ok(row!.next_run_at);assert.equal(row!.config.sourceId,undefined);
 const run=await startPlatformSubscription(sub.id,'test',tag());
 assert.equal(run.input.members[0]!.sourceId,null);assert.equal((await sql.begin(tx=>lockRun(tx,run.id))).eligible.length,1);
});
test('legacy config cannot buy; one-time association stops old run without rewriting frozen authority',async()=>{
 const id=await source(),payload=input(id),sub=await createPlatformSubscription(payload,'test',tag()),run=await startPlatformSubscription(sub.id,'test',tag());
 await sql`UPDATE collection_subscriptions SET config=config-'sourceId' WHERE id=${sub.id}`;
 await sql`UPDATE operation_runs SET input=jsonb_set(jsonb_set(input,'{members,0,sourceId}','null'),'{members,0,sourceExecutionVersion}','null') WHERE id=${run.id}`;
 let sends=0;await assert.rejects(paidRequest({service:'ownership-test',purpose:'test',identity:tag()},async()=>{sends++;return {response:{}};},receiptOptions(execution(run))));assert.equal(sends,0);
 await updatePlatformSubscription(sub.id,{editVersion:1,config:payload},'test');
 const [old]=await sql`SELECT * FROM operation_runs WHERE id=${run.id}`;assert.equal(old!.status,'stopped');assert.equal(old!.input.members[0].sourceId,null);
 await assert.rejects(sql.begin(tx=>resumeRun(tx,execution(old as never))));
 assert.equal(await sql.begin(tx=>importSource(tx,old!.input.members)),null);
 assert.equal((await sql.begin(tx=>importSource(tx,old!.input.members,id)))!.id,id);
 const fresh=await startPlatformSubscription(sub.id,'test',tag());assert.equal(fresh.input.members[0]!.sourceId,id);
});
test('provider switch preserves owner and source disabling fences every attached run and recovery',async()=>{
 const id=await source(),payload=input(id),sub=await createPlatformSubscription(payload,'test',tag()),other=await createPlatformSubscription(input(id),'test',tag());
 const old=await startPlatformSubscription(sub.id,'test',tag());process.env.AGENTKEY_API_KEY='synthetic';
 try{await switchPlatformSubscriptionProvider(sub.id,{editVersion:1,targetProvider:'agentkey',reason:'Synthetic switch'},'test');}finally{delete process.env.AGENTKEY_API_KEY;}
 const run=await startPlatformSubscription(sub.id,'test',tag()),second=await startPlatformSubscription(other.id,'test',tag());assert.equal(run.input.members[0]!.sourceId,id);
 const [src]=await sql`SELECT updated_at FROM sources WHERE id=${id}`;
 await updateSource(id,{patch:{enabled:false},version:src!.updated_at.toISOString()},'test');
 for(const r of [old,run,second]){assert.equal((await sql.begin(tx=>lockRun(tx,r.id))).eligible.length,0);await assert.rejects(sql.begin(tx=>resumeRun(tx,execution(r))));}
 const occupied=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id IN ${sql([sub.id,other.id])}`;assert.ok(occupied.every(s=>s.active_run_id===null));
});
test('deletion rejects references before side effects and serializes new association',async()=>{
 const id=await source();await createPlatformSubscription(input(id),'test',tag());let destructive=false;
 await assert.rejects(sql.begin(async tx=>{await lockSourceDeletion(tx,[id]);destructive=true;await tx`DELETE FROM sources WHERE id=${id}`;}),/referenced/);assert.equal(destructive,false);
 const fresh=await source(),locked=gate(),release=gate();
 const deleting=sql.begin(async tx=>{await lockSourceDeletion(tx,[fresh]);locked.open();await release.promise;await tx`DELETE FROM sources WHERE id=${fresh}`;});
 await locked.promise;let settled=false;const creating=createPlatformSubscription(input(fresh),'test',tag()).finally(()=>{settled=true;});
 // The deleting transaction holds the actual row lock; a concurrent SHARE must wait.
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(settled,false);release.open();await deleting;await assert.rejects(creating,/not found/);
});

test('actual delete entry refuses references before withdrawal or report pruning',async()=>{
 const id=await source(),article=newArticleId(),key=tag();await createPlatformSubscription(input(id),'test',tag());
 await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES (${article},${id},${key},${'https://example.com/'+key},'Synthetic',now(),now())`;
 await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,selected_ready_at) VALUES (${article},'Synthetic',${id},'news',${'https://example.com/'+key},now(),now(),now(),now())`;
 const content={items:[{itemId:article}]};await sql`INSERT INTO reports(kind,key,window_start,window_end,content,generated_at) VALUES ('daily',${key},now()-interval '1 day',now(),${sql.json(content)},now())`;
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/delete-sources.ts','Synthetic rejection',id],{timeout:10000}),/referenced/);
 assert.equal((await sql`SELECT visibility FROM publications WHERE article_id=${article}`)[0]!.visibility,'public');
 assert.deepEqual((await sql`SELECT content FROM reports WHERE key=${key}`)[0]!.content,content);
 assert.equal((await sql`SELECT * FROM editorial_overrides WHERE article_id=${article}`).length,0);
});
test('unreferenced deletion can finish publication and report cleanup under its source lock',async()=>{
 const id=await source(),article=newArticleId(),key=tag();
 await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES (${article},${id},${key},${'https://example.com/'+key},'Synthetic',now(),now())`;
 await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,selected_ready_at) VALUES (${article},'Synthetic',${id},'news',${'https://example.com/'+key},now(),now(),now(),now())`;
 await sql`INSERT INTO reports(kind,key,window_start,window_end,content,generated_at) VALUES ('daily',${key},now()-interval '1 day',now(),${sql.json({items:[{itemId:article}]})},now())`;
 await promisify(execFile)(process.execPath,['scripts/delete-sources.ts','Synthetic allowed deletion',id],{timeout:10000});
 assert.equal((await sql`SELECT id FROM sources WHERE id=${id}`).length,0);
 assert.deepEqual((await sql`SELECT content FROM reports WHERE key=${key}`)[0]!.content,{items:[]});
});

test('one hundred legacy unowned subscriptions cannot starve owned content or unowned research',async()=>{
 const id=await source(),payload=input(id),a=await createPlatformSubscription(payload,'test',tag()),research=await createPlatformSubscription({name:tag(),operationId:'UAQ90A1F',parameters:{},enabled:true},'test',tag());
 const legacy=await sql`INSERT INTO collection_subscriptions(provider,platform,operation_key,contract_version,config,interval_minutes,enabled,next_run_at) SELECT 'redfox','douyin','redfox.platform.collection',1,${sql.json({name:tag(),operationId:'OWIBYU1V',parameters:{keyword:'synthetic'}})},15,true,'2000-01-01' FROM generate_series(1,100) RETURNING id`;
 await sql`UPDATE collection_subscriptions SET next_run_at='2000-01-02' WHERE id IN ${sql([a.id,research.id])}`;
 process.env.COLLECT_ENABLED='true';process.env.REDFOX_CALLS_ENABLED='true';
 try{await schedulePlatformSubscriptions();}finally{process.env.COLLECT_ENABLED='false';process.env.REDFOX_CALLS_ENABLED='false';await sql`UPDATE collection_subscriptions SET next_run_at=NULL WHERE id IN ${sql(legacy.map(row=>row.id))}`;}
 const rows=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id IN ${sql([a.id,research.id])}`;assert.ok(rows.every(row=>row.active_run_id));
 assert.ok((await sql`SELECT active_run_id FROM collection_subscriptions WHERE id IN ${sql(legacy.map(row=>row.id))}`).every(row=>row.active_run_id===null));
});
test('import source honors only the frozen main subscription force command',async()=>{
 const id=await source();await sql`UPDATE sources SET enabled=false WHERE id=${id}`;
 const sub=await sql.begin(tx=>createSubscription(tx,{sourceId:id,provider:'dajiala',platform:'wechat',operationKey:'synthetic.force',contractVersion:1,config:{},intervalMinutes:15,enabled:false}));
 const run=await sql.begin(tx=>createRun(tx,{actor:'test',commandKey:tag(),provider:'dajiala',operationKey:'synthetic.force',contractVersion:1,input:{},stepKey:'synthetic',subscriptionIds:[sub],forceSourceId:id}));
 assert.equal(await sql.begin(tx=>importSource(tx,run.input.members)),null);
 assert.equal((await sql.begin(tx=>importSource(tx,run.input.members,undefined,run.input.forceSourceId)))!.id,id);
 const independent=await createPlatformSubscription(input(id),'test',tag());
 const [snapshot]=await sql`SELECT execution_version FROM collection_subscriptions WHERE id=${independent.id}`;
 assert.equal(await sql.begin(tx=>importSource(tx,[{subscriptionId:independent.id,executionVersion:snapshot!.execution_version,sourceId:id,sourceExecutionVersion:1}],undefined,id)),null);
});

test('completed query results and account bindings reject source deletion before any side effects',async()=>{
 for(const kind of ['binding','result-source','result-article']){
  const id=await source(),article=newArticleId(),key=tag();
  await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES (${article},${id},${key},${'https://example.com/'+key},'Synthetic',now(),now())`;
  await sql`INSERT INTO publications(article_id,title,source_id,channel,url,discovered_at,timeline_at,sort_at,selected_ready_at) VALUES (${article},'Synthetic',${id},'news',${'https://example.com/'+key},now(),now(),now(),now())`;
  const content={items:[{itemId:article}]};await sql`INSERT INTO reports(kind,key,window_start,window_end,content,generated_at) VALUES ('daily',${key},now()-interval '1 day',now(),${sql.json(content)},now())`;
  if(kind==='binding')await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('douyin','uid',${key},${id},'{}')`;
  else{
   const run=await sql.begin(tx=>createRun(tx,{actor:'test',commandKey:tag(),provider:'redfox',operationKey:'synthetic.query',contractVersion:1,input:{},stepKey:'synthetic'}));
   await sql`UPDATE operation_runs SET status='completed' WHERE id=${run.id}`;
   await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,source_id,article_id) VALUES (${run.id},1,'item','synthetic',${kind==='result-source'?id:null},${kind==='result-article'?article:null})`;
  }
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/delete-sources.ts','Synthetic reference rejection',id],{timeout:10000}),/referenced/);
  assert.equal((await sql`SELECT visibility FROM publications WHERE article_id=${article}`)[0]!.visibility,'public');
  assert.deepEqual((await sql`SELECT content FROM reports WHERE key=${key}`)[0]!.content,content);
  assert.equal((await sql`SELECT * FROM editorial_overrides WHERE article_id=${article}`).length,0);
 }
});

test('same-provider work origin chains reuse original frozen members without query occupancy',async()=>{
 const {inheritedSourceMembers}=await import('@aihot/backend/sources/subscriptions'),owner=await source(),other=await source(),sub=await createPlatformSubscription(input(owner),'test',tag()),root=await startPlatformSubscription(sub.id,'test',tag());
 const [first]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES (${root.id},1,'origin','wechat_work','{}') RETURNING id`;
 const middle=await sql.begin(tx=>createRun(tx,{actor:'test',commandKey:tag(),provider:'redfox',operationKey:'synthetic.query',contractVersion:1,stepKey:'synthetic',input:{mode:'query',origin:{resultId:first!.id}}}));
 const [second]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data) VALUES (${middle.id},1,'origin','wechat_work','{}') RETURNING id`;
 const child=await sql.begin(tx=>createRun(tx,{actor:'test',commandKey:tag(),provider:'redfox',operationKey:'synthetic.query',contractVersion:1,stepKey:'synthetic',input:{mode:'query',origin:{resultId:second!.id}}}));
 const inherited=await inheritedSourceMembers(sql,child.input,'redfox',child.id);assert.deepEqual(inherited!.members,root.input.members);assert.equal((await sql`SELECT subscription_id FROM operation_runs WHERE id=${child.id}`)[0]!.subscription_id,null);assert.deepEqual(child.input.members,[]);
 assert.equal((await sql.begin(tx=>importSource(tx,[],undefined,null,{resultId:second!.id,provider:'redfox',runId:child.id})))!.id,owner);
 assert.equal(await sql.begin(tx=>importSource(tx,[],other,null,{resultId:second!.id,provider:'redfox',runId:child.id})),null);
 assert.equal(await inheritedSourceMembers(sql,child.input,'agentkey',child.id),null);
 await sql`UPDATE sources SET execution_version=execution_version+1 WHERE id=${owner}`;
 assert.equal(await sql.begin(tx=>importSource(tx,[],undefined,null,{resultId:second!.id,provider:'redfox',runId:child.id})),null);
});

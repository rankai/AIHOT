import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {agentKeyWechatOperations,wechatArticlesRoute,wechatDetailRoute,wechatProfileRoute,wechatCommentsRoute,wechatRepliesRoute,wechatStatsRoute} from '@aihot/backend/providers/agentkey/wechat-contract';
import {parseAgentKeyWechat} from '@aihot/backend/providers/agentkey/wechat-parser';
import {agentKeyRouteFor} from '@aihot/backend/providers/agentkey/routes';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {importWechatResult} from '@aihot/backend/providers/redfox/import-wechat';
import {sql,closeDb} from '@aihot/backend/db';
import {expireOperationResults} from '@aihot/backend/operations/result-retention';
import {createNativeSubscription} from '@aihot/backend/sources/native-migration';
import {preflightMpReplacement,switchMpCollection} from '@aihot/backend/sources/mp-replacement';
import {createAgentKeyMpCollection} from '@aihot/backend/sources/mp-commands';
import {createCollection} from '@aihot/backend/sources/collection-commands';
import {scheduleNativeCollections} from '@aihot/backend/sources/native-scheduling';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {stub,tag,assertConfiguredTestDatabase,gate} from './setup.ts';
const short='https://mp.weixin.qq.com/s/testShort',long='https://mp.weixin.qq.com/s?__biz=abc%3D%3D&mid=9007199254740993123&idx=1';
const detail={url:short,content:{title:'Article',user_name:'gh_test',link:long,mid:'9007199254740993123',idx:1,_content_type:'article',content_noencode:'<p>Full article</p>',create_timestamp:1729400000}};
const wrap=(data:unknown)=>({envelope:{provider:'TikHub',data:{code:200,data}}});
let budgets:any[]=[];
before(async()=>{budgets=await sql`SELECT * FROM budgets WHERE service IN ('agentkey.query','agentkey.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('agentkey.query','agentkey.collect')`;});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
test('six strict MP schemas preserve opaque cursor and typed IDs, reject raw/implicit reply/related route',()=>{
 assert.equal(agentKeyWechatOperations.length,6);
 const list=agentKeyWechatOperations[0].schema.parse({username:'custom_id',offset:'a+/='});assert.equal(list.offset,'a+/=');assert.equal(list.raw,false);
 for(const op of agentKeyWechatOperations)assert.throws(()=>op.schema.parse({username:'gh_a',url:short,raw:true}));
 assert.throws(()=>agentKeyWechatOperations[4].schema.parse({url:short}));
 assert.throws(()=>agentKeyWechatOperations[4].schema.parse({url:short,content_id:123}));
 assert.equal(agentKeyRouteFor({provider:'agentkey',contract_version:1,operation_key:'agentkey.wechat_mp.related_articles',step_key:'agentkey.wechat_mp.related_articles.query',input:{mode:'query'}}),undefined);
});
test('documented six result shapes and empty pages; null/error never empty',()=>{
 const cases=[
  [wechatArticlesRoute,{username:'gh_test'},{biz_username:'gh_test',is_end:1,count:0,next_offset:null,articles:[]}],
  [wechatDetailRoute,{url:short},detail],
  [wechatProfileRoute,{username:'gh_test'},{user_name:'gh_test',nick_name:null,head_url:null,signature:null}],
  [wechatCommentsRoute,{url:short},{appmsgid:'1',comment_id:'2',buffer:'',has_more:false,comments:[]}],
  [wechatRepliesRoute,{url:short,content_id:'99'},{content_id:'99',offset:0,next_offset:0,has_more:false,count:0,replies:[]}],
  [wechatStatsRoute,{url:short},{comment_count:0,elected_comment_count:0}],
 ] as const;
 for(const [route,input,body] of cases){assert.doesNotThrow(()=>parseAgentKeyWechat(wrap(body),route,input));assert.throws(()=>parseAgentKeyWechat(wrap(null),route,input));assert.throws(()=>parseAgentKeyWechat(wrap({...body,errcode:401}),route,input));}
 assert.throws(()=>parseAgentKeyWechat(wrap({content_id:'88',offset:0,next_offset:0,has_more:false,count:0,replies:[]}),wechatRepliesRoute,{url:short,content_id:'99'}));
 const stats=parseAgentKeyWechat(wrap({comment_count:0,elected_comment_count:0}),wechatStatsRoute,{url:short});assert.equal((stats.candidates[0]!.data.record as any).read_num,null);
});
test('H5 optional alias proof does not block Q; body type and seconds retain honest completeness',()=>{
 const parsed=parseAgentKeyWechat(wrap(detail),wechatDetailRoute,{url:short}).candidates[0]!;assert.equal(parsed.data.aliasConfirmed,true);assert.equal((parsed.data.record as any).articleContent,'<p>Full article</p>');
 const sparse={...detail,content:{...detail.content,link:undefined,mid:undefined,idx:undefined,_content_type:'unknown'}};
 const item=parseAgentKeyWechat(wrap(sparse),wechatDetailRoute,{url:short}).candidates[0]!;assert.equal(item.data.aliasConfirmed,false);assert.equal((item.data.record as any).articleContent,null);
 assert.throws(()=>parseAgentKeyWechat(wrap({...detail,content:{...detail.content,mid:'42'}}),wechatDetailRoute,{url:short}));
 const app=parseAgentKeyWechat(wrap({user_name:'gh_test@app'}),wechatProfileRoute,{username:'gh_test@app'});assert.equal((app.candidates[0]!.data.identity as any).wxId,'gh_test@app');
 const custom=parseAgentKeyWechat(wrap({user_name:'custom'}),wechatProfileRoute,{username:'custom'});assert.deepEqual(custom.candidates[0]!.data.identity,{});
});
async function mcp(body:unknown){return stub(async (_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:1.75,data:{code:200,data:typeof body==='function'?await body(q.params?.arguments):body}}}};});}
test('MP Q persists receipt/summary, explicit import re-verifies evidence and keeps source isolated',async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 const marker=tag(),username=`gh_${marker}`,testShort=`https://mp.weixin.qq.com/s/${marker}`,testLong=`https://mp.weixin.qq.com/s?__biz=${marker}&mid=9007199254740993123&idx=1`,server=await mcp({...detail,url:testShort,content:{...detail.content,link:testLong,user_name:username}});
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-mp-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',AIHOT_ENVIRONMENT:'test'});
 let runId:number|undefined,sourceId:string|undefined;
 try{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'I3CIBRI2',parameters:{url:testShort}},'mp-test',tag());runId=run.id;
  await executeOperationStep(run.id,1,randomUUID());
  const [state]=await sql`SELECT status,wait_reason FROM operation_runs WHERE id=${run.id}`;assert.equal(state!.status,'completed',JSON.stringify(state));
  const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='wechat_work'`;
  const imported=await importWechatResult(result!.id,{reason:'test'},'mp-test',tag());assert.ok(imported?.articleId);sourceId=imported.sourceId;
  const [source]=await sql`SELECT participation_mode,site_fulltext FROM sources WHERE id=${sourceId}`;assert.equal(source!.participation_mode,'isolated');assert.equal(source!.site_fulltext,false);
  const [receipt]=await sql`SELECT usage FROM receipts WHERE id=${result!.receipt_id}`;assert.ok(receipt);
  await sql`UPDATE operation_results SET data=jsonb_set(data,'{title}','"tampered"') WHERE id=${result!.id}`;
  await assert.rejects(importWechatResult(result!.id,{reason:'test'},'mp-test',tag()),/differs/);
 }finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
async function switchTo(id:string,target:'agentkey'|'dajiala'|'redfox'){
 const p=await preflightMpReplacement(id,target);assert.equal(p!.supported,true,JSON.stringify(p!.checks));
 return switchMpCollection(id,{target,sourceVersion:p!.sourceVersion,subscriptionVersion:p!.subscriptionVersion,mappingVersion:p!.mappingVersion,reason:'local test'},'mp-test');
}
test('source MP list → bounded same-run H5 preserves first import, rights, explicit switch and force',async()=>{
 const marker=tag(),username=`gh_${marker}`,sourceId=`mp-${marker}`;
 let calls=0,body='<p>Source body</p>',hold=false;const entered=gate(),release=gate();
 const items=Array.from({length:10},(_,i)=>({app_msg_id:String(i+1),idx:1,title:`MP ${i}`,digest:'excerpt only',url:`https://mp.weixin.qq.com/s/${marker}${i}`}));
 const server=await mcp(async (args:any)=>{
  calls++;if(hold){entered.open();await release.promise;}if(args.name.includes('account_profile'))return {user_name:username,nick_name:'Synthetic'};
  if(args.name.includes('account_articles'))return {biz_username:username,count:items.length,is_end:1,next_offset:null,articles:items};
  const index=items.findIndex(i=>i.url===args.params.url);assert.ok(index>=0);
  return {url:args.params.url,content:{title:items[index]!.title,user_name:username,link:`https://mp.weixin.qq.com/s?__biz=${marker}&mid=${index+1}&idx=1`,mid:String(index+1),idx:1,_content_type:'article',content_noencode:body,create_timestamp:1729400000}};
 });
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-mp',DAJIALA_KEY:'fake-native',REDFOX_API_KEY:'fake-redfox',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'true',AIHOT_ENVIRONMENT:'test'});
 try{
  const sub=await sql.begin(async tx=>{await tx`INSERT INTO sources(id,name,kind,config,interval_minutes,site_fulltext,syndicate_fulltext,participation_mode) VALUES (${sourceId},'MP test','mp_account',${tx.json({ghid:username})},73,true,false,'editorial')`;return createNativeSubscription(tx,sourceId);});
  const profile=await createAgentKeyQuery({provider:'agentkey',operationId:'KUQYSQNX',parameters:{username}},'mp-test',tag());await step(profile.id);
  const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${profile.id} AND kind='wechat_account'`;await importWechatResult(result!.id,{sourceId,reason:'received source identity'},'mp-test',tag());
  await sql`UPDATE operation_results SET expires_at=now()-interval '1 day' WHERE run_id=${profile.id}`;await expireOperationResults();
  const [profileSummary]=await sql`SELECT kind FROM operation_results WHERE run_id=${profile.id} AND item_key='query_summary'`;assert.equal(profileSummary!.kind,'query_summary');assert.equal((await preflightMpReplacement(sourceId,'agentkey'))!.supported,true);
  const listQuery=await createAgentKeyQuery({provider:'agentkey',operationId:'8IQD0BJC',parameters:{username}},'mp-test',tag());await step(listQuery.id);const [listItem]=await sql`SELECT id FROM operation_results WHERE run_id=${listQuery.id} AND item_key='work:0'`;const initial=await importWechatResult(listItem!.id,{sourceId,reason:'explicit list import'},'mp-test',tag());const [pendingBefore]=await sql`SELECT discovered_at,body_status FROM articles WHERE id=${initial!.articleId!}`;assert.equal(pendingBefore!.body_status,'pending');
  await switchTo(sourceId,'agentkey');
  await scheduleNativeCollections('mp_account');const [scheduled]=await sql`SELECT active_run_id FROM collection_subscriptions WHERE id=${sub}`;assert.ok(scheduled!.active_run_id);const run={id:scheduled!.active_run_id};let r=await step(run.id);assert.equal(r.step_key,wechatDetailRoute.stepKey);assert.equal(r.progress.detailItems.length,8);assert.equal(r.progress.retainedReceiptIds.length,1);
  const {claimRun}=await import('@aihot/backend/providers/operations/store');const {requestAgentKey}=await import('@aihot/backend/providers/agentkey/request');
  const held=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:r.step_version,generation:r.generation},randomUUID()));
  await requestAgentKey(held,r as unknown as import('@aihot/backend/providers/operations/store').RunRow,wechatDetailRoute,r.progress.parameters);const beforeReplay=calls;process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';r=await step(run.id);assert.equal(calls,beforeReplay);assert.equal(r.status,'active',r.wait_reason);process.env.AGENTKEY_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';
  for(let i=0;i<7;i++)r=await step(run.id);
  assert.equal(r.status,'completed',r.wait_reason);assert.equal(calls,11);
  const articles=await sql`SELECT * FROM articles WHERE source_id=${sourceId}`;assert.equal(articles.length,8);assert.ok(articles.filter(a=>a.id!==initial!.articleId).every(a=>a.backfill&&a.backfill_reason==='first-import'&&a.body_status==='ok'));const enriched=articles.find(a=>a.id===initial!.articleId)!;assert.equal(enriched.body_status,'ok');assert.equal(enriched.discovered_at.toISOString(),pendingBefore!.discovered_at.toISOString());
  await sql`UPDATE operation_results SET expires_at=now()-interval '1 day' WHERE run_id=${run.id}`;await expireOperationResults();
  const [historicalDetail]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='wechat_work' AND step_version=2`;
  const repeated=await importWechatResult(historicalDetail!.id,{sourceId,reason:'retained original evidence'},'collector',`agentkey-mp:${historicalDetail!.id}`);assert.equal(repeated!.articleId,initial!.articleId);
  const [detailSummary]=await sql`SELECT * FROM operation_results WHERE id=${historicalDetail!.data.querySummaryId}`;assert.equal(detailSummary!.kind,'query_summary');const [origin]=await sql`SELECT * FROM operation_results WHERE id=${detailSummary!.data.originResultId}`;assert.equal(origin!.kind,'wechat_work');assert.equal((await sql`SELECT kind FROM operation_results WHERE id=${origin!.data.querySummaryId}`)[0]!.kind,'query_summary');
  const [saved]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub}`;assert.ok(saved!.progress.lastCheckedAt);assert.equal(saved!.interval_minutes,73);
  await switchTo(sourceId,'redfox');assert.equal((await sql`SELECT config FROM collection_subscriptions WHERE id=${sub}`)[0]!.config.redfoxLibrary,'wide');await switchTo(sourceId,'agentkey');assert.equal((await sql`SELECT config FROM collection_subscriptions WHERE id=${sub}`)[0]!.config.redfoxLibrary,undefined);await switchTo(sourceId,'dajiala');await switchTo(sourceId,'agentkey');const [restored]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub}`;assert.equal(restored!.progress.lastCheckedAt,saved!.progress.lastCheckedAt);
  const preview=await createAgentKeyMpCollection(sourceId,{actor:'mp-test',key:tag(),reason:'manual',preview:true});r=await step(preview.id);while(r.status==='active')r=await step(preview.id);assert.equal(r.status,'completed',r.wait_reason);assert.equal((await sql`SELECT id FROM articles WHERE source_id=${sourceId}`).length,8);
  await sql`UPDATE sources SET enabled=false WHERE id=${sourceId}`;await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub}`;
  await assert.rejects(createCollection(sourceId,{actor:'mp-test',key:tag(),reason:'manual'}),/disabled/i);
  body='';const forced=await createCollection(sourceId,{actor:'mp-test',key:tag(),reason:'manual',force:true});r=await step(forced.id);while(r.status==='active')r=await step(forced.id);assert.equal(r.status,'completed',r.wait_reason);
  assert.equal((await sql`SELECT id FROM articles WHERE source_id=${sourceId}`).length,10);
  const pending=await sql`SELECT id,body_status,raw FROM articles WHERE source_id=${sourceId} AND body_status='none'`;assert.equal(pending.length,2);assert.ok(pending.every(a=>a.raw.agentkeyMp.bodyRetry.attempts===1));await sql`UPDATE articles SET discovered_at=now()-interval '4 days' WHERE id=${pending[0]!.id}`;
  for(let retry=0;retry<2;retry++){const attempt=await createCollection(sourceId,{actor:'mp-test',key:tag(),reason:'manual',force:true});r=await step(attempt.id);while(r.status==='active')r=await step(attempt.id);assert.equal(r.status,'completed',r.wait_reason);}
  const [expired]=await sql`SELECT raw FROM articles WHERE id=${pending[0]!.id}`;assert.equal(expired!.raw.agentkeyMp.bodyRetry.attempts,1);
  const beforeStopped=calls,stopped=await createCollection(sourceId,{actor:'mp-test',key:tag(),reason:'manual',force:true});r=await step(stopped.id);assert.equal(r.status,'completed');assert.equal(calls,beforeStopped+1);
  const late=await createCollection(sourceId,{actor:'mp-test',key:tag(),reason:'manual',force:true});hold=true;const response=step(late.id);await entered.promise;await switchTo(sourceId,'dajiala');release.open();await response;hold=false;
  const [lateRun]=await sql`SELECT * FROM operation_runs WHERE id=${late.id}`;const [lateReceipt]=await sql`SELECT status,usage FROM receipts WHERE id=${lateRun!.current_receipt_id}`;assert.equal(lateReceipt!.status,'received');assert.equal(lateReceipt!.usage.chargedCredits,1.75);assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${late.id}`).length,0);
  const [source]=await sql`SELECT site_fulltext,syndicate_fulltext,participation_mode FROM sources WHERE id=${sourceId}`;assert.equal(source!.site_fulltext,true);assert.equal(source!.syndicate_fulltext,false);assert.equal(source!.participation_mode,'editorial');
 }finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await sql`UPDATE collection_subscriptions SET enabled=false WHERE control_source_id=${sourceId}`;}
});
test('unknown fields cannot inject list body or timestamp, and short URL contradiction is rejected',()=>{
 const item=parseAgentKeyWechat(wrap({biz_username:'gh_test',is_end:1,count:1,next_offset:null,articles:[{app_msg_id:'1',idx:1,title:'safe',url:short,digest:'excerpt',articleContent:'<p>injected</p>',content:'injected',publishDate:'2026-10-22T00:00:00Z'}]}),wechatArticlesRoute,{username:'gh_test'}).candidates[0]!;
 const record=item.data.record as Record<string,unknown>;assert.equal(record.articleContent,undefined);assert.equal(record.content,undefined);assert.equal(record.publishDate,undefined);assert.equal(item.data.publishedAt,null);
 const unknown=parseAgentKeyWechat(wrap({...detail,content:{...detail.content,_content_type:'unknown',content:'injected',publishDate:'2026-10-22T00:00:00Z'}}),wechatDetailRoute,{url:short}).candidates[0]!;
 assert.equal((unknown.data.record as any).articleContent,null);assert.equal((unknown.data.record as any).content,undefined);assert.notEqual((unknown.data.record as any).publishDate,'2026-10-22T00:00:00Z');
 assert.throws(()=>parseAgentKeyWechat(wrap({...detail,url:'https://mp.weixin.qq.com/s/another'}),wechatDetailRoute,{url:short}),/differs/);
 assert.throws(()=>parseAgentKeyWechat(wrap({...detail,content:{...detail.content,link:'https://mp.weixin.qq.com/s/another'}}),wechatDetailRoute,{url:short}),/short URL disagrees/);
});
test('retained MP receipt is consumed with both valves off without another paid call',async()=>{
 const {claimRun}=await import('@aihot/backend/providers/operations/store');const {requestAgentKey}=await import('@aihot/backend/providers/agentkey/request');
 const marker=tag(),server=await mcp({comment_count:3,elected_comment_count:2}),previous={...process.env};
 Object.assign(process.env,{AGENTKEY_API_KEY:'fake-mp',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'true'});
 try{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'wechat.article_stats',parameters:{url:short}},'mp-test',tag());
  const e=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:1,generation:run.generation},randomUUID()));
  await requestAgentKey(e,run,wechatStatsRoute,{url:short,raw:false});const before=server.hits();process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
  const r=await step(run.id);assert.equal(r.status,'completed',r.wait_reason);assert.equal(server.hits(),before);
  const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='wechat_stats'`;await assert.rejects(importWechatResult(result!.id,{reason:'research'},'mp-test',tag()),/cannot be imported/);
  const [receipt]=await sql`SELECT usage,status FROM receipts WHERE id=${result!.receipt_id}`;assert.equal(receipt!.usage.chargedCredits,1.75);assert.equal(receipt!.status,'completed');
 }finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
test('WeChat alias locks preserve legacy owner, source and discovery; conflicts reject two owners',async()=>{
 const {upsertMaterial}=await import('@aihot/backend/content/materials');const {bindSourceAccount}=await import('@aihot/backend/sources/account-bindings');
 const token=tag(),source=`alias-mp-${token}`,other=`alias-other-${token}`,s=`https://mp.weixin.qq.com/s/${token}`,l=`https://mp.weixin.qq.com/s?__biz=${token}&mid=123&idx=1`,discovered=new Date('2020-01-01T00:00:00Z');
 await sql`INSERT INTO sources(id,name,kind) VALUES (${source},'Alias source','external'),(${other},'Other source','external')`;
 await sql.begin(tx=>bindSourceAccount(tx,{platform:'wechat',idKind:'bizInfo',idValue:token,sourceId:source,evidence:{kind:'result',reference:'1'}}));
 const old=await upsertMaterial({sourceId:other,url:s,title:'Legacy',bodyText:'Original',discoveredAt:discovered,via:'fetch'});
 const confirmation={platform:'wechat' as const,requestedUrl:s,responseUrl:s,longUrl:l,bizInfo:token,mid:'123',idx:'1',sourceId:source,evidence:{kind:'result' as const,reference:'1'}};
 const next=await upsertMaterial({sourceId:source,url:l,title:'New',bodyText:'New',confirmedIdentity:confirmation,via:'import'});assert.equal(next.articleId,old.articleId);
 const [stored]=await sql`SELECT source_id,discovered_at,body_text,url FROM articles WHERE id=${old.articleId}`;assert.equal(stored!.source_id,other);assert.equal(stored!.discovered_at.toISOString(),discovered.toISOString());assert.equal(stored!.body_text,'Original');assert.equal(stored!.url,s);
 const duplicates=await Promise.all([upsertMaterial({sourceId:source,url:l,title:'Again',confirmedIdentity:confirmation,via:'import'}),upsertMaterial({sourceId:source,url:s,title:'Again',via:'import'})]);assert.ok(duplicates.every(x=>x.articleId===old.articleId));
 const s2=`https://mp.weixin.qq.com/s/${token}conflict`,l2=`https://mp.weixin.qq.com/s?__biz=${token}&mid=124&idx=1`;
 await upsertMaterial({sourceId:source,url:s2,title:'A',via:'fetch'});await upsertMaterial({sourceId:source,url:l2,title:'B',via:'fetch'});
 await assert.rejects(upsertMaterial({sourceId:source,url:l2,title:'C',via:'import',confirmedIdentity:{...confirmation,requestedUrl:s2,responseUrl:s2,longUrl:l2,mid:'124'}}),/different articles/);
});
test('MP unknown recovery requires exact route, waits thirty minutes and releases at most once',async()=>{
 const {claimRun,receiptOptions}=await import('@aihot/backend/providers/operations/store');const {paidRequest}=await import('@aihot/backend/providers/receipts');const {releaseOperationReceipt}=await import('@aihot/backend/providers/operations/recovery');
 const previous=process.env.AGENTKEY_CALLS_ENABLED;process.env.AGENTKEY_CALLS_ENABLED='true';
 try{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'wechat.comments',parameters:{url:short}},'mp-test',tag());let e=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:1,generation:run.generation},randomUUID()));
  const req={service:'agentkey.query',purpose:wechatCommentsRoute.operationKey,model:wechatCommentsRoute.tool,identity:tag(),estimatedUsage:{estimatedCredits:2}},unknown=async()=>{throw new Error('synthetic incomplete');};
  await assert.rejects(paidRequest(req,unknown,receiptOptions(e)),/synthetic/);const [current]=await sql`SELECT current_receipt_id FROM operation_runs WHERE id=${run.id}`;const id=current!.current_receipt_id;
  assert.equal((await releaseOperationReceipt(id)).released,false);await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${id}`;
  process.env.AGENTKEY_CALLS_ENABLED='false';assert.equal((await releaseOperationReceipt(id)).released,false);process.env.AGENTKEY_CALLS_ENABLED='true';
  await sql`UPDATE operation_runs SET step_key='agentkey.wechat_mp.related_articles.query' WHERE id=${run.id}`;assert.equal((await releaseOperationReceipt(id)).released,false);
  await sql`UPDATE operation_runs SET step_key=${wechatCommentsRoute.stepKey} WHERE id=${run.id}`;assert.equal((await releaseOperationReceipt(id)).released,true);
  const [resumed]=await sql`SELECT generation FROM operation_runs WHERE id=${run.id}`;e={...e,generation:resumed!.generation};await assert.rejects(paidRequest(req,unknown,receiptOptions(e)),/synthetic/);
  await sql`UPDATE receipts SET updated_at=now()-interval '31 minutes' WHERE id=${id}`;assert.equal((await releaseOperationReceipt(id)).released,false);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${id}`)[0]!.attempts,2);
 }finally{if(previous===undefined)delete process.env.AGENTKEY_CALLS_ENABLED;else process.env.AGENTKEY_CALLS_ENABLED=previous;}
});

test('H5 article source video is confirmed before sanitization and historical receipt repair stays offline',async()=>{
 const marker=tag(),url=`https://mp.weixin.qq.com/s/${marker}`,longUrl=`https://mp.weixin.qq.com/s?__biz=${marker}&mid=123&idx=1`;
 const server=await mcp({url,content:{title:'Article with video',user_name:`gh_${marker}`,link:longUrl,mid:'123',idx:1,_content_type:'article',content_noencode:'<p>Article body</p><video><source type="video/mp4" src="/v.mp4"></video>',create_timestamp:1729400000}});
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-mp-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',AIHOT_ENVIRONMENT:'test'});
 try{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'I3CIBRI2',parameters:{url}},'mp-video',tag());await executeOperationStep(run.id,1,randomUUID());
  const [result]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND kind='wechat_work'`;
  const imported=await importWechatResult(result!.id,{reason:'Verified body video'},'mp-video',tag());
  const [article]=await sql`SELECT media,body_html FROM articles WHERE id=${imported!.articleId}`;
  assert.equal(article!.media.some((m:any)=>m.confirmed===true),true);assert.equal(article!.body_html.includes('<source'),false);
  await sql`UPDATE articles SET media='[]'::jsonb WHERE id=${imported!.articleId}`;
  const {scanVideoHistory,applyVideoHistoryEntry,restoreVideoHistoryEntry}=await import('@aihot/backend/content/video-history');
  const before=server.hits();process.env.AGENTKEY_CALLS_ENABLED='false';
  const manifest=await sql.begin('read only',tx=>scanVideoHistory(tx,5000));const entry=manifest.entries.find(e=>e.articleId===imported!.articleId);assert.ok(entry);assert.equal(entry.evidence.kind,'result');
  const applied=await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));await sql.begin(tx=>restoreVideoHistoryEntry(tx,applied));assert.equal(server.hits(),before);
 }finally{await server.close();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});

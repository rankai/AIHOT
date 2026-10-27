import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {importXSearchResult} from '@aihot/backend/providers/redfox/import-x-search';
import {importXDetailResult} from '@aihot/backend/providers/redfox/import-x-detail';
import {importXAccountResult} from '@aihot/backend/providers/redfox/import-account';
import {parseAgentKeyX} from '@aihot/backend/providers/agentkey/x-parser';
import {agentKeyXWork} from '@aihot/backend/providers/agentkey/x-evidence';
import {xSearchRoute,xPostsRoute} from '@aihot/backend/providers/agentkey/x-contract';
import {upsertMaterial,isHistorical} from '@aihot/backend/content/materials';
import {extractArticleBody} from '@aihot/backend/content/extract';
import {tweetToCandidate} from '@aihot/backend/sources/x';
import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';
const id=()=>BigInt('0x'+randomUUID().replaceAll('-','').slice(0,20)).toString();
const author=(uid=id())=>({rest_id:uid,screen_name:'sample',name:'Sample'});
const tweet=(a=author())=>({tweet_id:id(),text:'Received text',created_at:new Date().toISOString(),author:a,lang:'en'});
const envelope=(body:unknown)=>({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data:body}}});
const chosenWorkSource=tag();
let budgets:any[]=[];
before(async()=>{await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${chosenWorkSource},'Chosen X source','rss','isolated',false)`;const [d]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(d!.name,d!.port);budgets=await sql`SELECT * FROM budgets WHERE service='agentkey.query'`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='agentkey.query'`;});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function query(operationId:string,parameters:unknown,body:unknown){
 let hits=0;const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};hits++;return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',data:{code:200,data:body}}}};});
 const old={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-x-import',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true'});
 try{const run=await createAgentKeyQuery({provider:'agentkey',operationId,parameters},'test',tag());await executeOperationStep(run.id,run.step_version,randomUUID());const [state]=await sql`SELECT * FROM operation_runs WHERE id=${run.id}`;assert.equal(state!.status,'completed',state!.wait_reason);assert.equal(hits,1);return await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind<>'query_summary' ORDER BY id`;}
 finally{await server.close();for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
}
async function search(t:any){return (await query('5K5EG87P',{keyword:'test'},{timeline:[{...t,author:undefined,user_info:t.author,type:'tweet'}]}))[0]!;}
async function source(uid:string,mode='isolated',kind='x_search',handle='sample',bind=true){const sid=tag();await sql`INSERT INTO sources(id,name,kind,config,participation_mode,site_fulltext,enabled) VALUES(${sid},'Synthetic',${kind},${sql.json({query:`from:${handle} -filter:replies`})},${mode},false,true)`;if(bind)await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES('x','user_id',${uid},${sid},'{"kind":"audit","reference":"synthetic"}')`;return sid;}
const importWork=(r:any,key=tag(),sourceId=chosenWorkSource)=>(r.kind==='x_detail_work'?importXDetailResult:importXSearchResult)(r.id,{sourceId,reason:'verified synthetic'},'test',key);
const article=async(id:string)=>(await sql`SELECT * FROM articles WHERE id=${id}`)[0]!;
test('five eligible producers, pinned and actual context reuse the sole writer with honest pending text and original discovery',async()=>{
 for(const producer of ['search','account_posts','list_posts','community_posts','detail']){
  const t=tweet();let rows:any[];
  if(producer==='search')rows=[await search(t)];
  else if(producer==='detail')rows=await query('x.detail',{tweet_id:t.tweet_id},{...t,tweet_id:undefined,id:t.tweet_id,display_text:'Different display text',in_reply_to_status_id_str:null});
  else if(producer==='account_posts')rows=await query('x.account_posts',{screen_name:'sample'},{user:{profile:'sample',rest_id:t.author.rest_id},pinned:t,timeline:[{...tweet(t.author),author:{...t.author,screen_name:null}}]});
  else rows=await query(`x.${producer}`,producer==='list_posts'?{list_id:'1'}:{community_id:'2'},{timeline:[t]});
  for(const r of rows){const key=tag(),got=await importWork(r,key);assert.deepEqual(await importWork(r,key),got);const a=await article(got!.articleId),[receipt]=await sql`SELECT received_at FROM receipts WHERE id=${r.receipt_id}`,[s]=await sql`SELECT * FROM sources WHERE id=${got!.sourceId}`;
   assert.equal(a.raw.provider,'agentkey');assert.equal(a.raw.receivedText,'Received text');assert.equal(a.body_text,null);assert.equal(a.body_status,'pending');assert.equal(a.excerpt,'Received text');assert.equal(a.x_post.text,'Received text');assert.equal(a.x_post.handle,'sample');assert.equal(a.x_post.replyTo,producer==='detail'?null:undefined);assert.equal(+a.discovered_at,+receipt!.received_at);assert.equal(s!.participation_mode,'isolated');assert.equal(s!.site_fulltext,false);
   const audits=await sql`SELECT id FROM audit_log WHERE action='material.import' AND subject=${`result:${r.id}`}`;assert.equal(audits.length,1);assert.ok((await sql`SELECT id FROM pgboss.job WHERE data->>'articleId'=${a.id}`).length>0);
  }
 }
});
test('unknown, invalid and zone-less dates stay historical with null publication time',async()=>{
 for(const created_at of [undefined,'invalid','2026-10-23T12:00:00']){const r=await search({...tweet(),created_at}),got=await importWork(r),a=await article(got!.articleId);assert.equal(a.published_at,null);assert.equal(a.backfill,true);assert.equal(isHistorical({backfill:a.backfill,published_at:a.published_at,discovered_at:a.discovered_at}),true);assert.equal(a.body_status,'pending');}
});
test('quotes retain their own author and text; partial, retweet, limited roles and missing identities remain research',async()=>{
 const t=tweet(),q={...tweet(),text:'Quoted text',author:{...author(),screen_name:'quoted'}};
 const r=await search({...t,quoted:q}),got=await importWork(r),a=await article(got!.articleId);assert.deepEqual(a.x_post.quoted,{authorName:'Sample',handle:'quoted',text:'Quoted text',url:`https://x.com/quoted/status/${q.tweet_id}`});
 for(const invalid of [{...tweet(),author:{rest_id:id(),screen_name:null}},{...tweet(),tweet_id:undefined},{...tweet(),tweet_id:'1'.repeat(31)},{...tweet(),text:''},{...tweet(),quoted:{...q,author:{...q.author,screen_name:null}}}]){const r=await search(invalid);await assert.rejects(importWork(r));assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r.id}`)[0]!.article_id,null);}
 const wrapped={...tweet(),retweeted:{id:q.tweet_id},retweeted_tweet:q};const [wrapper]=await query('x.account_posts',{screen_name:'sample'},{timeline:[wrapped]});await assert.rejects(importWork(wrapper),/role/);
 const [limited]=await query('x.list_posts',{list_id:'1'},{timeline:[{...tweet(),quoted:q}]});await assert.rejects(importWork(limited),/role/);
 const [standalone]=await query('x.list_posts',{list_id:'1'},{timeline:[{...tweet(),retweeted:{id:q.tweet_id}}]});await assert.rejects(importWork(standalone),/role/);
 const partial=parseAgentKeyX(envelope({timeline:[{text:'Useful research',type:'tweet'}]}),xSearchRoute,{keyword:'test'});assert.equal(partial.candidates.length,1);assert.throws(()=>agentKeyXWork(partial.candidates[0]!));
 const context=parseAgentKeyX(envelope({user:{profile:'sample',rest_id:'1'},timeline:[{...tweet(),author:{rest_id:'1',screen_name:null}}]}),xPostsRoute,{screen_name:'sample'});assert.equal(agentKeyXWork(context.candidates[0]!).user.username,'sample');
});
test('original receipt, frozen input, summary and candidate tampering or expiry reject before writes',async()=>{
 const r=await search(tweet()),[run]=await sql`SELECT * FROM operation_runs WHERE id=${r.run_id}`,[receipt]=await sql`SELECT * FROM receipts WHERE id=${r.receipt_id}`,[summary]=await sql`SELECT * FROM operation_results WHERE id=${r.data.querySummaryId}`;
 const bad=async()=>{await assert.rejects(importWork(r));assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r.id}`)[0]!.article_id,null);};
 for(const data of [{...r.data,record:{...r.data.record,text:'forged'}},{...r.data,tweetId:'9'},{...r.data,querySummaryId:r.id}]){await sql`UPDATE operation_results SET data=${sql.json(data)} WHERE id=${r.id}`;await bad();}await sql`UPDATE operation_results SET data=${sql.json(r.data)} WHERE id=${r.id}`;
 await sql`UPDATE operation_results SET data=${sql.json({...summary!.data,receivedScope:{rest_id:'forged'}})} WHERE id=${summary!.id}`;await bad();await sql`UPDATE operation_results SET data=${sql.json(summary!.data)} WHERE id=${summary!.id}`;
 for(const input of [{...run!.input,origin:{discoveredAt:new Date().toISOString()}},{...run!.input,parameters:{keyword:'changed',search_type:'Top'}},{...run!.input,mode:'collection'}]){await sql`UPDATE operation_runs SET input=${sql.json(input)} WHERE id=${run!.id}`;await bad();}await sql`UPDATE operation_runs SET input=${sql.json(run!.input)} WHERE id=${run!.id}`;
 await sql`UPDATE receipts SET request=${sql.json({...receipt!.request,params:{keyword:'forged'}})} WHERE id=${receipt!.id}`;await bad();await sql`UPDATE receipts SET request=${sql.json(receipt!.request)} WHERE id=${receipt!.id}`;
 await sql`UPDATE operation_results SET kind='result_expired' WHERE id=${r.id}`;await bad();await sql`UPDATE operation_results SET kind=${r.kind} WHERE id=${r.id}`;
 // Eligibility copy is advisory; original fields still decide import.
 await sql`UPDATE operation_results SET data=${sql.json({...r.data,importable:true,missing:[]})} WHERE id=${r.id}`;assert.ok(await importWork(r));
});
test('disabled bound sources, explicit target conflicts and Article requirements keep existing permissions',async()=>{
 const t=tweet(),sid=await source(t.author.rest_id,'editorial');await sql`UPDATE sources SET enabled=false WHERE id=${sid}`;const r=await search(t);await assert.rejects(importWork(r,tag(),sid),/disabled/);await sql`UPDATE sources SET enabled=true WHERE id=${sid}`;
 await assert.rejects(importXSearchResult(r.id,{reason:'wrong',sourceId:tag()},'test',tag()),/associated source/);
 const ar=await search({...tweet(t.author),text:'Article https://x.com/i/article/123'});await assert.rejects(importWork(ar,tag(),sid),/Article/);
 const got=await importWork(r,tag(),sid),[s]=await sql`SELECT * FROM sources WHERE id=${got!.sourceId}`;assert.equal(got!.sourceId,sid);assert.equal(s!.participation_mode,'editorial');assert.equal(s!.site_fulltext,false);
});
test('canonical native URL and existing Redfox identity deduplicate without overwriting complete body',async()=>{
 const t=tweet(),sid=await source(t.author.rest_id),old=await upsertMaterial({sourceId:sid,via:'import',url:`https://twitter.com/sample/status/${t.tweet_id}`,title:'Existing',bodyText:'Complete existing body',bodyStatus:'ok',raw:{provider:'redfox'}}),r=await search(t),got=await importWork(r);assert.equal(got!.articleId,old.articleId);const a=await article(got!.articleId);assert.equal(a.identity_key,`x:${t.tweet_id}`);assert.equal(a.body_text,'Complete existing body');assert.equal(a.raw.provider,'redfox');
});
test('profile only binds matching existing single-account X source and rejects mapping conflicts',async()=>{
 const uid=id(),sid=await source(uid,'isolated','x_search','sample',false),[r]=await query('x.account_profile',{screen_name:'sample'},{profile:'sample',rest_id:uid,id:uid,name:'Sample'}),key=tag();
 assert.deepEqual(await importXAccountResult(r!.id,{sourceId:sid,reason:'verified'},'test',key),{resultId:r!.id,sourceId:sid,userId:uid});assert.deepEqual(await importXAccountResult(r!.id,{sourceId:sid,reason:'verified'},'test',key),{resultId:r!.id,sourceId:sid,userId:uid});
 for(const target of [await source(id(),'isolated','external','sample',false),await source(id(),'isolated','x_search','other',false),await source(id())]){const [other]=await query('x.account_profile',{screen_name:'sample'},{profile:'sample',rest_id:id()});await assert.rejects(importXAccountResult(other!.id,{sourceId:target,reason:'bad'},'test',tag()));}
 const target=await source(id(),'isolated','x_search','sample',false),[same]=await query('x.account_profile',{screen_name:'sample'},{profile:'sample',rest_id:uid});await assert.rejects(importXAccountResult(same!.id,{sourceId:target,reason:'conflict'},'test',tag()),/conflict/);
});
test('transaction rollback removes material, author binding, result association, queue and audit together',async()=>{
 const t=tweet(),r=await search(t);let aid='';await assert.rejects(sql.begin(async tx=>{const got=await importXSearchResult(r.id,{sourceId:chosenWorkSource,reason:'rollback'},'test',tag(),tx);aid=got!.articleId;throw Error('synthetic abort');}),/synthetic abort/);
 assert.equal((await sql`SELECT id FROM articles WHERE id=${aid}`).length,0);assert.equal((await sql`SELECT id FROM pgboss.job WHERE data->>'articleId'=${aid}`).length,0);assert.equal((await sql`SELECT source_id FROM source_account_bindings WHERE platform='x' AND id_value=${t.author.rest_id}`).length,0);assert.equal((await sql`SELECT id FROM audit_log WHERE subject=${`result:${r.id}`}`).length,0);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r.id}`)[0]!.article_id,null);
});
test('AgentKey raw or subscription ownership blocks SocialData and Jina even on explicit extraction',async()=>{
 let hits=0;const server=await stub(()=>{hits++;return {};});const old={...process.env};Object.assign(process.env,{SOCIALDATA_API_KEY:'fake-only',SOCIALDATA_BASE_URL:server.url});
 try{for(const subscription of [false,true]){const t=tweet(),sid=await source(t.author.rest_id),r=await search(t),got=await importWork(r,tag(),sid);if(subscription){await sql`INSERT INTO collection_subscriptions(control_source_id,provider,platform,operation_key,contract_version,interval_minutes) VALUES(${sid},'agentkey','x','agentkey.x.collection',1,30)`;await sql`UPDATE articles SET raw='{}' WHERE id=${got!.articleId}`;}
  const [count]=await sql`SELECT count(*)::int n FROM receipts WHERE service='socialdata'`;assert.equal(await extractArticleBody(got!.articleId,true),'unconfirmed');assert.equal((await article(got!.articleId)).body_status,'unconfirmed');assert.equal((await sql`SELECT count(*)::int n FROM receipts WHERE service='socialdata'`)[0]!.n,count!.n);assert.equal(hits,0);
 }}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test('SocialData candidate preserves text, quote, media, metrics and reply fields',()=>{
 const c=tweetToCandidate({id_str:'12',tweet_created_at:'2026-10-23T10:00:00Z',full_text:'First line\nBody',lang:'en',favorite_count:4,retweet_count:2,views_count:7,in_reply_to_status_id_str:'10',user:{screen_name:'sample',name:'Sample'},quoted_status:{id_str:'11',full_text:'Quote',tweet_created_at:'2026-10-23T09:00:00Z',user:{screen_name:'quoted',name:'Quoted'}},extended_entities:{media:[{type:'photo',media_url_https:'https://example.com/image.jpg'}]}});
 assert.equal(c.url,'https://x.com/sample/status/12');assert.equal(c.identityKey,'x:12');assert.equal(c.title,'First line');assert.equal(c.bodyText,'First line\nBody\n\n【引用 @quoted】Quote');assert.equal(c.bodyStatus,'ok');assert.equal(c.xPost!.replyTo,'10');assert.deepEqual(c.raw,{favorite:4,retweet:2,views:7});assert.deepEqual(c.media,[{kind:'image',url:'https://example.com/image.jpg',width:null,height:null,poster:null}]);
});

test('partial AgentKey producers revise received text without erasing previously received X metadata',async()=>{
 const t=tweet(),q={...tweet(),text:'Quoted verified text',author:{...author(),screen_name:'quoted'}},first=await importWork(await search({...t,quoted:q}));
 const original=await article(first!.articleId);
 // A previous full producer has independently received these optional fields.
 const media=[{kind:'image' as const,url:'https://example.com/received.jpg'}];
 await upsertMaterial({sourceId:first!.sourceId,url:original.url,title:'Full producer version',excerpt:'Full producer version',via:'fetch',media,xPost:{...original.x_post,replyTo:'123',media,avatarUrl:'https://example.com/avatar.jpg',lang:'en'}});
 const before=await article(first!.articleId);
 for(const producer of ['account_posts','detail','list_posts']){
  const updated={...t,text:`New received version from ${producer}`,lang:undefined};
  const rows=await query(`x.${producer}`,producer==='account_posts'?{screen_name:'sample'}:producer==='detail'?{tweet_id:t.tweet_id}:{list_id:'1'},producer==='detail'?{...updated,id:t.tweet_id}: {timeline:[updated]});
  const got=await importWork(rows[0]),a=await article(got!.articleId);
  assert.equal(got!.articleId,first!.articleId);assert.equal(a.x_post.text,updated.text);assert.equal(a.revision,before.revision+1+['account_posts','detail','list_posts'].indexOf(producer));
  assert.deepEqual({quoted:a.x_post.quoted,replyTo:a.x_post.replyTo,media:a.media,postMedia:a.x_post.media,avatar:a.x_post.avatarUrl,lang:a.x_post.lang},{quoted:before.x_post.quoted,replyTo:'123',media,postMedia:media,avatar:'https://example.com/avatar.jpg',lang:'en'});
  for(const key of ['source_id','identity_key','published_at','discovered_at','timeline_at','body_text','body_status'])assert.deepEqual(a[key],before[key],key);
 }
 const [clear]=await query('x.detail',{tweet_id:t.tweet_id},{...t,id:t.tweet_id,text:'Explicit reply cleared',in_reply_to_status_id_str:null});await importWork(clear);
 assert.equal((await article(first!.articleId)).x_post.replyTo,null);
 const nextQuote={...tweet(),text:'Entire new quote',author:{...author(),screen_name:'newquoted',name:'New author'}};
 await importWork(await search({...t,text:'New quote version',quoted:nextQuote}));
 assert.deepEqual((await article(first!.articleId)).x_post.quoted,{authorName:'New author',handle:'newquoted',text:'Entire new quote',url:`https://x.com/newquoted/status/${nextQuote.tweet_id}`});
});

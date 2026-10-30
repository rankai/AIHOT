import {allowTestBudgetScope} from './setup.ts';
import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {recoverOperations} from '@aihot/backend/providers/operations/recovery';
import {claimRun,resumeRun} from '@aihot/backend/providers/operations/store';
import {agentKeyXOperations,xCollectionIds,xSearchRoute,xPostsRoute,xDetailRoute,xCommentsRoute,xProfileRoute,xCommunityMembersRoute} from '@aihot/backend/providers/agentkey/x-contract';
import {parseAgentKeyX} from '@aihot/backend/providers/agentkey/x-parser';
import {agentKeyXWork,agentKeyXAccount} from '@aihot/backend/providers/agentkey/x-evidence';
import {parseLosslessJson} from '@aihot/backend/providers/agentkey/response';
import {agentKeyRouteFor} from '@aihot/backend/providers/agentkey/routes';
import {requestAgentKey} from '@aihot/backend/providers/agentkey/request';
import {config as backendConfig} from '@aihot/backend/config';
import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';
const tid='9876543210123456789',uid='7000000001';
// Synthetic values follow the recorded 2026-10-23 live typed shapes, not new live calls.
const author={rest_id:uid,screen_name:'sample',name:'Sample',avatar:null,followers_count:null};
const profile={status:'active',profile:'sample',rest_id:uid,id:uid,name:'Sample',desc:null};
const tweet={tweet_id:tid,text:'Outer post',created_at:'Fri Oct 23 10:00:00 +0000 2026',author,screen_name:'sample',bookmarks:null};
const detail={id:tid,text:'Received text',display_text:'Distinct display text',author,status:'active',created_at:tweet.created_at,in_reply_to_screen_name:null,in_reply_to_status_id_str:null,in_reply_to_user_id_str:null};
const member={user_id:uid,screen_name:'sample',name:'Sample',description:null,profile_image:null};
const parameters=[{keyword:' ordinary keyword '},{screen_name:'sample'},{tweet_id:tid},{tweet_id:tid},{screen_name:'sample'},{screen_name:'sample'},{screen_name:'sample'},{list_id:'84839422'},{community_id:'1493290339532222469'},{},{list_id:'84839422'},{community_id:'1493290339532222469'}];
const bodies=[{status:'ok',timeline:[{...tweet,type:'tweet',author:undefined,user_info:author}],next_cursor:'next'}, {status:'ok',timeline:[{...tweet,author:{...author,screen_name:null},screen_name:undefined}],pinned:{...tweet},user:profile,next_cursor:'next'},detail,{...detail,thread:[{...detail,id:'9876543210123456790',conversation_id:tid}],cursor:'next'},profile,{status:'ok',followers:[member],next_cursor:'next',more_users:true},{status:'ok',following:[member],next_cursor:'next',more_users:true},{timeline:[tweet],cursor:'next'},{timeline:[tweet],cursor:'next'},{trends:[{name:'Term',description:null,context:'Context'}]},{status:'ok',members:[member],next_cursor:'next',more_users:true},{status:'ok',members:[member],next_cursor:'unusable'}];
const response=(body:unknown)=>({httpStatus:200,mcp:{},envelope:{provider:'TikHub',data:{code:200,data:body}}});
let budgets:any[]=[];
let restoreAdminScope:()=>Promise<void>;
before(async()=>{restoreAdminScope=await allowTestBudgetScope(['agentkey.query'],'admin');const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);budgets=await sql`SELECT * FROM budgets WHERE service='agentkey.query'`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='agentkey.query'`;});
after(async()=>{await restoreAdminScope?.();for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function withStub(body:unknown,run:(calls:any[])=>Promise<void>){
 const calls:any[]=[];const server=await stub(async(_hit,req)=>{const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}};calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:{provider:'TikHub',credits_charged:.2,data:{code:200,data:body}}}};});
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-x-test-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true',COLLECT_ENABLED:'false',REDFOX_CALLS_ENABLED:'false'});
 try{await run(calls);}finally{await server.close();for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
}
async function step(id:number){const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());return (await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;}
test('all twelve exact route contracts, profile guards and homepage inputs',()=>{
 const tools=['fetch_search_timeline','fetch_user_post_tweet','fetch_tweet_detail','fetch_post_comments','fetch_user_profile','fetch_user_followers','fetch_user_followings','fetch_list_timeline','fetch_community_timeline','fetch_trending','fetch_list_members','fetch_community_members'];
 assert.equal(agentKeyXOperations.length,12);
 agentKeyXOperations.forEach((op,i)=>{
  assert.equal(op.route.tool,`TikHub/${tools[i]}_api_v1_twitter_web_${tools[i]}_get`);assert.equal(op.route.estimatedCredits,.2);assert.equal(op.route.recovery,'readOnly');
  const params=op.schema.parse(parameters[i]);assert.ok(!('cursor' in params));for(const extra of [{cursor:''},{cursor:'None'},{page:1},{count:20}])assert.throws(()=>op.schema.parse({...parameters[i],...extra}));
  const run={provider:'agentkey',contract_version:1,operation_key:op.route.operationKey,step_key:op.route.stepKey,input:{mode:'query',operationId:op.operationId,platform:'x-research',tool:op.route.tool,upstream:'TikHub'}};assert.equal(agentKeyRouteFor(run),op.route);
  assert.equal(agentKeyRouteFor({...run,input:{...run.input,mode:'collection'}}),(xCollectionIds as readonly string[]).includes(op.operationId)?op.route:undefined);
  for(const patch of [{provider:'redfox'},{contract_version:2},{step_key:'wrong'},{operation_key:'wrong'},{input:{...run.input,platform:'x'}},{input:{...run.input,tool:'wrong'}},{input:{...run.input,upstream:'wrong'}},{input:{...run.input,operationId:'wrong'}}])assert.equal(agentKeyRouteFor({...run,...patch}),undefined);
 });
 assert.deepEqual(agentKeyXOperations[0].schema.parse(parameters[0]),{keyword:' ordinary keyword ',search_type:'Top'});
 assert.deepEqual(agentKeyXOperations[8].schema.parse(parameters[8]),parameters[8]);assert.deepEqual(agentKeyXOperations[9].schema.parse({}),{country:'UnitedStates'});
 for(const i of [1,4]){for(const bad of [{},{screen_name:'sample',rest_id:1},{rest_id:'9876543210123456789'},{rest_id:9876543210123456789},{screen_name:'@sample'}])assert.throws(()=>agentKeyXOperations[i]!.schema.parse(bad));assert.deepEqual(agentKeyXOperations[i]!.schema.parse({rest_id:44196397}),{rest_id:44196397});}
 assert.throws(()=>agentKeyXOperations[0].schema.parse({keyword:'x',search_type:'People'}));assert.throws(()=>agentKeyXOperations[9].schema.parse({country:'unknown'}));
});
test('all witnessed query families accept nullable optional fields and known empty arrays; unknown shapes reject',()=>{
 agentKeyXOperations.forEach((op,i)=>{
  const page=parseAgentKeyX(response(bodies[i]),op.route,parameters[i]);assert.ok(page.candidates.length);assert.ok(page.candidates.every(x=>x.data.importable===false&&x.data.platform==='x-research'));
  const key=i===0||i===1||i===7||i===8?'timeline':i===3?'thread':i===5?'followers':i===6?'following':i===9?'trends':i>=10?'members':null;
  if(key){const empty={...bodies[i],[key]:[],pinned:undefined};assert.equal(parseAgentKeyX(response(empty),op.route,parameters[i]).summary.count,0);}
  assert.throws(()=>parseAgentKeyX(response({unknown:[]}),op.route,parameters[i]));assert.throws(()=>parseAgentKeyX(response({...bodies[i],status:'error'}),op.route,parameters[i]));assert.throws(()=>parseAgentKeyX(response({...bodies[i],error:'bad'}),op.route,parameters[i]));
 });
 const members=parseAgentKeyX(response(bodies[11]),xCommunityMembersRoute,parameters[11]);assert.equal(members.summary.pagination,undefined);assert.match(String(members.summary.limitation),/19/);
 const trends=parseAgentKeyX(response(bodies[9]),agentKeyXOperations[9].route,{}).candidates[0]!.data;assert.equal(trends.rank,undefined);assert.equal(trends.heat,undefined);
});
test('wrapper, quote, pinned, actual context and conversation remain separate',()=>{
 const nested={...tweet,tweet_id:'123',author:{rest_id:'999',screen_name:null,name:null},screen_name:undefined,text:'Original'};
 const body={status:'ok',user:profile,pinned:tweet,timeline:[{...tweet,author:{...author,screen_name:null},screen_name:undefined,retweeted:{id:'123'},retweeted_tweet:nested,quoted:{...nested,tweet_id:'124'}}]};
 const p=parseAgentKeyX(response(body),xPostsRoute,{screen_name:'sample'});assert.equal(p.candidates[0]!.data.pinned,true);
 const r=p.candidates[1]!.data.record as any;assert.equal(r.tweetId,tid);assert.equal(r.author.screen_name,null);assert.equal(r.authorContext.screen_name,'sample');assert.equal(r.retweeted_tweet.tweetId,'123');assert.equal(r.retweeted_tweet.author.rest_id,'999');assert.equal(r.retweeted_tweet.authorContext,undefined);assert.equal(r.quoted.tweetId,'124');assert.equal(r.quoted.authorContext,undefined);assert.equal(r.text,'Outer post');
 assert.throws(()=>parseAgentKeyX(response({...body,user:{...profile,profile:'other'}}),xPostsRoute,{screen_name:'sample'}));
 assert.throws(()=>parseAgentKeyX(response({...body,user:{...profile,rest_id:'999',id:'999'}}),xPostsRoute,{screen_name:'sample'}));
 assert.throws(()=>parseAgentKeyX(response({...body,timeline:[{...body.timeline[0],retweeted:{id:'456'}}]}),xPostsRoute,{screen_name:'sample'}));
 const c=parseAgentKeyX(response(bodies[3]),xCommentsRoute,{tweet_id:tid});assert.equal(c.summary.count,1);assert.equal((c.summary.root as any).tweetId,tid);assert.equal((c.candidates[0]!.data.record as any).parentTweetId,undefined);
 const d=parseAgentKeyX(response(detail),xDetailRoute,{tweet_id:tid}).candidates[0]!.data.record as any;assert.notEqual(d.text,d.display_text);assert.equal(d.in_reply_to_status_id_str,null);
 assert.throws(()=>parseAgentKeyX(response(detail),xDetailRoute,{tweet_id:'1'}));assert.throws(()=>parseAgentKeyX(response({...profile,id:'9'}),xProfileRoute,{screen_name:'sample'}));
});
test('conversation items without received IDs are not mistaken for the root',()=>{
 const p=parseAgentKeyX(response({status:'active',text:'Root without ID',thread:[{text:'First meaningful conversation item'},{id:null,text:'Second meaningful conversation item'}]}),xCommentsRoute,{tweet_id:tid});
 assert.equal(p.summary.count,2);assert.equal(p.candidates.length,2);
 assert.deepEqual(p.candidates.map(item=>item.data.title),['First meaningful conversation item','Second meaningful conversation item']);
 assert.ok(p.candidates.every(item=>item.data.tweetId===undefined));
 const sameRoot=parseAgentKeyX(response({...detail,thread:[detail,{...detail,id:'9876543210123456790'}]}),xCommentsRoute,{tweet_id:tid});assert.equal(sameRoot.summary.count,1);
});
test('lossless numeric words, aliases and whitelisted output',()=>{
 const raw=JSON.stringify(response({timeline:[{...tweet,type:'tweet',user_info:author,author:undefined,token:'not-ui',arbitrary:{secret:'not-ui'}}]})).replace(`"tweet_id":"${tid}"`,`"tweet_id":${tid}`);
 const p=parseAgentKeyX(parseLosslessJson(raw),xSearchRoute,{keyword:'k'});assert.equal(p.candidates[0]!.data.tweetId,tid);assert.ok(!JSON.stringify(p).includes('not-ui'));
 assert.throws(()=>parseAgentKeyX(response({timeline:[{...tweet,type:'tweet',user_info:{...author,screen_name:'other'}}]}),xSearchRoute,{keyword:'k'}));
});
test('all twelve Q runs persist summaries and receipt identities without materials or bindings',async()=>{
 for(let i=0;i<agentKeyXOperations.length;i++)await withStub(bodies[i],async calls=>{
  const op=agentKeyXOperations[i]!,run=await createAgentKeyQuery({provider:'agentkey',operationId:op.operationId,parameters:parameters[i]},'x-test',tag());assert.equal(run.input.platform,'x-research');
  const state=await step(run.id);assert.equal(state.status,'completed',JSON.stringify(state));assert.equal(calls.length,1);assert.equal(calls[0].name,op.route.tool);assert.deepEqual(calls[0].params,op.schema.parse(parameters[i]));
  const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`,summary=rows.find(r=>r.kind==='query_summary')!;assert.ok(summary);assert.ok(rows.every(r=>r.receipt_id===summary.receipt_id&&r.source_id===null&&r.article_id===null));for(const r of rows.filter(r=>r!==summary)){
   const expected=[0,1,2,4,7,8].includes(i);assert.equal(r.data.importable,expected);assert.equal(r.data.querySummaryId,summary.id);if(expected)assert.match(r.data.missing.join(' '),i===4?/已有完全匹配.*不自动切换/:/不证明完整长文.*不自动补购/);
  }
  const [receipt]=await sql`SELECT * FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.status,'completed');assert.equal(receipt!.usage.chargedCredits,.2);assert.equal(receipt!.model,op.route.tool);assert.equal(receipt!.subject,`operation:${run.id}`);assert.equal(receipt!.service,'agentkey.query');
  const bindings=await sql`SELECT id_value FROM source_account_bindings WHERE evidence->>'reference' IN ${sql(rows.map(r=>String(r.id)))}`;assert.equal(bindings.length,0);
 });
});
test('unknown received evidence survives resume; repaired fixture resumes locally with valves closed',async()=>{
 await withStub({unknown:[]},async calls=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'5K5EG87P',parameters:{keyword:'k'}},'test',tag());let failed=await step(run.id);assert.equal(failed.status,'needs_review');
  const [receipt]=await sql`SELECT * FROM receipts WHERE id=${failed.current_receipt_id}`;assert.equal(receipt!.status,'received');assert.equal((await sql`SELECT id FROM operation_results WHERE run_id=${run.id}`).length,0);
  process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:failed.step_version,generation:failed.generation}));failed=await step(run.id);assert.equal(failed.status,'needs_review');assert.equal(calls.length,1);
  // Test-only repair simulates a parser-compatible persisted receipt after local repair; production never edits it here.
  await sql`UPDATE receipts SET response=${sql.json(response({timeline:[]}) as never)} WHERE id=${receipt!.id}`;
  await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:failed.step_version,generation:failed.generation}));assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);
  const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(results.length,1);assert.equal(results[0]!.data.count,0);assert.equal(results[0]!.receipt_id,receipt!.id);
 });
});
test('received interruption resumes locally; frozen receipt parameter tampering cannot be reused',async()=>{
 await withStub(detail,async calls=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'x.detail',parameters:{tweet_id:tid}},'test',tag());
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},randomUUID()));const receipt=await requestAgentKey(execution,run,xDetailRoute,{tweet_id:tid});
  process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
  const [stored]=await sql`SELECT request FROM receipts WHERE id=${receipt.receiptId}`;await sql`UPDATE receipts SET request=${sql.json({...stored!.request,params:{tweet_id:'9'}})} WHERE id=${receipt.receiptId}`;
  let state=await step(run.id);assert.equal(state.status,'needs_review');assert.equal(calls.length,1);
  await sql`UPDATE receipts SET request=${sql.json(stored!.request)} WHERE id=${receipt.receiptId}`;await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:state.step_version,generation:state.generation}));state=await step(run.id);assert.equal(state.status,'completed');assert.equal(calls.length,1);
 });
});
test('API merges existing Redfox X variants and exposes all exact twelve ordinary queries',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp(),previous=backendConfig.devAdmin;backendConfig.devAdmin={displayName:'X synthetic API'};
 try{
  const options=await app.inject({method:'GET',url:'/api/admin/redfox/operations'});assert.equal(options.statusCode,200,options.body);const ops=options.json() as any[];
  for(const op of agentKeyXOperations){const matching=ops.filter(o=>o.id===op.operationId);assert.equal(matching.length,1);assert.equal(matching[0].platform,'x-research');const queries=matching[0].queryProviders??matching[0].collectionProviders;assert.ok(queries.some((v:any)=>v.id==='agentkey'));if(!op.operationId.startsWith('x.'))assert.ok(queries.some((v:any)=>v.id==='redfox'));else assert.equal(matching[0].schedulableType,(xCollectionIds as readonly string[]).includes(op.operationId)?op.operationId==='x.trending'?'trend':'list':null);}
  await withStub(profile,async calls=>{const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{provider:'agentkey',operationId:'x.account_profile',parameters:{screen_name:'sample'}}});assert.equal(reply.statusCode,202,reply.body);assert.equal((await step(reply.json().runId)).status,'completed');assert.equal(calls.length,1);});
  const reply=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{provider:'agentkey',operationId:'x.community_members',parameters:{community_id:'1',cursor:'no'}}});assert.equal(reply.statusCode,400,reply.body);
 }finally{backendConfig.devAdmin=previous;await app.close();}
});

test('existing recovery scanner requeues received X locally with outbound valves closed',async()=>{
 await withStub(detail,async calls=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'x.detail',parameters:{tweet_id:tid}},'test',tag());
  const [queued]=await sql`SELECT job_id FROM operation_runs WHERE id=${run.id}`;
  const execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:run.step_version,generation:run.generation},queued!.job_id));
  await requestAgentKey(execution,run,xDetailRoute,{tweet_id:tid});
  const [cursor]=await sql`SELECT value FROM settings WHERE key='operations.recovery-cursor'`;
  const [stored]=await sql`SELECT job_id FROM operation_runs WHERE id=${run.id}`;
  await sql`UPDATE pgboss.job SET state='cancelled' WHERE id=${stored!.job_id}`;
  await sql`INSERT INTO settings(key,value,updated_by) VALUES ('operations.recovery-cursor',${sql.json(run.id-1)},'x-test') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';
  try{const recovered=await recoverOperations();assert.equal(recovered.requeued,1);assert.equal(recovered.released,0);assert.equal(calls.length,1);assert.equal((await step(run.id)).status,'completed');assert.equal(calls.length,1);}
  finally{if(cursor)await sql`UPDATE settings SET value=${sql.json(cursor.value)} WHERE key='operations.recovery-cursor'`;else await sql`DELETE FROM settings WHERE key='operations.recovery-cursor'`;}
 });
});


test('advisory eligibility accepts only verified work/profile facts while parser research stays available',()=>{
 const work=parseAgentKeyX(response(bodies[0]),xSearchRoute,parameters[0]).candidates[0]!;assert.equal(work.data.importable,false);assert.equal(agentKeyXWork(work).tweetId,tid);
 const account=parseAgentKeyX(response(profile),xProfileRoute,{screen_name:'sample'}).candidates[0]!;assert.equal(agentKeyXAccount(account).userId,uid);
 assert.throws(()=>agentKeyXWork({...work,data:{...work.data,record:{text:'Partial research'}}}));
 assert.throws(()=>agentKeyXAccount({...account,data:{...account.data,record:{profile:'sample'}}}));
});

test('stored partial and role-limited Q candidates remain nonimportable without automatic writes',async()=>{
 const body={timeline:[{type:'tweet',text:'Partial research'},{...tweet,user_info:author,author:undefined,type:'tweet',retweeted:{id:'123'}}]};
 await withStub(body,async calls=>{
  const run=await createAgentKeyQuery({provider:'agentkey',operationId:'5K5EG87P',parameters:{keyword:'test'}},'test',tag());assert.equal((await step(run.id)).status,'completed');
  const rows=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind<>'query_summary'`;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.data.importable===false&&r.article_id===null&&r.source_id===null));assert.equal(calls.length,1);
 });
});

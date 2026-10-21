import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createPlatformSubscription,startPlatformSubscription,updatePlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {resumeRun} from '@aihot/backend/providers/operations/store';
import {douyinOperations} from '@aihot/backend/providers/redfox/douyin-contract';
import {xiaohongshuOperations} from '@aihot/backend/providers/redfox/xiaohongshu-contract';
const uid='900719925474099312340000'+Date.now(),workId='900719925474099312340001'+Date.now();
const wide={videoId:workId,content:'Synthetic collection',opusUrl:`https://www.douyin.com/video/${workId}`,authorUid:uid};
const premium={workId,title:'Synthetic missing-author candidate',workUrl:wide.opusUrl};
const note=tag(),xwork={workId:note,workTitle:'Synthetic note',workUrl:`https://www.xiaohongshu.com/explore/${note}`,accountUserid:uid};
const cases:[string,Record<string,unknown>,unknown][]=[
 ['QEQLCKD6',{accountId:'display',offset:40},{list:[premium]}],['QSL2ZSXM',{userId:uid,pageNum:100},{list:[wide]}],
 ['774OBKK0',{keyword:'synthetic'},{list:[premium]}],['OWIBYU1V',{keyword:'synthetic'},{list:[wide]}],
 ['HUCIASU',{},[premium]],['I8P3HTVH',{keyword:'synthetic'},{list:[{photoId:workId,title:'Synthetic AI',url:wide.opusUrl}]}],
 ['WD6UT8DQ',{},[{aweme_id:workId,author_user_id:uid,aweme_desc:'Synthetic',share_url:wide.opusUrl}]],['0ZB9S2FW',{},[{aweme_id:workId,author_user_id:uid,aweme_desc:'Synthetic',share_url:wide.opusUrl}]],
 ['384C6W6B',{keyword:'synthetic'},{list:[xwork]}],['047JJ3UA',{keyword:'synthetic',startTime:'2026-01-01 00:00:00',endTime:'2026-10-01 00:00:00'},{list:[{photoId:note,title:'Synthetic AI',url:xwork.workUrl}]}],
 ['3X8FGEEM',{}, {articles:[{id:note,title:'Synthetic match',authorId:uid,shareInfoLink:xwork.workUrl}],latestHotArticles:[{id:'recommend-'+note,title:'Synthetic recommendation',authorId:uid,shareInfoLink:`https://www.xiaohongshu.com/explore/recommend-${note}`}],hotTopics:[{topic:'Synthetic topic'}]}],
 ['LBYLC5AK',{},[{title:'Synthetic rank',photoJumpUrl:xwork.workUrl,userJumpUrl:`https://www.xiaohongshu.com/user/profile/${uid}`}]],
 ['XN3ULENA',{userid:uid,offset:20},{list:[xwork]}],['P3W2W18P',{category:'综合全部'},[{title:'Synthetic rank',photoId:note,userId:uid}]],
 ['AEA6YE0J',{rankDate:'2026-10-19',category:'综合全部'},[{title:'Synthetic rank',photoJumpUrl:xwork.workUrl,userJumpUrl:`https://www.xiaohongshu.com/user/profile/${uid}`}]],
];
let current=cases[0]!,override:((p:Record<string,unknown>)=>unknown)|undefined,hits=0;
const requests:Record<string,unknown>[]=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{hits++;const url=new URL(req.url!,'http://localhost'),all={...douyinOperations,...xiaohongshuOperations},op=all[current[0] as keyof typeof all];assert.equal(url.pathname,op.path);assert.equal(req.method,op.method);const p=req.method==='GET'?Object.fromEntries(url.searchParams):JSON.parse(body);requests.push(p);const data=override?override(p):current[2];res.end(JSON.stringify(current[0]==='3X8FGEEM'?data:{code:2000,data}));});});
let saved:Record<string,unknown>;
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-platform-collection';process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.collect'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.collect'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.collect'`;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function start(pages=1,items=10){const payload={name:tag(),operationId:current[0],parameters:current[1],enabled:true,limits:{pages,items,details:0}},sub=await createPlatformSubscription(payload,'test',tag()),run=await startPlatformSubscription(sub.id,'test',tag());return {sub,run,payload};}
async function finish(id:number){for(let i=0;i<25;i++){const r=await row(id);if(r.status!=='active')return r;await step(id);}throw new Error('Fixture exceeded bounded steps');}
test('fifteen actual collection adapters use collect receipts and preserve research/missing identities',async()=>{
 for(const c of cases){current=c;const initial=hits,{run}=await start(),done=await finish(run.id);assert.equal(done.status,'completed',`${c[0]}: ${done.wait_reason}`);assert.equal(hits,initial+1);
  const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`,summary=results.find(r=>r.kind==='query_summary')!;
  assert.equal(summary.data.workCount,1);const [receipt]=await sql`SELECT * FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.service,'redfox.collect');assert.equal(receipt!.model,c[0]);assert.equal(receipt!.attempts,1);assert.ok(receipt!.cost!=null);
  const works=results.filter(r=>r.kind.endsWith('_work'));
  if(['QEQLCKD6','774OBKK0','HUCIASU','I8P3HTVH','047JJ3UA','P3W2W18P'].includes(c[0]))assert.ok(works[0]!.data.pendingReason);
  if(c[0]==='3X8FGEEM'){assert.equal(works.find(r=>r.data.role==='provider_recommendation')!.article_id,null);assert.equal(summary.data.count,3);assert.equal(summary.data.workCount,1);}
 }
});
test('offset twenty, pageNum and keyword-only research respect bounded pagination',async()=>{
 for(const [id,field,first,second] of [['QEQLCKD6','offset',40,60],['QSL2ZSXM','pageNum',100,101],['XN3ULENA','offset',20,40],['3X8FGEEM','pageNum',1,2]] as const){current=cases.find(c=>c[0]===id)!;requests.length=0;const {run}=await start(2);assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,2);assert.equal(requests[0]![field]??1,first);assert.equal(requests[1]![field],second);}
 current=[...cases.find(c=>c[0]==='3X8FGEEM')!] as typeof current;current[1]={keyword:'synthetic',pageNum:99};requests.length=0;const {run}=await start(3);assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,1);
});
test('retained completed page replays with both call gates closed and preserves per-page discovery',async()=>{
 current=cases.find(c=>c[0]==='384C6W6B')!;const {run}=await start();await step(run.id);const page=(await row(run.id)).progress.pageReceipt;
 const at=new Date('2020-01-02T03:04:05Z');await sql`UPDATE operation_results SET created_at=${at} WHERE run_id=${run.id} AND kind='query_summary'`;
 await sql`UPDATE receipts SET status='completed' WHERE id=${page}`;const before=hits;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal(hits,before);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='xiaohongshu_work'`;assert.ok(result!.article_id);assert.ok(result!.provenance.sourcePageResultId);assert.equal((await sql`SELECT status FROM receipts WHERE id=${page}`)[0]!.status,'completed');}
 finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='fake-platform-collection';}
});
test('budget and collection gate produce no attempt; invalidated versions cannot consume retained items',async()=>{
 current=cases.find(c=>c[0]==='OWIBYU1V')!;const {run}=await start();const before=hits;await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.collect'`;await step(run.id);let r=await row(run.id);assert.equal(r.status,'waiting');assert.equal(r.current_receipt_id,null);assert.equal(hits,before);await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;
 await sql.begin(tx=>resumeRun(tx,{runId:r.id,stepVersion:r.step_version,generation:r.generation}));process.env.COLLECT_ENABLED='false';await step(run.id);r=await row(run.id);assert.equal(r.status,'waiting');assert.equal(r.current_receipt_id,null);assert.equal(hits,before);process.env.COLLECT_ENABLED='true';
 const next=await start();await step(next.run.id);const stale=await row(next.run.id);await updatePlatformSubscription(next.sub.id,{editVersion:1,config:{...next.payload,parameters:{keyword:'changed'}}},'test');await executeOperationStep(stale.id,stale.step_version,randomUUID());assert.equal((await row(stale.id)).status,'stopped');assert.equal((await sql`SELECT * FROM operation_results WHERE run_id=${stale.id} AND kind='douyin_work'`).length,0);
});
test('collection API shares creation commands, isolates old endpoint and fences edited configuration',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Platform collection fixture'};
 try{const payload={name:tag(),operationId:'OWIBYU1V',parameters:{keyword:'synthetic'}},headers={'x-csrf-token':'dev','idempotency-key':tag()},initial=hits;
  const [a,b]=await Promise.all([app.inject({method:'POST',url:'/api/admin/redfox/collections',headers,payload}),app.inject({method:'POST',url:'/api/admin/redfox/collections',headers,payload})]);assert.equal(a.statusCode,201,a.body);assert.equal(a.json().id,b.json().id);
  const id=a.json().id,list=(await app.inject({url:'/api/admin/redfox/collections'})).json();assert.equal(list.find((s:{id:number})=>s.id===id).enabled,false);assert.equal(list.find((s:{id:number})=>s.id===id).platform,'douyin');
  assert.ok(!(await app.inject({url:'/api/admin/redfox/subscriptions'})).json().some((s:{id:number})=>s.id===id));
  assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/subscriptions',headers,payload})).statusCode,409);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/collections',headers:{...headers,'idempotency-key':tag()},payload:{...payload,enrichDetails:true}})).statusCode,409);
  assert.equal((await app.inject({method:'PATCH',url:`/api/admin/redfox/collections/${id}`,headers,payload:{editVersion:1,config:{...payload,name:'Edited',intervalMinutes:30}}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/collections',headers,payload})).json().id,id);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/collections',headers,payload:{...payload,parameters:{keyword:'changed'}}})).statusCode,409);
  assert.equal(hits,initial);
 }finally{config.devAdmin=null;await app.close();}
});
test('explicit no-more, empty page and item truncation record exact bounded consumption',async()=>{
 current=cases.find(c=>c[0]==='384C6W6B')!;
 try{override=()=>({list:[xwork],hasMore:0,total:'900719925474099312345'});let task=await start(3);let initial=hits;assert.equal((await finish(task.run.id)).status,'completed');assert.equal(hits,initial+1);let summary=(await sql`SELECT data FROM operation_results WHERE run_id=${task.run.id} AND kind='query_summary'`)[0]!.data;assert.equal(summary.returnedPage.hasMore,0);assert.equal(summary.stopReason,'upstream-no-more');
 override=()=>({list:[],total:100});task=await start(3);assert.equal((await finish(task.run.id)).status,'completed');summary=(await sql`SELECT data FROM operation_results WHERE run_id=${task.run.id}`)[0]!.data;assert.equal(summary.count,0);assert.equal(summary.stopReason,'empty-work-page');
 override=()=>({list:[xwork,{...xwork,workId:'tail-'+note,workUrl:`https://www.xiaohongshu.com/explore/tail-${note}`}]});task=await start(3,1);assert.equal((await finish(task.run.id)).status,'completed');summary=(await sql`SELECT data FROM operation_results WHERE run_id=${task.run.id} AND kind='query_summary'`)[0]!.data;assert.equal(summary.processedCount,1);assert.equal(summary.unprocessedDueToLimit,1);assert.equal(summary.truncated,true);
 }finally{override=undefined;}
});
test('lost item job is recovered from retained raw while outbound is closed, with no new page purchase',async()=>{
 const {recoverOperations}=await import('@aihot/backend/providers/operations/recovery');
 current=cases.find(c=>c[0]==='OWIBYU1V')!;const {run}=await start();await step(run.id);const r=await row(run.id);await sql`DELETE FROM pgboss.job WHERE id=${r.job_id}`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${run.id}`;
 process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';const initial=hits;
 try{let found=false;for(let i=0;i<20;i++){await recoverOperations();if((await row(run.id)).job_id){found=true;break;}}assert.ok(found,'bounded recovery cursor must eventually visit the fixture');await step(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal(hits,initial);}
 finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';}
});
test('disabled author stays pending and forged page provenance cannot grant formal import',async()=>{
 const {importDouyinResult}=await import('@aihot/backend/providers/redfox/import-douyin');const source=tag(),author='disabled-'+tag();
 await sql`INSERT INTO sources(id,name,kind,participation_mode,enabled) VALUES (${source},'Synthetic disabled','external','isolated',false)`;
 await sql`INSERT INTO source_account_bindings(source_id,platform,id_kind,id_value,evidence) VALUES (${source},'douyin','uid',${author},${sql.json({kind:'test',reference:tag()})})`;
 current=cases.find(c=>c[0]==='OWIBYU1V')!;override=()=>({list:[{...wide,authorUid:author,videoId:workId+'9',opusUrl:`https://www.douyin.com/video/${workId}9`}]});
 try{const {run}=await start();assert.equal((await finish(run.id)).status,'completed');const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='douyin_work'`;assert.equal(r!.article_id,null);assert.match(r!.data.pendingReason,/disabled/);assert.equal((await sql`SELECT 1 FROM articles WHERE source_id=${source}`).length,0);
 await sql`UPDATE operation_results SET provenance=provenance||${sql.json({sourcePageResultId:r!.id})} WHERE id=${r!.id}`;await assert.rejects(importDouyinResult(r!.id,{reason:'Forged page'},'test',tag()),/Source page/);
 }finally{override=undefined;}
});
test('different pages freeze their own first discovery and item import commits with advancement',async()=>{
 current=cases.find(c=>c[0]==='384C6W6B')!;const notes=[tag(),tag()];
 override=p=>{const i=Number(p.offset??0)/20;return {list:[{...xwork,workId:notes[i],workUrl:`https://www.xiaohongshu.com/explore/${notes[i]}`}],hasMore:i===0?1:0};};
 try{const {run}=await start(2);const times=[new Date('2020-02-03T00:00:00Z'),new Date('2020-03-04T00:00:00Z')];
  for(let i=0;i<2;i++){await step(run.id);const r=await row(run.id);assert.equal(r.step_key,'redfox.platform.item');assert.equal(r.progress.index,0);assert.equal(r.progress.items,undefined);
   await sql`UPDATE operation_results SET created_at=${times[i]!} WHERE run_id=${run.id} AND kind='query_summary' AND receipt_id=${r.progress.pageReceipt}`;
   await Promise.all([step(run.id),step(run.id)]);
   const rows=await sql`SELECT z.*,a.discovered_at FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id} AND z.receipt_id=${r.progress.pageReceipt}`;assert.equal(rows.length,1);assert.equal(rows[0]!.discovered_at.toISOString(),times[i]!.toISOString());
   assert.equal((await sql`SELECT 1 FROM audit_log WHERE action='material.import' AND subject=${`result:${rows[0]!.id}`}`).length,1);
  }
  assert.equal((await row(run.id)).status,'completed');const summaries=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY id`;assert.deepEqual(summaries.map(r=>r.data.processedCount),[1,1]);
 }finally{override=undefined;}
});
test('research and recommended results consume the same frozen item allowance without becoming works',async()=>{
 current=cases.find(c=>c[0]==='3X8FGEEM')!;const initial=hits,{run}=await start(3,2);assert.equal((await finish(run.id)).status,'completed');assert.equal(hits,initial+1);
 const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`,summary=results.find(r=>r.kind==='query_summary')!.data;
 assert.equal(summary.workCount,1);assert.equal(summary.selectedResearchCount,1);assert.equal(summary.unprocessedResearchDueToLimit,1);assert.equal(summary.truncated,true);assert.equal(summary.stopReason,'item-limit');
 assert.equal(results.filter(r=>r.kind!=='query_summary').length,2);assert.equal(results.find(r=>r.data.role==='provider_recommendation')!.article_id,null);
});
test('two mixed pages share one total item cap while work counts stay separate',async()=>{
 current=cases.find(c=>c[0]==='3X8FGEEM')!;const initial=hits,{run}=await start(3,5);assert.equal((await finish(run.id)).status,'completed');assert.equal(hits,initial+2);
 const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`,summaries=results.filter(r=>r.kind==='query_summary');
 assert.equal(results.filter(r=>r.kind!=='query_summary').length,5);assert.deepEqual(summaries.map(r=>r.data.workCount),[1,1]);assert.deepEqual(summaries.map(r=>r.data.selectedResearchCount),[2,1]);assert.equal(summaries[1]!.data.stopReason,'item-limit');
});

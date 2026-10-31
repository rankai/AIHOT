import {allowTestBudgetScope} from './setup.ts';
import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {resumeRun} from '@aihot/backend/providers/operations/store';
import {bilibiliOperations,type BilibiliOperation} from '@aihot/backend/providers/redfox/bilibili-contract';
import {parseBilibili} from '@aihot/backend/providers/redfox/bilibili';
import {importBilibiliResult as load} from '@aihot/backend/providers/redfox/import-bilibili';
const mid='900719925474099312345',bv='BV1abcDEF234',work={bvId:bv,title:'Synthetic video',description:'Synthetic body',authorId:mid,created:'2026-01-01 12:00:00',picUrl:'https://example.com/synthetic.jpg'};
const cases:{id:BilibiliOperation;path:string;parameters:Record<string,unknown>;data:unknown;kind:string}[]=[
 {id:'TIN1NMTZ',path:'/story/api/bili/data/workDetail',parameters:{bvId:bv},data:work,kind:'bilibili_work'},
 {id:'EH53TOT7',path:'/story/api/bili/data/accountDetail',parameters:{mid},data:{mid,name:'Synthetic account'},kind:'bilibili_account'},
 {id:'ZXJLJQ21',path:'/story/api/bili/data/accountSearch',parameters:{keyword:'synthetic',page:'101',pageSize:50,order:'follower'},data:{accountList:[{mid,name:'Synthetic account'}],page:101,total:1},kind:'bilibili_account'},
 {id:'LEN9QXR3',path:'/story/api/bili/data/workSearch',parameters:{keyword:'synthetic',page:'100',exactMatch:false,pageSize:10,order:'time'},data:{workList:[work],page:100,total:1},kind:'bilibili_work'},
 {id:'VPA67I98',path:'/story/api/bili/data/accountWorkList',parameters:{accountUrl:`https://space.bilibili.com/${mid}`,page:101,pageSize:50,order:'like'},data:{mid,workList:[{bvId:bv,title:'Synthetic account work'}],page:101,total:1},kind:'bilibili_work'},
];
let fixture=cases[0]!,hits=0,rawOverride:string|undefined,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,fixture.path);assert.equal(req.headers.redfox_api_key,'fake-bili');assert.deepEqual(JSON.parse(body),fixture.parameters);res.end(rawOverride??JSON.stringify({code:2000,data:fixture.data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});});
let restoreAdminScope:()=>Promise<void>;
before(async()=>{restoreAdminScope=await allowTestBudgetScope(['redfox.query'],'admin');await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-bili';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await restoreAdminScope?.();await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:fixture.id,parameters:fixture.parameters},'bilibili-test',tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
const newMid=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString(),newBv=()=>`BV${randomUUID().replaceAll('-','').slice(0,10)}`;
const url=(id:string)=>`https://www.bilibili.com/video/${id}`;
async function accountResult(uid:string){fixture={...cases[1]!,parameters:{mid:uid},data:{mid:uid,name:'Synthetic author'}};return (await query()).results[0]!;}
async function workResult(record:Record<string,unknown>){fixture={...cases[0]!,parameters:{workUrl:'https://b23.tv/Synthetic'},data:record};return (await query()).results[0]!;}
async function external(){const id=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${id},'Synthetic owner','external','editorial',true)`;return id;}
test('five POST contracts persist typed results, real outer author and generated BV original',async()=>{const initial=hits;for(const c of cases){fixture=c;const q=await query();assert.equal(q.run.status,'completed',q.run.wait_reason);assert.equal(q.results[0]!.kind,c.kind);if(c.kind==='bilibili_work'){assert.equal(q.results[0]!.data.url,url(bv));assert.equal(q.results[0]!.data.identity.mid,mid);}}assert.equal(hits,initial+5);});
test('strict input URLs, exclusivity, booleans and documented page types',()=>{
 for(const c of cases)assert.ok(bilibiliOperations[c.id].schema.safeParse(c.parameters).success);
 for(const [id,p] of [['TIN1NMTZ',{bvId:bv,workUrl:url(bv)}],['TIN1NMTZ',{}],['VPA67I98',{mid,accountUrl:`https://space.bilibili.com/${mid}`}],['ZXJLJQ21',{keyword:'x',page:1}],['ZXJLJQ21',{keyword:'x',page:'0'}],['LEN9QXR3',{keyword:'x',page:'1',exactMatch:'false'}],['VPA67I98',{mid,page:'1'}],['VPA67I98',{mid,pageSize:51}]] as [BilibiliOperation,unknown][])assert.equal(bilibiliOperations[id].schema.safeParse(p).success,false);
 for(const address of ['https://example.com/1',`https://space.bilibili.com:443/${mid}`,`https://u:p@space.bilibili.com/${mid}`,`https://space.bilibili.com/${mid}#x`])assert.equal(bilibiliOperations.VPA67I98.schema.safeParse({accountUrl:address}).success,false);
 for(const address of ['https://example.com/video/'+bv,'https://b23.tv/a/b',url(bv)+'#x',url(bv).replace('bilibili.com','bilibili.com:443'),'https://www.bilibili.com/video/av123'])assert.equal(bilibiliOperations.TIN1NMTZ.schema.safeParse({workUrl:address}).success,false);
 for(const address of [url(bv),`http://bilibili.com/video/${bv}/?p=2`,'https://b23.tv/Synthetic'])assert.ok(bilibiliOperations.TIN1NMTZ.schema.safeParse({workUrl:address}).success);
});
test('response mismatch rejects while short-link response BV and missing author remain honest',()=>{
 assert.throws(()=>parseBilibili('TIN1NMTZ',work,{bvId:newBv()}));assert.throws(()=>parseBilibili('TIN1NMTZ',work,{workUrl:url(newBv())}));assert.throws(()=>parseBilibili('EH53TOT7',{mid},{mid:'1'}));assert.throws(()=>parseBilibili('VPA67I98',{mid,workList:[{...work,authorId:'1'}]},{mid}));assert.throws(()=>parseBilibili('VPA67I98',{mid:'1',workList:[]},{accountUrl:`https://space.bilibili.com/${mid}`}));
 const r=parseBilibili('TIN1NMTZ',{bvId:bv,title:'No author'},{workUrl:'https://b23.tv/Synthetic'})[0]!;assert.equal(r.data.url,url(bv));assert.deepEqual(r.data.identity,{});assert.equal((r.data.missing as string[]).length,0);
});
test('huge raw MID stays exact, empty pages consume receipts, malformed raw replays locally',async()=>{
 try{fixture=cases[1]!;rawOverride=`{"code":2000,"data":{"mid":${mid}}}`;const large=await query();assert.equal(large.run.status,'completed');assert.equal(large.results[0]!.data.identity.mid,mid);
 for(const c of cases.slice(2)){fixture=c;rawOverride=JSON.stringify({code:2000,data:c.id==='ZXJLJQ21'?{accountList:[]}:{mid,workList:[]}});const q=await query();assert.equal(q.run.status,'completed');assert.equal(q.results[0]!.kind,'query_summary');}
 fixture=cases[0]!;for(const raw of ['{broken',JSON.stringify({code:2000,data:{bvId:newBv()}}),JSON.stringify({code:2000,data:{}})]){rawOverride=raw;const q=await query();assert.equal(q.run.status,'needs_review');const initial=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));await step(q.run.id);assert.equal(hits,initial);assert.equal((await sql`SELECT status FROM receipts WHERE id=${q.run.current_receipt_id}`)[0]!.status,'received');process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-bili';}
 }finally{rawOverride=undefined;}
});
test('HTTP invalid URLs reject before run or outbound; catalog free, valid query and local import idempotent',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic Bilibili admin'};try{const initial=hits;const catalog=(await app.inject({url:'/api/admin/redfox/operations'})).json() as {id:string;platform:string}[];for(const c of cases)assert.equal(catalog.filter(o=>o.platform==='bilibili'&&o.id===c.id).length,1);const [before]=await sql`SELECT count(*)::int AS count FROM operation_runs`;
 for(const payload of [{operationId:'VPA67I98',parameters:{accountUrl:'https://example.com'}},{operationId:'TIN1NMTZ',parameters:{workUrl:'https://example.com'}}])assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload})).statusCode,400);
 assert.equal((await sql`SELECT count(*)::int AS count FROM operation_runs`)[0]!.count,before!.count);assert.equal(hits,initial);
 fixture=cases[1]!;const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:fixture.id,parameters:fixture.parameters};const a=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload});assert.equal(a.statusCode,202,a.body);assert.deepEqual((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload})).json(),a.json());assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload:{...payload,parameters:{mid:'1'}}})).statusCode,409);await step(a.json().runId);const [r]=await sql`SELECT id FROM operation_results WHERE run_id=${a.json().runId}`;process.env.REDFOX_CALLS_ENABLED='false';const calls=hits,importHeaders={'x-csrf-token':'dev','idempotency-key':tag()},request={method:'POST' as const,url:`/api/admin/operations/results/${r!.id}/import`,headers:importHeaders,payload:{reason:'Received account'}};const imported=await app.inject(request);assert.equal(imported.statusCode,200,imported.body);assert.deepEqual((await app.inject(request)).json(),imported.json());assert.equal(hits,calls);
 }finally{process.env.REDFOX_CALLS_ENABLED='true';config.devAdmin=null;await app.close();}
});
test('received MID imports concurrently once; account conflicts remain strict; authorless works use explicit owner and disabled owners refuse',async()=>{
 const uid=newMid(),one=await accountResult(uid),two=await accountResult(uid),key=tag(),initial=hits;process.env.REDFOX_CALLS_ENABLED='false';let sourceId:string;try{const [a,b]=await Promise.all([load(one.id,{reason:'Received'},'test',key),load(two.id,{reason:'Same'},'test',tag())]);sourceId=a!.sourceId;assert.equal(sourceId,b!.sourceId);assert.equal((await sql`SELECT participation_mode FROM sources WHERE id=${sourceId}`)[0]!.participation_mode,'isolated');assert.equal(hits,initial);await assert.rejects(load(one.id,{reason:'Changed',sourceId},'test',key),{code:'conflict'});}finally{process.env.REDFOX_CALLS_ENABLED='true';}
 const owner=await external(),known=newMid();await load((await accountResult(known)).id,{sourceId:owner,reason:'Explicit received owner'},'test',tag());await assert.rejects(load((await accountResult(newMid())).id,{sourceId:owner,reason:'Replace identity'},'test',tag()),{code:'conflict'});
 const missing=await workResult({bvId:newBv(),title:'No author'});await assert.rejects(load(missing.id,{reason:'Missing'},'test',tag()),/associated source/);const manual=await load(missing.id,{sourceId:owner,reason:'Verified missing author'},'test',tag());assert.equal(manual!.sourceId,owner);assert.equal((await sql`SELECT site_fulltext FROM sources WHERE id=${manual!.sourceId}`)[0]!.site_fulltext,true);
 await sql`UPDATE sources SET enabled=false WHERE id=${owner}`;await assert.rejects(load((await workResult({...work,bvId:newBv(),authorId:known})).id,{sourceId:owner,reason:'Paused'},'test',tag()),/disabled/);
});
test('VPA outer MID survives import and local time remains unknown; fresh zoned time/media use material policy',async()=>{
 const uid=newMid(),owner=await external();await load((await accountResult(uid)).id,{sourceId:owner,reason:'Received author'},'test',tag());const bvId=newBv();fixture={...cases[4]!,parameters:{mid:uid},data:{mid:uid,workList:[{bvId,title:'Account video',description:'Synthetic content',created:'2001-01-01 12:00:00',picUrl:'https://example.com/cover.jpg'}]}};const r=(await query()).results[0]!,a=await load(r.id,{sourceId:owner,reason:'Account list provenance'},'test',tag());assert.equal(a!.sourceId,owner);const [saved]=await sql`SELECT * FROM articles WHERE id=${a!.articleId!}`;assert.equal(saved!.published_at,null);assert.equal(saved!.backfill,true);assert.equal(saved!.media[0].kind,'image');assert.equal(saved!.identity_key,`bilibili:bvId:${bvId}`);
 for(const [created,historical] of [[new Date().toISOString(),false],['2001-01-01T00:00:00Z',true],['broken',true]] as const){const value=await load((await workResult({...work,bvId:newBv(),authorId:uid,created})).id,{sourceId:owner,reason:'Timeline'},'test',tag());assert.equal((await sql`SELECT backfill FROM articles WHERE id=${value!.articleId!}`)[0]!.backfill,historical);}
 const missingBV=await workResult({title:'No BV',authorId:uid,picUrl:'https://example.com/image'});await assert.rejects(load(missingBV.id,{reason:'No original'},'test',tag()),/permalink/);
});
test('material owner conflicts roll back new author identity and result link; received kind/model remain required',async()=>{
 const {newArticleId}=await import('@aihot/backend/lib/ids'),{identityKeyForUrl}=await import('@aihot/backend/lib/url');const owner=await external(),bvId=newBv(),uid=newMid();
 for(const token of ['one','two']){const original=url(bvId)+'?token='+token;await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES (${newArticleId()},${owner},${identityKeyForUrl(original)!},${original},'Legacy',now(),now())`;}
 const r=await workResult({...work,bvId,authorId:uid});await assert.rejects(load(r.id,{sourceId:owner,reason:'Conflicting owners'},'test',tag()),{code:'conflict'});assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='bilibili' AND id_value=${uid}`).length,0);assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${r.id}`)[0]!.source_id,null);
 const wrong=await accountResult(newMid());await sql`UPDATE operation_results SET kind='bilibili_work' WHERE id=${wrong.id}`;await assert.rejects(load(wrong.id,{reason:'Wrong kind'},'test',tag()),/kind/);
 const missingReceipt=await accountResult(newMid());await sql`UPDATE operation_results SET receipt_id=NULL WHERE id=${missingReceipt.id}`;await assert.rejects(load(missingReceipt.id,{reason:'No receipt'},'test',tag()),/confirmed/);
});
test('verified native URL fills only missing BV original without changing received author or record',async()=>{
 const uid=newMid(),owner=await external();await load((await accountResult(uid)).id,{sourceId:owner,reason:'Received owner'},'test',tag());
 const record={title:'Synthetic missing original',authorId:uid,description:'Received body'},r=await workResult(record),bvId=newBv(),initial=hits;
 await assert.rejects(load(r.id,{reason:'Still missing original'},'test',tag()),/permalink/);
 for(const address of ['https://example.com/video/'+bvId,'https://b23.tv/Synthetic'])await assert.rejects(load(r.id,{reason:'Unsupported URL evidence',supplement:{url:address,evidence:'Synthetic evidence'}},'test',tag()),/native Bilibili/);
 process.env.REDFOX_CALLS_ENABLED='false';try{const imported=await load(r.id,{sourceId:owner,reason:'Verified original URL',supplement:{url:url(bvId),evidence:'Synthetic independently verified original'}},'test',tag());assert.equal(imported!.sourceId,owner);assert.equal(hits,initial);const [a]=await sql`SELECT identity_key,raw FROM articles WHERE id=${imported!.articleId!}`;assert.equal(a!.identity_key,`bilibili:bvId:${bvId}`);assert.equal(a!.raw.supplement.url,url(bvId));assert.equal((await sql`SELECT site_fulltext FROM sources WHERE id=${owner}`)[0]!.site_fulltext,true);assert.deepEqual((await sql`SELECT data FROM operation_results WHERE id=${r.id}`)[0]!.data.record,record);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
 const received=await workResult({...record,bvId:newBv()});await assert.rejects(load(received.id,{reason:'Cannot replace received BV',supplement:{url:url(newBv()),evidence:'Different original'}},'test',tag()),{code:'conflict'});
});

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
import {toutiaoOperations,type ToutiaoOperation} from '@aihot/backend/providers/redfox/toutiao-contract';
import {toutiaoWorkId} from '@aihot/backend/lib/url';
import {parseToutiao} from '@aihot/backend/providers/redfox/toutiao';
const id='900719925474099312345';
const work={caption:'Synthetic caption',nickname:'Synthetic nickname',videoUrl:'https://example.com/media.mp4',publishTime:'2020-01-01 12:00:00',duration:57000};
let operation:ToutiaoOperation='28CFGF5I',parameters:Record<string,unknown>={keyword:'synthetic',offset:'0'},data:unknown={list:[work]},raw:string|undefined,hits=0,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,toutiaoOperations[operation].path);assert.equal(req.headers.redfox_api_key,'fake-toutiao');assert.deepEqual(JSON.parse(body),toutiaoOperations[operation].schema.parse(parameters));res.end(raw??JSON.stringify(operation==='4QS1F8DE'?data:{code:2000,data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});});
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-toutiao';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:operation,parameters},'toutiao-test',tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test('four exact POST/body contracts keep returned IDs separate from token and preserve raw pagination types',async()=>{
 const before=hits;for(const [op,p,d] of [
 ['28CFGF5I',{keyword:'synthetic',offset:'0001'},[{opusId:id,uid:'123',opusUrl:`https://www.toutiao.com/a${id}/?original=keep`,title:'Synthetic',publishTime:'1700000000',pageCount:10,hasNext:false}]],
 ['PAB6Z75Y',{opusId:id},{workId:id,workUrl:`https://toutiao.com/group/${id}/`,title:'Detail',content:'Synthetic complete body',authorName:'Not stable identity',workType:false,hasVideo:false,publishTime:'2020-01-01 12:00:00',duration:'0'}],
 ['4QS1F8DE',{name:'synthetic',offset:'',searchId:' opaque/+== '},{list:[{uid:'123',nickname:'Synthetic',homeUrl:'https://www.toutiao.com/c/user/123/'}],hasMore:false,offset:' opaque-next ',searchId:' raw-search ',updateTime:'2020-01-01 12:00:00'}],
 ['R1IGR09H',{category:'profile_all',token:'Opaque_token',offset:'0'},{workList:[{workId:id,secUid:'Received_other_token',title:'Synthetic list',workUrl:`https://www.toutiao.com/article/${id}/`,duration:30,repostCount:null}],hasMore:false,offset:123}],
 ] as [ToutiaoOperation,Record<string,unknown>,unknown][]){operation=op;parameters=p;data=d;const q=await query();assert.equal(q.run.status,'completed');const r=q.results[0]!.data;
 if(op==='28CFGF5I'){assert.deepEqual(r.identity,{uid:'123'});assert.equal(r.publishTimeUnit,'seconds');assert.equal(r.record.hasNext,false);assert.equal(q.results.at(-1)!.data.hasMore,undefined);}
 if(op==='PAB6Z75Y'){assert.deepEqual(r.identity,{});assert.equal(r.record.content,'Synthetic complete body');assert.equal(r.record.workType,false);assert.equal(r.record.hasVideo,false);assert.equal(r.requestedWorkId,id);}
 if(op==='4QS1F8DE'){assert.deepEqual(r.identity,{uid:'123'});assert.equal(q.results.at(-1)!.data.hasMore,false);assert.equal(q.results.at(-1)!.data.offset,' opaque-next ');}
 if(op==='R1IGR09H'){assert.deepEqual(r.identity,{secUid:'Received_other_token'});assert.equal(r.durationUnit,'seconds');assert.equal(r.record.repostCount,null);assert.equal(q.results.at(-1)!.data.hasMore,false);}}
 assert.equal(hits,before+4);
});
test('required digits strings, exact category and identity conflicts are enforced without fabricating missing identities',async()=>{
 for(const p of [{keyword:'x'},{keyword:'x',offset:0},{keyword:'x',offset:'abc'}])assert.equal(toutiaoOperations['28CFGF5I'].schema.safeParse(p).success,false);
 for(const p of [{category:'all',token:'x',offset:'0'},{category:'profile_all',offset:'0'}])assert.equal(toutiaoOperations.R1IGR09H.schema.safeParse(p).success,false);
 assert.throws(()=>parseToutiao('PAB6Z75Y',{workId:'2',title:'Wrong'},{opusId:'1'}));
 const missing=parseToutiao('PAB6Z75Y',{title:'No identifiers',authorName:'Display only',workUrl:'javascript:bad'},{opusId:id})[0]!;assert.equal(missing.data.workId,null);assert.equal(missing.data.requestedWorkId,id);assert.deepEqual(missing.data.identity,{});assert.equal(missing.data.url,null);assert.equal(missing.data.missing instanceof Array,true);
 assert.throws(()=>parseToutiao('PAB6Z75Y',{},{}));assert.throws(()=>parseToutiao('4QS1F8DE',{},{}));assert.deepEqual(parseToutiao('4QS1F8DE',{list:[{nickname:'Only nickname'}]},{} )[0]!.data.identity,{});
 const before=hits,key=tag();await assert.rejects(createSynchronousQuery({operationId:'R1IGR09H',parameters:{category:'bad',token:'x',offset:'0'}},'toutiao-invalid',key));assert.equal((await sql`SELECT 1 FROM operation_runs WHERE actor='toutiao-invalid' AND command_key=${key}`).length,0);assert.equal(hits,before);
});
test('empty search has only actual count; absent and false pagination remain distinct',async()=>{
 operation='28CFGF5I';parameters={keyword:'empty',offset:'0'};data=[];const q=await query();assert.equal(q.run.status,'completed');assert.equal(q.results[0]!.data.count,0);assert.equal(q.results[0]!.data.hasNext,undefined);assert.equal(q.results[0]!.data.offset,undefined);
 assert.equal(parseToutiao('4QS1F8DE',{list:[]},{}).at(-1)!.data.hasMore,undefined);assert.equal(parseToutiao('R1IGR09H',{workList:[],hasMore:false,offset:0},{}).at(-1)!.data.hasMore,false);
});
test('lossless response IDs and large integer offset do not round through Number',async()=>{
 operation='R1IGR09H';parameters={category:'pc_profile_video',token:'Opaque',offset:id};raw=`{"code":2000,"data":{"workList":[{"workId":${id},"title":"Synthetic","secUid":"opaque-author"}],"hasMore":false,"offset":${id}}}`;
 try{const q=await query();assert.equal(q.run.status,'completed');assert.equal(q.results[0]!.data.workId,id);assert.equal(q.results[1]!.data.offset,id);}finally{raw=undefined;}
});
test('root-account exception rejects explicit error codes and malformed bodies, retains raw and permits offline reread',async()=>{
 operation='4QS1F8DE';parameters={name:'bad'};
 try{for(const response of ['{bad','{}',JSON.stringify({code:5000,list:[]})]){raw=response;const q=await query();assert.equal(q.run.status,'needs_review');const before=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));await step(q.run.id);assert.equal(hits,before);const [r]=await sql`SELECT response,attempts,status FROM receipts WHERE id=${q.run.current_receipt_id}`;assert.equal(r!.response.body,response);assert.equal(r!.attempts,1);assert.equal(r!.status,'received');process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-toutiao';}
 operation='28CFGF5I';parameters={keyword:'no envelope',offset:'0'};raw='[]';assert.equal((await query()).run.status,'needs_review');}finally{raw=undefined;}
});
test('HTTP catalog and GET reads have no outbound effect; command idempotency and bad400 hold',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic Toutiao admin'};
 try{const before=hits,catalog=await app.inject({url:'/api/admin/redfox/operations'});assert.equal(catalog.json().filter((r:{id:string})=>r.id in toutiaoOperations).length,4);const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:'28CFGF5I',parameters:{keyword:'synthetic',offset:'0'}},url='/api/admin/redfox/queries';const a=await app.inject({method:'POST',url,headers,payload});assert.equal(a.statusCode,202);assert.deepEqual((await app.inject({method:'POST',url,headers,payload})).json(),a.json());assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,parameters:{keyword:'different',offset:'0'}}})).statusCode,409);assert.equal((await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':tag()},payload:{...payload,parameters:{keyword:'x'}}})).statusCode,400);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}`})).statusCode,200);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}/results`})).statusCode,200);await assert.rejects(createSynchronousQuery({...payload,sourceResultId:1},'toutiao-origin',tag()),/only/);assert.equal(hits,before);}finally{config.devAdmin=null;await app.close();}
});

test('strict native original paths preserve ID strings and reject conflicting or unsupported addresses',()=>{
 for(const path of [`a${id}`,`group/${id}`,`article/${id}`,`video/${id}`])for(const host of ['http://www.toutiao.com','https://toutiao.com']){
  const url=`${host}/${path}/?unrelated=keep`;
  assert.equal(toutiaoWorkId(url),id);
  const r=parseToutiao('PAB6Z75Y',{title:'Native URL evidence',workUrl:url},{opusId:id})[0]!;
  assert.equal(r.data.workId,id);assert.equal(r.data.url,url);
 }
 for(const url of [`https://toutiao.com:443/article/${id}`,`https://u@toutiao.com/article/${id}`,`https://toutiao.com/article/${id}#fragment`,`https://toutiao.com/123`, `https://toutiao.com/c/user/token/${id}/`,`https://example.com/article/${id}`])assert.equal(toutiaoWorkId(url),null);
 assert.throws(()=>parseToutiao('28CFGF5I',[{opusId:id,opusUrl:'https://toutiao.com/group/123/',title:'Mismatch'}],{}),/original differs/);
 assert.throws(()=>parseToutiao('PAB6Z75Y',{workUrl:'https://toutiao.com/article/123/',title:'Mismatch'},{opusId:id}),/requested/);
 const origin={resultId:1,workId:id,uid:'42',discoveredAt:new Date().toISOString()};
 assert.throws(()=>parseToutiao('PAB6Z75Y',{workId:id,uid:'43'},{opusId:id},origin),/author differs/);
 const detail=parseToutiao('PAB6Z75Y',{title:'No ID echoed'},{opusId:id},origin)[0]!;
 assert.equal(detail.data.workId,null);assert.deepEqual(detail.data.identity,{uid:'42'});
});
test('search and account-work origin freeze distinct author evidence with original discovery and idempotency',async()=>{
 for(const sourceOp of ['28CFGF5I','R1IGR09H'] as const)for(const known of [true,false]){
  operation=sourceOp;parameters=sourceOp==='28CFGF5I'?{keyword:'origin',offset:'0'}:{category:'profile_all',token:'Not-an-author',offset:'0'};
  const identity=known?(sourceOp==='28CFGF5I'?{uid:'123'}:{secUid:'opaque_received'}):{};
  const record={...(sourceOp==='28CFGF5I'?{opusId:id}:{workId:id}),title:'Origin work',...identity};
  data=sourceOp==='28CFGF5I'?[record]:{workList:[record]};const source=await query(),result=source.results[0]!;
  await sql`UPDATE operation_results SET created_at=now()-interval '10 days' WHERE id=${result.id}`;
  const [original]=await sql`SELECT created_at FROM operation_results WHERE id=${result.id}`;
  const body={operationId:'PAB6Z75Y',parameters:{opusId:id},sourceResultId:Number(result.id)},key=tag(),before=hits;
  await assert.rejects(createSynchronousQuery({...body,parameters:{opusId:'123'}},'toutiao-origin',tag()),/differs/);
  const run=await createSynchronousQuery(body,'toutiao-origin',key);
  assert.equal(hits,before);assert.equal((await row(run.id)).subscription_id,null);
  assert.deepEqual(run.input.origin,{resultId:Number(result.id),workId:id,...identity,discoveredAt:original!.created_at.toISOString()});
  await sql`UPDATE operation_results SET data='{}'::jsonb WHERE id=${result.id}`;
  assert.equal((await createSynchronousQuery(body,'toutiao-origin',key)).id,run.id);
  await assert.rejects(createSynchronousQuery(body,'toutiao-origin',tag()),/confirmed/);
  operation='PAB6Z75Y';parameters={opusId:id};data={workId:id,title:'Detail',workUrl:`https://toutiao.com/article/${id}/`,content:'Received body'};
  await step(run.id);assert.equal((await row(run.id)).status,'completed');
  const [r]=await sql`SELECT data FROM operation_results WHERE run_id=${run.id}`;
  assert.deepEqual(r!.data.identity,identity);assert.equal(r!.data.originResultId,Number(result.id));
  assert.equal((await row(source.run.id)).status,'completed');
 }
});
test('origin requires real operation/receipt proof and same-work conflicts retain raw for offline review',async()=>{
 operation='28CFGF5I';parameters={keyword:'proof',offset:'0'};data=[{opusId:id,uid:'567',title:'Proof'}];
 const source=await query(),result=source.results[0]!,body={operationId:'PAB6Z75Y',parameters:{opusId:id},sourceResultId:Number(result.id)};
 const before=hits;
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{identity}','{"uid":"fake-normalized"}'::jsonb) WHERE id=${result.id}`;
 const run=await createSynchronousQuery(body,'toutiao-proof',tag());assert.equal((run.input.origin as {uid:string}).uid,'567');
 await sql`UPDATE receipts SET model='not-toutiao' WHERE id=${result.receipt_id}`;
 await assert.rejects(createSynchronousQuery(body,'toutiao-proof',tag()),/confirmed/);
 await sql`UPDATE receipts SET model='28CFGF5I' WHERE id=${result.receipt_id}`;
 assert.equal(hits,before);
 operation='PAB6Z75Y';parameters={opusId:id};
 // A valid but different returned uid is an identity conflict, not a lost response.
 data={workId:id,uid:'568',title:'Conflict'};await step(run.id);const stopped=await row(run.id);assert.equal(stopped.status,'needs_review');
 const receivedHits=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:stopped.step_version,generation:stopped.generation}));await step(run.id);assert.equal(hits,receivedHits);assert.equal((await row(run.id)).status,'needs_review');assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${stopped.current_receipt_id}`)[0]!.attempts,1);}finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-toutiao';}
});

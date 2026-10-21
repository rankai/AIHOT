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
import {kuaishouOperations,type KuaishouOperation} from '@aihot/backend/providers/redfox/kuaishou-contract';
import {parseKuaishou} from '@aihot/backend/providers/redfox/kuaishou';
const id='900719925474099312345';
const work={caption:'Synthetic caption',nickname:'Synthetic nickname',videoUrl:'https://example.com/media.mp4',publishTime:'2020-01-01 12:00:00',duration:57000};
let operation:KuaishouOperation='ZWR31P2A',parameters:Record<string,unknown>={keyword:'synthetic'},data:unknown={list:[work]},raw:string|undefined,hits=0,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,kuaishouOperations[operation].path);assert.equal(req.headers.redfox_api_key,'fake-kuaishou');assert.deepEqual(JSON.parse(body),kuaishouOperations[operation].schema.parse(parameters));res.end(raw??JSON.stringify({code:2000,data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});});
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-kuaishou';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:operation,parameters},'kuaishou-test',tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test('four fixed POST requests emit documented defaults and preserve opaque IDs and nullable fields',async()=>{
 const before=hits,opaque='Opaque-photo_Id-AbC123=';
 for(const [op,p,d] of [
 ['GU17EVLV',{accountName:'synthetic'},{list:[{kwaiId:'DisplayOnly',nickname:'Synthetic'}],page:1,pageSize:20,total:80}],
 ['27DQ6SF9',{threeXId:'3xOpaqueProfile'},{list:[{...work,photoId:opaque,collectCount:null}],page:1,size:20}],
 ['UOM99OQI',{photoId:opaque},work],
 ['ZWR31P2A',{keyword:'synthetic'},{list:[{...work,photoId:id}],page:1,size:20}],
 ] as [KuaishouOperation,Record<string,unknown>,unknown][]){operation=op;parameters=p;data=d;const q=await query();assert.equal(q.run.status,'completed');assert.deepEqual(q.results[0]!.data.identity,{});assert.ok(q.results[0]!.data.missing.length);if(op==='GU17EVLV'){assert.equal(q.results[0]!.kind,'kuaishou_account');assert.equal(q.results[0]!.data.record.kwaiId,'DisplayOnly');}else{assert.equal(q.results[0]!.data.url,null);assert.equal(q.results[0]!.data.durationUnit,'milliseconds');assert.equal(q.results[0]!.data.duration,57000);assert.equal(q.results[0]!.data.record.publishTime,'2020-01-01 12:00:00');}if(op==='UOM99OQI'){assert.equal(q.results[0]!.data.workId,null);assert.equal(q.results[0]!.data.requestedWorkId,opaque);}if(op==='27DQ6SF9'){assert.equal(q.results[0]!.data.workId,opaque);assert.equal(q.results[0]!.data.record.collectCount,null);assert.equal(q.results[1]!.data.total,undefined);assert.equal(q.results[1]!.data.hasMore,undefined);}}
 assert.equal(hits,before+4);
});
test('normalization satisfies required/default conflict, exact-one locator and Chinese enum',async()=>{
 assert.deepEqual(kuaishouOperations.ZWR31P2A.schema.parse({keyword:'x'}),{keyword:'x',page:1,size:20,sort:'综合'});assert.deepEqual(kuaishouOperations.GU17EVLV.schema.parse({accountName:'x'}),{accountName:'x',page:1,pageSize:20});
 assert.ok(kuaishouOperations['27DQ6SF9'].schema.safeParse({kwaiId:'Display_123'}).success);assert.ok(kuaishouOperations['27DQ6SF9'].schema.safeParse({threeXId:'3xOpaque'}).success);
 for(const p of [{},{kwaiId:'x',threeXId:'y'},{kwaiId:123}])assert.equal(kuaishouOperations['27DQ6SF9'].schema.safeParse(p).success,false);
 for(const p of [{keyword:'x',sort:'latest'},{keyword:'x',page:'1'},{keyword:'x',size:51},{keyword:'x',page:0}])assert.equal(kuaishouOperations.ZWR31P2A.schema.safeParse(p).success,false);
 const before=hits,key=tag();await assert.rejects(createSynchronousQuery({operationId:'27DQ6SF9',parameters:{kwaiId:'x',threeXId:'y'}},'kuaishou-bad',key));assert.equal((await sql`SELECT 1 FROM operation_runs WHERE actor='kuaishou-bad' AND command_key=${key}`).length,0);assert.equal(hits,before);
});
test('empty pages preserve actual count and only received pagination metadata; empty objects reject',async()=>{
 assert.throws(()=>parseKuaishou('UOM99OQI',{}, {photoId:'opaque'}));assert.throws(()=>parseKuaishou('ZWR31P2A',{list:[{}]},{}));
 operation='GU17EVLV';parameters={accountName:'empty'};data={list:[],total:99,page:1,pageSize:20};const q=await query();assert.equal(q.run.status,'completed');assert.equal(q.results[0]!.data.count,0);assert.equal(q.results[0]!.data.total,99);assert.equal(q.results[0]!.data.hasMore,undefined);assert.equal((await sql`SELECT status FROM receipts WHERE id=${q.results[0]!.receipt_id}`)[0]!.status,'completed');
 const summary=parseKuaishou('ZWR31P2A',{list:[]},{}).at(-1)!;assert.equal(summary.data.total,undefined);assert.equal(summary.data.size,undefined);assert.equal(summary.data.hasMore,undefined);
});
test('raw large IDs remain strings; malformed raw is retained and offline replay adds no attempt',async()=>{
 operation='ZWR31P2A';parameters={keyword:'raw'};raw=`{"code":2000,"data":{"list":[{"photoId":${id},"caption":"Synthetic"}]}}`;const good=await query();assert.equal(good.results[0]!.data.workId,id);
 try{for(const response of ['{bad',JSON.stringify({code:2000,data:{list:[{}]}})]){raw=response;const q=await query();assert.equal(q.run.status,'needs_review');const before=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));await step(q.run.id);assert.equal(hits,before);const [r]=await sql`SELECT response,attempts,status FROM receipts WHERE id=${q.run.current_receipt_id}`;assert.equal(r!.response.body,response);assert.equal(r!.attempts,1);assert.equal(r!.status,'received');process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-kuaishou';}}finally{raw=undefined;}
});
test('HTTP catalog and reads are free; normalized defaults share command identity, invalid inputs400 and unsupported origin reject',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic Kuaishou admin'};
 try{const before=hits,catalog=await app.inject({url:'/api/admin/redfox/operations'});assert.equal(catalog.json().filter((r:{platform:string})=>r.platform==='kuaishou').length,4);const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:'ZWR31P2A',parameters:{keyword:'synthetic'}},url='/api/admin/redfox/queries';const a=await app.inject({method:'POST',url,headers,payload});assert.equal(a.statusCode,202);assert.deepEqual((await app.inject({method:'POST',url,headers,payload:{...payload,parameters:{keyword:'synthetic',page:1,size:20,sort:'综合'}}})).json(),a.json());assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,parameters:{keyword:'other'}}})).statusCode,409);assert.equal((await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':tag()},payload:{operationId:'27DQ6SF9',parameters:{kwaiId:'x',threeXId:'y'}}})).statusCode,400);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}`})).statusCode,200);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}/results`})).statusCode,200);await assert.rejects(createSynchronousQuery({...payload,sourceResultId:1},'kuaishou-origin',tag()),/only/);assert.equal(hits,before);}finally{config.devAdmin=null;await app.close();}
});

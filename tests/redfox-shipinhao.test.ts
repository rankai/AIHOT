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
import {shipinhaoOperations,isShipinhaoShareUrl,type ShipinhaoOperation} from '@aihot/backend/providers/redfox/shipinhao-contract';
import {parseShipinhao} from '@aihot/backend/providers/redfox/shipinhao';
const id='900719925474099312345',share='https://weixin.qq.com/sph/Synthetic_-Code?share=keep';
const work={description:'Synthetic description',nickname:'Synthetic nickname',videoUrl:'https://example.com/media.mp4',publishTime:'2020-01-01 12:00:00',videoDuration:'57'};
let operation:ShipinhaoOperation='E7G00COY',parameters:Record<string,unknown>={keyword:'synthetic'},data:unknown={list:[work]},raw:string|undefined,hits=0,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,shipinhaoOperations[operation].path);assert.equal(req.headers.redfox_api_key,'fake-shipinhao');assert.deepEqual(JSON.parse(body),parameters);res.end(raw??JSON.stringify({code:2000,data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:String(e)}));}});});
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-shipinhao';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:operation,parameters},'shipinhao-test',tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test('five exact POST/body transports retain received IDs separately from request and export identities',async()=>{
 const before=hits;
 const fixtures:[ShipinhaoOperation,Record<string,unknown>,unknown][]=[['E7G00COY',{keyword:'synthetic',sort:'最多点赞',page:2,size:50,exactMatch:false},{list:[{...work,videoId:id}],total:200,page:2,size:50}],['NL4I3533',{accountName:'synthetic',page:1,pageSize:20},{list:[{nickname:'Synthetic',findName:'not-author-id'}],page:1,pageSize:20,total:13}],['OE4KUEUO',{videoId:id},work],['OVUTOTCV',{nickname:'Synthetic',page:1,size:8},{list:[work],total:1,page:1,size:8}],['MH5YA9DL',{url:share},{exportId:'Export_Opaque',description:'Synthetic share',nickname:'Synthetic',forwardCount:'10万',publishTime:'2020-01-01 12:00:00'}]];
 for(const [op,p,d] of fixtures){operation=op;parameters=p;data=d;const q=await query();assert.equal(q.run.status,'completed');const result=q.results[0]!.data;assert.deepEqual(result.identity,{});assert.ok(result.missing.length);if(op==='E7G00COY'){assert.equal(result.workId,id);assert.equal(result.workIdKind,'videoId');}if(op==='OE4KUEUO'){assert.equal(result.workId,null);assert.equal(result.requestedWorkId,id);}if(op==='MH5YA9DL'){assert.equal(result.workIdKind,'exportId');assert.equal(result.workId,'Export_Opaque');assert.equal(result.inputUrl,share);assert.equal(result.url,null);}if(op==='OVUTOTCV'){assert.equal(result.workId,null);assert.equal(result.url,null);assert.equal(result.record.publishTime,work.publishTime);}}
 assert.equal(hits,before+5);
});
test('strict schemas preserve optional defaults while rejecting enums, string pages, oversized size and generic URLs',async()=>{
 assert.ok(shipinhaoOperations.E7G00COY.schema.safeParse({keyword:'x'}).success);assert.ok(shipinhaoOperations.E7G00COY.schema.safeParse({keyword:'x',exactMatch:false}).success);
 for(const p of [{keyword:'x',sort:'latest'},{keyword:'x',page:'1'},{keyword:'x',size:51},{keyword:'x',exactMatch:'false'},{keyword:'x',page:0}])assert.equal(shipinhaoOperations.E7G00COY.schema.safeParse(p).success,false);
 const before=hits;for(const url of ['https://example.com/sph/code','https://weixin.qq.com/other/code','https://weixin.qq.com:443/sph/code','https://u:p@weixin.qq.com/sph/code','https://weixin.qq.com/sph/code#x']){assert.equal(isShipinhaoShareUrl(url),false);const key=tag();await assert.rejects(createSynchronousQuery({operationId:'MH5YA9DL',parameters:{url}},'shipinhao-bad',key));assert.equal((await sql`SELECT 1 FROM operation_runs WHERE actor='shipinhao-bad' AND command_key=${key}`).length,0);}assert.equal(hits,before);assert.ok(isShipinhaoShareUrl(share));
});
test('missing IDs and nickname-only accounts remain usable research; empty pages count actual rows',async()=>{
 const account=parseShipinhao('NL4I3533',{list:[{nickname:'Only nickname'}]},{});assert.deepEqual(account[0]!.data.identity,{});assert.equal(account[0]!.kind,'shipinhao_account');
 assert.throws(()=>parseShipinhao('OE4KUEUO',{}, {videoId:id}));assert.throws(()=>parseShipinhao('E7G00COY',{list:[{}]},{}));
 operation='E7G00COY';parameters={keyword:'empty'};data={list:[],total:999,page:1,size:20};const q=await query();assert.equal(q.run.status,'completed');assert.equal(q.results.length,1);assert.equal(q.results[0]!.data.count,0);assert.equal(q.results[0]!.data.total,999);assert.equal((await sql`SELECT status FROM receipts WHERE id=${q.results[0]!.receipt_id}`)[0]!.status,'completed');
});
test('raw integer ID retains exact digits and malformed raw replays locally without new attempts',async()=>{
 operation='E7G00COY';parameters={keyword:'raw'};raw=`{"code":2000,"data":{"list":[{"videoId":${id},"description":"Synthetic"}]}}`;const good=await query();assert.equal(good.results[0]!.data.workId,id);
 try{for(const response of ['{broken',JSON.stringify({code:2000,data:{list:[{}]}})]){raw=response;const q=await query();assert.equal(q.run.status,'needs_review');const before=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));await step(q.run.id);assert.equal(hits,before);const [r]=await sql`SELECT response,attempts,status FROM receipts WHERE id=${q.run.current_receipt_id}`;assert.equal(r!.response.body,response);assert.equal(r!.attempts,1);assert.equal(r!.status,'received');process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-shipinhao';}}finally{raw=undefined;}
});
test('catalog/read are free; invalid URL is HTTP400, query idempotent, unverified origin rejected',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic channel admin'};
 try{const before=hits,catalog=await app.inject({url:'/api/admin/redfox/operations'});const entries=catalog.json().filter((x:{platform:string})=>x.platform==='shipinhao');assert.equal(entries.length,5);assert.deepEqual(Object.fromEntries(entries.map((x:{id:string;schedulableType:unknown})=>[x.id,x.schedulableType])),{E7G00COY:'search',OVUTOTCV:'list',NL4I3533:null,OE4KUEUO:null,MH5YA9DL:null});const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:'OE4KUEUO',parameters:{videoId:id}},url='/api/admin/redfox/queries';const a=await app.inject({method:'POST',url,headers,payload});assert.equal(a.statusCode,202);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}`})).statusCode,200);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}/results`})).statusCode,200);assert.deepEqual((await app.inject({method:'POST',url,headers,payload})).json(),a.json());assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,parameters:{videoId:'other'}}})).statusCode,409);assert.equal((await app.inject({method:'POST',url,headers:{...headers,'idempotency-key':tag()},payload:{operationId:'MH5YA9DL',parameters:{url:'https://example.com'}}})).statusCode,400);await assert.rejects(createSynchronousQuery({...payload,sourceResultId:1},'shipinhao-origin',tag()),/confirmed work evidence/);assert.equal(hits,before);}finally{config.devAdmin=null;await app.close();}
});

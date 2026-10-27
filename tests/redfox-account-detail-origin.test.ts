import {tag,assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {resultDetailOptions} from '@aihot/backend/providers/redfox/account-detail-options';
import {accountDetailOrigin} from '@aihot/backend/providers/redfox/account-detail-origin';
import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {importWeiboResult} from '@aihot/backend/providers/redfox/import-weibo';
import {importDouyinResult} from '@aihot/backend/providers/redfox/import-douyin';
import {importXiaohongshuResult} from '@aihot/backend/providers/redfox/import-xiaohongshu';
import {importWechatResult} from '@aihot/backend/providers/redfox/import-wechat';
import {importBilibiliResult} from '@aihot/backend/providers/redfox/import-bilibili';
import {importBaijiahaoResult} from '@aihot/backend/providers/redfox/import-baijiahao';
import Fastify from 'fastify';
import {registerAdminOperationDetails} from '../apps/api/src/routes/admin-operation-details.ts';
let data:unknown={},hits=0,budgets:Record<string,any>[]=[];
const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{hits++;res.end(JSON.stringify({code:2000,data}));});});
const on=()=>{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='synthetic-account-origin';};
const off=()=>{process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;};
before(async()=>{const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;config.allowPrivateNetworkFetch=true;on();budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.query','redfox.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.query','redfox.collect')`;});
after(async()=>{try{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;}finally{off();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));try{await stopBoss();}finally{await closeDb();}}});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
const digits=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
interface Fixture{platform:string;op:string;p:Record<string,unknown>;page:unknown;target:string;request:Record<string,unknown>;detail:Record<string,unknown>;stable:Record<string,string>;importer:typeof importWeiboResult}
function fixture(platform:string):Fixture{
 const id=digits(),display=tag();
 if(platform==='weibo')return{platform,op:'API_1789098515245',p:{keyword:display,page:1},page:[{uid:id,nickname:'Source'}],target:'API_1789098515117',request:{userId:id},detail:{uid:id,nickname:'Detail'},stable:{uid:id},importer:importWeiboResult};
 if(platform==='douyin')return{platform,op:'P5CHB3BZ',p:{keyword:display},page:{list:[{uid:id,accountId:display,nickname:'Source'}]},target:'XUT4CECZ',request:{accountId:id},detail:{uid:id,displayId:display,nickname:'Detail'},stable:{uid:id},importer:importDouyinResult};
 if(platform==='xiaohongshu')return{platform,op:'439NFLBD',p:{keyword:display},page:{list:[{accountId:display,accountName:'Source'}]},target:'4IVIDHEN',request:{accountId:display},detail:{accountId:display,userId:id,accountName:'Detail'},stable:{userId:id},importer:importXiaohongshuResult};
 if(platform==='wechat')return{platform,op:'DNVPQZEZ',p:{keyword:display},page:{list:[{account:display,accountName:'Source'}]},target:'KUQYSQNX',request:{account:display},detail:{account:display,wxId:'gh_'+id,bizInfo:display,accountName:'Detail'},stable:{wxId:'gh_'+id,bizInfo:display},importer:importWechatResult};
 if(platform==='bilibili')return{platform,op:'ZXJLJQ21',p:{keyword:display,page:'1'},page:{accountList:[{mid:id,name:'Source'}]},target:'EH53TOT7',request:{mid:id},detail:{mid:id,name:'Detail'},stable:{mid:id},importer:importBilibiliResult};
 return{platform,op:'API_1789097000885',p:{keyword:display,page:'1'},page:{dataList:[{uk:display,title:'Source'}]},target:'API_1789097000814',request:{uk:display},detail:{uid:id,secUid:display,nickname:'Detail'},stable:{uid:id,secUid:display,uk:display},importer:importBaijiahaoResult};
}
async function query(op:string,p:Record<string,unknown>,payload:unknown,sourceResultId?:number){data=payload;on();const run=await createSynchronousQuery({operationId:op,parameters:p,...(sourceResultId?{sourceResultId}:{})},'account-origin-test',tag());await step(run.id);const current=await row(run.id);return{run:current,results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
for(const platform of ['weibo','douyin','xiaohongshu','wechat','bilibili','baijiahao'])test(`${platform}: received account locator → explicit detail → actual stable-ID binding`,async()=>{
 const f=fixture(platform),source=await query(f.op,f.p,f.page);assert.equal(source.run.status,'completed',source.run.wait_reason);const id=source.results[0]!.id;
 const n=hits;off();const options=await resultDetailOptions(id),choice=options!.choices.find(c=>c.operationId===f.target);assert.ok(choice);assert.deepEqual(choice.parameters,f.request);assert.equal(hits,n);
 const detail=await query(f.target,f.request,f.detail,id);assert.equal(detail.run.status,'completed',detail.run.wait_reason);assert.equal(detail.run.input.origin.kind,'account');assert.equal(detail.run.input.origin.sourceResultId,id);assert.equal(detail.results[0]!.data.originResultId,id);
 off();const received=detail.results[0]!.data.record??detail.results[0]!.data;for(const [key,value] of Object.entries(f.detail))assert.equal(received[key],value);
 const before=hits,bound=await f.importer(detail.results[0]!.id,{reason:'Synthetic received account detail'},'account-origin-test',tag());assert.ok(bound?.sourceId);
 const bindings=await sql`SELECT id_kind,id_value FROM source_account_bindings WHERE source_id=${bound.sourceId}`;for(const [kind,value] of Object.entries(f.stable))assert.ok(bindings.some(b=>b.id_kind===kind&&b.id_value===value),`${kind} not bound`);assert.equal(hits,before);assert.equal((await row(source.run.id)).status,'completed');
});
test('same-type conflict and missing returned IDs do not inherit or fabricate stable identity; no-origin query retains behavior',async()=>{
 const f=fixture('douyin'),source=await query(f.op,f.p,f.page),id=source.results[0]!.id;
 const bad=await query(f.target,f.request,{uid:'999',nickname:'Conflicting'},id);assert.equal(bad.run.status,'needs_review');assert.equal(bad.results.length,0);
 const missing=await query(f.target,f.request,{nickname:'Only nickname'},id);assert.equal(missing.run.status,'completed',missing.run.wait_reason);assert.deepEqual(missing.results[0]!.data.identity,{});await assert.rejects(importDouyinResult(missing.results[0]!.id,{reason:'Must not invent UID'},'account-origin-test',tag()));
 const ordinary=await query(f.target,f.request,{uid:'999',nickname:'Existing no-origin behavior'});assert.equal(ordinary.run.status,'completed');assert.equal(ordinary.results[0]!.data.originResultId,undefined);
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:{accountId:'another'},sourceResultId:id},'account-origin-test',tag()),/locator/);
});
test('only actual typed locators create account choices; aliases, nickname, secureId, and collector input cannot substitute',async()=>{
 const name=tag(),cases:[string,Record<string,unknown>,unknown][]=[['P5CHB3BZ',{keyword:name},{list:[{nickname:'Only name'}]}],['L6OUNUN1',{keyword:name},{list:[{displayName:'Only secure',secureId:'secure'}]}],['439NFLBD',{keyword:name},{list:[{accountName:'No display account',userId:'123'}]}],['I8P3HTVH',{keyword:name},{list:[{title:'AI',authorId:'123',photoId:'unproved'}]}],['QSL2ZSXM',{userId:'collector-id'},{list:[{videoId:'123',content:'author missing'}]}]];
 for(const [op,p,payload] of cases){const source=await query(op,p,payload);assert.equal(source.run.status,'completed',source.run.wait_reason);const options=await resultDetailOptions(source.results[0]!.id);assert.equal(options!.choices.some(c=>['XUT4CECZ','4IVIDHEN'].includes(c.operationId)),false);}
 const work=await query('QSL2ZSXM',{userId:'collector-id'},{list:[{videoId:'123',authorUid:'456',content:'actual other author'}]});assert.deepEqual((await resultDetailOptions(work.results[0]!.id))!.choices.find(c=>c.operationId==='XUT4CECZ')!.parameters,{accountId:'456'});
 const premium=await query('774OBKK0',{keyword:name},{list:[{workId:'123',authorId:'display-author',title:'test'}]});assert.deepEqual((await resultDetailOptions(premium.results[0]!.id))!.choices.find(c=>c.operationId==='XUT4CECZ')!.parameters,{accountId:'display-author'});
 const wx=await query('5Y84NI1D',{keyword:name},{list:[{account:'display',wxId:'gh_stable',bizInfo:'biz',accountName:'same record'}]});const choices=(await resultDetailOptions(wx.results[0]!.id))!.choices;assert.equal(choices.filter(c=>c.operationId==='KUQYSQNX').length,1);assert.deepEqual(choices.find(c=>c.operationId==='KUQYSQNX')!.parameters,{wxId:'gh_stable'});
 const conflict=await query('KUQYSQNX',{wxId:'gh_stable'},{wxId:'gh_stable',bizInfo:'wrong',accountName:'conflict'},wx.results[0]!.id);assert.equal(conflict.run.status,'needs_review');
});
test('actual collection page proof is required and local options GET is guarded and free',async()=>{
 const uid=digits();data={list:[{videoId:digits(),authorUid:uid,content:'Collected author'}],hasMore:false};on();
 const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:tag(),operationId:'OWIBYU1V',parameters:{keyword:tag()},enabled:true,limits:{pages:1,items:10,details:0}},'account-origin-test',tag());const run=await startPlatformSubscription(sub.id,'account-origin-test',tag());for(let i=0;i<15;i++){if((await row(run.id)).status!=='active')break;await step(run.id);}await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
 const [source]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='douyin_work'`;assert.ok(source);
 const proof=await accountDetailOrigin(sql,source!.id,'XUT4CECZ',{accountId:uid});assert.equal(proof.identity.uid,uid);
 const detail=await query('XUT4CECZ',{accountId:uid},{uid,nickname:'Collection author'},source!.id);assert.equal(detail.run.status,'completed',detail.run.wait_reason);off();assert.ok((await importDouyinResult(detail.results[0]!.id,{reason:'Collected actual author'},'account-origin-test',tag()))?.sourceId);
 const app=Fastify();registerAdminOperationDetails(app);const path=`/api/admin/operations/results/${source!.id}/detail-options`,before=hits;
 try{config.devAdmin=null;assert.equal((await app.inject({url:path})).statusCode,401);config.devAdmin={displayName:'Synthetic account origin'};const r=await app.inject({url:path});assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');assert.equal(hits,before);
 await sql`UPDATE operation_results SET provenance='{"sourcePageResultId":1}' WHERE id=${source!.id}`;await assert.rejects(accountDetailOrigin(sql,source!.id,'XUT4CECZ',{accountId:uid}),/page/);
 await sql`UPDATE operation_results SET receipt_id=NULL WHERE id=${source!.id}`;assert.equal((await app.inject({url:path})).statusCode,422);assert.equal(hits,before);
 }finally{config.devAdmin=null;await app.close();}
});

test('configured collection detail uses its proven receipt context for explicit account query, never derived locators',async()=>{
 const uid=digits(),videoId=digits(),page={list:[{videoId,content:'Collected original',authorUid:uid,opusUrl:`https://www.douyin.com/video/${videoId}`}],hasMore:false};
 on();data=page;
 const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:tag(),operationId:'OWIBYU1V',parameters:{keyword:tag()},enabled:true,enrichDetails:true,detailOperationId:'FK67XDVQ',limits:{pages:1,items:10,details:1}},'account-context-test',tag());
 const run=await startPlatformSubscription(sub.id,'account-context-test',tag());await step(run.id);await step(run.id);
 assert.equal((await row(run.id)).step_key,'redfox.platform.detail');
 data={videoId,content:'Actual detail',authorUid:uid,opusUrl:`https://www.douyin.com/video/${videoId}`};await step(run.id);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
 const [saved]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND provenance ? 'detailSourceResultId'`;assert.ok(saved);
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic context admin'};
 try{
 off();const calls=hits,path=`/api/admin/operations/results/${saved!.id}/detail-options`,options=await app.inject({url:path});assert.equal(options.statusCode,200,options.body);assert.equal(options.headers['cache-control'],'no-store');const choice=options.json().choices.find((c:{operationId:string})=>c.operationId==='XUT4CECZ');assert.deepEqual(choice.parameters,{accountId:uid});assert.equal(hits,calls);
 const response=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{operationId:'XUT4CECZ',parameters:choice.parameters,sourceResultId:saved!.id}});assert.equal(response.statusCode,202,response.body);assert.equal(hits,calls);
 const accountRun=response.json().runId;on();data={uid,nickname:'Confirmed detail author'};await step(accountRun);assert.equal((await row(accountRun)).status,'completed');const [account]=await sql`SELECT * FROM operation_results WHERE run_id=${accountRun}`;off();const bound=await importDouyinResult(account!.id,{reason:'Explicit account from formal collected detail'},'account-context-test',tag());assert.ok(bound?.sourceId);
 const missingRecord={...saved!.data.record};delete missingRecord.authorUid;
 await sql`UPDATE operation_results SET data=${sql.json({...saved!.data,record:missingRecord})} WHERE id=${saved!.id}`;
 assert.deepEqual((await resultDetailOptions(saved!.id))!.choices,[]);
 await sql`UPDATE operation_results SET data=${sql.json({...saved!.data,record:{...saved!.data.record,authorUid:'conflict'}})} WHERE id=${saved!.id}`;
 await assert.rejects(accountDetailOrigin(sql,saved!.id,'XUT4CECZ',{accountId:uid}),/conflict/);
 await sql`UPDATE operation_results SET data=${sql.json(saved!.data)} WHERE id=${saved!.id}`;
 const foreign=await query('OWIBYU1V',{keyword:tag()},page),foreignWork=foreign.results.find(r=>r.kind==='douyin_work')!;off();
 await sql`UPDATE operation_results SET provenance=${sql.json({...saved!.provenance,detailSourceResultId:foreignWork.id})} WHERE id=${saved!.id}`;await assert.rejects(accountDetailOrigin(sql,saved!.id,'XUT4CECZ',{accountId:uid}),/run|page/);
 await sql`UPDATE operation_results SET provenance=${sql.json({...saved!.provenance,detailSourceResultId:saved!.id})} WHERE id=${saved!.id}`;await assert.rejects(accountDetailOrigin(sql,saved!.id,'XUT4CECZ',{accountId:uid}));
 await sql`UPDATE operation_results SET provenance=${sql.json(saved!.provenance)} WHERE id=${saved!.id}`;
 const before=hits;assert.equal((await app.inject({url:path})).statusCode,200);assert.equal(hits,before);
 }finally{config.devAdmin=null;await app.close();}
});

const selectedSourceId=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${selectedSourceId},'Selected test source','external','isolated') ON CONFLICT(id) DO NOTHING`;return selectedSourceId;}

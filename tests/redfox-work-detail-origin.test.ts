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
import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {importDouyinResult} from '@aihot/backend/providers/redfox/import-douyin';
import {importXiaohongshuResult} from '@aihot/backend/providers/redfox/import-xiaohongshu';
import {importWechatResult} from '@aihot/backend/providers/redfox/import-wechat';
import {importTiktokResult} from '@aihot/backend/providers/redfox/import-tiktok';
import {importBilibiliResult} from '@aihot/backend/providers/redfox/import-bilibili';
import {resumeRun} from '@aihot/backend/providers/operations/store';
let data:unknown={},hits=0,code=2000;
const wire:{path:string,body:unknown}[]=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{hits++;wire.push({path:req.url!,body:body?JSON.parse(body):null});res.end(JSON.stringify({code,data}));});});
let budgets:Record<string,unknown>[]=[];
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;on();config.allowPrivateNetworkFetch=true;
 budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.query','redfox.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.query','redfox.collect')`;
});
after(async()=>{try{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute as number},per_hour=${b.per_hour as number},per_day=${b.per_day as number} WHERE service=${b.service as string}`;}finally{off();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));try{await stopBoss();}finally{await closeDb();}}});
function on(){process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='fake-origin';}
function off(){process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;}
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function finish(id:number){for(let n=0;n<20;n++){const r=await row(id);if(r.status!=='active')return r;await step(id);}throw Error('Fixture step bound');}
const digits=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
function fixture(platform:string){
 const id=digits(),author=digits(),note='Note_'+tag(),bv='BV'+randomUUID().replaceAll('-','').slice(0,10),biz='Biz'+tag(),uuid=tag();
 if(platform==='douyin')return {platform,source:'OWIBYU1V',parameters:{keyword:tag(),pageNum:1,pageSize:10},page:{list:[{videoId:id,content:'Original description',opusUrl:`https://www.douyin.com/video/${id}`,authorUid:author}],hasMore:false},target:'FK67XDVQ',request:{videoId:id},detail:{videoId:id,content:'Later detail',opusUrl:`https://www.douyin.com/video/${id}`},identity:{uid:author},importer:importDouyinResult};
 if(platform==='xiaohongshu')return {platform,source:'384C6W6B',parameters:{keyword:tag()},page:{list:[{workId:note,workTitle:'Source',workUrl:`https://www.xiaohongshu.com/explore/${note}`,accountUserid:author}],hasMore:false},target:'KR1LPTBF',request:{workId:note},detail:{workId:note,workTitle:'Detail',workDesc:'Detail description',workUrl:`https://www.xiaohongshu.com/explore/${note}`},identity:{userId:author},importer:importXiaohongshuResult};
 if(platform==='wechat')return {platform,source:'FVQ8D4W5',parameters:{keyword:tag()},page:{list:[{workUuid:uuid,title:'Source',workUrl:`https://mp.weixin.qq.com/s/Synthetic${uuid}`,bizInfo:biz}],hasMore:false},target:'1LDQ7E1C',request:{workUuid:uuid},detail:{workUuid:uuid,title:'Detail',content:'<p>Detail body</p>',workUrl:`https://mp.weixin.qq.com/s/Synthetic${uuid}`},identity:{bizInfo:biz},importer:importWechatResult};
 if(platform==='tiktok')return {platform,source:'R473NUE9',parameters:{secUserId:author},page:[{workId:id,content:'Source',shareLink:`https://www.tiktok.com/@synthetic/video/${id}`,authorData:{userId:author,secUserId:author}}],target:'6SE9WIHJ',request:{awemeId:id},detail:{workId:id,content:'Detail',shareLink:`https://www.tiktok.com/@synthetic/video/${id}`},identity:{userId:author,secUserId:author},importer:importTiktokResult};
 return {platform,source:'VPA67I98',parameters:{mid:author},page:{mid:author,workList:[{bvId:bv,title:'Source',description:'Source body'}]},target:'TIN1NMTZ',request:{bvId:bv},detail:{bvId:bv,title:'Detail',description:'Later detail'},identity:{mid:author},importer:importBilibiliResult};
}
async function source(f:ReturnType<typeof fixture>,collection=false){
 data=f.page;code=2000;on();let run;
 if(collection){const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:tag(),operationId:f.source,parameters:f.parameters,enabled:true,limits:{pages:1,items:10,details:0}},'origin-test',tag());run=await startPlatformSubscription(sub.id,'origin-test',tag());await step(run.id);await sql`UPDATE operation_results SET created_at='2020-02-03T04:05:06Z' WHERE run_id=${run.id} AND kind='query_summary'`;await finish(run.id);}
 else{run=await createSynchronousQuery({operationId:f.source,parameters:f.parameters},'origin-test',tag());await finish(run.id);await sql`UPDATE operation_results SET created_at='2020-02-03T04:05:06Z' WHERE run_id=${run.id}`;}
 assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);
 const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind=${f.platform+'_work'} ORDER BY id`;assert.ok(result);return {run,result:result!};
}
for(const platform of ['douyin','xiaohongshu','wechat','tiktok','bilibili'])for(const collection of [false,true])test(`${platform}: ${collection?'collection page':'query'} → authorless detail → local import preserves discovery and parent`,async()=>{
 const f=fixture(platform),s=await source(f,collection),parent=await row(s.run.id),before=hits;
 const prior=s.result.article_id?(await sql`SELECT body_text,body_html,revision,processing_state FROM articles WHERE id=${s.result.article_id}`)[0]:undefined;
 const body={operationId:f.target,parameters:f.request,sourceResultId:Number(s.result.id)},key=tag(),run=await createSynchronousQuery(body,'origin-test',key);
 assert.equal((await row(run.id)).subscription_id,null);assert.equal((run.input.origin as {discoveredAt:string}).discoveredAt,'2020-02-03T04:05:06.000Z');assert.equal(hits,before);
 data=f.detail;await step(run.id);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);const [detail]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.deepEqual(detail!.data.identity,f.identity);assert.equal(detail!.data.originResultId,s.result.id);
 const calls=hits;off();try{const imported=await f.importer(Number(detail!.id),{sourceId:await selectedSource(),reason:'Confirmed same work'},'origin-test',tag());assert.ok(imported?.articleId);const [article]=await sql`SELECT discovered_at,source_id,body_text FROM articles WHERE id=${imported.articleId}`;assert.equal(article!.discovered_at.toISOString(),'2020-02-03T04:05:06.000Z');if(collection&&s.result.article_id){assert.equal(imported.articleId,s.result.article_id);assert.equal(imported.sourceId,s.result.source_id);if(prior?.body_text||prior?.body_html){const [current]=await sql`SELECT body_text,body_html FROM articles WHERE id=${imported.articleId}`;assert.deepEqual(current,{body_text:prior.body_text,body_html:prior.body_html});}}assert.equal(hits,calls);}finally{on();}
 assert.equal((await row(s.run.id)).status,parent.status);assert.equal((await row(s.run.id)).step_version,parent.step_version);
 await sql`UPDATE operation_results SET data='{}' WHERE id=${s.result.id}`;assert.equal((await createSynchronousQuery(body,'origin-test',key)).id,run.id);
});
test('wrong work/library, forged normalized identity and foreign page are rejected before any call',async()=>{
 const f=fixture('douyin'),s=await source(f,true),before=hits;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:{videoId:'123'},sourceResultId:s.result.id},'origin-test',tag()));
 await assert.rejects(createSynchronousQuery({operationId:'0OT1E306',parameters:{workId:f.request.videoId},sourceResultId:s.result.id},'origin-test',tag()));
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{identity}','{"uid":"forged"}') WHERE id=${s.result.id}`;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-test',tag()),/identity/);
 await sql`UPDATE operation_results SET data=${sql.json(s.result.data)},provenance=jsonb_set(provenance,'{sourcePageResultId}',to_jsonb(1)) WHERE id=${s.result.id}`;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-test',tag()),/page/);assert.equal(hits,before);
 const bili=fixture('bilibili'),b=await source(bili,true),calls=hits;await sql`UPDATE operation_results SET data=jsonb_set(data,'{accountMid}','"123"') WHERE id=${b.result.id}`;await assert.rejects(createSynchronousQuery({operationId:bili.target,parameters:bili.request,sourceResultId:b.result.id},'origin-test',tag()),/MID/);assert.equal(hits,calls);
});
test('received author conflict remains raw and offline replay never calls again; import revalidates origin and raw record',async()=>{
 const f=fixture('douyin'),s=await source(f),run=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-test',tag());data={...f.detail,authorUid:'different'};await step(run.id);assert.equal((await row(run.id)).status,'needs_review');const before=hits;off();try{const r=await row(run.id);await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:r.step_version,generation:r.generation}));await step(run.id);assert.equal(hits,before);assert.equal((await row(run.id)).status,'needs_review');}finally{on();}
 const good=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-test',tag());data=f.detail;await step(good.id);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${good.id}`;
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{record,authorUid}','"different"') WHERE id=${result!.id}`;
 await assert.rejects(f.importer(Number(result!.id),{sourceId:await selectedSource(),reason:'Forged record'},'origin-test',tag()),/author conflicts/);
 assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${result!.id}`)[0]!.article_id,null);
});
test('growth min work keeps its own URL and account; I3 long/short scope rejects known article or author conflict',async()=>{
 const biz='Biz'+tag(),gh='gh_'+randomUUID().replaceAll('-',''),max=`https://mp.weixin.qq.com/s/Max${tag()}`,min=`https://mp.weixin.qq.com/s?__biz=${biz}&mid=42&idx=1`;
 on();data=[{accountId:gh,accountName:'Synthetic',maxWork:{title:'Max',workUrl:max},minWork:{title:'Min',workUrl:min}}];
 const parent=await createSynchronousQuery({operationId:'DL4YNCTQ',parameters:{rankDate:'2026-10-01'}},'origin-test',tag());await step(parent.id);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${parent.id} AND item_key='rank:0:minWork'`;
 const run=await createSynchronousQuery({operationId:'I3CIBRI2',parameters:{articleUrl:min},sourceResultId:result!.id},'origin-test',tag());assert.equal((run.input.origin as {url:string}).url,min);
 code=200;data={articleTitle:'Min detail',articleUrl:`https://mp.weixin.qq.com/s/Returned${tag()}`,articleContent:'<p>Min body</p>'};await step(run.id);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);const [detail]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;off();try{assert.ok((await importWechatResult(Number(detail!.id),{sourceId:await selectedSource(),reason:'Same requested article'},'origin-test',tag()))?.articleId);}finally{on();code=2000;}
 for(const response of [{articleUrl:`https://mp.weixin.qq.com/s?__biz=${biz}&mid=99&idx=1`},{articleUrl:`https://mp.weixin.qq.com/s/Short${tag()}`,bizKey:'other'}]){const bad=await createSynchronousQuery({operationId:'I3CIBRI2',parameters:{articleUrl:min},sourceResultId:result!.id},'origin-test',tag());data={articleTitle:'Wrong',...response};code=200;await step(bad.id);assert.equal((await row(bad.id)).status,'needs_review');}code=2000;
});
test('each other platform rejects an explicit author conflict after the actual detail response',async()=>{
 for(const platform of ['xiaohongshu','wechat','tiktok','bilibili']){
  const f=fixture(platform),s=await source(f),run=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-test',tag());
  data={...f.detail,...(platform==='xiaohongshu'?{accountUserid:'other'}:platform==='wechat'?{bizInfo:'other'}:platform==='tiktok'?{authorData:{userId:'other'}}:{authorId:'123'})};await step(run.id);assert.equal((await row(run.id)).status,'needs_review',platform);assert.match((await row(run.id)).wait_reason,/author conflicts/);
 }
});
async function single(op:string,parameters:Record<string,unknown>,payload:unknown,kind:string){on();code=2000;data=payload;const run=await createSynchronousQuery({operationId:op,parameters},'origin-test',tag());await step(run.id);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);return (await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind=${kind} ORDER BY id`)[0]!;}
test('DY same-library premium and explicit AI native URL choice never use photoId or fallback',async()=>{
 const id=digits(),url=`https://www.douyin.com/video/${id}`;
 const premium=await single('774OBKK0',{keyword:tag()},{list:[{workId:id,title:'Premium',workUrl:url}]},'douyin_work');
 const a=await createSynchronousQuery({operationId:'0OT1E306',parameters:{workId:id},sourceResultId:premium.id},'origin-test',tag());data={workId:id,title:'Premium detail',workUrl:url};await step(a.id);assert.equal((await row(a.id)).status,'completed');
 await assert.rejects(createSynchronousQuery({operationId:'FK67XDVQ',parameters:{videoId:id},sourceResultId:premium.id},'origin-test',tag()),/library/);
 const ai=await single('I8P3HTVH',{keyword:tag()},{list:[{photoId:'not-native',authorId:'not-author',title:'AI',url}]},'douyin_work');
 for(const target of ['0OT1E306','FK67XDVQ']){const run=await createSynchronousQuery({operationId:target,parameters:target==='0OT1E306'?{workId:id}:{videoId:id},sourceResultId:ai.id},'origin-test',tag());assert.deepEqual((run.input.origin as {identity:unknown}).identity,{});data=target==='0OT1E306'?{workId:id,title:'Chosen premium',workUrl:url}:{videoId:id,content:'Chosen wide',opusUrl:url};await step(run.id);assert.equal((await row(run.id)).status,'completed');}
 await assert.rejects(createSynchronousQuery({operationId:'FK67XDVQ',parameters:{videoId:'not-native'},sourceResultId:ai.id},'origin-test',tag()));
});
test('XHS recommendation origin preserves role; linked rank uses actual URL, not opaque photoId',async()=>{
 const id='Note_'+tag(),author=tag(),url=`https://www.xiaohongshu.com/explore/${id}`;
 const r=await single('3X8FGEEM',{keyword:tag()},{articles:[],latestHotArticles:[{id,title:'Recommended',authorId:author,shareInfoLink:url}]},'xiaohongshu_work');
 const run=await createSynchronousQuery({operationId:'KR1LPTBF',parameters:{workId:id},sourceResultId:r.id},'origin-test',tag());data={workId:id,workTitle:'Detail',workUrl:url};await step(run.id);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(result!.data.originRole,'provider_recommendation');assert.equal(result!.data.role,undefined);assert.ok((await importXiaohongshuResult(Number(result!.id),{sourceId:await selectedSource(),reason:'Explicit recommendation'},'origin-test',tag()))?.articleId);
 const linked=await single('LBYLC5AK',{},[{photoId:'opaque-do-not-use',title:'Ranked',photoJumpUrl:url,userJumpUrl:`https://www.xiaohongshu.com/user/profile/${author}`}],'xiaohongshu_work');
 await assert.rejects(createSynchronousQuery({operationId:'KR1LPTBF',parameters:{workId:'opaque-do-not-use'},sourceResultId:linked.id},'origin-test',tag()));
 const selected=await createSynchronousQuery({operationId:'KR1LPTBF',parameters:{workLink:url},sourceResultId:linked.id},'origin-test',tag());data={workId:id,workTitle:'Detail',workUrl:url};await step(selected.id);assert.equal((await row(selected.id)).status,'completed');
});
test('WeChat premium UUID cannot cross libraries; HTTP origin command and import preserve same identity/CAS behavior',async()=>{
 const uuid=tag(),biz='Biz'+tag(),url=`https://mp.weixin.qq.com/s?__biz=${biz}&mid=25&idx=1`;
 const r=await single('PW97QFBS',{keyword:tag()},{list:[{workUuid:uuid,title:'Premium',workUrl:url}]},'wechat_work');
 await assert.rejects(createSynchronousQuery({operationId:'1LDQ7E1C',parameters:{workUuid:uuid},sourceResultId:r.id},'origin-test',tag()),/cross libraries/);
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic origin admin'};
 try{
  const payload={operationId:'XEO0QQNF',parameters:{workUuid:uuid},sourceResultId:r.id},headers={'x-csrf-token':'dev','idempotency-key':tag()};
  assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',payload})).statusCode,403);
  const response=await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload});assert.equal(response.statusCode,202,response.body);assert.deepEqual((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload})).json(),response.json());assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload:{...payload,sourceResultId:r.id+1}})).statusCode,409);
  data={workUuid:uuid,title:'Premium detail',workUrl:url,content:'<p>Actual detail</p>'};await step(response.json().runId);assert.equal((await row(response.json().runId)).status,'completed');const [detail]=await sql`SELECT * FROM operation_results WHERE run_id=${response.json().runId}`;off();const calls=hits;
  const imported=await app.inject({method:'POST',url:`/api/admin/operations/results/${detail!.id}/import`,headers:{...headers,'idempotency-key':tag()},payload:{sourceId:await selectedSource(),reason:'Same work'}});assert.equal(imported.statusCode,200,imported.body);assert.equal(hits,calls);
 }finally{on();config.devAdmin=null;await app.close();}
});

const selectedSourceId=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${selectedSourceId},'Selected test source','external','isolated') ON CONFLICT(id) DO NOTHING`;return selectedSourceId;}

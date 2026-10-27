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
import {importWeiboResult} from '@aihot/backend/providers/redfox/import-weibo';
import {importQichezhijiaResult} from '@aihot/backend/providers/redfox/import-qichezhijia';
import {importDongchediResult} from '@aihot/backend/providers/redfox/import-dongchedi';
import {importYicheResult} from '@aihot/backend/providers/redfox/import-yiche';
import {resumeRun} from '@aihot/backend/providers/operations/store';
const selectedSource=tag();
let data:unknown={},hits=0,code=2000;
const wire:{path:string,body:unknown}[]=[];
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{hits++;wire.push({path:req.url!,body:body?JSON.parse(body):null});res.end(JSON.stringify({code,data}));});});
let budgets:Record<string,unknown>[]=[];
before(async()=>{
 await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${selectedSource},'Chosen origin source','rss','isolated')`;
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;on();config.allowPrivateNetworkFetch=true;
 budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.query','redfox.collect')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.query','redfox.collect')`;
});
after(async()=>{try{await sql`UPDATE collection_subscriptions SET enabled=false WHERE config->>'sourceId'=${selectedSource}`;for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute as number},per_hour=${b.per_hour as number},per_day=${b.per_day as number} WHERE service=${b.service as string}`;}finally{off();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));try{await stopBoss();}finally{await closeDb();}}});
function on(){process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='fake-origin';}
function off(){process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;}
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function finish(id:number){for(let n=0;n<20;n++){const r=await row(id);if(r.status!=='active')return r;await step(id);}throw Error('Fixture step bound');}
const digits=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
interface Fixture {platform:string;source:string;parameters:Record<string,unknown>;page:unknown;target:string;request:Record<string,unknown>;detail:Record<string,unknown>;identity:Record<string,string>;importer:typeof importWeiboResult;sourceCode:number;targetCode:number}
function fixture(platform:string):Fixture{
 const id=digits(),author=digits();
 if(platform==='weibo')return {platform,source:'TXQPVGJG',parameters:{searchType:'1',page:'1',keyword:tag()},page:[{opusId:id,uid:author,text:'Original full body',opusUrl:`https://weibo.com/${author}/${id}`}],target:'API_1789098514899',request:{opusId:id},detail:{opusId:id,text:'Later body',opusUrl:`https://weibo.com/${author}/${id}`},identity:{uid:author},importer:importWeiboResult,sourceCode:2000,targetCode:2000};
 if(platform==='qichezhijia')return {platform,source:'CI7VW144',parameters:{keyword:tag(),offset:'0',page:'1',sourceType:'video'},page:[{workId:id,workType:'14',authorId:author,title:'Source',description:'Original full body',workUrl:`https://chejiahao.autohome.com.cn/info/${id}`}],target:'TE6AGWAF',request:{videoId:id,videoType:4},detail:{workId:id,title:'Detail',description:'Later body',cjhUrl:`https://chejiahao.autohome.com.cn/info/${id}`},identity:{chejiahao_authorId:author},importer:importQichezhijiaResult,sourceCode:2000,targetCode:2000};
 if(platform==='dongchedi')return {platform,source:'API_1791793668086',parameters:{userId:author},page:{account:{userId:author,nickname:'Actual author'},workList:[{workId:id,title:'Source',description:'Original full body',articleType:7,articleTypeStr:'ugc_article',workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${id}`}]},target:'QQ5E3EZ9',request:{workId:id,workType:'article'},detail:{workId:id,workType:1,title:'Detail',description:'Later body',workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${id}`},identity:{userId:author},importer:importDongchediResult,sourceCode:2000,targetCode:200};
 return {platform,source:'YIGCY5US',parameters:{keyword:tag(),page:1,sourceType:'xinwen'},page:[{workId:id,authorInfo:{userId:author},title:'Source',description:'Original full body',workUrl:`https://news.yiche.com/zonghexinwen/20261021/${id}99.html`}],target:'VYSP68M2',request:{url:`https://news.yiche.com/zonghexinwen/20261021/${id}99.html`},detail:{workId:id,title:'Detail',content:'<p>Later body</p>',workUrl:`https://news.yiche.com/zonghexinwen/20261021/${id}99.html`},identity:{userId:author},importer:importYicheResult,sourceCode:2000,targetCode:2000};
}
async function source(f:ReturnType<typeof fixture>,collection=false){
 data=f.page;code=f.sourceCode;on();let run;
 if(collection){const sub=await createPlatformSubscription({sourceId:selectedSource,name:tag(),operationId:f.source,parameters:f.parameters,enabled:true,limits:{pages:1,items:10,details:0}},'origin-b',tag());run=await startPlatformSubscription(sub.id,'origin-b',tag());await step(run.id);await sql`UPDATE operation_results SET created_at='2020-02-03T04:05:06Z' WHERE run_id=${run.id} AND kind='query_summary'`;await finish(run.id);}
 else{run=await createSynchronousQuery({operationId:f.source,parameters:f.parameters},'origin-b',tag());await finish(run.id);await sql`UPDATE operation_results SET created_at='2020-02-03T04:05:06Z' WHERE run_id=${run.id}`;}
 assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind=${f.platform+'_work'} ORDER BY id`;assert.ok(result);return {run,result:result!};
}
for(const platform of ['weibo','qichezhijia','dongchedi','yiche'])for(const collection of [false,true])test(`${platform} ${collection?'collection':'query'} → authorless detail → local import`,async()=>{
 const f=fixture(platform),s=await source(f,collection),parent=await row(s.run.id),before=hits;
 const prior=s.result.article_id?(await sql`SELECT body_text,body_html FROM articles WHERE id=${s.result.article_id}`)[0]:null;
 const body={operationId:f.target,parameters:f.request,sourceResultId:s.result.id},key=tag(),run=await createSynchronousQuery(body,'origin-b',key);
 assert.equal(hits,before);assert.equal((run.input.origin as {discoveredAt:string}).discoveredAt,'2020-02-03T04:05:06.000Z');data=f.detail;code=f.targetCode;await step(run.id);
 assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`;assert.deepEqual(result!.data.originIdentity,f.identity);
 const calls=hits;off();try{const imported=await f.importer(result!.id,{sourceId:selectedSource,reason:'Same verified work'},'origin-b',tag());assert.ok(imported?.articleId);const [article]=await sql`SELECT discovered_at,body_text,body_html FROM articles WHERE id=${imported.articleId}`;assert.equal(article!.discovered_at.toISOString(),'2020-02-03T04:05:06.000Z');if(prior){assert.equal(imported.articleId,s.result.article_id);assert.equal(article!.body_text,prior.body_text);assert.equal(article!.body_html,prior.body_html);}assert.equal(hits,calls);}finally{on();}
 assert.equal((await row(s.run.id)).step_version,parent.step_version);assert.equal((await row(s.run.id)).status,'completed');
 await sql`UPDATE operation_results SET data='{}' WHERE id=${s.result.id}`;assert.equal((await createSynchronousQuery(body,'origin-b',key)).id,run.id);
});
test('Autohome original and chejiahao namespaces remain distinct; article page is explicit; club is unsupported',async()=>{
 const f=fixture('qichezhijia'),s=await source(f),before=hits;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:{...f.request,videoType:0},sourceResultId:s.result.id},'origin-b',tag()),/type/);
 const original={...f,page:[{...(f.page as Record<string,unknown>[])[0],workType:'3',workUrl:`https://v.autohome.com.cn/v-${f.request.videoId}.html`}],request:{...f.request,videoType:0},detail:{workId:f.request.videoId,title:'Original detail',ycUrl:`https://v.autohome.com.cn/v-${f.request.videoId}.html`}};
 const os=await source(original),or=await createSynchronousQuery({operationId:original.target,parameters:original.request,sourceResultId:os.result.id},'origin-b',tag());data=original.detail;code=2000;await step(or.id);assert.equal((await row(or.id)).status,'completed');
 const [od]=await sql`SELECT * FROM operation_results WHERE run_id=${or.id}`;assert.deepEqual(od!.data.originIdentity,{original_authorId:f.identity.chejiahao_authorId});
 const article={...f,parameters:{...f.parameters,sourceType:'article'},page:[{...(f.page as Record<string,unknown>[])[0],workType:undefined}]};const a=await source(article);
 await assert.rejects(createSynchronousQuery({operationId:'LLCI8QTE',parameters:{workId:f.request.videoId},sourceResultId:a.result.id},'origin-b',tag()));
 const ar=await createSynchronousQuery({operationId:'LLCI8QTE',parameters:{workId:f.request.videoId,page:2},sourceResultId:a.result.id},'origin-b',tag());data={workId:f.request.videoId,title:'Article',content:'<p>Body</p>',workUrl:(f.page as Record<string,unknown>[])[0]!.workUrl};await step(ar.id);assert.equal((await row(ar.id)).status,'completed');assert.deepEqual(wire.at(-1)!.body,{workId:f.request.videoId,page:2});
 const club=await source({...f,parameters:{...f.parameters,sourceType:'club'}});await assert.rejects(createSynchronousQuery({operationId:'LLCI8QTE',parameters:{workId:f.request.videoId,page:1},sourceResultId:club.result.id},'origin-b',tag()),/type/);assert.ok(hits>before);
});
test('DCD search composite does not imply article; account parent, work type and author conflicts are enforced',async()=>{
 const f=fixture('dongchedi'),s=await source(f,true),calls=hits;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:{...f.request,workType:'video'},sourceResultId:s.result.id},'origin-b',tag()),/type/);
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{record,userId}','"forged-parent"') WHERE run_id=${s.run.id} AND kind='dongchedi_account'`;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-b',tag()),/account differs/);assert.equal(hits,calls);
 const search={...f,source:'W86F8SSK',parameters:{keyword:tag(),offset:'0',sourceType:'1'},page:{workList:[{workId:f.request.workId,title:'Unknown type'}],hasMore:'0'},sourceCode:200};const ss=await source(search);
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:ss.result.id},'origin-b',tag()),/type/);
 const good=await source(f),run=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:good.result.id},'origin-b',tag());data={...f.detail,authorId:'other'};code=200;await step(run.id);assert.equal((await row(run.id)).status,'needs_review');const n=hits;off();try{const r=await row(run.id);await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:r.step_version,generation:r.generation}));await step(run.id);assert.equal(hits,n);}finally{on();}
});
test('Yiche video identity and separate author kinds survive detail; wrong news original cannot pass',async()=>{
 const f=fixture('yiche'),id=digits(),url=`https://vc.yiche.com/vc.m/vplay/${id}.html`;
 const video={...f,parameters:{...f.parameters,sourceType:'shipin'},page:[{workId:id,title:'Video',authorId:'received-author',authorInfo:{userId:'received-user'},workUrl:url}],target:'3BXWEB6Y',request:{workId:id},detail:{workId:id,title:'Detail',workUrl:url}};
 const s=await source(video),run=await createSynchronousQuery({operationId:video.target,parameters:video.request,sourceResultId:s.result.id},'origin-b',tag());data=video.detail;await step(run.id);assert.equal((await row(run.id)).status,'completed');const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.deepEqual(d!.data.originIdentity,{authorId:'received-author',userId:'received-user'});
 const news=await source(f);await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:{url:f.request.url+'?other=1'},sourceResultId:news.result.id},'origin-b',tag()),/type/);
 const wrong=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:news.result.id},'origin-b',tag());data={...f.detail,workUrl:'https://news.yiche.com/zonghexinwen/20261021/other.html'};await step(wrong.id);assert.equal((await row(wrong.id)).status,'needs_review');
});
test('fake page and changed ID reject before query; import revalidates typed origin instead of derived display fields',async()=>{
 const f=fixture('qichezhijia'),s=await source(f,true),n=hits;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:{...f.request,videoId:'wrong'},sourceResultId:s.result.id},'origin-b',tag()),/type/);
 await sql`UPDATE operation_results SET provenance=jsonb_set(provenance,'{sourcePageResultId}','1') WHERE id=${s.result.id}`;
 await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-b',tag()),/page/);assert.equal(hits,n);
 const good=await source(f),run=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:good.result.id},'origin-b',tag());data=f.detail;await step(run.id);const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{record,authorId}','"other"') WHERE id=${d!.id}`;
 await assert.rejects(importQichezhijiaResult(d!.id,{sourceId:selectedSource,reason:'Reject forged author'},'origin-b',tag()),/author conflicts/);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${d!.id}`)[0]!.article_id,null);
});
test('Weibo keeps missing response UID raw, rejects account/trend or mismatched author/ID and preserves old independent detail',async()=>{
 const f=fixture('weibo'),s=await source(f),run=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-b',tag());data=f.detail;await step(run.id);const [d]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;assert.equal(d!.data.uid,undefined);assert.equal(d!.data.originIdentity.uid,f.identity.uid);
 const calls=hits;off();await importWeiboResult(d!.id,{sourceId:selectedSource,reason:'Verified author context'},'origin-b',tag());assert.equal(hits,calls);assert.equal((await sql`SELECT data FROM operation_results WHERE id=${d!.id}`)[0]!.data.uid,undefined);on();
 const bad=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-b',tag());data={...f.detail,uid:'1'};await step(bad.id);assert.equal((await row(bad.id)).status,'needs_review');
 const wrong=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-b',tag());data={...f.detail,opusId:'1'};await step(wrong.id);assert.equal((await row(wrong.id)).status,'needs_review');
 data=[{uid:digits(),nickname:'Account'}];const accountRun=await createSynchronousQuery({operationId:'TXQPVGJG',parameters:{...f.parameters,searchType:'3'}},'origin-b',tag());await step(accountRun.id);const [account]=await sql`SELECT * FROM operation_results WHERE run_id=${accountRun.id}`;assert.equal(account!.kind,'weibo_account');await assert.rejects(createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:account!.id},'origin-b',tag()),/single work/);
 const legacy=await createSynchronousQuery({operationId:f.target,parameters:f.request},'origin-b',tag());data={...f.detail,uid:f.identity.uid};await step(legacy.id);assert.equal((await row(legacy.id)).status,'completed');const [ld]=await sql`SELECT * FROM operation_results WHERE run_id=${legacy.id}`;assert.equal(ld!.data.originResultId,undefined);assert.ok((await importWeiboResult(ld!.id,{sourceId:selectedSource,reason:'Independent received detail'},'origin-b',tag()))?.articleId);
});
test('Yiche URL-only news origin does not invent a work ID and imports using original discovery',async()=>{
 const f=fixture('yiche'),record={...(f.page as Record<string,unknown>[])[0],workId:undefined},s=await source({...f,page:[record]});
 const run=await createSynchronousQuery({operationId:f.target,parameters:f.request,sourceResultId:s.result.id},'origin-b',tag());assert.equal((run.input.origin as {workId:unknown}).workId,null);
 data={...f.detail,workId:'actual-detail-id'};code=2000;await step(run.id);assert.equal((await row(run.id)).status,'completed');const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;off();try{const saved=await importYicheResult(result!.id,{sourceId:selectedSource,reason:'Received news URL confirms scope'},'origin-b',tag());assert.ok(saved?.articleId);assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${saved.articleId}`)[0]!.discovered_at.toISOString(),'2020-02-03T04:05:06.000Z');}finally{on();}
});

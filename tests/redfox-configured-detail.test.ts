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
import {importWeiboResult} from "@aihot/backend/providers/redfox/import-weibo";
import {importQichezhijiaResult} from "@aihot/backend/providers/redfox/import-qichezhijia";
import {importDongchediResult} from "@aihot/backend/providers/redfox/import-dongchedi";
import {importYicheResult} from "@aihot/backend/providers/redfox/import-yiche";
function firstFixture(platform:string){
 const id=digits(),author=digits(),note='Note_'+tag(),bv='BV'+randomUUID().replaceAll('-','').slice(0,10),biz='Biz'+tag(),uuid=tag();
 if(platform==='douyin')return {platform,source:'OWIBYU1V',parameters:{keyword:tag(),pageNum:1,pageSize:10},page:{list:[{videoId:id,content:'Original description',opusUrl:`https://www.douyin.com/video/${id}`,authorUid:author}],hasMore:false},target:'FK67XDVQ',request:{videoId:id},detail:{videoId:id,content:'Later detail',opusUrl:`https://www.douyin.com/video/${id}`},identity:{uid:author},importer:importDouyinResult};
 if(platform==='xiaohongshu')return {platform,source:'384C6W6B',parameters:{keyword:tag()},page:{list:[{workId:note,workTitle:'Source',workUrl:`https://www.xiaohongshu.com/explore/${note}`,accountUserid:author}],hasMore:false},target:'KR1LPTBF',request:{workId:note},detail:{workId:note,workTitle:'Detail',workDesc:'Detail description',workUrl:`https://www.xiaohongshu.com/explore/${note}`},identity:{userId:author},importer:importXiaohongshuResult};
 if(platform==='wechat')return {platform,source:'FVQ8D4W5',parameters:{keyword:tag()},page:{list:[{workUuid:uuid,title:'Source',workUrl:`https://mp.weixin.qq.com/s/Synthetic${uuid}`,bizInfo:biz}],hasMore:false},target:'1LDQ7E1C',request:{workUuid:uuid},detail:{workUuid:uuid,title:'Detail',content:'<p>Detail body</p>',workUrl:`https://mp.weixin.qq.com/s/Synthetic${uuid}`},identity:{bizInfo:biz},importer:importWechatResult};
 if(platform==='tiktok')return {platform,source:'R473NUE9',parameters:{secUserId:author},page:[{workId:id,content:'Source',shareLink:`https://www.tiktok.com/@synthetic/video/${id}`,authorData:{userId:author,secUserId:author}}],target:'6SE9WIHJ',request:{awemeId:id},detail:{workId:id,content:'Detail',shareLink:`https://www.tiktok.com/@synthetic/video/${id}`},identity:{userId:author,secUserId:author},importer:importTiktokResult};
 return {platform,source:'VPA67I98',parameters:{mid:author},page:{mid:author,workList:[{bvId:bv,title:'Source',description:'Source body'}]},target:'TIN1NMTZ',request:{bvId:bv},detail:{bvId:bv,title:'Detail',description:'Later detail'},identity:{mid:author},importer:importBilibiliResult};
}
interface Fixture {platform:string;source:string;parameters:Record<string,unknown>;page:unknown;target:string;request:Record<string,unknown>;detail:Record<string,unknown>;identity:Record<string,string>;importer:typeof importWeiboResult;sourceCode:number;targetCode:number}
function secondFixture(platform:string):Fixture{
 const id=digits(),author=digits();
 if(platform==='weibo')return {platform,source:'TXQPVGJG',parameters:{searchType:'1',page:'1',keyword:tag()},page:[{opusId:id,uid:author,text:'Original full body',opusUrl:`https://weibo.com/${author}/${id}`}],target:'API_1789098514899',request:{opusId:id},detail:{opusId:id,text:'Later body',opusUrl:`https://weibo.com/${author}/${id}`},identity:{uid:author},importer:importWeiboResult,sourceCode:2000,targetCode:2000};
 if(platform==='qichezhijia')return {platform,source:'CI7VW144',parameters:{keyword:tag(),offset:'0',page:'1',sourceType:'video'},page:[{workId:id,workType:'14',authorId:author,title:'Source',description:'Original full body',workUrl:`https://chejiahao.autohome.com.cn/info/${id}`}],target:'TE6AGWAF',request:{videoId:id,videoType:4},detail:{workId:id,title:'Detail',description:'Later body',cjhUrl:`https://chejiahao.autohome.com.cn/info/${id}`},identity:{chejiahao_authorId:author},importer:importQichezhijiaResult,sourceCode:2000,targetCode:2000};
 if(platform==='dongchedi')return {platform,source:'API_1791793668086',parameters:{userId:author},page:{account:{userId:author,nickname:'Actual author'},workList:[{workId:id,title:'Source',description:'Original full body',articleType:7,articleTypeStr:'ugc_article',workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${id}`}]},target:'QQ5E3EZ9',request:{workId:id,workType:'article'},detail:{workId:id,workType:1,title:'Detail',description:'Later body',workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${id}`},identity:{userId:author},importer:importDongchediResult,sourceCode:2000,targetCode:200};
 return {platform,source:'YIGCY5US',parameters:{keyword:tag(),page:1,sourceType:'xinwen'},page:[{workId:id,authorInfo:{userId:author},title:'Source',description:'Original full body',workUrl:`https://news.yiche.com/zonghexinwen/20261021/${id}99.html`}],target:'VYSP68M2',request:{url:`https://news.yiche.com/zonghexinwen/20261021/${id}99.html`},detail:{workId:id,title:'Detail',content:'<p>Later body</p>',workUrl:`https://news.yiche.com/zonghexinwen/20261021/${id}99.html`},identity:{userId:author},importer:importYicheResult,sourceCode:2000,targetCode:2000};
}

const fixture=(platform:string)=>["weibo","qichezhijia","dongchedi","yiche"].includes(platform)?secondFixture(platform):({...firstFixture(platform),sourceCode:2000,targetCode:2000});
async function start(f:ReturnType<typeof fixture>,details=1){
 on();data=f.page;code=f.sourceCode;
 const sub=await createPlatformSubscription({name:tag(),operationId:f.source,parameters:f.parameters,enabled:true,enrichDetails:true,detailOperationId:f.target,limits:{pages:1,items:10,details}},'detail-collection',tag());
 const run=await startPlatformSubscription(sub.id,'detail-collection',tag());await step(run.id);assert.equal((await row(run.id)).status,'active',(await row(run.id)).wait_reason);
 await sql`UPDATE operation_results SET created_at='2020-02-03T04:05:06Z' WHERE run_id=${run.id} AND kind='query_summary'`;
 return {sub,run};
}
for(const platform of ['douyin','xiaohongshu','wechat','tiktok','bilibili','weibo','qichezhijia','dongchedi','yiche'])test(`${platform} configured collection detail preserves page, received records and original discovery`,async()=>{
 const f=fixture(platform),{sub,run}=await start(f);await step(run.id);const waiting=await row(run.id);assert.equal(waiting.step_key,'redfox.platform.detail',waiting.wait_reason);assert.ok(waiting.progress.detailSourceResultId);assert.deepEqual(waiting.progress.retainedReceiptIds,[waiting.progress.pageReceipt]);
 const sourceId=waiting.progress.detailSourceResultId,before=hits;const [frozenSource]=await sql`SELECT data FROM operation_results WHERE id=${sourceId}`;data=f.detail;code=f.targetCode;await step(run.id);const done=await row(run.id);assert.equal(done.status,'completed',done.wait_reason);assert.equal(hits,before+1);
 const [original]=await sql`SELECT * FROM operation_results WHERE id=${sourceId}`;assert.ok(original!.article_id);assert.ok(original!.provenance.detailResultId);const [detail]=await sql`SELECT * FROM operation_results WHERE id=${original!.provenance.detailResultId}`;
 assert.equal(detail!.article_id,original!.article_id);assert.equal(detail!.provenance.detailSourceResultId,sourceId);assert.equal(detail!.provenance.sourcePageResultId,original!.provenance.sourcePageResultId);assert.deepEqual(original!.data,frozenSource!.data);
 assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${detail!.article_id}`)[0]!.discovered_at.toISOString(),'2020-02-03T04:05:06.000Z');
 const [receipt]=await sql`SELECT service,model,request,status FROM receipts WHERE id=${detail!.receipt_id}`;assert.equal(receipt!.service,'redfox.collect');assert.equal(receipt!.model,f.target);assert.deepEqual(receipt!.request.input,f.request);assert.equal(receipt!.status,'completed');
 off();const count=hits;assert.ok((await f.importer(detail!.id,{reason:'Completed detail replay'},'detail-collection',tag()))?.articleId);assert.equal(hits,count);await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;on();
});
test('configured targets/page must be explicit and scope-correct, limits leave pending without another call',async()=>{
 const f=fixture('qichezhijia'),base={name:tag(),operationId:f.source,parameters:f.parameters,enrichDetails:true,enabled:false,limits:{pages:1,items:1,details:1}};
 await assert.rejects(createPlatformSubscription(base,'detail-collection',tag()),/Select/);
 await assert.rejects(createPlatformSubscription({...base,detailOperationId:'LLCI8QTE'},'detail-collection',tag()));
 await assert.rejects(createPlatformSubscription({...base,parameters:{...f.parameters,sourceType:'article'},detailOperationId:'LLCI8QTE'},'detail-collection',tag()),/page/);
 await assert.rejects(createPlatformSubscription({...base,enrichDetails:false,detailOperationId:f.target},'detail-collection',tag()),/requires enrichment/);
 const {sub,run}=await start(f,0),n=hits;await finish(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal(hits,n);const [r]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='qichezhijia_work'`;assert.match(r!.data.pendingReason,/limit/);assert.equal(r!.article_id,null);await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
});
test('detail budget wait retains exact page/item; received response recovers without key or outbound',async()=>{
 const {queryDouyin}=await import('@aihot/backend/providers/redfox/douyin'),{receiptOptions,claimRun}=await import('@aihot/backend/providers/operations/store'),{recoverOperations}=await import('@aihot/backend/providers/operations/recovery');
 const f=fixture('douyin'),{sub,run}=await start(f);await step(run.id);const before=await row(run.id),calls=hits;
 await sql`UPDATE budgets SET per_minute=0 WHERE service='redfox.collect'`;await step(run.id);const waiting=await row(run.id);assert.equal(waiting.status,'waiting');assert.equal(waiting.step_version,before.step_version);assert.equal(waiting.progress.index,0);assert.equal(waiting.progress.pageReceipt,before.progress.pageReceipt);assert.equal(waiting.current_receipt_id,null);assert.equal(hits,calls);
 await sql`UPDATE budgets SET per_minute=1000 WHERE service='redfox.collect'`;await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:waiting.step_version,generation:waiting.generation}));
 const current=await row(run.id),execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:current.step_version,generation:current.generation},randomUUID()));data=f.detail;code=2000;
 const response=await queryDouyin('FK67XDVQ',current.progress.detailParameters,String(current.input.window),receiptOptions(execution),'collect');
 assert.equal((await sql`SELECT status FROM receipts WHERE id=${response.receiptId}`)[0]!.status,'received');const count=hits;off();await sql`UPDATE pgboss.job SET state='completed',completed_on=now() WHERE singleton_key=${`${run.id}:${current.step_version}`} AND state IN ('created','retry','active')`;await sql`UPDATE operation_runs SET job_id=NULL WHERE id=${run.id}`;
 const [total]=await sql`SELECT count(*)::int AS n FROM operation_runs WHERE status IN ('active','waiting')`;
 for(let i=0;i<Math.ceil(total!.n/200)+3;i++){await recoverOperations();if((await row(run.id)).job_id)break;}
 assert.ok((await row(run.id)).job_id);await step(run.id);assert.equal((await row(run.id)).status,'completed',(await row(run.id)).wait_reason);assert.equal(hits,count);assert.equal((await sql`SELECT attempts FROM receipts WHERE id=${response.receiptId}`)[0]!.attempts,1);
 await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;on();
});
test('configuration fence after received detail prevents materials, links and page progress',async()=>{
 const {queryDouyin}=await import('@aihot/backend/providers/redfox/douyin'),{receiptOptions,claimRun}=await import('@aihot/backend/providers/operations/store'),{updatePlatformSubscription}=await import('@aihot/backend/sources/platform-subscriptions');
 const f=fixture('douyin'),{sub,run}=await start(f);await step(run.id);const r=await row(run.id),execution=await sql.begin(tx=>claimRun(tx,{runId:run.id,stepVersion:r.step_version,generation:r.generation},randomUUID()));data=f.detail;
 const response=await queryDouyin('FK67XDVQ',r.progress.detailParameters,String(r.input.window),receiptOptions(execution),'collect');
 await updatePlatformSubscription(sub.id,{editVersion:1,config:{name:'Changed',operationId:f.source,parameters:{...f.parameters,keyword:tag()},enabled:false,enrichDetails:true,detailOperationId:f.target,limits:{pages:1,items:10,details:1}}},'detail-collection');
 await step(run.id);assert.equal((await row(run.id)).status,'stopped');assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE run_id=${run.id} AND receipt_id=${response.receiptId}`)[0]!.n,0);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r.progress.detailSourceResultId}`)[0]!.article_id,null);
});
test('duplicate works reuse detail receipt and preserve existing full body',async()=>{
 const f=fixture('bilibili'),page=f.page as {mid:string;workList:unknown[]};page.workList.push(page.workList[0]);
 const {sub,run}=await start(f,2);await step(run.id);data=f.detail;code=f.targetCode;await step(run.id);
 const [first]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND provenance ? 'detailSourceResultId'`;
 assert.ok(first!.article_id);await sql`UPDATE articles SET body_text='Existing complete text',body_html='<p>Existing complete text</p>' WHERE id=${first!.article_id}`;
 const count=hits;await finish(run.id);assert.equal((await row(run.id)).status,'completed');assert.equal(hits,count);
 const results=await sql`SELECT article_id FROM operation_results WHERE run_id=${run.id} AND kind='bilibili_work'`;
 assert.ok(results.length>=3);assert.ok(results.every(r=>r.article_id===first!.article_id));
 const [article]=await sql`SELECT body_text,body_html FROM articles WHERE id=${first!.article_id}`;assert.equal(article!.body_text,'Existing complete text');assert.equal(article!.body_html,'<p>Existing complete text</p>');
 await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
});
test('actual detail author conflict stops with retained page and no material link',async()=>{
 const f=fixture('douyin'),{sub,run}=await start(f);await step(run.id);const before=await row(run.id);
 data={...f.detail,authorUid:digits()};code=f.targetCode;await step(run.id);const stopped=await row(run.id);
 assert.equal(stopped.status,'needs_review');assert.equal(stopped.step_key,'redfox.platform.detail');assert.equal(stopped.progress.index,0);assert.deepEqual(stopped.progress.retainedReceiptIds,before.progress.retainedReceiptIds);
 assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${before.progress.detailSourceResultId}`)[0]!.article_id,null);
 const count=hits;off();await sql.begin(tx=>resumeRun(tx,{runId:run.id,stepVersion:stopped.step_version,generation:stopped.generation}));await step(run.id);assert.equal((await row(run.id)).status,'needs_review');assert.equal(hits,count);on();
 await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
});
test('collected details have no repeated work query and reject nested source provenance',async()=>{
 const {workDetailOptions}=await import('@aihot/backend/providers/redfox/work-detail-options');
 const f=fixture('bilibili'),{sub,run}=await start(f);await step(run.id);const item=await row(run.id);data=f.detail;code=f.targetCode;await step(run.id);
 const [detail]=await sql`SELECT id FROM operation_results WHERE run_id=${run.id} AND provenance ? 'detailSourceResultId'`;
 assert.deepEqual((await workDetailOptions(detail!.id))!.choices,[]);
 await sql`UPDATE operation_results SET provenance=provenance||${sql.json({detailSourceResultId:detail!.id})} WHERE id=${item.progress.detailSourceResultId}`;
 await assert.rejects(workDetailOptions(detail!.id),/another run\/page/);
 await sql`UPDATE operation_results SET provenance=provenance-'detailSourceResultId' WHERE id=${item.progress.detailSourceResultId}`;
 await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
});
test('legacy Weibo unique detail target is execution-equivalent on name/period edits',async()=>{
 const {updatePlatformSubscription}=await import('@aihot/backend/sources/platform-subscriptions');
 for(const status of ['active','waiting']){
  const input={name:tag(),operationId:'TXQPVGJG',parameters:{searchType:'1',page:'1',keyword:tag()},enabled:true,enrichDetails:true,intervalMinutes:15,limits:{pages:1,items:8,details:2}};
  const sub=await createPlatformSubscription(input,'legacy-detail',tag()),run=await startPlatformSubscription(sub.id,'legacy-detail',tag());
  await sql`UPDATE operation_runs SET status=${status},wait_reason=${status==='waiting'?'fixture budget wait':null} WHERE id=${run.id}`;
  const [before]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`,beforeRun=await row(run.id);
  const config={...input,name:'Renamed legacy subscription',intervalMinutes:30,detailOperationId:'API_1789098514899'};
  await updatePlatformSubscription(sub.id,{editVersion:1,config},'legacy-detail');
  const [after]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`,afterRun=await row(run.id);
  assert.equal(after!.execution_version,before!.execution_version);assert.equal(after!.active_run_id,run.id);assert.equal(after!.config.detailOperationId,config.detailOperationId);assert.equal(after!.interval_minutes,30);assert.equal(afterRun.status,status);assert.equal(afterRun.generation,beforeRun.generation);assert.equal(after!.creation_input_hash,before!.creation_input_hash);
  await assert.rejects(updatePlatformSubscription(sub.id,{editVersion:2,config:{...config,detailOperationId:'FK67XDVQ'}},'legacy-detail'),/Select/);
  const changed=status==='active'?{...config,limits:{...config.limits,details:1}}:{...input,name:config.name,intervalMinutes:30,enrichDetails:false};
  await updatePlatformSubscription(sub.id,{editVersion:2,config:changed},'legacy-detail');
  const [fenced]=await sql`SELECT * FROM collection_subscriptions WHERE id=${sub.id}`;assert.equal(fenced!.execution_version,before!.execution_version+1);assert.equal(fenced!.active_run_id,null);assert.equal((await row(run.id)).status,'stopped');
  await sql`UPDATE collection_subscriptions SET enabled=false WHERE id=${sub.id}`;
 }
});

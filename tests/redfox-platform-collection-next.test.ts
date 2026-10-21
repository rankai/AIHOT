import {wechatOperations} from '@aihot/backend/providers/redfox/wechat-contract';
import {tiktokOperations} from '@aihot/backend/providers/redfox/tiktok-contract';
import {bilibiliOperations} from '@aihot/backend/providers/redfox/bilibili-contract';
import {youtubeOperations} from '@aihot/backend/providers/redfox/youtube-contract';
import {instagramOperations} from '@aihot/backend/providers/redfox/instagram-contract';
import {toutiaoOperations} from '@aihot/backend/providers/redfox/toutiao-contract';
import {shipinhaoOperations} from '@aihot/backend/providers/redfox/shipinhao-contract';
import {kuaishouOperations} from '@aihot/backend/providers/redfox/kuaishou-contract';
import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
const requests:{path:string;parameters:Record<string,unknown>;body:string}[]=[];
let respond:(p:Record<string,unknown>)=>unknown=()=>({});
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const url=new URL(req.url!,'http://localhost');const parameters=req.method==='GET'?Object.fromEntries(url.searchParams):JSON.parse(body);requests.push({path:url.pathname,parameters,body});res.end(JSON.stringify({code:2000,data:respond(parameters)}));});});
let budget:Record<string,unknown>;
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-platform-next';process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';config.allowPrivateNetworkFetch=true;budget=(await sql`SELECT * FROM budgets WHERE service='redfox.collect'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.collect'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${budget.per_minute as number},per_hour=${budget.per_hour as number},per_day=${budget.per_day as number} WHERE service='redfox.collect'`;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function start(operationId:string,parameters:Record<string,unknown>,pages=2,items=10){const sub=await createPlatformSubscription({name:tag(),operationId,parameters,enabled:true,limits:{pages,items,details:0}},'test',tag());return startPlatformSubscription(sub.id,'test',tag());}
async function finish(id:number){for(let i=0;i<30;i++){const r=await row(id);if(r.status!=='active')return r;await step(id);}throw new Error('Fixture exceeded bounded steps');}
test('YouTube token pages commit each result with its own source-page proof and original discovery',async()=>{
 const ids=[randomUUID().replaceAll('-','').slice(0,11),randomUUID().replaceAll('-','').slice(0,11)],token=' | opaque-next | ',channel='channel_'+tag();
 respond=p=>({videos:[{videoId:ids[p.continuationToken?1:0],channelId:channel,title:'Synthetic collected video',description:'Synthetic description'}],continuationToken:p.continuationToken?null:token,estimatedResults:'900719925474099312345'});
 const initial=requests.length,run=await start('GC5SC5HS',{searchQuery:tag()},3),times=[new Date('2020-01-02T00:00:00Z'),new Date('2020-02-03T00:00:00Z')];
 for(let i=0;i<2;i++){await step(run.id);const r=await row(run.id);assert.equal(r.step_key,'redfox.platform.item');assert.equal(r.progress.items,undefined);await sql`UPDATE operation_results SET created_at=${times[i]!} WHERE run_id=${run.id} AND receipt_id=${r.progress.pageReceipt} AND kind='query_summary'`;await Promise.all([step(run.id),step(run.id)]);const [result]=await sql`SELECT z.*,a.discovered_at FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id} AND z.receipt_id=${r.progress.pageReceipt}`;assert.ok(result,result?.data?.pendingReason);assert.equal(result!.discovered_at.toISOString(),times[i]!.toISOString());assert.ok(result!.provenance.sourcePageResultId);}
 assert.equal((await row(run.id)).status,'completed');assert.equal(requests.length,initial+2);assert.equal(requests.at(-1)!.parameters.continuationToken,token);const summaries=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY id`;assert.deepEqual(summaries.map(r=>r.data.count),[1,1]);
});
test('WeChat HTML collection imports retained completed page locally while both outbound gates are closed',async()=>{
 const biz='Synthetic'+tag(),mid=String(Date.now()),url=`https://mp.weixin.qq.com/s?__biz=${biz}&mid=${mid}&idx=1`;respond=()=>({list:[{workUuid:tag(),title:'Synthetic HTML article',workUrl:url,bizInfo:biz,content:'<p>Full synthetic <strong>HTML</strong> content.</p>'}],hasMore:false});
 const run=await start('FVQ8D4W5',{keyword:tag()}),initial=requests.length;await step(run.id);const r=await row(run.id);await sql`UPDATE receipts SET status='completed' WHERE id=${r.progress.pageReceipt}`;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,initial+1);const [result]=await sql`SELECT z.*,a.body_text,a.body_html FROM operation_results z JOIN articles a ON a.id=z.article_id WHERE z.run_id=${run.id}`;assert.ok(result);assert.match(result!.body_text,/Full synthetic HTML content/);assert.match(result!.body_html,/<strong>HTML<\/strong>/);const [receipt]=await sql`SELECT service,cost FROM receipts WHERE id=${r.progress.pageReceipt}`;assert.equal(receipt!.service,'redfox.collect');assert.ok(receipt!.cost!==null);}
 finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='fake-platform-next';}
});
test('twenty fixed operations use collect wire and prices, preserve actual results and avoid implicit enrichment',async()=>{
 const id=String(BigInt('0x'+randomUUID().replaceAll('-',''))),biz='Biz'+tag(),url=`https://mp.weixin.qq.com/s?__biz=${biz}&mid=123&idx=1`,wx='gh_'+randomUUID().replaceAll('-','');
 const work={title:'Synthetic full article',workUuid:tag(),workUrl:url,content:'<p>Synthetic HTML.</p>',bizInfo:biz},tt={workId:id,content:'Synthetic description',authorData:{userId:id,secUserId:'sec-'+tag()},shareLink:`https://www.tiktok.com/@synthetic/video/${id}`},bv='BV'+randomUUID().replaceAll('-','').slice(0,10),bw={bvId:bv,title:'Synthetic video',authorId:id};
 const cases:[string,Record<string,unknown>,unknown][]=[
 ['PW97QFBS',{keyword:tag(),offset:20},{list:[work]}],['FVQ8D4W5',{keyword:tag(),offset:40},{list:[work]}],['IE0887SO',{keyword:tag(),pageNum:1,pageSize:20,startTime:'2026-01-01 00:00:00',endTime:'2026-01-02 00:00:00'},{list:[{title:'Synthetic AI',photoId:tag()}]}],
 ['ZIGAGYYT',{type:'科技数码',startDate:'2026-01-01',endDate:'2026-01-02'},[{...work,oriUrl:url}]],['OFFSPQ0U',{type:'总排名',startDate:'2026-01-01',endDate:'2026-01-02'},[{...work,oriUrl:url}]],['DL4YNCTQ',{rankDate:'2026-01-01'},[{accountId:wx,userName:'Synthetic rank',maxWork:{title:'Maximum',oriUrl:`https://mp.weixin.qq.com/s/Max${tag()}`},minWork:{title:'Minimum',oriUrl:`https://mp.weixin.qq.com/s/Min${tag()}`}}]],
 ['R473NUE9',{secUserId:tt.authorData.secUserId},[tt]],['PXZXY8KQ',{keyword:tag(),offset:'0'},[tt]],['API_1790149158205',{ch_id:id,cursor:'0'},{workList:[tt],hasMore:0,nextCursor:id}],['API_1790581450500',{sec_user_id:'collector',max_cursor:'0'},{workList:[tt],hasMore:0,nextCursor:id}],
 ['LEN9QXR3',{keyword:tag(),page:'1'},{workList:[bw]}],['VPA67I98',{mid:id},{mid:id,workList:[bw]}],['GC5SC5HS',{searchQuery:tag()},{videos:[{videoId:randomUUID().replaceAll('-','').slice(0,11),channelId:'channel_'+tag(),title:'Synthetic'}],continuationToken:null}],['GM0TISWI',{keyword:tag()},{items:[{code:tag(),captionText:'Synthetic',user:{id}}],count:99,paginationToken:null}],
 ['28CFGF5I',{keyword:tag(),offset:'0'},[{opusId:id,uid:id,title:'Synthetic',opusUrl:`https://www.toutiao.com/a${id}/`}]],['R1IGR09H',{category:'profile_all',token:tag(),offset:'0'},{workList:[{workId:id,secUid:'sec'+id,title:'Synthetic',workUrl:`https://www.toutiao.com/article/${id}/`}],hasMore:false,offset:0}],
 ['E7G00COY',{keyword:tag()},{list:[{videoId:id,description:'Synthetic',nickname:'Display'}]}],['OVUTOTCV',{nickname:tag()},{list:[{description:'Synthetic',nickname:'Display'}]}],['27DQ6SF9',{threeXId:tag()},{list:[{photoId:'opaque-'+tag(),caption:'Synthetic',nickname:'Display'}]}],['ZWR31P2A',{keyword:tag()},{list:[{photoId:tag(),caption:'Synthetic'}]}],
 ];
 const definitions:Record<string,{path:string;schema:{parse(v:unknown):unknown}}>={...wechatOperations,...tiktokOperations,...bilibiliOperations,...youtubeOperations,...instagramOperations,...toutiaoOperations,...shipinhaoOperations,...kuaishouOperations};
 for(const [op,parameters,data] of cases){respond=()=>data;const initial=requests.length,run=await start(op,parameters,1),done=await finish(run.id);assert.equal(done.status,'completed',`${op}: ${done.wait_reason}`);assert.equal(requests.length,initial+1,op);assert.equal(requests.at(-1)!.path,definitions[op]!.path);const expected=definitions[op]!.schema.parse(parameters);if(op==='API_1790149158205')assert.ok(requests.at(-1)!.body.includes(`"ch_id":${id}`));else if(op==='API_1790581450500')assert.ok(requests.at(-1)!.body.includes('"max_cursor":0'));else assert.deepEqual(requests.at(-1)!.parameters,expected,op);
 const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`,summary=results.find(r=>r.kind==='query_summary')!;assert.equal(results.filter(r=>r.kind==='query_summary').length,1);const [receipt]=await sql`SELECT service,model,cost FROM receipts WHERE id=${summary.receipt_id}`;assert.equal(receipt!.service,'redfox.collect');assert.equal(receipt!.model,op);assert.ok(receipt!.cost!=null);
 if(op==='DL4YNCTQ'){assert.equal(summary.data.count,3);const imported=results.filter(r=>r.article_id);assert.equal(imported.length,2);assert.deepEqual(imported.map(r=>r.data.title),['Maximum','Minimum']);}
 if(['E7G00COY','OVUTOTCV','27DQ6SF9','ZWR31P2A','IE0887SO'].includes(op)){const pending=results.find(r=>r.kind.endsWith('_work'))!;assert.equal(pending.article_id,null);assert.ok(pending.data.pendingReason);}
 }
});
test('token and offset pagination preserves large lexemes and stops repeated or unverifiable continuations',async()=>{
 const id=String(BigInt('0x'+randomUUID().replaceAll('-',''))),next='9007199254740993123456789',tt={workId:id,content:'Synthetic',authorData:{userId:id},shareLink:`https://www.tiktok.com/@synthetic/video/${id}`};
 for(const [op,field,parameters] of [['API_1790149158205','cursor',{ch_id:id,cursor:'0'}],['API_1790581450500','max_cursor',{sec_user_id:tag(),max_cursor:'0'}]] as const){respond=()=>({workList:[tt],hasMore:1,nextCursor:next});const initial=requests.length,run=await start(op,parameters,5);assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,initial+2);assert.ok(requests.at(-1)!.body.includes(`"${field}":${next}`));const summaries=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY id`;assert.equal(summaries[1]!.data.stopReason,'repeated-next-token-needs-review');}
 respond=()=>({workList:[tt],hasMore:1});let run=await start('API_1790149158205',{ch_id:id,cursor:'0'},3);const missing=await finish(run.id);assert.equal(missing.status,'needs_review');assert.match(missing.wait_reason,/nextCursor/);assert.equal((await sql`SELECT status FROM receipts WHERE id=${missing.current_receipt_id}`)[0]!.status,'received');
 respond=()=>[tt];let initial=requests.length;run=await start('PXZXY8KQ',{keyword:tag()},4);assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,initial+1);assert.equal((await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary'`)[0]!.data.stopReason,'pagination-mapping-unverified');
 respond=()=>[{opusId:id,uid:id,title:'Synthetic TT',opusUrl:`https://www.toutiao.com/article/${id}/`}];initial=requests.length;run=await start('28CFGF5I',{keyword:tag(),offset:next},2);assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,initial+2);assert.equal(requests.at(-1)!.parameters.offset,String(BigInt(next)+1n));
 const code=tag();respond=p=>({items:[{code,captionText:'Synthetic',user:{id}}],paginationToken:p.paginationToken?null:' | next | '});initial=requests.length;run=await start('GM0TISWI',{keyword:tag()},4);assert.equal((await finish(run.id)).status,'completed');assert.equal(requests.length,initial+2);assert.equal(requests.at(-1)!.parameters.paginationToken,' | next | ');
});
test('new TikTok description result preserves existing same-owner full body and still links discovery',async()=>{
 const id=String(BigInt('0x'+randomUUID().replaceAll('-',''))),data={workId:id,content:'Synthetic initial description',authorData:{userId:id},shareLink:`https://www.tiktok.com/@synthetic/video/${id}`};respond=()=>[data];let run=await start('PXZXY8KQ',{keyword:tag()},1);assert.equal((await finish(run.id)).status,'completed');const [original]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='tiktok_work'`;assert.ok(original!.article_id);
 const {upsertMaterial}=await import('@aihot/backend/content/materials');await upsertMaterial({sourceId:original!.source_id,url:data.shareLink,title:'Synthetic initial description',bodyText:'Complete synthetic article body',bodyHtml:'<p>Complete synthetic article body</p>',bodyStatus:'ok',via:'import'});
 const [before]=await sql`SELECT * FROM articles WHERE id=${original!.article_id}`;respond=()=>[{...data,content:'Synthetic new short description'}];run=await start('PXZXY8KQ',{keyword:tag()},1);assert.equal((await finish(run.id)).status,'completed');const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='tiktok_work'`,[after]=await sql`SELECT * FROM articles WHERE id=${original!.article_id}`;assert.equal(result!.article_id,original!.article_id);assert.equal(after!.body_text,before!.body_text);assert.equal(after!.body_html,before!.body_html);assert.equal(after!.source_id,before!.source_id);assert.equal(after!.discovered_at.toISOString(),before!.discovered_at.toISOString());
});
test('catalog exposes only local collect prices and actual detail capability without paid reads',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Collection metadata fixture'};const initial=requests.length;
 try{const response=await app.inject({url:'/api/admin/redfox/operations'});assert.equal(response.statusCode,200);const list=response.json(),yt=list.find((d:{id:string})=>d.id==='GC5SC5HS'),detail=list.find((d:{id:string})=>d.id==='609DF2IR');assert.deepEqual(yt.collectionPrice,{amount:0.06,currency:'CNY',basis:'estimated'});assert.deepEqual(yt.collectionCapabilities,{detailEnrichment:false,detailOperations:[]});assert.equal(detail.collectionPrice,undefined);assert.equal(list.find((d:{id:string})=>d.id==='TXQPVGJG').collectionCapabilities.detailEnrichment,true);assert.equal(requests.length,initial);}
 finally{config.devAdmin=null;await app.close();}
});
test('confirmed page counters advance by their documented units without coercing string pages',async()=>{
 const samples:[string,Record<string,unknown>,unknown,string,unknown][]=[
 ['PW97QFBS',{keyword:tag(),offset:40},{list:[{title:'Synthetic candidate'}]},'offset',60],['FVQ8D4W5',{keyword:tag(),offset:20},{list:[{title:'Synthetic candidate'}]},'offset',40],
 ['IE0887SO',{keyword:tag(),pageNum:100,pageSize:20,startTime:'2026-01-01 00:00:00',endTime:'2026-01-02 00:00:00'},{list:[{title:'Synthetic candidate'}]},'pageNum',101],
 ['LEN9QXR3',{keyword:tag(),page:'100'},{workList:[{title:'Synthetic candidate'}]},'page','101'],['VPA67I98',{mid:'123456',page:100},{mid:'123456',workList:[{title:'Synthetic candidate'}]},'page',101],
 ['E7G00COY',{keyword:tag(),page:100},{list:[{description:'Synthetic candidate'}]},'page',101],['OVUTOTCV',{nickname:tag(),page:100},{list:[{description:'Synthetic candidate'}]},'page',101],
 ['27DQ6SF9',{threeXId:tag(),page:100},{list:[{caption:'Synthetic candidate'}]},'page',101],['ZWR31P2A',{keyword:tag(),page:100},{list:[{caption:'Synthetic candidate'}]},'page',101],
 ];
 for(const [op,parameters,data,field,next] of samples){respond=()=>data;const initial=requests.length,run=await start(op,parameters,2);const done=await finish(run.id);assert.equal(done.status,'completed',`${op}: ${done.wait_reason}`);assert.equal(requests.length,initial+2,op);assert.equal(requests.at(-1)!.parameters[field],next,op);}
});
test('scheduled work consumers validate page proof for detail origins and isolated manual imports',async()=>{
 const {createSynchronousQuery}=await import('@aihot/backend/providers/redfox/synchronous'),{importManualWorkResult}=await import('@aihot/backend/providers/redfox/import-manual-work');
 const id=String(BigInt('0x'+randomUUID().replaceAll('-',''))),video=randomUUID().replaceAll('-','').slice(0,11),code=tag(),at=new Date('2020-04-05T00:00:00Z');
 const fixtures:[string,Record<string,unknown>,unknown,string,Record<string,unknown>][]=[
 ['GC5SC5HS',{searchQuery:tag()},{videos:[{videoId:video,channelId:'Channel_'+tag(),title:'Synthetic'}]},'609DF2IR',{videoId:video}],
 ['GM0TISWI',{keyword:tag()},{items:[{code,user:{id},captionText:'Synthetic'}]},'Z9M88QI8',{codeOrUrl:code}],
 ['28CFGF5I',{keyword:tag(),offset:'0'},[{opusId:id,uid:id,title:'Synthetic',opusUrl:`https://www.toutiao.com/article/${id}/`}],'PAB6Z75Y',{opusId:id}],
 ['E7G00COY',{keyword:tag()},{list:[{videoId:id,description:'Synthetic',nickname:'Display only'}]},'OE4KUEUO',{videoId:id}],
 ['ZWR31P2A',{keyword:tag()},{list:[{photoId:'opaque-'+id,caption:'Synthetic',nickname:'Display only'}]},'UOM99OQI',{photoId:'opaque-'+id}],
 ];
 for(const [op,parameters,data,target,detail] of fixtures){respond=()=>data;const run=await start(op,parameters,1);await step(run.id);await sql`UPDATE operation_results SET created_at=${at} WHERE run_id=${run.id} AND kind='query_summary'`;assert.equal((await finish(run.id)).status,'completed');const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind LIKE '%_work' ORDER BY id`,before=requests.length;
 const payload={operationId:target,parameters:detail,sourceResultId:result!.id},key=tag(),child=await createSynchronousQuery(payload,'test',key),frozen=await row(child.id);assert.equal(frozen.input.origin.discoveredAt,at.toISOString());assert.equal(frozen.input.origin.resultId,result!.id);assert.equal((await row(run.id)).status,'completed');assert.equal(requests.length,before);
 await assert.rejects(createSynchronousQuery({...payload,parameters:Object.fromEntries(Object.keys(detail).map(k=>[k,'WrongWork']))},'test',tag()));
 const provenance=result!.provenance;await sql`UPDATE operation_results SET provenance=${sql.json({...provenance,sourcePageResultId:result!.id})} WHERE id=${result!.id}`;await assert.rejects(createSynchronousQuery(payload,'test',tag()),/Source page/);assert.equal((await createSynchronousQuery(payload,'test',key)).id,child.id);await sql`UPDATE operation_results SET provenance=${sql.json(provenance)} WHERE id=${result!.id}`;
 if(op==='E7G00COY'||op==='ZWR31P2A'){
  assert.equal(result!.article_id,null);const source=tag();await sql`INSERT INTO sources(id,name,kind,enabled,participation_mode) VALUES (${source},'Synthetic manual source','external',true,'isolated')`;
  const input={sourceId:source,reason:'Verified scheduled candidate',supplement:{url:op==='E7G00COY'?`https://weixin.qq.com/sph/${tag()}`:`https://www.kuaishou.com/short-video/${tag()}`,evidence:'Individually verified original and isolated attribution'}};
  process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;
  try{const linked=await importManualWorkResult(result!.id,input,'test',tag());assert.ok(linked?.articleId);const [article]=await sql`SELECT * FROM articles WHERE id=${linked.articleId}`;assert.equal(article!.discovered_at.toISOString(),at.toISOString());assert.equal(article!.source_id,source);assert.equal((await sql`SELECT count(*)::int AS n FROM source_account_bindings WHERE source_id=${source}`)[0]!.n,0);assert.equal(requests.length,before);}
  finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';process.env.REDFOX_API_KEY='fake-platform-next';}
 }
 const [queryBudget]=await sql`SELECT * FROM budgets WHERE service='redfox.query'`;
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;
 try{respond=()=>target==='609DF2IR'?{videoId:video,title:'Synthetic detail'}:target==='Z9M88QI8'?{code,captionText:'Synthetic detail'}:target==='PAB6Z75Y'?{workId:id,title:'Synthetic detail',content:'Synthetic full content'}:target==='OE4KUEUO'?{description:'Synthetic detail'}:{caption:'Synthetic detail'};
 await step(child.id);assert.equal((await row(child.id)).status,'completed');const [detailResult]=await sql`SELECT data FROM operation_results WHERE run_id=${child.id} AND kind!='query_summary'`;assert.equal(detailResult!.data.originResultId,result!.id);if(target==='OE4KUEUO'||target==='UOM99OQI')assert.equal(detailResult!.data.workId,null);
 }finally{await sql`UPDATE budgets SET per_minute=${queryBudget!.per_minute},per_hour=${queryBudget!.per_hour},per_day=${queryBudget!.per_day} WHERE service='redfox.query'`;}
 }
});

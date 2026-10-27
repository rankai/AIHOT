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
import {importQichezhijiaResult} from '@aihot/backend/providers/redfox/import-qichezhijia';
import {importZhihuResult} from '@aihot/backend/providers/redfox/import-zhihu';
let data:unknown=[],hits=0,budget:Record<string,unknown>;
const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{hits++;res.end(JSON.stringify({code:req.url?.startsWith('/story/api/dongchedi/searchWork')?200:2000,data}));});});
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-cars-import';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;budget=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${budget.per_minute as number},per_hour=${budget.per_hour as number},per_day=${budget.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
async function query(operationId:string,parameters:Record<string,unknown>,response:unknown){data=response;const run=await createSynchronousQuery({operationId,parameters},'test',tag());await executeOperationStep(run.id,run.step_version,randomUUID());const [state]=await sql`SELECT * FROM operation_runs WHERE id=${run.id}`;assert.equal(state!.status,'completed',state!.wait_reason);return (await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind!='query_summary' ORDER BY id`)[0]!;}
test('same Autohome author digits keep original and chejiahao ownership separate, local import is atomic and idempotent',async()=>{
 const id=String(Date.now()),author='author-'+tag();const rows:Awaited<ReturnType<typeof query>>[]=[];
 for(const [workType,url] of [['3',`http://v.autohome.com.cn/v-${id}.html`],['14',`https://chejiahao.autohome.com.cn/info/${id}`]]){rows.push(await query('CI7VW144',{keyword:tag(),offset:'0',page:'1',sourceType:'video'},[{workId:id,workType,authorId:author,title:'Synthetic video',description:'Synthetic caption',workUrl:url}]));}
 const before=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;
 try{const a=await sql.begin(tx=>importQichezhijiaResult(rows[0]!.id,{reason:'Verified local item'},'test',tag(),tx)),b=await importQichezhijiaResult(rows[1]!.id,{reason:'Verified local item'},'test',tag());assert.ok(a&&b);assert.notEqual(a.sourceId,b.sourceId);assert.notEqual(a.articleId,b.articleId);const bindings=await sql`SELECT id_kind FROM source_account_bindings WHERE platform='qichezhijia' AND id_value=${author} ORDER BY id_kind`;assert.deepEqual(bindings.map(b=>b.id_kind),['chejiahao_authorId','original_authorId']);assert.equal((await sql`SELECT count(*)::int AS n FROM article_identity_aliases WHERE article_id IN (${a.articleId!},${b.articleId!})`)[0]!.n,0);assert.equal((await importQichezhijiaResult(rows[0]!.id,{reason:'Repeat'},'test',tag()))!.articleId,a.articleId);assert.equal(hits,before);
 const [source]=await sql`SELECT * FROM sources WHERE id=${a.sourceId}`;assert.equal(source!.participation_mode,'isolated');assert.equal(source!.site_fulltext,false);
 }finally{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-cars-import';}
});
test('Zhihu requires explicit native original evidence and preserves received namespace, author and discovery',async()=>{
 const uid=tag(),result=await query('API_1789095347662',{offset:'0',keword:tag(),vertical:'answer'},[{opusId:'opaque-'+tag(),uid,title:'Synthetic answer',publishTime:123}]);const at=new Date('2020-01-02T00:00:00Z');await sql`UPDATE operation_results SET created_at=${at} WHERE id=${result.id}`;
 await assert.rejects(importZhihuResult(result.id,{reason:'Missing original'},'test',tag()),/original/);
 await assert.rejects(importZhihuResult(result.id,{reason:'Wrong host',supplement:{url:'https://example.com/a',evidence:'Verified'}},'test',tag()),/original/);
 await assert.rejects(importZhihuResult(result.id,{reason:'Wrong namespace',supplement:{vertical:'article',url:'https://www.zhihu.com/question/123/answer/456',evidence:'Verified'}},'test',tag()),/namespace/);
 const input={reason:'Verified original',supplement:{url:`https://www.zhihu.com/question/123/answer/${Date.now()}`,evidence:'Operator verified the received answer against this original'}},key=tag(),before=hits;
 const a=await importZhihuResult(result.id,input,'test',key);assert.ok(a?.articleId);const [article]=await sql`SELECT * FROM articles WHERE id=${a.articleId}`;assert.equal(article!.discovered_at.toISOString(),at.toISOString());assert.equal(article!.backfill,true);assert.equal(article!.identity_key.startsWith('url:'),true);assert.equal(article!.raw.namespace,'answer');assert.equal((await importZhihuResult(result.id,input,'test',key))!.articleId,a.articleId);await assert.rejects(importZhihuResult(result.id,{...input,supplement:{...input.supplement,evidence:'Different'}},'test',key),/different/);assert.equal(hits,before);
});
test('Dongchedi only uses received same-response account context and imports documented article description as full body',async()=>{
 const {importDongchediResult}=await import('@aihot/backend/providers/redfox/import-dongchedi'),userId=tag(),workId=String(Date.now()),url=`https://www.dcdapp.com/motor/m/feed/detail?group_id=${workId}`;
 const account=await query('API_1791793668086',{userId},{account:{userId,displayName:'Synthetic DCD author'},workList:[{workId,workUrl:url,title:'Synthetic article',articleType:7,articleTypeStr:'ugc_article',description:'<p>Complete synthetic article.</p>',publishTime:1700000000}]});
 const [work]=await sql`SELECT * FROM operation_results WHERE run_id=${account.run_id} AND kind='dongchedi_work'`;
 const linked=await sql.begin(tx=>importDongchediResult(work!.id,{reason:'Same page author proof'},'test',tag(),tx));assert.ok(linked?.articleId);const [article]=await sql`SELECT * FROM articles WHERE id=${linked.articleId}`;assert.equal(article!.body_text,'Complete synthetic article.');assert.match(article!.body_html,/<p>/);assert.equal(article!.published_at.toISOString(),new Date(1700000000000).toISOString());assert.equal((await sql`SELECT id_value FROM source_account_bindings WHERE source_id=${linked.sourceId} AND id_kind='userId'`)[0]!.id_value,userId);
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{accountContext,userId}',${sql.json('forged')}) WHERE id=${work!.id}`;
 assert.equal((await importDongchediResult(work!.id,{reason:'Normalized context ignored'},'test',tag()))!.sourceId,linked.sourceId);
 const conflicting=await query('API_1791793668086',{userId},{account:{userId,displayName:'Synthetic DCD'},workList:[{workId:workId+'1',workUrl:url+'&other=1',title:'Synthetic mismatch',articleType:7,articleTypeStr:'ugc_article',authorId:'other'}]});const [bad]=await sql`SELECT * FROM operation_results WHERE run_id=${conflicting.run_id} AND kind='dongchedi_work'`;await assert.rejects(importDongchediResult(bad!.id,{reason:'Reject mismatch'},'test',tag()),/author conflicts/);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${bad!.id}`)[0]!.article_id,null);
});
test('Yiche article URL numbers are not supplier identity; explicit list relationship binds separate author kinds',async()=>{
 const {importYicheResult}=await import('@aihot/backend/providers/redfox/import-yiche'),author=tag(),url=`https://news.yiche.com/zonghexinwen/20260810/${Date.now()}.html`;
 const result=await query('VYSP68M2',{url},{workId:'different-supplier-id',authorId:author,title:'Synthetic full article',content:'<p>Full Yiche article.</p>',contentType:'21'});
 const linked=await sql.begin(tx=>importYicheResult(result.id,{reason:'Explicit native original'},'test',tag(),tx));assert.ok(linked?.articleId);const [article]=await sql`SELECT * FROM articles WHERE id=${linked.articleId}`;assert.equal(article!.url,url);assert.match(article!.identity_key,/^url:/);assert.equal(article!.raw.workId,'different-supplier-id');assert.equal(article!.body_text,'Full Yiche article.');
 const item=await query('YGYYT0G0',{userId:author},{workList:[{workId:'other-video-id',authorId:author,workType:4,workUrl:`http://vc.yiche.com/vplay/${Date.now()}.html`,description:'Synthetic video'}]});const video=await importYicheResult(item.id,{reason:'Verified directed list'},'test',tag());assert.equal(video!.sourceId,linked.sourceId);const bindings=await sql`SELECT id_kind FROM source_account_bindings WHERE source_id=${linked.sourceId} ORDER BY id_kind`;assert.deepEqual(bindings.map(r=>r.id_kind),['authorId','userId']);
});
test('Baijiahao fixed account detail relates uk to received uid/secUid, HTML keeps its independent original URL',async()=>{
 const {importBaijiahaoResult}=await import('@aihot/backend/providers/redfox/import-baijiahao'),uk=tag(),uid=tag(),secUid=tag();
 const account=await query('API_1789097000814',{uk},{uid,secUid,nickname:'Synthetic Baijiahao author'}),owner=await importBaijiahaoResult(account.id,{reason:'Received account proof'},'test',tag());assert.ok(owner);
 assert.deepEqual((await sql`SELECT id_kind FROM source_account_bindings WHERE source_id=${owner.sourceId} ORDER BY id_kind`).map(r=>r.id_kind),['secUid','uid','uk']);
 const articleId='supplier-'+tag(),url=`https://baijiahao.baidu.com/s?id=${Date.now()}`,result=await query('API_1789097000710',{articleId},{opusId:articleId,uid,title:'Synthetic full article',content:'<p>Complete Baijiahao HTML.</p>',opusUrl:url,imageList:['https://example.com/synthetic.jpg']});
 const before=hits;process.env.REDFOX_CALLS_ENABLED='false';try{const linked=await sql.begin(tx=>importBaijiahaoResult(result.id,{reason:'Local HTML import'},'test',tag(),tx));assert.equal(linked!.sourceId,owner.sourceId);const [article]=await sql`SELECT * FROM articles WHERE id=${linked!.articleId!}`;assert.equal(article!.url,url);assert.equal(article!.raw.workId,articleId);assert.equal(article!.body_text,'Complete Baijiahao HTML.');assert.deepEqual(article!.media,[{kind:'image',url:'https://example.com/synthetic.jpg'}]);assert.equal(hits,before);}finally{process.env.REDFOX_CALLS_ENABLED='true';}
 await sql`UPDATE sources SET enabled=false WHERE id=${owner.sourceId}`;
 const second=await query('API_1789097000710',{articleId:articleId+'2'},{opusId:articleId+'2',uid,title:'Disabled author',content:'Synthetic',opusUrl:url+'&other=2'});await assert.rejects(importBaijiahaoResult(second.id,{reason:'Disabled author'},'test',tag()),/disabled/);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${second.id}`)[0]!.article_id,null);
});
test('new same-work captions preserve full body and concurrent imports preserve existing ownership and timeline',async()=>{
 const {importYicheResult}=await import('@aihot/backend/providers/redfox/import-yiche'),author=tag(),url=`https://news.yiche.com/zonghexinwen/20260810/${Date.now()}.html`;
 const first=await query('VYSP68M2',{url},{workId:tag(),authorId:author,title:'Synthetic unchanged title',content:'<p>Complete article body.</p>'});const owned=await importYicheResult(first.id,{reason:'Full original'},'test',tag());assert.ok(owned?.articleId);const [before]=await sql`SELECT * FROM articles WHERE id=${owned.articleId}`;
 const caption=await query('YIGCY5US',{keyword:tag(),page:1,sourceType:'xinwen'},[{workId:tag(),authorId:author,title:'Synthetic unchanged title',description:'Short summary',workUrl:url}]);const key=tag();const [a,b]=await Promise.all([importYicheResult(caption.id,{reason:'Same command'},'test',key),importYicheResult(caption.id,{reason:'Same command'},'test',key)]);assert.equal(a!.articleId,owned.articleId);assert.equal(b!.articleId,owned.articleId);
 const [after]=await sql`SELECT * FROM articles WHERE id=${owned.articleId}`;assert.equal(after!.body_text,before!.body_text);assert.equal(after!.body_html,before!.body_html);assert.equal(after!.revision,before!.revision);assert.equal(after!.discovered_at.toISOString(),before!.discovered_at.toISOString());
 const other=await query('YIGCY5US',{keyword:tag(),page:1,sourceType:'xinwen'},[{workId:tag(),authorId:'other-'+tag(),title:'Other source',description:'Must not overwrite',workUrl:url}]);const result=await importYicheResult(other.id,{reason:'Other discovery'},'test',tag());assert.equal(result!.articleId,owned.articleId);assert.notEqual(result!.sourceId,owned.sourceId);assert.equal((await sql`SELECT source_id FROM articles WHERE id=${owned.articleId}`)[0]!.source_id,owned.sourceId);
});
test('manual original evidence can fill invalid placeholders but cannot replace confirmed or requested works',async()=>{
 const {importYicheResult}=await import('@aihot/backend/providers/redfox/import-yiche');const {importDongchediResult}=await import('@aihot/backend/providers/redfox/import-dongchedi');
 const video=await query('3BXWEB6Y',{workId:tag()},{title:'Synthetic placeholder',workUrl:'[]',authorInfo:{userId:tag()}}),url=`https://vc.yiche.com/vplay/${Date.now()}.html`;
 const before=hits;const linked=await importYicheResult(video.id,{reason:'Verified original',supplement:{url,evidence:'Matched the received video to its original page'}},'test',tag());assert.ok(linked?.articleId);assert.equal(hits,before);assert.equal((await sql`SELECT data FROM operation_results WHERE id=${video.id}`)[0]!.data.record.workUrl,'[]');
 const id=String(Date.now()),relative=`//m.dcdapp.com/motor/m/feed/detail?group_id=${id}&share=synthetic`,dcd=await query('W86F8SSK',{keyword:tag(),offset:'0',sourceType:'2'},{workList:[{workId:id,title:'Synthetic relative original',authorId:tag(),workUrl:relative}],hasMore:'0'});
 await assert.rejects(importDongchediResult(dcd.id,{reason:'Different work',supplement:{url:`https://m.dcdapp.com/motor/m/feed/detail?group_id=${id}1&share=synthetic`,evidence:'Cannot change original'}},'test',tag()),/locator cannot be replaced/);
 const at=hits;const imported=await importDongchediResult(dcd.id,{reason:'Verified explicit scheme',supplement:{url:'https:'+relative,evidence:'Operator verified the same host, path and query'}},'test',tag());assert.ok(imported?.articleId);assert.equal(hits,at);assert.equal((await sql`SELECT data FROM operation_results WHERE id=${dcd.id}`)[0]!.data.record.workUrl,relative);
 const valid=await query('YIGCY5US',{keyword:tag(),page:1,sourceType:'shipin'},[{workId:tag(),authorId:tag(),title:'Known native original',workUrl:url}]);await assert.rejects(importYicheResult(valid.id,{reason:'Wrong original',supplement:{url:url.replace('.html','2.html'),evidence:'Not the same work'}},'test',tag()),/Received original cannot be replaced/);
 const requested=`https://news.yiche.com/verified-original/${tag()}`,detail=await query('VYSP68M2',{url:requested},{workId:tag(),authorId:tag(),title:'Explicit requested article',content:'Synthetic full body'});await assert.rejects(importYicheResult(detail.id,{reason:'Wrong requested original',supplement:{url:requested+'2',evidence:'Cannot replace request scope'}},'test',tag()),/Requested original cannot be replaced/);
 const exact=await importYicheResult(detail.id,{reason:'Verified requested original',supplement:{url:requested,evidence:'Verified this exact explicit input page'}},'test',tag());assert.ok(exact?.articleId);
});
test('manual Autohome and Zhihu original fallback rejects obvious media paths without network',async()=>{
 const auto=await query('CI7VW144',{keyword:tag(),offset:'0',page:'1',sourceType:'club'},[{workId:tag(),authorId:tag(),title:'Synthetic club post'}]);const zhihu=await query('API_1789095347662',{keword:tag(),offset:'0',vertical:'answer'},[{opusId:tag(),uid:tag(),title:'Synthetic answer'}]);const before=hits;
 for(const extension of ['jpg','png','webp','mp4','mp3']){await assert.rejects(importQichezhijiaResult(auto.id,{reason:'Media is not original',supplement:{url:`https://club.autohome.com.cn/synthetic.${extension}`,evidence:'Must reject media'}},'test',tag()),/original/);await assert.rejects(importZhihuResult(zhihu.id,{reason:'Media is not original',supplement:{url:`https://www.zhihu.com/synthetic.${extension}`,evidence:'Must reject media'}},'test',tag()),/URL/);}
 assert.equal(hits,before);assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE id IN (${auto.id},${zhihu.id}) AND article_id IS NOT NULL`)[0]!.n,0);
});

test('verified full car and Baijiahao bodies retain source-video facts before HTML sanitization',async()=>{
 const {importDongchediResult}=await import('@aihot/backend/providers/redfox/import-dongchedi'),{importYicheResult}=await import('@aihot/backend/providers/redfox/import-yiche'),{importBaijiahaoResult}=await import('@aihot/backend/providers/redfox/import-baijiahao');
 const {scanVideoHistory,applyVideoHistoryEntry}=await import('@aihot/backend/content/video-history');
 const html='<p>Full body</p><video><source type="video/mp4" src="/v.mp4"></video>',id=String(Date.now()),author=tag();
 const cases=[
  {op:'LLCI8QTE',parameters:{workId:id,page:1},record:{workId:id,authorId:author,workUrl:`https://chejiahao.autohome.com.cn/info/${id}`,title:'Body',content:html},importer:importQichezhijiaResult},
  {op:'VYSP68M2',parameters:{url:`https://news.yiche.com/zonghexinwen/20260810/${id}.html`},record:{workId:id,authorId:author,title:'Body',content:html},importer:importYicheResult},
  {op:'API_1789097000710',parameters:{articleId:id},record:{opusId:id,uid:author,opusUrl:`https://baijiahao.baidu.com/s?id=${id}`,title:'Body',content:html},importer:importBaijiahaoResult},
  {op:'API_1791793668086',parameters:{userId:author},record:{account:{userId:author},workList:[{workId:id,workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${id}`,title:'Body',articleType:7,articleTypeStr:'ugc_article',description:html}]},importer:importDongchediResult},
 ];
 for(const c of cases){
  let result=await query(c.op,c.parameters,c.record);
  if(result.kind==='dongchedi_account')result=(await sql`SELECT * FROM operation_results WHERE run_id=${result.run_id} AND kind='dongchedi_work'`)[0]!;
  const imported=await c.importer(result.id,{reason:'Verified raw body'},'body-video',tag());
  const [article]=await sql`SELECT media,body_html FROM articles WHERE id=${imported!.articleId}`;assert.equal(article!.media.some((m:any)=>m.confirmed===true),true,c.op);assert.equal(article!.body_html.includes('<source'),false);
  await sql`UPDATE articles SET media='[]'::jsonb WHERE id=${imported!.articleId}`;
  const manifest=await sql.begin('read only',tx=>scanVideoHistory(tx,5000)),entry=manifest.entries.find(e=>e.articleId===imported!.articleId);assert.ok(entry,c.op+' historical proof');
  await sql.begin(tx=>applyVideoHistoryEntry(tx,entry));
 }
});

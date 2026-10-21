import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createRun} from '@aihot/backend/providers/operations/store';
import {operationDetail} from '@aihot/backend/providers/operations/read';
import {isHistorical} from '@aihot/backend/content/materials';
after(async()=>{await stopBoss();await closeDb();});
const numeric=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
const discovered=new Date(Math.floor(Date.now()/1000)*1000-4*86400000),published=new Date(discovered.getTime()-3600000);
async function fixture(platform:string,op:string,parameters:Record<string,unknown>,record:Record<string,unknown>){
 const parser=await import(`../packages/backend/src/providers/redfox/${platform==="xiaohongshu"?"xiaohongshu-parser":platform}.ts`);
 const parsed=parser[`parse${platform[0]!.toUpperCase()+platform.slice(1)}`](op,record,parameters)[0];
 const run=await sql.begin(tx=>createRun(tx,{actor:'discovery-test',commandKey:tag(),provider:'redfox',operationKey:'redfox.sync.query',contractVersion:1,stepKey:'redfox.sync.query',input:{operationId:op,parameters},limits:{steps:1}}));
 const [receipt]=await sql`INSERT INTO receipts(logical_key,service,model,purpose,status,response,attempts) VALUES (${tag()},'redfox.query',${op},'query','completed','{"body":"synthetic retained"}',3) RETURNING id`;
 const [r]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id,created_at) VALUES (${run.id},1,'work',${parsed.kind},${sql.json(parsed.data)},${receipt!.id},${discovered}) RETURNING *`;
 await sql`UPDATE operation_runs SET created_at=${new Date(discovered.getTime()-10*86400000)},status='completed',current_receipt_id=${receipt!.id} WHERE id=${run.id}`;
 return {run,receiptId:receipt!.id,result:r!};
}
const cases=()=>{const id=numeric(),uid=numeric(),code=randomUUID().replaceAll('-',''),video=code.slice(0,11);return [
 ['weibo','API_1789098514899',{opusId:id},{opusId:id,uid,text:'Synthetic body',opusUrl:`https://weibo.com/${uid}/${id}`,publishTime:published.toISOString()}],
 ['wechat','1LDQ7E1C',{workUuid:code},{workUuid:code,title:'Synthetic',content:'Synthetic body',bizInfo:code,workUrl:`https://mp.weixin.qq.com/s?__biz=${code}&mid=123&idx=1&sn=${code}`,publishTime:published.toISOString()}],
 ['douyin','FK67XDVQ',{videoId:id},{videoId:id,content:'Synthetic body',authorUid:uid,opusUrl:`https://douyin.com/video/${id}`,publishTime:published.toISOString()}],
 ['xiaohongshu','KR1LPTBF',{workId:code},{workId:code,workTitle:'Synthetic',workDesc:'Synthetic body',accountUserid:uid,workUrl:`https://xiaohongshu.com/explore/${code}`,workPublishTime:published.toISOString()}],
 ['tiktok','6SE9WIHJ',{awemeId:id},{workId:id,content:'Synthetic body',authorData:{userId:uid},shareLink:`https://tiktok.com/@synthetic/video/${id}`,publishTime:published.getTime()/1000}],
 ['bilibili','TIN1NMTZ',{bvId:'BV'+code.slice(0,10)},{bvId:'BV'+code.slice(0,10),title:'Synthetic',description:'Synthetic body',authorId:uid,created:published.toISOString()}],
 ['youtube','609DF2IR',{videoId:video},{videoId:video,title:'Synthetic',description:'Synthetic body',channelUrl:`https://youtube.com/channel/UC_${code}`,date:published.toISOString()}],
 ['instagram','Z9M88QI8',{codeOrUrl:code},{code,user:{id:uid},captionText:'Synthetic body',takenAt:published.getTime()/1000}],
 ] as [string,string,Record<string,unknown>,Record<string,unknown>][];};
test('eight delayed sync imports use the consumed result discovery, not click/run/shared receipt time',async()=>{
 for(const [platform,op,parameters,record] of cases()){
  const f=await fixture(platform,op,parameters,record),mod=await import(`../packages/backend/src/providers/redfox/import-${platform}.ts`),load=mod[`import${platform[0]!.toUpperCase()+platform.slice(1)}Result`];
  await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id,created_at) VALUES (${f.run.id},1,'unrelated-earlier','query_summary','{}',${f.receiptId},${new Date(discovered.getTime()-86400000)})`;
  const imported=await load(f.result.id,{reason:'Delayed click fixture'},'discovery-test',tag());
  const [a]=await sql`SELECT * FROM articles WHERE id=${imported.articleId}`;
  assert.equal(a!.discovered_at.toISOString(),discovered.toISOString(),platform);assert.equal(a!.backfill,false,platform);assert.equal(isHistorical(a as never),false,platform);
  assert.equal(a!.published_at.toISOString(),published.toISOString(),platform);
  // Existing material times survive subsequent consumption of a different result from the same receipt/run.
  const later=new Date(discovered.getTime()+3*86400000);
  const [second]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id,created_at) VALUES (${f.run.id},1,'second-work',${f.result.kind},${sql.json(f.result.data)},${f.receiptId},${later}) RETURNING id`;
  const again=await load(second!.id,{reason:'Same material later'},'discovery-test',tag());assert.equal(again.articleId,imported.articleId);
  assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${imported.articleId}`)[0]!.discovered_at.toISOString(),discovered.toISOString());
 }
});
test('attempt diagnostics count master raw only for the current attempt and same receipt',async()=>{
 const [platform,op,p,record]=cases()[5]!;const f=await fixture(platform,op,p,record);
 for(const attempt of [1,2,3])await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,response) VALUES (${f.receiptId},${attempt},'redfox.query',${op},'received',${attempt===1?sql.json({body:'late old response'}):null})`;
 let detail=await operationDetail(f.run.id);assert.deepEqual(detail!.attempts.map(a=>a.has_retained_response),[true,false,true]);
 await sql`UPDATE receipts SET response=NULL WHERE id=${f.receiptId}`;detail=await operationDetail(f.run.id);assert.deepEqual(detail!.attempts.map(a=>a.has_retained_response),[true,false,false]);
 const other=await fixture(...cases()[5]!);await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,status) VALUES (${other.receiptId},1,'redfox.query','received')`;assert.deepEqual((await operationDetail(other.run.id))!.attempts.map(a=>a.has_retained_response),[false]);
 assert.equal('response' in detail!.attempts[0]!,false);
});

test('different results sharing one receipt keep distinct discovery; formal legacy fallback and foreign page rejection are explicit',async()=>{
 const {importBilibiliResult}=await import('@aihot/backend/providers/redfox/import-bilibili');
 const f=await fixture(...cases()[5]!),later=new Date(discovered.getTime()+86400000),bv='BV'+randomUUID().replaceAll('-','').slice(0,10);
 const data={...f.result.data,record:{...f.result.data.record,bvId:bv}};
 const [second]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id,created_at) VALUES (${f.run.id},1,'other-work','bilibili_work',${sql.json(data)},${f.receiptId},${later}) RETURNING id`;
 // Detail is scoped to its request, so use two normal search records sharing the same page receipt.
 await sql`UPDATE operation_runs SET input=${sql.json({operationId:'LEN9QXR3',parameters:{keyword:'synthetic',page:'1'}})} WHERE id=${f.run.id}`;
 await sql`UPDATE receipts SET model='LEN9QXR3' WHERE id=${f.receiptId}`;
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{operationId}','"LEN9QXR3"') WHERE run_id=${f.run.id}`;
 const a=await importBilibiliResult(f.result.id,{reason:'First search item'},'test',tag()),b=await importBilibiliResult(second!.id,{reason:'Second search item'},'test',tag());
 assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${a!.articleId!}`)[0]!.discovered_at.toISOString(),discovered.toISOString());
 assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${b!.articleId!}`)[0]!.discovered_at.toISOString(),later.toISOString());
 const {importWeiboResult}=await import('@aihot/backend/providers/redfox/import-weibo');
 const legacy=await fixture(...cases()[0]!);
 await sql`UPDATE operation_runs SET operation_key='redfox.weibo.collection',input=${sql.json({operationId:'TXQPVGJG',parameters:{keyword:'synthetic',searchType:'61',page:'1'}})} WHERE id=${legacy.run.id}`;
 const imported=await importWeiboResult(legacy.result.id,{reason:'Legacy without source page'},'test',tag());
 assert.equal((await sql`SELECT discovered_at FROM articles WHERE id=${imported!.articleId!}`)[0]!.discovered_at.toISOString(),discovered.toISOString());
 const bad=await fixture(...cases()[0]!);
 await sql`UPDATE operation_runs SET operation_key='redfox.weibo.collection',input=${sql.json({operationId:'TXQPVGJG',parameters:{keyword:'synthetic',searchType:'61',page:'1'}})} WHERE id=${bad.run.id}`;
 await sql`UPDATE operation_results SET provenance=${sql.json({sourcePageResultId:Number(legacy.result.id)})} WHERE id=${bad.result.id}`;
 await assert.rejects(importWeiboResult(bad.result.id,{reason:'Foreign page rejected'},'test',tag()),/Source-page/);
 assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${bad.result.id}`)[0]!.article_id,null);
});

test('new description/caption results link without downgrading an existing full body',async()=>{
 const {upsertMaterial}=await import('@aihot/backend/content/materials');
 for(const c of cases().filter(x=>['youtube','bilibili','instagram'].includes(x[0]))){
  const f=await fixture(...c),mod=await import(`../packages/backend/src/providers/redfox/import-${c[0]}.ts`),load=mod[`import${c[0][0]!.toUpperCase()+c[0].slice(1)}Result`];
  const first=await load(f.result.id,{reason:'Initial candidate'},'body-test',tag());
  const [original]=await sql`SELECT * FROM articles WHERE id=${first.articleId}`;
  await upsertMaterial({sourceId:original!.source_id,url:original!.url,title:original!.title,bodyText:'Complete verified body',bodyHtml:'<p>Complete verified body</p>',bodyStatus:'ok',via:'fetch'});
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${first.articleId}`;
  const [before]=await sql`SELECT * FROM articles WHERE id=${first.articleId}`;
  const [r]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id) VALUES (${f.run.id},1,'new-description',${f.result.kind},${sql.json(f.result.data)},${f.receiptId}) RETURNING id`;
  const key=tag(),again=await load(r!.id,{reason:'Another received result'},'body-test',key);
  assert.equal(again.articleId,first.articleId);
  await load(r!.id,{reason:'Another received result'},'body-test',key);
  const [after]=await sql`SELECT * FROM articles WHERE id=${first.articleId}`;
  for(const field of ['body_text','body_html','body_status','content_hash','revision','processing_state','discovered_at','published_at','backfill'])assert.deepEqual(after![field],before![field],`${c[0]} ${field}`);
  assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r!.id}`)[0]!.article_id,first.articleId);
  assert.equal((await sql`SELECT count(*)::int AS n FROM article_discoveries WHERE article_id=${first.articleId} AND via='import'`)[0]!.n,1);
 }
});

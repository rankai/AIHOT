import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createNativeSubscription} from '@aihot/backend/sources/native-migration';
import {createNativeCollection} from '@aihot/backend/sources/native-commands';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {sourceDetail,updateSource} from '@aihot/backend/admin/sources';
import {operationDetail} from '@aihot/backend/providers/operations/read';
import {videoResourcesFromHtml} from '@aihot/backend/content/media';
import {assertSupportedConfig} from '@aihot/backend/sources/config-keys';
import {assetMetadata,listAssets,getAsset} from '@aihot/backend/operations/assets';

import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {importManualWorkResult} from '@aihot/backend/providers/redfox/import-manual-work';
import {importTiktokResult} from '@aihot/backend/providers/redfox/import-tiktok';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {upsertMaterial} from '@aihot/backend/content/materials';

import {preflightXReplacement,switchXCollection} from '@aihot/backend/sources/x-replacement';
import {logicalMpConfig} from '@aihot/backend/sources/mp-replacement';
import {videoDownloadCapability} from '@aihot/backend/sources/subscription-video-candidates';
let collectionData:unknown,xExtra:Record<string,unknown>={},loseParser=false;
let xId='',mpId='',html='',mediaUrl='',bytes:Buffer,gets:string[]=[];
let provider:Awaited<ReturnType<typeof stub>>,media:http.Server,budgets:Record<string,any>[]=[];
const state=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
async function step(id:number){const r=await state(id);await executeOperationStep(id,r.step_version,randomUUID());return state(id);}
async function child(id:number){return (await sql`SELECT * FROM operation_runs WHERE operation_key='subscription.video.download' AND input->>'parentRunId'=${String(id)}`)[0];}
async function source(kind:'x_search'|'mp_account',auto=true){const id=tag();const conf={...(kind==='x_search'?{query:`from:synthetic ${id}`}:{ghid:id}),autoDownloadVideo:auto};await sql`INSERT INTO sources(id,name,kind,config,participation_mode) VALUES (${id},'Synthetic video source',${kind},${sql.json(conf)},'isolated')`;await sql.begin(tx=>createNativeSubscription(tx,id));return id;}
async function collect(id:string){const run=await createNativeCollection(id,{actor:'test',key:tag(),reason:'schedule'});for(let n=0;n<5&&(await state(run.id)).status==='active';n++)await step(run.id);assert.equal((await state(run.id)).status,'completed');return run;}
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 budgets=await sql`SELECT * FROM budgets WHERE service IN ('socialdata','dajiala','redfox.media','redfox.collect','redfox.query')`;await sql`UPDATE budgets SET per_minute=10000,per_hour=10000,per_day=10000 WHERE service IN ('socialdata','dajiala','redfox.media','redfox.collect','redfox.query')`;
 bytes=Buffer.from(JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files.find((f:any)=>f.filename==='tiny.mp4').base64,'base64');
 media=http.createServer((req,res)=>{if(req.url!.startsWith('/story/')&&!req.url!.includes('/parseWork/')){req.resume();req.on('end',()=>res.end(JSON.stringify({code:2000,data:collectionData})));return;}if(req.method==='GET'){gets.push(req.url!);if(req.url==='/large'){res.writeHead(200,{'content-length':'50000001'});res.end();}else{res.writeHead(200,{'content-type':'video/mp4'});res.end(bytes);}return;}if(loseParser){req.socket.destroy();return;}req.resume();req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({code:2000,data:{videoUrl:mediaUrl+'/x',resources:[]}}));});});await new Promise<void>(r=>media.listen(0,'127.0.0.1',r));mediaUrl=`http://127.0.0.1:${(media.address() as {port:number}).port}`;
 provider=await stub((_n,req)=>req.url.includes('post_history')?{code:0,data:[{position:1,url:`https://mp.weixin.qq.com/s?__biz=${mpId}&mid=1&idx=1&sn=synthetic`,title:'Synthetic MP',post_time:Math.floor(Date.now()/1000),sn:mpId}]}:req.url.includes('article_detail')?{code:0,title:'Synthetic MP',content:html}:{tweets:[{id_str:xId,tweet_created_at:new Date().toISOString(),full_text:'Synthetic video',user:{name:'Synthetic',screen_name:'synthetic'},extended_entities:{media:[{type:'video',media_url_https:'https://example.test/cover.jpg'}]},...xExtra}],next_cursor:null});
 Object.assign(process.env,{SOCIALDATA_API_KEY:'synthetic-key',SOCIALDATA_BASE_URL:provider.url,DAJIALA_KEY:'synthetic-key',DAJIALA_BASE_URL:provider.url,REDFOX_API_KEY:'synthetic-key',REDFOX_TEST_BASE_URL:mediaUrl,REDFOX_CALLS_ENABLED:'true',COLLECT_ENABLED:'true'});config.allowPrivateNetworkFetch=true;
});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await provider.close();await new Promise<void>(r=>media.close(()=>r()));await stopBoss();await closeDb();});

test('native X commits subscription intent and completes private Redfox save with safe derived DTO',async()=>{
 xId=String(BigInt(Date.now())*10000n);const id=await source('x_search'),parent=await collect(id),run=await child(parent.id);assert.ok(run);assert.equal(run.input.workId,xId);assert.equal(run.input.collector,'socialdata');
 await step(run.id);assert.equal((await step(run.id)).status,'completed');
 const detail=await operationDetail(run.id),file=detail!.results.find((r:any)=>r.file)!.file;
 assert.equal(file.origin,'subscription-video');assert.equal(file.source.sourceId,id);assert.equal(file.source.runId,run.id);assert.equal(file.expired,false);assert.ok(file.createdAt&&file.expiresAt);
 assert.equal(JSON.stringify(detail).includes(mediaUrl),false);assert.equal((await sourceDetail(id))!.source.videoDownloads.lastRunId,run.id);
 const asset=await getAsset(file.key);assert.equal(asset.bytes,bytes.length);
});

test('MP captures owned source alternatives before cleaning, rejects oversized first and saves second with outbound Redfox disabled',async()=>{
 mpId=tag();const id=await source('mp_account');html=`<p>Owned article.</p><video><source type="video/mp4" src="${mediaUrl}/large"><source type="video/mp4" src="${mediaUrl}/small"></video><pre><video src="${mediaUrl}/code"></video></pre><iframe><video src="${mediaUrl}/frame"></video></iframe><div class="promo-box"><video src="${mediaUrl}/promo"></video></div>`;
 const groups=videoResourcesFromHtml(html,'https://example.test');assert.deepEqual(groups,[[mediaUrl+'/large',mediaUrl+'/small']]);
 const parent=await collect(id),run=await child(parent.id);assert.ok(run);assert.equal(run.input.manifest.targets.length,1);assert.equal(run.input.manifest.targets[0].candidates.length,2);
 const [article]=await sql`SELECT media,body_html FROM articles WHERE id=${run.input.articleId}`;assert.ok(article!.media.some((m:any)=>m.kind==='video'&&m.confirmed));assert.equal(article!.body_html.includes('<source'),false);
 const before=gets.length;process.env.REDFOX_CALLS_ENABLED='false';await step(run.id);assert.equal((await step(run.id)).status,'completed');process.env.REDFOX_CALLS_ENABLED='true';assert.deepEqual(gets.slice(before),['/large','/small']);
 mpId=tag();html=`<p>Second work.</p><video src="${mediaUrl}/small"></video><video></video>`;const mixed=await child((await collect(await source('mp_account'))).id);assert.equal(mixed!.input.singleVideo,false);assert.equal(mixed!.input.manifest.targets.length,2);assert.ok(mixed!.input.manifest.targets.every((t:any)=>t.stable===false));
});

test('native config is boolean, subscription-owned, defaults false; disabling invalidates stopped generation and retains receipt',async()=>{
 assert.throws(()=>assertSupportedConfig('x_search',{query:'from:synthetic',autoDownloadVideo:'true'}));assert.throws(()=>assertSupportedConfig('rss',{feedUrl:'https://example.test',autoDownloadVideo:true}));
 xId=String(BigInt(Date.now())*10000n+1n);const id=await source('x_search'),parent=await collect(id),run=await child(parent.id);
 assert.equal((await sql`SELECT config ? 'autoDownloadVideo' AS has FROM sources WHERE id=${id}`)[0]!.has,false);
 await sql`UPDATE operation_runs SET status='stopped' WHERE id=${run.id}`;
 const d=await sourceDetail(id);await updateSource(id,{version:new Date(d!.source.updated_at).toISOString(),patch:{config:{...d!.source.config,autoDownloadVideo:false}}},'test');
 const stopped=await state(run.id);assert.equal(stopped.status,'stopped');assert.equal(stopped.generation,run.generation+1);
 assert.equal((await sourceDetail(id))!.source.config.autoDownloadVideo,false);
 xId=String(BigInt(Date.now())*10000n+2n);assert.equal(await child((await collect(id)).id),undefined);
});

async function platformCollect(operationId:string,parameters:Record<string,unknown>,response:unknown){
 collectionData=response;const sub=await createPlatformSubscription({name:tag(),operationId,parameters,autoDownloadVideo:true,enabled:true,limits:{pages:1,items:10,details:0}},'test',tag());
 const run=await startPlatformSubscription(sub.id,'test',tag());for(let n=0;n<8&&(await state(run.id)).status==='active';n++)await step(run.id);
 assert.equal((await state(run.id)).status,'completed',(await state(run.id)).wait_reason);return {run,sub,results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};
}
test('TikTok topic and favorite real imports use verified authors and direct download; XHS creates fixed resolver intent',async()=>{
 for(const operationId of ['API_1790149158205','API_1790581450500']){
  const workId=String(BigInt(Date.now())*10000n+BigInt(Math.floor(Math.random()*1000))),userId=workId+'1';
  const record={workId,content:'Synthetic work',shareLink:`https://www.tiktok.com/@synthetic/video/${workId}`,mediaType:'video',authorData:{userId,secUserId:'sec-'+userId},videoData:{downloadNoMarkAddress:mediaUrl+'/tiktok'}};
  const {run}=await platformCollect(operationId,operationId==='API_1790149158205'?{ch_id:workId,cursor:'0'}:{sec_user_id:'collector-'+tag(),max_cursor:'0'},{nextCursor:'0',hasMore:0,workList:[record]});
  const save=await child(run.id);assert.ok(save);assert.equal(save.input.workId,workId);assert.equal(save.input.manifest.targets[0].candidates[0].field,'videoData.downloadNoMarkAddress');assert.equal((await step(save.id)).status,'completed');assert.equal((await operationDetail(save.id))!.inputs.videoDownload!.resolverUsed,false);
 }
 const note=tag(),author=tag(),record={workId:note,workTitle:'Synthetic video note',workType:'video',workUrl:`https://www.xiaohongshu.com/explore/${note}`,accountUserid:author};
 const {run}=await platformCollect('384C6W6B',{keyword:tag()},{list:[record]});const save=await child(run.id);assert.ok(save);assert.equal(save.input.workId,note);assert.equal(save.input.resolver.operationId,'QPNFJRG1');
 await sql`UPDATE operation_runs SET status='needs_review' WHERE id=${save.id}`;const authorSource=(await sourceDetail(save.input.sourceId))!.source;await updateSource(authorSource.id,{version:new Date(authorSource.updated_at).toISOString(),patch:{enabled:false}},'test');assert.equal((await state(save.id)).status,'stopped');assert.equal((await state(save.id)).generation,save.generation+1);
});
test('verified collection manual import is atomic, fills old material video facts, and independent query has no download effect',async()=>{
 const workId=String(BigInt(Date.now())*10000n+7n),url=`https://www.tiktok.com/@synthetic/video/${workId}`,record={workId,content:'Synthetic needs author',shareLink:url,mediaType:'video',videoData:{downloadAddress:mediaUrl+'/manual-tiktok'}};
 const collected=await platformCollect('API_1790149158205',{ch_id:workId,cursor:'0'},{nextCursor:'0',hasMore:0,workList:[record]});const result=collected.results.find(r=>r.kind==='tiktok_work')!;assert.equal(result.article_id,null);assert.equal(await child(collected.run.id),undefined);
 const input={reason:'Synthetic verified author',supplement:{userId:workId+'1',evidence:'Synthetic independently checked author'}};
 await assert.rejects(sql.begin(async tx=>{await importTiktokResult(result.id,input,'test',tag(),tx);const [child]=await tx`SELECT id FROM operation_runs WHERE input->>'parentResultId'=${String(result.id)}`;assert.ok(child);throw new Error('rollback verified intent');}),/rollback verified intent/);
 assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${result.id}`)[0]!.article_id,null);assert.equal(await child(collected.run.id),undefined);
 const sourceId='tiktok-rollback-'+tag();await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${sourceId},'Synthetic','external','isolated')`;
 // The native identity already exists; filling media must still register when content does not change.
 const old=await upsertMaterial({sourceId,url,identityKey:`tiktok:workId:${workId}`,title:'Synthetic needs author',bodyText:'Synthetic needs author',via:'import'});
 await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('tiktok','userId',${workId+'1'},${sourceId},'{"kind":"manual","reference":"synthetic"}')`;
 const imported=await importTiktokResult(result.id,input,'test',tag());assert.equal(imported!.articleId,old.articleId);assert.ok(await child(collected.run.id));assert.ok((await sql`SELECT media FROM articles WHERE id=${old.articleId}`)[0]!.media.some((m:any)=>m.confirmed));
 collectionData=record;const query=await createSynchronousQuery({operationId:'6SE9WIHJ',parameters:{awemeId:workId}},'test',tag());await step(query.id);const [q]=await sql`SELECT id FROM operation_results WHERE run_id=${query.id} AND kind='tiktok_work'`;await importTiktokResult(q!.id,input,'test',tag());assert.equal(await child(query.id),undefined);
});
test('Kuaishou collection requires manual verified attribution before registration; query and non-video remain inert',async()=>{
 const photoId=tag(),record={photoId,caption:'Synthetic verified video',workType:'1',videoUrl:mediaUrl+'/ks'};
 const collected=await platformCollect('ZWR31P2A',{keyword:tag()},{list:[record]}),result=collected.results.find(r=>r.kind==='kuaishou_work')!;assert.equal(await child(collected.run.id),undefined);
 const sourceId=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode) VALUES (${sourceId},'Synthetic','external','isolated')`;
 const input={sourceId,reason:'Synthetic checked identity',supplement:{url:`https://www.kuaishou.com/short-video/${photoId}`,evidence:'Verified original and author'}};
 await importManualWorkResult(result.id,input,'test',tag());const run=await child(collected.run.id);assert.ok(run);assert.equal((await step(run.id)).status,'completed');
 collectionData={...record,photoId:tag(),workType:'2'};const next=await platformCollect('ZWR31P2A',{keyword:tag()},{list:[collectionData]});const r=next.results.find(r=>r.kind==='kuaishou_work')!;await importManualWorkResult(r.id,{...input,supplement:{...input.supplement,url:`https://www.kuaishou.com/short-video/${tag()}`}},'test',tag());assert.equal(await child(next.run.id),undefined);
 const [file]=await sql`SELECT file_key FROM operation_results WHERE run_id=${run.id} AND file_key IS NOT NULL`;await sql`UPDATE stored_files SET expires_at=now()-interval '1 second' WHERE key=${file!.file_key}`;
 assert.equal((await assetMetadata(file!.file_key)).expired,true);assert.ok((await listAssets()).items.every(a=>!('candidate' in a)));await assert.rejects(getAsset(file!.file_key),/expired/);
});

test('native X own and verified single-level quote use real target IDs with shared parent links; mismatched and GIF quotes stay inert',async()=>{
 const base=BigInt(Date.now())*100000n;
 for(const [index,own,valid,gif] of [[0,true,true,false],[1,false,true,false],[2,false,false,false],[3,false,true,true]] as const){
  xId=String(base+BigInt(index*10));const quotedId=String(base+BigInt(index*10+1));
  xExtra={...(own?{}:{extended_entities:{media:[]}}),is_quote_status:true,quoted_status_id_str:valid?quotedId:'999',quoted_status:{id_str:quotedId,tweet_created_at:new Date().toISOString(),full_text:'Verified quoted target',user:{name:'Other author',screen_name:'other'},extended_entities:{media:[{type:gif?'animated_gif':'video',media_url_https:'https://example.test/quote.jpg'}]}}};
  const sourceId=await source('x_search'),parent=await collect(sourceId),children=await sql`SELECT * FROM operation_runs WHERE operation_key='subscription.video.download' AND input->>'parentRunId'=${String(parent.id)} ORDER BY id`;
  assert.equal(children.length,(own?1:0)+(valid&&!gif?1:0));
  if(children.length){const detail=await operationDetail(parent.id),r=detail!.results.find((r:any)=>r.articleId)!;assert.deepEqual(r.videoDownloadRunIds,children.map(c=>c.id));assert.equal(r.videoDownloadRunId,children[0]!.id);
   for(const child of children){assert.equal(child.input.workId,child.input.mediaRole==='quoted'?quotedId:xId);assert.ok(child.input.originalUrl.endsWith('/'+child.input.workId));assert.equal(child.input.sourceId,sourceId);await step(child.id);assert.equal((await step(child.id)).status,'completed');}
   const [a]=await sql`SELECT source_id,author FROM articles WHERE id=${r.articleId}`;assert.equal(a!.source_id,sourceId);assert.equal(a!.author,'synthetic');}
 }
 xExtra={};
});
test('native provider switching preserves auto-save, invalidates an unknown parser without erasing its receipt, and explains unsupported target evidence',async()=>{
 xId=String(BigInt(Date.now())*100000n+9n);const id=await source('x_search');
 await sql`UPDATE collection_subscriptions SET config=jsonb_set(config,'{query}',${sql.json('from:s'+Date.now())}) WHERE control_source_id=${id}`;
 const parent=await collect(id),download=await child(parent.id);assert.ok(download);
 loseParser=true;try{await step(download.id);}finally{loseParser=false;}
 const unknown=await state(download.id);assert.equal(unknown.status,'waiting');assert.ok(unknown.current_receipt_id);
 await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES ('x','user_id',${xId},${id},'{"kind":"manual","reference":"synthetic"}')`;
 for(const target of ['redfox','socialdata'] as const){const preflight=(await preflightXReplacement(id,target))!;assert.equal(preflight.supported,true,JSON.stringify(preflight.checks));assert.ok(preflight.checks.find(c=>c.key==='videoDownload'));
  await switchXCollection(id,{target,sourceVersion:preflight.sourceVersion,subscriptionVersion:preflight.subscriptionVersion,mappingVersion:preflight.mappingVersion,reason:'Synthetic provider switch'},'test');
  assert.equal((await sourceDetail(id))!.source.config.autoDownloadVideo,true);
 }
 const stopped=await state(download.id);assert.equal(stopped.status,'stopped');assert.equal(stopped.generation,unknown.generation+2);assert.equal(stopped.current_receipt_id,unknown.current_receipt_id);assert.equal((await sql`SELECT status FROM receipts WHERE id=${unknown.current_receipt_id}`)[0]!.status,'unknown');
 assert.equal(logicalMpConfig({ghid:'test',redfoxLibrary:'wide',autoDownloadVideo:true}).autoDownloadVideo,true);
 for(const platform of ['x','weibo','toutiao','douyin'])assert.match(videoDownloadCapability(platform,'agentkey','QEQLCKD6'),/暂不会自动保存/);
 assert.match(videoDownloadCapability('shipinhao','redfox','E7G00COY'),/定时列表缺少可靠视频类型/);
});

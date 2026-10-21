import {tag} from './setup.ts';
import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import {Readable} from 'node:stream';
import {sha256,stableJson} from '@aihot/backend/lib/ids';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createTranscription} from '@aihot/backend/providers/redfox/transcription';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {saveResultAttachment,useOperationResult} from '@aihot/backend/operations/result-attachments';
import {AssetError,assetPath,deleteAsset,prepareUpload,writeUpload,publishUpload} from '@aihot/backend/operations/assets';
import {contentChain} from '@aihot/backend/admin/content';
import {parseAttachmentText} from '@aihot/backend/operations/attachment-text';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {buildApp} from '../apps/api/src/app.ts';
const youtubeId=randomUUID().replaceAll('-','').slice(0,11);
const fixtureDigits=BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12)).toString();
const dir=await mkdtemp(path.join(tmpdir(),'aihot-result-attachments-'));config.dataDir=dir;
const downloads:string[]=[];const files=new Map<string,Buffer>();let mediaData:unknown;
let pausedDownload:{path:string;ready:()=>void;wait:Promise<void>}|undefined;
let calls=0;const text='Synthetic transcript\nSecond line.';
const server=http.createServer((req,res)=>{if(req.method==='GET'){downloads.push(req.url!);const data=files.get(req.url!);res.writeHead(data?200:404,{'content-type':'application/octet-stream'});const paused=pausedDownload;if(paused&&paused.path===req.url){paused.ready();void paused.wait.then(()=>res.end(data??'missing'));}else res.end(data??'missing');return;}let b='';req.on('data',c=>b+=c);req.on('end',()=>{calls++;const p=JSON.parse(b);res.end(JSON.stringify({code:2000,data:req.url!.includes('videoSubtitle')||req.url!.includes('videoDownload')?mediaData:p.url?{taskId:'task-'+randomUUID()}:{taskId:p.taskId,status:'succeeded',text}}));});});
let budgets:any[];const app=await buildApp();
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;config.allowPrivateNetworkFetch=true;budgets=await sql`SELECT * FROM budgets WHERE service IN ('redfox.transcript','redfox.poll','redfox.media')`;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service IN ('redfox.transcript','redfox.poll','redfox.media')`;});
after(async()=>{try{await app.close();await new Promise<void>(r=>server.close(()=>r()));await stopBoss();}finally{try{for(const b of budgets??[])await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;}finally{await closeDb();await rm(dir,{recursive:true,force:true});}}});
const valveNames=['REDFOX_CALLS_ENABLED','MODEL_CALLS_ENABLED','REDFOX_API_KEY'] as const;
let valves: Record<string,string|undefined>;
beforeEach(()=>{valves=Object.fromEntries(valveNames.map(name=>[name,process.env[name]]));process.env.REDFOX_CALLS_ENABLED='true';process.env.MODEL_CALLS_ENABLED='false';});
afterEach(()=>{for(const name of valveNames){const value=valves[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}});
async function result(url:string){try{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-attachment';const r=await createTranscription({platform:'douyin',url},'test',tag());await executeOperationStep(r.id,r.step_version,randomUUID());await sql`UPDATE operation_runs SET next_attempt_at=now()-interval '1 second' WHERE id=${r.id}`;const [s]=await sql`SELECT * FROM operation_runs WHERE id=${r.id}`;await executeOperationStep(r.id,s!.step_version,s!.job_id);const [z]=await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind='transcription'`;assert.ok(z);return z;}finally{process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;}}
async function article(url:string){const sid=tag();await sql`INSERT INTO sources(id,name,kind,config,participation_mode,enabled) VALUES(${sid},'Synthetic','external','{}','isolated',true)`;const m=await upsertMaterial({sourceId:sid,url,title:'Synthetic',bodyText:null,via:'import'});return (await sql`SELECT * FROM articles WHERE id=${m.articleId}`)[0]!;}
test('successful transcript saves deterministic private TXT once, preserves parent and rejects deleted selection',async()=>{const z=await result(`https://www.douyin.com/video/${fixtureDigits}99880001`),n=calls,k=tag(),saved=await saveResultAttachment(z.id,{reason:'Save transcript'},'test',k);assert.equal(await readFile(assetPath(saved.asset.key),'utf8'),text);assert.equal(saved.asset.metadata.kind,'text');assert.equal((await saveResultAttachment(z.id,{reason:'Retry'},'test',k)).result.id,saved.result.id);assert.equal((await sql`SELECT file_key FROM operation_results WHERE id=${z.id}`)[0]!.file_key,null);assert.equal(calls,n);config.devAdmin=null;const url=`/api/admin/assets/${encodeURIComponent(saved.asset.key)}/content`;assert.equal((await app.inject({url})).statusCode,401);config.devAdmin={displayName:'Synthetic'};const response=await app.inject({url});assert.equal(response.statusCode,200,response.body);assert.equal(response.body,text);await deleteAsset(saved.asset.key);await assert.rejects(saveResultAttachment(z.id,{reason:'Retry deleted'},'test',k),/deleted/);});
test('a pending deletion cannot attach an existing file or fill article text',async()=>{
 const url=`https://www.douyin.com/video/${fixtureDigits}99880005`,a=await article(url),z=await result(url),saved=await saveResultAttachment(z.id,{reason:'Save before deletion'},'test',tag());
 await sql`UPDATE stored_files SET status='deleting' WHERE key=${saved.asset.key}`;
 assert.equal(await readFile(assetPath(saved.asset.key),'utf8'),text);
 for(const action of ['attach','fill-body'] as const)await assert.rejects(useOperationResult(saved.result.id,{articleId:a.id,expectedRevision:a.revision,action,reason:'Deletion started'},'test',tag()),(error:unknown)=>error instanceof AssetError&&error.statusCode===409&&/unavailable|deleted|being deleted/.test(error.message));
 const [current]=await sql`SELECT body_text,body_html FROM articles WHERE id=${a.id}`;
 assert.equal(current!.body_text,null);assert.equal(current!.body_html,null);
 const [attachment]=await sql`SELECT article_id,source_id FROM operation_results WHERE id=${saved.result.id}`;
 assert.equal(attachment!.article_id,null);assert.equal(attachment!.source_id,null);
});
test('attachment use rechecks availability after waiting for its transaction locks',async()=>{
 const url=`https://www.douyin.com/video/${fixtureDigits}99880006`,a=await article(url),z=await result(url),saved=await saveResultAttachment(z.id,{reason:'Save before concurrent deletion'},'test',tag());
 let outcome!:Promise<void>,waiting=false;
 await sql.begin(async tx=>{
  await tx`SELECT id FROM sources WHERE id=${a.source_id} FOR UPDATE`;
  outcome=assert.rejects(useOperationResult(saved.result.id,{articleId:a.id,expectedRevision:a.revision,action:'fill-body',reason:'Concurrent deletion'},'test',tag()),(error:unknown)=>error instanceof AssetError&&error.statusCode===409);
  for(let i=0;i<100;i++){
   const [blocked]=await sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query='SELECT * FROM sources WHERE id=$1 FOR UPDATE'`;
   if(blocked){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  await tx`UPDATE stored_files SET status='deleting' WHERE key=${saved.asset.key}`;
 });
 await outcome;assert.equal(waiting,true,'Use must pass its initial check and wait on the source lock before deletion');
 const [current]=await sql`SELECT body_text,body_html,revision FROM articles WHERE id=${a.id}`;
 assert.equal(current!.body_text,null);assert.equal(current!.body_html,null);assert.equal(current!.revision,a.revision);
 const [attachment]=await sql`SELECT article_id,source_id FROM operation_results WHERE id=${saved.result.id}`;
 assert.equal(attachment!.article_id,null);assert.equal(attachment!.source_id,null);
});
test('same original fills empty body with CAS; existing body, wrong work and disabled source remain protected',async()=>{const url=`https://www.douyin.com/video/${fixtureDigits}99880002`,a=await article(url),z=await result(url),n=calls,key=tag();const used=await useOperationResult(z.id,{articleId:a.id,expectedRevision:a.revision,action:'fill-body',reason:'Use verified transcript'},'test',key);assert.equal((await sql`SELECT body_text FROM articles WHERE id=${a.id}`)[0]!.body_text,text);assert.equal((await useOperationResult(z.id,{articleId:a.id,expectedRevision:a.revision,action:'fill-body',reason:'Retry'},'test',key)).revision,used.revision);await assert.rejects(useOperationResult(z.id,{articleId:a.id,expectedRevision:used.revision,action:'fill-body',reason:'Do not overwrite'},'test',tag()),/already has a body/);const other=await article(`https://www.douyin.com/video/${fixtureDigits}99880003`);await assert.rejects(useOperationResult(z.id,{articleId:other.id,expectedRevision:1,action:'attach',evidence:'Cannot override',reason:'Wrong'},'test',tag()),/another article/);const wrong=await result(`https://www.douyin.com/video/${fixtureDigits}99880004`);await assert.rejects(useOperationResult(wrong.id,{articleId:other.id,expectedRevision:1,action:'attach',evidence:'Cannot override',reason:'Wrong'},'test',tag()),/different work/);await sql`UPDATE sources SET enabled=false WHERE id=${other.source_id}`;await assert.rejects(useOperationResult(wrong.id,{articleId:other.id,expectedRevision:1,action:'attach',reason:'Disabled'},'test',tag()),/disabled/);assert.equal(calls,n+2);});
test('HTTP commands require authentication/CSRF; uncertain sharing context requires explicit evidence',async()=>{const z=await result('Synthetic sharing prose'),a=await article(`https://example.invalid/${tag()}`),url=`/api/admin/operations/results/${z.id}/save-attachment`;config.devAdmin=null;assert.equal((await app.inject({method:'POST',url,payload:{reason:'Save'}})).statusCode,401);config.devAdmin={displayName:'Synthetic'};assert.equal((await app.inject({method:'POST',url,payload:{reason:'Save'}})).statusCode,403);const headers={'x-csrf-token':'dev','idempotency-key':tag()};assert.equal((await app.inject({method:'POST',url,payload:{reason:'Save'},headers})).statusCode,201);await assert.rejects(useOperationResult(z.id,{articleId:a.id,expectedRevision:1,action:'attach',reason:'Unproven'},'test',tag()),/evidence/);const used=await useOperationResult(z.id,{articleId:a.id,expectedRevision:1,action:'attach',evidence:'Operator verified same work',reason:'Attach'},'test',tag());assert.equal(used.articleId,a.id);});

test('explicit native identities cannot be overridden by evidence across platforms or within one platform',async()=>{const z=await result(`https://www.douyin.com/video/${fixtureDigits}99881101`);for(const url of [`https://www.douyin.com/video/${fixtureDigits}99881102`,`https://www.xiaohongshu.com/explore/synthetic_${fixtureDigits}`]){const a=await article(url);await assert.rejects(useOperationResult(z.id,{articleId:a.id,expectedRevision:a.revision,action:'attach',evidence:'Operator claim cannot override received identity',reason:'Conflict'},'test',tag()),/different work/);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${z.id}`)[0]!.article_id,null);}});

const local=(p:string)=>`http://127.0.0.1:${(server.address() as {port:number}).port}${p}`;
async function media(op:string,data:unknown,url=`https://www.youtube.com/watch?v=${youtubeId}`){const enabled=process.env.REDFOX_CALLS_ENABLED;mediaData=data;try{process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-attachment';const r=await createSynchronousQuery({operationId:op,parameters:{url}},'test',tag());await executeOperationStep(r.id,r.step_version,randomUUID());const rows=await sql`SELECT * FROM operation_results WHERE run_id=${r.id} AND kind!='query_summary' ORDER BY id`;assert.ok(rows.length);return rows;}finally{if(enabled===undefined)delete process.env.REDFOX_CALLS_ENABLED;else process.env.REDFOX_CALLS_ENABLED=enabled;delete process.env.REDFOX_API_KEY;}}
test('closed outbound valve blocks remote subtitle and media without changing parent or publishing files',async()=>{
 files.set('/valve.srt',Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nValve\n'));
 files.set('/valve.png',await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer());
 const [subtitle]=await media('API_1792051516512',{subtitles:[{languageName:'Valve',languageTag:'x',urls:[{format:'srt',url:local('/valve.srt')}]}]});
 const [image]=await media('0W27H3O6',{resources:[{type:'image',downloadUrl:local('/valve.png')}]});
 process.env.REDFOX_CALLS_ENABLED='false';
 const n=downloads.length,parents=await sql`SELECT * FROM operation_runs WHERE id IN (${subtitle!.run_id},${image!.run_id}) ORDER BY id`;
 const outcomes=await Promise.allSettled([saveResultAttachment(subtitle!.id,{formatIndex:0,reason:'Closed valve'},'test',tag()),saveResultAttachment(image!.id,{reason:'Closed valve'},'test',tag())]);
 console.log(`closed valve resource GETs: ${downloads.length-n}`);
 assert.equal(downloads.length,n);
 for(const outcome of outcomes){assert.equal(outcome.status,'rejected');if(outcome.status==='rejected'){assert.ok(outcome.reason instanceof AssetError);assert.equal(outcome.reason.statusCode,503);};}
 assert.deepEqual(await sql`SELECT * FROM operation_runs WHERE id IN (${subtitle!.run_id},${image!.run_id}) ORDER BY id`,parents);
 for(const [parent,selection] of [[subtitle!,'subtitle:0'],[image!,'media']] as const){
  const key=`uploads/redfox/${sha256(stableJson({parentResultId:parent.id,selection}))}`;
  assert.equal((await sql`SELECT count(*)::int n FROM stored_files WHERE key=${key}`)[0]!.n,0);
  assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE kind='result_attachment' AND provenance->>'parentResultId'=${String(parent.id)}`)[0]!.n,0);
  await assert.rejects(readFile(assetPath(key)),{code:'ENOENT'});
 }
 config.devAdmin={displayName:'Synthetic'};
 const response=await app.inject({method:'POST',url:`/api/admin/operations/results/${subtitle!.id}/save-attachment`,headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{formatIndex:0,reason:'Closed valve API'}});
 assert.equal(response.statusCode,503,response.body);assert.match(response.json().detail,/outbound calls are disabled/);assert.equal(downloads.length,n);
});
test('subtitle track index and language-independent formats save separately; JSON never becomes body',async()=>{
 const srt='1\n00:00:00,000 --> 00:00:01,500\n<b>Hello</b><script>bad()</script> world\n',vtt='WEBVTT\n\n00:00.000 --> 00:01.500\nSecond track\n';
 files.set('/track.srt',Buffer.from(srt));files.set('/track.vtt',Buffer.from(vtt));files.set('/track.json3',Buffer.from('{"unknownUnits":[1,2]}'));
 const rows=await media('API_1792051516512',{subtitles:[{languageName:'English',languageTag:'en',urls:[{format:'srt',url:local('/track.srt')},{format:'json3',url:local('/track.json3')}]},{languageName:'English auto',languageTag:'en',urls:[{format:'vtt',url:local('/track.vtt')}]}]});
 const first=await saveResultAttachment(rows[0]!.id,{formatIndex:0,reason:'Save SRT'},'test',tag()),json=await saveResultAttachment(rows[0]!.id,{formatIndex:1,reason:'Save JSON'},'test',tag()),other=await saveResultAttachment(rows[1]!.id,{formatIndex:0,reason:'Save VTT'},'test',tag());
 assert.equal(new Set([first.asset.key,json.asset.key,other.asset.key]).size,3);assert.equal((await sql`SELECT file_key FROM operation_results WHERE id=${rows[0]!.id}`)[0]!.file_key,null);
 const a=await article(`https://www.youtube.com/watch?v=${youtubeId}`);await useOperationResult(first.result.id,{articleId:a.id,expectedRevision:a.revision,action:'fill-body',reason:'Use subtitle'},'test',tag());const [updated]=await sql`SELECT * FROM articles WHERE id=${a.id}`;assert.equal(updated!.body_text,'Hello world');
 await assert.rejects(useOperationResult(json.result.id,{articleId:a.id,expectedRevision:updated!.revision,action:'fill-body',reason:'No guessed JSON cues'},'test',tag()),/cannot supply/);
 await useOperationResult(json.result.id,{articleId:a.id,expectedRevision:updated!.revision,action:'attach',reason:'Keep JSON research'},'test',tag());
 process.env.REDFOX_CALLS_ENABLED='false';const n=downloads.length;assert.equal((await saveResultAttachment(rows[0]!.id,{formatIndex:0,reason:'Retry'},'test',tag())).result.id,first.result.id);assert.equal(downloads.length,n);
});
test('media output follows actual bytes, rejects HTML masquerade and does not fetch on GET',async()=>{files.set('/photo.not-image',await sharp({create:{width:2,height:3,channels:3,background:'red'}}).png().toBuffer());files.set('/bad.png',Buffer.from('<html>not an image</html>'));const rows=await media('0W27H3O6',{resources:[{type:'image',downloadUrl:local('/photo.not-image')},{type:'image',downloadUrl:local('/bad.png')}]});const a=await saveResultAttachment(rows[0]!.id,{reason:'Save actual image'},'test',tag());assert.equal(a.asset.content_type,'image/png');assert.equal(a.asset.metadata.width,2);await assert.rejects(saveResultAttachment(rows[1]!.id,{reason:'Reject HTML'},'test',tag()));const n=downloads.length;config.devAdmin={displayName:'Synthetic'};assert.equal((await app.inject({url:`/api/admin/operations/results/${rows[0]!.id}/attachments`})).statusCode,200);assert.equal(downloads.length,n);});
test('invalid subtitle and oversized UTF8 have local 422/413, SSRF blocked, no child publication',async()=>{files.set('/bad.srt',Buffer.from('<html>error</html>'));files.set('/large.srt',Buffer.alloc(2*1024*1024+1,65));const rows=await media('API_1792051516512',{subtitles:[{languageName:'Synthetic',languageTag:'x',urls:[{format:'srt',url:local('/bad.srt')},{format:'srt',url:local('/large.srt')},{format:'srt',url:'http://127.0.0.1/blocked'}]}]});config.devAdmin={displayName:'Synthetic'};for(const [formatIndex,status] of [[0,422],[1,413]]){const response=await app.inject({method:'POST',url:`/api/admin/operations/results/${rows[0]!.id}/save-attachment`,headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{formatIndex,reason:'Invalid'}});assert.equal(response.statusCode,status,response.body);}config.allowPrivateNetworkFetch=false;try{await assert.rejects(saveResultAttachment(rows[0]!.id,{formatIndex:2,reason:'Blocked'},'test',tag()),/blocked/);}finally{config.allowPrivateNetworkFetch=true;}assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE kind='result_attachment' AND provenance->>'parentResultId'=${String(rows[0]!.id)}`)[0]!.n,0);});
test('complete file published before rolled-back registration is reused without redownload',async()=>{const content='1\n00:00:00,000 --> 00:00:01,000\nRecovered\n';files.set('/recovery.srt',Buffer.from(content));const [r]=await media('API_1792051516512',{subtitles:[{languageName:'Recovery',languageTag:'x',urls:[{format:'srt',url:local('/recovery.srt')}]}]});const key=`uploads/redfox/${sha256(stableJson({parentResultId:r!.id,selection:'subtitle:0'}))}`,temp=await prepareUpload();try{const written=await writeUpload(Readable.from([Buffer.from(content)]),temp.file,AbortSignal.timeout(1000));await assert.rejects(sql.begin(async tx=>{await publishUpload({actor:'test',key,file:temp.file,filename:'recovered.srt',mime:'application/x-subrip',purpose:'operation-output',...written},tx);throw Error('synthetic transaction failure after complete link');}));}finally{await temp.release();}process.env.REDFOX_CALLS_ENABLED='false';const n=downloads.length,saved=await saveResultAttachment(r!.id,{formatIndex:0,reason:'Recover'},'test',tag());assert.equal(saved.asset.key,key);assert.equal(downloads.length,n);assert.equal(await readFile(assetPath(key),'utf8'),content);});
test('concurrent native material writer and explicit body use preserve lock ordering and CAS',async()=>{const url=`https://www.douyin.com/video/${fixtureDigits}99889999`,a=await article(url),z=await result(url);const outcomes=await Promise.race([Promise.allSettled([upsertMaterial({sourceId:a.source_id,url,identityKey:a.identity_key,title:a.title,bodyText:'Original author full text',bodyHtml:'<p>Original author full text</p>',via:'import'}),useOperationResult(z.id,{articleId:a.id,expectedRevision:a.revision,action:'fill-body',reason:'Concurrent explicit use'},'test',tag())]),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(Error('Concurrent identity lock test timed out')),5000);t.unref();})]);assert.equal(outcomes[0]!.status,'fulfilled');if(outcomes[1]!.status==='rejected')assert.match(String(outcomes[1]!.reason),/revision changed|already has a body/);const [current]=await sql`SELECT body_text,body_html FROM articles WHERE id=${a.id}`;assert.equal(current!.body_text,'Original author full text');assert.equal(current!.body_html,'<p>Original author full text</p>');});
test('concurrent save commands converge on one child, and changed selection with same key conflicts',async()=>{const z=await result('Synthetic concurrency text'),key=tag();const saved=await Promise.all([saveResultAttachment(z.id,{reason:'Concurrent save'},'test',key),saveResultAttachment(z.id,{reason:'Concurrent save'},'test',key)]);assert.equal(saved[0]!.result.id,saved[1]!.result.id);process.env.REDFOX_CALLS_ENABLED='true';const rows=await media('API_1792051516512',{subtitles:[{languageName:'Two formats',languageTag:'x',urls:[{format:'srt',url:local('/track.srt')},{format:'vtt',url:local('/track.vtt')}]}]});const command=tag();await saveResultAttachment(rows[0]!.id,{formatIndex:0,reason:'First'},'test',command);const n=downloads.length;await assert.rejects(saveResultAttachment(rows[0]!.id,{formatIndex:1,reason:'Changed'},'test',command),/another format/);assert.equal(downloads.length,n);});

test('explicit audio/video outputs retain byte-derived MIME including output-only m4a',async()=>{const fixtures=JSON.parse(await readFile(new URL('./fixtures/operation-media.json',import.meta.url),'utf8')).files as Array<{filename:string;mime:string;base64:string}>;for(const [filename,type] of [['tiny.wav','audio'],['tiny.m4a','audio'],['tiny.webm','video']]){const f=fixtures.find(f=>f.filename===filename)!;assert.ok(f);const route='/output-'+filename;files.set(route,Buffer.from(f.base64,'base64'));const [r]=await media('0W27H3O6',{resources:[{type,downloadUrl:local(route)}]});const saved=await saveResultAttachment(r!.id,{reason:'Save explicit output'},'test',tag());assert.equal(saved.asset.metadata.kind,type);assert.equal(saved.asset.bytes,Buffer.from(f.base64,'base64').length);assert.equal(saved.asset.content_type,filename==='tiny.webm'?'video/webm':filename==='tiny.wav'?'audio/wav':'audio/x-m4a');}});
test('explicit subtitle metadata disagreement and unknown format reject before downloading',async()=>{const [r]=await media('API_1792051516512',{id:'other_vid_1',subtitles:[{languageName:'Synthetic',languageTag:'x',urls:[{format:'srt',url:local('/track.srt')}]}]});const n=downloads.length;await assert.rejects(saveResultAttachment(r!.id,{formatIndex:0,reason:'Wrong metadata'},'test',tag()),/different requested work/);assert.equal(downloads.length,n);const [unknown]=await media('API_1792051516512',{subtitles:[{languageName:'Synthetic',languageTag:'x',urls:[{format:'unknown',url:local('/track.srt')}]}]});await assert.rejects(saveResultAttachment(unknown!.id,{formatIndex:0,reason:'Unknown format'},'test',tag()),/Unsupported/);assert.equal(downloads.length,n);});

test('content selection DTO distinguishes HTML-only body and disabled source without changing body_chars',async()=>{const a=await article(`https://example.invalid/html-${tag()}`),z=await result('Synthetic source requiring evidence');await sql`UPDATE articles SET body_text=NULL,body_html='<p>Existing HTML only</p>' WHERE id=${a.id}`;let chain=await contentChain(a.id);assert.equal(chain!.article.has_body,true);assert.equal(chain!.article.body_chars,null);assert.equal(chain!.article.source_enabled,true);await assert.rejects(useOperationResult(z.id,{articleId:a.id,expectedRevision:a.revision,action:'fill-body',evidence:'Same work verified',reason:'Preserve HTML'},'test',tag()),/already has a body/);await sql`UPDATE articles SET body_html='  ' WHERE id=${a.id}`;await sql`UPDATE sources SET enabled=false WHERE id=${a.source_id}`;chain=await contentChain(a.id);assert.equal(chain!.article.has_body,false);assert.equal(chain!.article.source_enabled,false);});
test('text format validation rejects invalid UTF8, empty content and unbounded cue timestamps',()=>{assert.throws(()=>parseAttachmentText(Buffer.from([0xff]),'txt'));assert.throws(()=>parseAttachmentText(Buffer.from('  '),'txt'));assert.throws(()=>parseAttachmentText(Buffer.from('1\n99999999999999999999999:00:00,000 --> 99999999999999999999999:00:01,000\nText'),'srt'));assert.equal(parseAttachmentText(Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\n<b>Safe</b><script>unsafe()</script>'),'vtt').bodyText,'Safe');});

test('retention during attachment preparation refuses publication and clears temporary files',async()=>{
 const {expireOperationResults}=await import('@aihot/backend/operations/result-retention');
 files.set('/retention.srt',Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nRetained text\n'));
 const [parent]=await media('API_1792051516512',{subtitles:[{languageName:'Retention',languageTag:'x',urls:[{format:'srt',url:local('/retention.srt')}]}]});
 await sql`UPDATE operation_results SET created_at='2000-01-01',expires_at='2000-02-01' WHERE id=${parent!.id}`;
 let ready!:()=>void,release!:()=>void;const started=new Promise<void>(r=>ready=r),wait=new Promise<void>(r=>release=r);
 pausedDownload={path:'/retention.srt',ready,wait};process.env.REDFOX_CALLS_ENABLED='true';
 const saving=saveResultAttachment(parent!.id,{formatIndex:0,reason:'Concurrent expiry'},'test',tag());
 const outcome=assert.rejects(saving,/expired/);
 try{await started;await expireOperationResults(new Date('2001-01-01'));release();await outcome;
  assert.equal((await sql`SELECT kind FROM operation_results WHERE id=${parent!.id}`)[0]!.kind,'result_expired');
  const key=`uploads/redfox/${sha256(stableJson({parentResultId:parent!.id,selection:'subtitle:0'}))}`;
  assert.equal((await sql`SELECT count(*)::int n FROM stored_files WHERE key=${key}`)[0]!.n,0);
  await assert.rejects(readFile(assetPath(key)),{code:'ENOENT'});
  assert.deepEqual(await readdir(path.join(dir,'operation-tmp')),[]);
  assert.equal((await sql`SELECT count(*)::int n FROM operation_results WHERE provenance->>'parentResultId'=${String(parent!.id)}`)[0]!.n,0);
 }finally{release();pausedDownload=undefined;}
});

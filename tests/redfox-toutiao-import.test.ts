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
import {importToutiaoResult} from '@aihot/backend/providers/redfox/import-toutiao';
import {bindSourceAccount} from '@aihot/backend/sources/account-bindings';
import {extractArticleBody} from '@aihot/backend/content/extract';
import {newArticleId,sha256} from '@aihot/backend/lib/ids';
import {identityKeyForUrl} from '@aihot/backend/lib/url';
import type {ToutiaoOperation} from '@aihot/backend/providers/redfox/toutiao-contract';
let data:unknown,operation:ToutiaoOperation='28CFGF5I',hits=0,saved:Record<string,unknown>;
const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>{hits++;res.end(JSON.stringify(operation==='4QS1F8DE'?data:{code:2000,data}));});});
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-toutiao-import';process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const digit=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
const url=(id:string)=>`https://www.toutiao.com/article/${id}/`;
const actor='toutiao-import-test';
const step=async(id:number)=>{const [r]=await sql`SELECT step_version FROM operation_runs WHERE id=${id}`;await executeOperationStep(id,r!.step_version,randomUUID());};
async function query(op:ToutiaoOperation,record:Record<string,unknown>,parameters?:Record<string,unknown>){
 operation=op;data=op==='28CFGF5I'?[record]:op==='4QS1F8DE'?{list:[record]}:op==='R1IGR09H'?{workList:[record]}:record;
 const defaults=op==='28CFGF5I'?{keyword:'synthetic',offset:'0'}:op==='4QS1F8DE'?{name:'synthetic'}:op==='R1IGR09H'?{category:'profile_all',token:'NeverAuthorEvidence',offset:'0'}:{opusId:record.workId};
 const run=await createSynchronousQuery({operationId:op,parameters:parameters??defaults},actor,tag());await step(run.id);
 assert.equal((await sql`SELECT status FROM operation_runs WHERE id=${run.id}`)[0]!.status,'completed');
 return (await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`)[0]!;
}
async function source(mode='isolated',kind='external'){const id='tt-'+tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES(${id},'Synthetic owner',${kind},${mode},${mode==='editorial'})`;return id;}
const bind=(sourceId:string,idKind:string,idValue:string)=>sql.begin(tx=>bindSourceAccount(tx,{sourceId,platform:'toutiao',idKind,idValue,evidence:{kind:'audit',reference:'synthetic-test'}}));
const imported=(id:number,input:unknown={reason:'Verified synthetic evidence'},key=tag())=>importToutiaoResult(id,input,actor,key);
const material=async(id:string)=>(await sql`SELECT * FROM articles WHERE id=${id}`)[0]!;

test('received uid and secUid remain independent; account import binds only received uid',async()=>{
 const uid=digit(),account=await query('4QS1F8DE',{uid,nickname:'Synthetic account'}),owner=await source('editorial');
 const before=hits,a=await imported(Number(account.id),{reason:'Explicit verified account',sourceId:owner});assert.equal(a!.sourceId,owner);assert.equal(hits,before);
 const missing=await query('4QS1F8DE',{nickname:'Display only'});await assert.rejects(imported(Number(missing.id)),/verified uid/);
 await assert.rejects(imported(Number(missing.id),{reason:'No received ID',supplement:{uid,evidence:'Unverified account'}}),/received uid/);
 const id=digit(),work=await query('R1IGR09H',{workId:id,secUid:uid,title:'Not a uid relation',workUrl:url(id)});
 const b=await imported(Number(work.id));assert.notEqual(b!.sourceId,owner);assert.equal((await sql`SELECT participation_mode,site_fulltext FROM sources WHERE id=${b!.sourceId}`)[0]!.participation_mode,'isolated');
 const bindings=await sql`SELECT id_kind,source_id FROM source_account_bindings WHERE platform='toutiao' AND id_value=${uid}`;assert.equal(bindings.length,2);
});
test('manual cross-kind association requires evidence and isolated source; same-kind conflict is atomic',async()=>{
 const owner=await source(),uid=digit();await bind(owner,'uid',uid);
 const sec='Sec_'+tag(),id=digit(),work=await query('R1IGR09H',{workId:id,secUid:sec,title:'Same manually verified author',workUrl:url(id)});
 await assert.rejects(imported(Number(work.id),{reason:'Missing evidence',sourceId:owner}),/isolated source with evidence/);
 const input={reason:'Verified cross-kind relation',sourceId:owner,supplement:{evidence:'Operator checked original author against existing account'}};
 const a=await imported(Number(work.id),input);assert.equal(a!.sourceId,owner);
 assert.equal((await sql`SELECT source_id FROM source_account_bindings WHERE platform='toutiao' AND id_kind='secUid' AND id_value=${sec}`)[0]!.source_id,owner);
 assert.equal((await sql`SELECT provenance FROM operation_results WHERE id=${work.id}`)[0]!.provenance.toutiaoImport.intent.supplement.evidence,input.supplement.evidence);
 const otherId=digit(),otherSec='Other_'+tag(),other=await query('R1IGR09H',{workId:otherId,secUid:otherSec,title:'Different same kind',workUrl:url(otherId)});
 await assert.rejects(imported(Number(other.id),input),{code:'conflict'});assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='toutiao' AND id_value=${otherSec}`).length,0);assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${other.id}`)[0]!.source_id,null);
});
test('manual identities cannot inherit editorial permission; received identities honor current disabled and kind',async()=>{
 const uid=digit(),editorial=await source('editorial');await bind(editorial,'uid',uid);
 const id=digit(),w=await query('28CFGF5I',{opusId:id,uid,title:'Current rights',opusUrl:url(id)});
 await assert.rejects(imported(Number(w.id),{reason:'Manual extra kind',supplement:{secUid:'Extra_'+tag(),evidence:'Manual'}}),/Manual identity/);
 const otherId=digit(),sec='Unbound_'+tag(),other=await query('R1IGR09H',{workId:otherId,secUid:sec,title:'No permission from chosen target',workUrl:url(otherId)});
 await assert.rejects(imported(Number(other.id),{reason:'Wrong target',sourceId:editorial,supplement:{evidence:'Manual'}}),/isolated/);
 await sql`UPDATE sources SET enabled=false WHERE id=${editorial}`;await assert.rejects(imported(Number(w.id)),/disabled/);assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${w.id}`)[0]!.article_id,null);
 const wrong=await source('isolated','rss'),a=await query('4QS1F8DE',{uid:digit(),nickname:'Account'});await assert.rejects(imported(Number(a.id),{reason:'Wrong kind',sourceId:wrong}),/external source/);
});
test('conflicting owners and forged normalized identity do not leave partial mappings',async()=>{
 const one=await source(),two=await source(),uid=digit(),sec='Bound_'+tag();await bind(one,'uid',uid);await bind(two,'secUid',sec);
 const id=digit(),w=await query('28CFGF5I',{opusId:id,uid,title:'Conflict',opusUrl:url(id)});
 await assert.rejects(imported(Number(w.id),{reason:'Conflicting IDs',supplement:{secUid:sec,evidence:'Cannot join owners'}}),{code:'conflict'});
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{identity}',${sql.json({uid:digit()})}) WHERE id=${w.id}`;
 const a=await imported(Number(w.id));assert.equal(a!.sourceId,one);assert.equal((await sql`SELECT count(*)::int AS count FROM source_account_bindings WHERE platform='toutiao' AND source_id=${one}`)[0]!.count,1);
});
test('manual native originals only fill missing fields and always respect fixed detail request scope',async()=>{
 const uid=digit(),id=digit(),w=await query('PAB6Z75Y',{title:'No echo, only requested ID'},{opusId:id});
 await assert.rejects(imported(Number(w.id),{reason:'Wrong work',supplement:{uid,url:url(digit()),evidence:'Wrong URL'}}),{code:'conflict'});
 await assert.rejects(imported(Number(w.id),{reason:'Short link',supplement:{uid,url:'https://t.toutiao.com/example',evidence:'Short'}}));
 const a=await imported(Number(w.id),{reason:'Verified same work',supplement:{uid,url:url(id),evidence:'Verified original page'}});assert.ok(a!.articleId);assert.equal((await sql`SELECT data FROM operation_results WHERE id=${w.id}`)[0]!.data.record.workId,undefined);
 const next=digit(),bad=await query('28CFGF5I',{opusId:next,uid,title:'Already has URL',opusUrl:'https://example.com/not-a-native-original'});
 await assert.rejects(imported(Number(bad.id),{reason:'Cannot replace received URL',supplement:{url:url(next),evidence:'Replacement'}}),{code:'conflict'});
 const missing=await query('28CFGF5I',{title:'Missing work and author'}),newId=digit();const b=await imported(Number(missing.id),{reason:'Manual missing fields',supplement:{uid:digit(),url:url(newId),evidence:'Confirmed author and original'}});assert.equal((await material(b!.articleId!)).identity_key,`toutiao:workId:${newId}`);
});

test('publication time uses original result discovery; unknown and future claims backfill, media and sanitized body survive',async()=>{
 for(const [op,published,expected] of [
  ['28CFGF5I',String(Math.floor(Date.now()/1000)),'fresh'],['28CFGF5I','1700000000','old'],['PAB6Z75Y','2020-01-01 12:00:00','unknown'],['PAB6Z75Y','invalid','unknown'],['PAB6Z75Y','2099-01-01T00:00:00Z','unknown'],['PAB6Z75Y',new Date().toISOString(),'fresh'],
 ] as const){
  const id=digit(),uid=digit(),record={...(op==='28CFGF5I'?{opusId:id,uid,opusUrl:url(id)}:{workId:id,workUrl:url(id),content:'<p>Actual <strong>body</strong></p><script>bad()</script>',imageList:['https://example.com/img.jpg','javascript:bad'],downloadUrl:['https://example.com/video.mp4']}),title:'Timeline',publishTime:published};
  const r=await query(op,record),a=await imported(Number(r.id),{reason:'Time evidence',...(op==='PAB6Z75Y'?{supplement:{uid,evidence:'Missing detail author confirmed'}}:{})}),row=await material(a!.articleId!);
  assert.equal(row.discovered_at.toISOString(),r.created_at.toISOString());assert.equal(row.backfill,expected!=='fresh');if(expected==='unknown')assert.equal(row.published_at,null);if(expected==='old')assert.equal(row.backfill_reason,'stale-on-discovery');
  if(op==='PAB6Z75Y'){assert.equal(row.body_text,'Actual body');assert.ok(!row.body_html.includes('script'));assert.equal(row.media.length,2);assert.equal(row.body_status,'ok');}
 }
});
test('HTTP origin import reuses original discovery, is idempotent and local; pending editorial material cannot fallback',async()=>{
 const uid=digit(),owner=await source('editorial');await bind(owner,'uid',uid);const id=digit(),r=await query('28CFGF5I',{opusId:id,uid,title:'Original search',opusUrl:url(id)});
 await sql`UPDATE operation_results SET created_at=now()-interval '10 days' WHERE id=${r.id}`;
 const run=await createSynchronousQuery({operationId:'PAB6Z75Y',parameters:{opusId:id},sourceResultId:Number(r.id)},actor,tag());operation='PAB6Z75Y';data={workId:id,title:'Completed detail',workUrl:url(id),content:'Explicit detail body'};await step(run.id);const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${run.id}`;
 const pending=await query('28CFGF5I',{opusId:digit(),uid,title:'Bare search'}),pendingId=String(pending.data.workId);
 process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;const before=hits;
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic import admin'};
 try{
  const endpoint=`/api/admin/operations/results/${result!.id}/import`,headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={reason:'Verified origin'};
  const response=await app.inject({method:'POST',url:endpoint,headers,payload});assert.equal(response.statusCode,200,response.body);assert.deepEqual((await app.inject({method:'POST',url:endpoint,headers,payload})).json(),response.json());
  assert.equal((await sql`SELECT count(*)::int AS n FROM audit_log WHERE subject=${'result:'+result!.id} AND action='material.import'`)[0]!.n,1);
  assert.equal((await app.inject({method:'POST',url:endpoint,headers,payload:{...payload,supplement:{evidence:'Changed intent'}}})).statusCode,409);
  const a=await material(response.json().articleId);assert.equal(a.source_id,owner);assert.equal(a.discovered_at.toISOString(),(run.input.origin as {discoveredAt:string}).discoveredAt);assert.equal(a.body_text,'Explicit detail body');
  assert.equal((await sql`SELECT article_id FROM operation_results WHERE id=${r.id}`)[0]!.article_id,null);
  const bare=await imported(Number(pending.id),{reason:'Original supplied',supplement:{url:url(pendingId),evidence:'Verified original'}});assert.equal((await material(bare!.articleId!)).body_status,'pending');
  // Keep even a regressed fallback inside the local stub, never the real native host.
  await sql`UPDATE articles SET url=${process.env.REDFOX_TEST_BASE_URL!+'/body'} WHERE id=${bare!.articleId!}`;
  assert.equal(await extractArticleBody(bare!.articleId!,false),'unconfirmed');assert.equal((await material(bare!.articleId!)).body_status,'unconfirmed');assert.equal(hits,before);
 }finally{config.devAdmin=null;await app.close();process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY='fake-toutiao-import';}
});
test('legacy ownership conflict rolls back new author binding, source, result and queue',async()=>{
 const id=digit(),one=await source(),two=await source();
 for(const [owner,path] of [[one,'article'],[two,'video']]){const original=`https://toutiao.com/${path}/${id}?token=${tag()}`;await sql`INSERT INTO articles(id,source_id,identity_key,url,title,discovered_at,timeline_at) VALUES(${newArticleId()},${owner},${identityKeyForUrl(original)!},${original},'Legacy',now(),now())`;}
 const uid=digit(),r=await query('28CFGF5I',{opusId:id,uid,title:'Conflicting history',opusUrl:url(id)});
 await assert.rejects(imported(Number(r.id)),{code:'conflict'});assert.equal((await sql`SELECT 1 FROM sources WHERE id=${'toutiao-'+sha256('uid:'+uid).slice(0,24)}`).length,0);assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='toutiao' AND id_kind='uid' AND id_value=${uid}`).length,0);assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${r.id}`)[0]!.source_id,null);
});

test('concurrent account imports share one received owner; receipt proof and summaries cannot be imported',async()=>{
 const uid=digit(),first=await query('4QS1F8DE',{uid,nickname:'Concurrent one'}),second=await query('4QS1F8DE',{uid,nickname:'Concurrent two'});
 const before=hits,[a,b]=await Promise.all([imported(Number(first.id)),imported(Number(second.id))]);assert.equal(a!.sourceId,b!.sourceId);assert.equal(hits,before);
 assert.equal((await sql`SELECT 1 FROM source_account_bindings WHERE platform='toutiao' AND id_kind='uid' AND id_value=${uid}`).length,1);
 const missing=await query('4QS1F8DE',{uid:digit(),nickname:'Bad receipt proof'});
 await sql`UPDATE receipts SET model='different-operation' WHERE id=${missing.receipt_id}`;
 await assert.rejects(imported(Number(missing.id)),/confirmed Toutiao/);
 const [summary]=await sql`SELECT id FROM operation_results WHERE run_id=${first.run_id} AND kind='query_summary'`;
 await assert.rejects(imported(Number(summary!.id)),/query summaries/);
});

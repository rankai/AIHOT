import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {upsertMaterial,contentHash} from '@aihot/backend/content/materials';
import {MaterialIdentityConflict} from '@aihot/backend/content/material-identities';
import {toutiaoWorkId,normalizeUrl,identityKeyForUrl} from '@aihot/backend/lib/url';
import {tag,assertConfiguredTestDatabase} from './setup.ts';

const source=`tt-mobile-${tag()}`,other=`tt-mobile-other-${tag()}`;
let sequence=0;
const next=()=>`${Date.now()}${++sequence}71`;
const mobile=(id:string)=>`https://m.toutiao.com/article/${id}`;
const primary=(id:string)=>`toutiao:workId:${id}`;
const material=(id:string)=>({sourceId:other,url:`${mobile(id)}/?source=fixture`,identityKey:primary(id),title:'Received title',bodyText:'Received body',via:'import' as const});
// Explicit pre-upgrade SQL fixture: the new resolver must never manufacture this legacy state.
async function legacy(id:string,suffix=''){
 const articleId=randomUUID(),url=mobile(id)+suffix,hash=contentHash({title:'Legacy title',bodyText:'Legacy body'});
 await sql.begin(async tx=>{
  await tx`INSERT INTO articles(id,source_id,identity_key,url,title,body_text,body_status,content_hash,discovered_at,timeline_at,revision)
   VALUES (${articleId},${source},${`url:${url}`},${url},'Legacy title','Legacy body','ok',${hash},now(),now(),1)`;
  await tx`INSERT INTO article_revisions(article_id,revision,content_hash,title,body_text) VALUES (${articleId},1,${hash},'Legacy title','Legacy body')`;
  await tx`INSERT INTO article_discoveries(article_id,source_id,via) VALUES (${articleId},${source},'fetch')`;
 });return articleId;
}
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,syndicate_fulltext) VALUES
  (${source},'Legacy mobile source','external','isolated',false,false),(${other},'Received source','external','isolated',false,false)`;
});
after(()=>closeDb());

test('mobile native work parser accepts its canonical slashless form',()=>{
 const id=next();assert.equal(toutiaoWorkId(mobile(id)),id);assert.equal(toutiaoWorkId(normalizeUrl(`${mobile(id)}/`)),id);
 for(const url of [`http://m.toutiao.com/article/${id}`,`${mobile(id)}/extra`,`https://m.toutiao.com/group/${id}`,`${mobile(id)}#x`])assert.equal(toutiaoWorkId(url),null);
});
test('legacy mobile URL rows reuse their primary identity, source, permissions and revision history',async()=>{
 for(const suffix of ['', '/', '?a=1', '/?a=1']){
  const id=next(),old=await legacy(id,suffix),received=await upsertMaterial(material(id));assert.equal(received.articleId,old);
  assert.equal((await upsertMaterial(material(id))).articleId,old);
  const [row]=await sql`SELECT a.identity_key,a.url,a.source_id,a.title,a.body_text,a.revision,s.participation_mode,s.site_fulltext,s.syndicate_fulltext FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id=${old}`;
  assert.deepEqual({...row},{identity_key:`url:${mobile(id)+suffix}`,url:mobile(id)+suffix,source_id:source,title:'Legacy title',body_text:'Legacy body',revision:1,participation_mode:'isolated',site_fulltext:false,syndicate_fulltext:false});
  assert.equal((await sql`SELECT 1 FROM article_revisions WHERE article_id=${old}`).length,1);
  assert.equal((await sql`SELECT 1 FROM article_discoveries WHERE article_id=${old} AND source_id=${other}`).length,1);
 }
});
test('native ID first and canonical mobile rediscovery retain one material',async()=>{
 const id=next(),first=await upsertMaterial(material(id));
 const again=await upsertMaterial({sourceId:source,url:normalizeUrl(`${mobile(id)}/` )!,title:'Generic mobile',via:'fetch'});
 assert.equal(again.articleId,first.articleId);assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${first.articleId}`)[0]!.identity_key,primary(id));
});
test('overlapping native and canonical mobile discoveries serialize in either arrival order',async()=>{
 for(let round=0;round<4;round++){
  const id=next(),reports=[material(id),{sourceId:source,url:mobile(id),title:'Generic mobile',via:'fetch' as const}];
  const results=await Promise.all((round%2?reports.reverse():reports).map(m=>upsertMaterial(m)));
  assert.equal(new Set(results.map(r=>r.articleId)).size,1);
  assert.equal((await upsertMaterial(material(id))).articleId,results[0]!.articleId);
 }
});
test('preexisting mobile and native owners still reject instead of merging',async()=>{
 const id=next(),native=await upsertMaterial(material(id)),old=await legacy(id);
 await assert.rejects(upsertMaterial(material(id)),MaterialIdentityConflict);
 await assert.rejects(upsertMaterial({sourceId:source,url:mobile(id),title:'Generic',via:'fetch'}),MaterialIdentityConflict);
 const rows=await sql`SELECT id FROM articles WHERE id IN (${native.articleId},${old})`;assert.equal(rows.length,2);
 const mismatch=next();await assert.rejects(upsertMaterial({...material(id),url:mobile(mismatch)}),MaterialIdentityConflict);
 assert.equal(identityKeyForUrl(`${mobile(id)}/`),identityKeyForUrl(mobile(id)));
});

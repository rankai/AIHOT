import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {newArticleId} from '@aihot/backend/lib/ids';
import {identityKeyForUrl} from '@aihot/backend/lib/url';
const owner=tag(),other=tag(),note=()=>tag().replaceAll(':','_'),url=(id:string,token='a')=>`https://www.xiaohongshu.com/explore/${id}?xsec_token=${token}&xsec_source=pc_search`;
before(async()=>{await sql`INSERT INTO sources(id,name,kind) VALUES (${owner},'Synthetic original','rss'),(${other},'Synthetic other','external')`;});
after(()=>closeDb());
async function legacy(address:string,key=identityKeyForUrl(address)!){const id=newArticleId();await sql`INSERT INTO articles(id,source_id,identity_key,url,title,body_text,discovered_at,timeline_at) VALUES (${id},${owner},${key},${address},'Legacy','Original body',now()-interval '7 days',now()-interval '7 days')`;return id;}
test('signed legacy URLs preserve original owner and timeline; reverse and concurrent token variants share one typed identity',async()=>{
 const id=note(),old=await legacy(url(id)),[prior]=await sql`SELECT identity_key,url,source_id,body_text,discovered_at,timeline_at FROM articles WHERE id=${old}`;
 const r=await upsertMaterial({sourceId:other,url:url(id,'b'),identityKey:`xiaohongshu:noteId:${id}`,title:'Imported',bodyText:'Must not overwrite',via:'import'});assert.equal(r.articleId,old);assert.deepEqual((await sql`SELECT identity_key,url,source_id,body_text,discovered_at,timeline_at FROM articles WHERE id=${old}`)[0],prior);
 for(let i=0;i<3;i++){const id=note();const [a,b]=await Promise.all([upsertMaterial({sourceId:owner,url:url(id,'first'),identityKey:`xiaohongshu:noteId:${id}`,title:'Typed',via:'import'}),upsertMaterial({sourceId:other,url:url(id,'second'),title:'URL only',via:'fetch'})]);assert.equal(a.articleId,b.articleId);assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${a.articleId}`)[0]!.identity_key,`xiaohongshu:noteId:${id}`);assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id=${a.articleId}`).length,0);}
});
test('multiple legacy owners conflict atomically; exact opaque paths do not absorb prefixes or LIKE wildcard lookalikes',async()=>{
 const id=note(),a=await legacy(url(id)),b=await legacy(url(id,'b'));assert.notEqual(a,b);
 await assert.rejects(sql.begin(async tx=>{await tx`UPDATE articles SET title='Rollback' WHERE id=${a}`;await upsertMaterial({sourceId:other,url:url(id,'c'),title:'Conflict',via:'import'},tx);}),{code:'conflict'});assert.equal((await sql`SELECT title FROM articles WHERE id=${a}`)[0]!.title,'Legacy');
 const exact=note()+'_A',prefix=await legacy(url(exact+'more')),lookalike=await legacy(url(exact.replaceAll('_','z')));
 const normal=await upsertMaterial({sourceId:owner,url:url(exact),title:'Exact',via:'fetch'});assert.notEqual(normal.articleId,prefix);assert.notEqual(normal.articleId,lookalike);
 await assert.rejects(upsertMaterial({sourceId:owner,url:url(exact),identityKey:'xiaohongshu:noteId:wrong',title:'Wrong',via:'import'}),{code:'conflict'});
});
test('custom and retained fragments are independent; unsupported URL shapes remain ordinary materials',async()=>{
 const id=note(),address=url(id),custom=await legacy(address,'custom:'+tag()),fragment=await legacy(address+'#part',identityKeyForUrl(address,{keepFragment:true})+'#part');
 const normal=await upsertMaterial({sourceId:owner,url:address,title:'Native',via:'fetch'});assert.notEqual(normal.articleId,custom);assert.notEqual(normal.articleId,fragment);
 for(const address of [`https://xhslink.com/${note()}`,`https://xiaohongshu.com/discovery/item/${note()}`,`https://example.com/explore/${note()}`]){const r=await upsertMaterial({sourceId:owner,url:address,title:'Ordinary',via:'fetch'});assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${r.articleId}`)[0]!.identity_key,identityKeyForUrl(address));}
});

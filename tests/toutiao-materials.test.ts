import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test,after} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {identityKeyForUrl} from '@aihot/backend/lib/url';
import {newArticleId} from '@aihot/backend/lib/ids';
const nativeId=()=>BigInt('0x'+randomUUID().replaceAll('-','')).toString();
const address=(id:string,path='article',query='')=>`https://www.toutiao.com/${path==='a'?'a'+id:path+'/'+id}${query}`;
async function source(){const id=tag();await sql`INSERT INTO sources(id,name,kind) VALUES (${id},'Synthetic material owner','external')`;return id;}
async function legacy(sourceId:string,url:string,identity=identityKeyForUrl(url)!){const id=newArticleId();await sql`INSERT INTO articles(id,source_id,identity_key,url,title,body_text,discovered_at,timeline_at) VALUES (${id},${sourceId},${identity},${url},'Original','Original body',now()-interval '7 days',now()-interval '7 days')`;return id;}
after(closeDb);
test('legacy signed paths and new URL-only/typed writers reuse the original owner without aliases',async()=>{
 const oldOwner=await source(),newOwner=await source();
 for(const path of ['a','group','article','video']){
  const id=nativeId(),url=address(id,path,'/?token=old'),articleId=await legacy(oldOwner,url);
  const before=(await sql`SELECT source_id,url,identity_key,body_text,discovered_at,timeline_at,published_at,backfill FROM articles WHERE id=${articleId}`)[0];
  const found=await upsertMaterial({sourceId:newOwner,url:address(id,path==='video'?'a':'video','?token=new'),identityKey:`toutiao:workId:${id}`,title:'New author discovery',bodyText:'Cannot replace original body',via:'import'});
  assert.equal(found.articleId,articleId);assert.deepEqual((await sql`SELECT source_id,url,identity_key,body_text,discovered_at,timeline_at,published_at,backfill FROM articles WHERE id=${articleId}`)[0],before);
  assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id=${articleId}`).length,0);
 }
 const id=nativeId(),first=await upsertMaterial({sourceId:oldOwner,url:address(id,'a'),title:'First',via:'fetch'}),second=await upsertMaterial({sourceId:newOwner,url:address(id,'group','/?token=two'),title:'Second',via:'import'});
 assert.equal(first.articleId,second.articleId);assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${first.articleId}`)[0]!.identity_key,`toutiao:workId:${id}`);
});
test('custom, fragment, similar prefix and unrecognized paths stay independent',async()=>{
 const owner=await source(),id=nativeId(),url=address(id),custom=await legacy(owner,url,`custom:${tag()}`),fragment=await legacy(owner,url+'#section',identityKeyForUrl(url+'#section',{keepFragment:true})!);
 const native=await upsertMaterial({sourceId:owner,url,title:'Native',via:'fetch'});assert.notEqual(native.articleId,custom);assert.notEqual(native.articleId,fragment);
 const prefix=await legacy(owner,address(id+'1','video','?token=x'));assert.notEqual((await upsertMaterial({sourceId:owner,url:address(id,'group'),title:'Same',via:'fetch'})).articleId,prefix);
 for(const url of [`https://toutiao.com/${id}`,`https://toutiao.com/c/user/token/${id}/`]){const material=await upsertMaterial({sourceId:owner,url,title:'Generic',via:'fetch'});assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${material.articleId}`)[0]!.identity_key,identityKeyForUrl(url));}
});
test('concurrent native/typed writers share ownership; conflicting legacy owners abort',async()=>{
 const one=await source(),two=await source(),id=nativeId();const [a,b]=await Promise.all([upsertMaterial({sourceId:one,url:address(id,'a','?token=a'),title:'One',via:'fetch'}),upsertMaterial({sourceId:two,url:address(id,'video','?token=b'),identityKey:`toutiao:workId:${id}`,title:'Two',via:'import'})]);assert.equal(a.articleId,b.articleId);
 const conflict=nativeId();await legacy(one,address(conflict,'article','?token=a'));await legacy(two,address(conflict,'group','?token=b'));await assert.rejects(upsertMaterial({sourceId:one,url:address(conflict,'video'),title:'Conflict',via:'import'}),{code:'conflict'});
 await assert.rejects(upsertMaterial({sourceId:one,url:address(id),identityKey:'toutiao:workId:123',title:'Mismatch',via:'import'}),{code:'conflict'});
});

import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test,after} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {upsertMaterial} from '@aihot/backend/content/materials';
import {identityKeyForUrl} from '@aihot/backend/lib/url';
import {newArticleId} from '@aihot/backend/lib/ids';
const nativeId=()=>'BV'+randomUUID().replaceAll('-','').slice(0,10);
const address=(id:string,unusedHandle='synthetic',query='')=>`https://www.bilibili.com/video/${id}${query}`;
async function source(){const id=tag();await sql`INSERT INTO sources(id,name,kind) VALUES (${id},'Synthetic material owner','external')`;return id;}
async function legacy(sourceId:string,url:string,identity=identityKeyForUrl(url)!){const id=newArticleId();await sql`INSERT INTO articles(id,source_id,identity_key,url,title,body_text,discovered_at,timeline_at) VALUES (${id},${sourceId},${identity},${url},'Original','Original body',now()-interval '7 days',now()-interval '7 days')`;return id;}
after(closeDb);
test('legacy signed URL and changed sharing query share one owner; reverse URL-only reuse adds no aliases',async()=>{
 const oldOwner=await source(),newOwner=await source(),id=nativeId(),old=address(id,'old_unusedHandle','/?token=old'),articleId=await legacy(oldOwner,old);
 const before=(await sql`SELECT source_id,url,identity_key,body_text,discovered_at,timeline_at,published_at,backfill FROM articles WHERE id=${articleId}`)[0];
 const a=await upsertMaterial({sourceId:newOwner,url:address(id,'new_unusedHandle','?token=new'),identityKey:`bilibili:bvId:${id}`,title:'Changed',bodyText:'Other author body',via:'import'});assert.equal(a.articleId,articleId);assert.deepEqual((await sql`SELECT source_id,url,identity_key,body_text,discovered_at,timeline_at,published_at,backfill FROM articles WHERE id=${articleId}`)[0],before);
 const reverse=nativeId(),first=await upsertMaterial({sourceId:oldOwner,url:address(reverse),title:'Typed',via:'fetch'}),second=await upsertMaterial({sourceId:newOwner,url:address(reverse,'another','/?token=two'),title:'Another',via:'import'});assert.equal(first.articleId,second.articleId);assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${first.articleId}`)[0]!.identity_key,`bilibili:bvId:${reverse}`);assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id IN (${articleId},${first.articleId})`).length,0);
});
test('custom, fragments, prefix-similar IDs and unsupported addresses remain independent',async()=>{
 const owner=await source(),id=nativeId(),url=address(id),custom=await legacy(owner,url,`custom:${tag()}`),fragment=await legacy(owner,url+'#section',identityKeyForUrl(url+'#section',{keepFragment:true})!);
 const typed=await upsertMaterial({sourceId:owner,url,title:'Native',via:'fetch'});assert.notEqual(typed.articleId,custom);assert.notEqual(typed.articleId,fragment);
 const prefix=await legacy(owner,address(id+'1','other','?token=x'));assert.notEqual((await upsertMaterial({sourceId:owner,url:address(id,'new'),title:'Same native',via:'import'})).articleId,prefix);
 for(const u of [`https://b23.tv/${id}`,`https://www.bilibili.com/video/av123`]){const result=await upsertMaterial({sourceId:owner,url:u,title:'Generic',via:'import'});assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${result.articleId}`)[0]!.identity_key,identityKeyForUrl(u));}
});
test('concurrent URL-only and typed imports have one owner; multiple legacy owners conflict atomically',async()=>{
 const one=await source(),two=await source(),id=nativeId();const [a,b]=await Promise.all([upsertMaterial({sourceId:one,url:address(id,'one','?token=a'),title:'One',via:'fetch'}),upsertMaterial({sourceId:two,url:address(id,'two','?token=b'),identityKey:`bilibili:bvId:${id}`,title:'Two',via:'import'})]);assert.equal(a.articleId,b.articleId);
 const conflict=nativeId();await legacy(one,address(conflict,'one','?token=a'));await legacy(two,address(conflict,'two','?token=b'));await assert.rejects(upsertMaterial({sourceId:one,url:address(conflict,'third'),title:'Conflict',via:'import'}),{code:'conflict'});
 await assert.rejects(upsertMaterial({sourceId:one,url:address(id),identityKey:'bilibili:bvId:BV1234567890',title:'Mismatch',via:'import'}),{code:'conflict'});
});

import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { sql,closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { newArticleId } from "@aihot/backend/lib/ids";
import { identityKeyForUrl,douyinVideoId } from "@aihot/backend/lib/url";
const owner=tag(),other=tag();let seq=0;const next=()=>`998${Date.now()}${++seq}`;
const video=(id:string)=>`https://www.douyin.com/video/${id}`,share=(id:string)=>`http://www.iesdouyin.com/share/video/${id}`;
before(async()=>{await sql`INSERT INTO sources(id,name,kind) VALUES (${owner},'Synthetic original','rss'),(${other},'Synthetic other','external')`;});
after(()=>closeDb());
async function legacy(url:string){const id=newArticleId();await sql`INSERT INTO articles(id,source_id,identity_key,url,title,body_text,discovered_at,timeline_at) VALUES (${id},${owner},${identityKeyForUrl(url)!},${url},'Legacy','Keep original',now()-interval '7 days',now()-interval '7 days')`;return id;}
test("old ies address reuses the original primary/source/time; reverse URL reports and concurrency never create aliases",async()=>{
  const id=next(),old=await legacy(share(id)),[before]=await sql`SELECT identity_key,url,source_id,body_text,discovered_at,timeline_at FROM articles WHERE id=${old}`;
  const result=await upsertMaterial({sourceId:other,url:video(id),identityKey:`douyin:aweme_id:${id}`,title:"Imported",bodyText:"Do not overwrite",via:"import"});assert.equal(result.articleId,old);
  assert.deepEqual((await sql`SELECT identity_key,url,source_id,body_text,discovered_at,timeline_at FROM articles WHERE id=${old}`)[0],before);
  for(let round=0;round<3;round++){
    const n=next();const results=await Promise.all([upsertMaterial({sourceId:owner,url:video(n),identityKey:`douyin:aweme_id:${n}`,title:"New typed",via:"import"}),upsertMaterial({sourceId:other,url:share(n),title:"RSS variant",via:"fetch"})]);
    assert.equal(results[0]!.articleId,results[1]!.articleId);assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${results[0]!.articleId}`)[0]!.identity_key,`douyin:aweme_id:${n}`);
    assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id=${results[0]!.articleId}`).length,0);
  }
});
test("different historical owners or a mismatched typed work ID fail atomically",async()=>{
  const id=next(),a=await legacy(video(id)),b=await legacy(share(id));assert.notEqual(a,b);
  await assert.rejects(sql.begin(async tx=>{await tx`UPDATE articles SET title='Rollback' WHERE id=${a}`;await upsertMaterial({sourceId:other,url:video(id),title:"Conflict",via:"import"},tx);}),{code:"conflict"});assert.equal((await sql`SELECT title FROM articles WHERE id=${a}`)[0]!.title,"Legacy");
  await assert.rejects(upsertMaterial({sourceId:other,url:video(next()),identityKey:`douyin:aweme_id:${next()}`,title:"Wrong ID",via:"import"}),{code:"conflict"});
});
test("unsupported paths and custom or fragment identities retain the existing material behavior",async()=>{
  const id=next();for(const url of [`https://v.douyin.com/${id}`,`https://www.douyin.com/note/${id}`,`https://www.douyin.com/user/person?vid=${id}`,`https://example.com/video/${id}`,video(id)+"#part"]){assert.equal(douyinVideoId(url),null);const r=await upsertMaterial({sourceId:owner,url,title:"Untyped",via:"fetch"});assert.equal((await sql`SELECT identity_key FROM articles WHERE id=${r.articleId}`)[0]!.identity_key,identityKeyForUrl(url));}
  const address=video(next());const a=await upsertMaterial({sourceId:owner,url:address,identityKey:"custom:"+tag(),title:"Custom",via:"fetch"}),b=await upsertMaterial({sourceId:owner,url:address,identityKey:`url:${address}#section`,title:"Fragment",via:"fetch"});assert.notEqual(a.articleId,b.articleId);
  const normal=await upsertMaterial({sourceId:owner,url:address,title:"Normal typed",via:"fetch"});assert.notEqual(normal.articleId,a.articleId);assert.notEqual(normal.articleId,b.articleId);
  const rss=`https://example.com/${tag()}`;assert.equal((await upsertMaterial({sourceId:owner,url:rss,title:"RSS",via:"fetch"})).created,true);
});

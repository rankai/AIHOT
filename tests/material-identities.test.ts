import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial, type MaterialInput } from "@aihot/backend/content/materials";
import { MaterialIdentityConflict, type ConfirmedWorkIdentity } from "@aihot/backend/content/material-identities";
import { identityKeyForUrl } from "@aihot/backend/lib/url";
type WeiboIdentity=Extract<ConfirmedWorkIdentity,{platform:"weibo"}>;
const source=`aliases-${tag()}`,other=`aliases-other-${tag()}`;
let sequence=0;
const next=():WeiboIdentity=>({platform:"weibo",opusId:`99${Date.now()}${Math.floor(Math.random()*1000000)}${++sequence}`,mblogid:`AbC${tag().replace(/[^a-zA-Z0-9]/g,"")}${sequence}`,uid:"1200000123",evidence:{kind:"result",reference:`synthetic-${tag()}`}});
const short=(c:WeiboIdentity)=>`https://weibo.com/${c.uid}/${c.mblogid}`;
const material=(c:WeiboIdentity):MaterialInput=>({sourceId:source,url:`https://weibo.com/${c.uid}/${c.opusId}`,identityKey:`weibo:opusId:${c.opusId}`,title:"Confirmed work",bodyText:"Original body",via:"import",confirmedIdentity:c});
before(async()=>{await sql`INSERT INTO sources(id,name,kind) VALUES (${source},'Identity fixture','rss'),(${other},'Other identity fixture','rss')`;});
after(()=>closeDb());
test("old short URL is reused without rewriting primary identity or source; foreign content is discovery only",async()=>{
  const c=next();const old=await upsertMaterial({sourceId:source,url:short(c),title:"Old",bodyText:"Old body",via:"fetch"});
  const result=await upsertMaterial({...material(c),sourceId:other});assert.equal(result.articleId,old.articleId);assert.equal(result.revised,false);
  const [row]=await sql`SELECT identity_key,url,source_id,body_text FROM articles WHERE id=${old.articleId}`;
  assert.equal(row!.identity_key,identityKeyForUrl(short(c)));assert.equal(row!.url,short(c));assert.equal(row!.source_id,source);assert.equal(row!.body_text,"Old body");
  assert.equal((await sql`SELECT 1 FROM article_discoveries WHERE article_id=${old.articleId} AND source_id=${other}`).length,1);
  const aliases=await sql`SELECT alias_key FROM article_identity_aliases WHERE article_id=${old.articleId} ORDER BY alias_key`;
  assert.deepEqual(aliases.map(x=>x.alias_key),[`weibo:mblogid:${c.mblogid}`,`weibo:opusId:${c.opusId}`]);
});
test("confirmed numeric detail first, plain RSS short URL and repeated detail reuse one article",async()=>{
  const c=next();const first=await upsertMaterial(material(c));
  const rss=await upsertMaterial({sourceId:other,url:`${short(c)}?utm_source=rss`,title:"RSS rendering",via:"fetch"});
  assert.equal(rss.articleId,first.articleId);assert.equal((await upsertMaterial(material(c))).articleId,first.articleId);
  const [row]=await sql`SELECT identity_key,url FROM articles WHERE id=${first.articleId}`;assert.equal(row!.identity_key,`weibo:opusId:${c.opusId}`);assert.equal(row!.url,material(c).url);
});
test("missing evidence and contradictory URL reject before creating article or aliases",async()=>{
  const c=next();await assert.rejects(upsertMaterial({...material(c),confirmedIdentity:{...c,evidence:undefined} as unknown as ConfirmedWorkIdentity}));
  await assert.rejects(upsertMaterial({...material(c),url:short(next())}),MaterialIdentityConflict);
  assert.equal((await sql`SELECT 1 FROM articles WHERE identity_key=${material(c).identityKey!}`).length,0);
  assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE alias_key=${`weibo:opusId:${c.opusId}`}`).length,0);
});
test("two preexisting articles conflict and the entire item transaction rolls back",async()=>{
  const c=next();const a=await upsertMaterial({sourceId:source,url:short(c),title:"Short legacy",via:"fetch"});
  const b=await upsertMaterial({...material(c),confirmedIdentity:undefined});assert.notEqual(a.articleId,b.articleId);
  await assert.rejects(sql.begin(async tx=>{await tx`UPDATE articles SET title='must rollback' WHERE id=${a.articleId}`;await upsertMaterial(material(c),tx);}),MaterialIdentityConflict);
  assert.equal((await sql`SELECT title FROM articles WHERE id=${a.articleId}`)[0]!.title,"Short legacy");
  assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id IN (${a.articleId},${b.articleId})`).length,0);
});
test("overlapping concurrent short, numeric and confirmed reports have one owner",async()=>{
  for(let round=0;round<5;round++){
    const c=next();const reports=[material(c),{...material(c),url:short(c),identityKey:undefined},{sourceId:other,url:short(c),title:"RSS",via:"fetch" as const}];
    const results=await Promise.all((round%2?reports.reverse():reports).map(m=>upsertMaterial(m)));
    assert.equal(new Set(results.map(r=>r.articleId)).size,1);
    assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id=${results[0]!.articleId}`).length,2);
  }
});
test("alias and primary disagreement refuses merge; case and ordinary fragment identities stay distinct",async()=>{
  const a=next(),b=next();await upsertMaterial(material(a));await upsertMaterial(material(b));
  await assert.rejects(upsertMaterial(material({...b,mblogid:a.mblogid})),MaterialIdentityConflict);
  const url=`https://example.com/${tag()}`;const one=await upsertMaterial({sourceId:source,url,identityKey:`url:${url}#a`,title:"A",via:"fetch"});
  const two=await upsertMaterial({sourceId:source,url,identityKey:`url:${url}#b`,title:"B",via:"fetch"});assert.notEqual(one.articleId,two.articleId);
  const c=next();await upsertMaterial(material(c));const lower=await upsertMaterial({sourceId:source,url:short({...c,mblogid:c.mblogid.toLowerCase()}),title:"Distinct opaque ID",via:"fetch"});
  assert.equal((await sql`SELECT 1 FROM article_identity_aliases WHERE article_id=${lower.articleId}`).length,0);
});

test("numeric opaque permalinks use confirmed candidates, never an ID-format conversion",async()=>{
  const c={...next(),mblogid:`456${Date.now()}${Math.floor(Math.random()*1000000)}${sequence}`};
  const old=await upsertMaterial({sourceId:source,url:short(c),title:"Numeric short legacy",via:"fetch"});
  assert.equal((await upsertMaterial({...material(c),url:short(c)})).articleId,old.articleId);
  assert.equal((await upsertMaterial({sourceId:other,url:`https://m.weibo.cn/status/${c.mblogid}`,title:"Mobile numeric short",via:"fetch"})).articleId,old.articleId);
  // An ambiguous numeric URL cannot silently choose between two confirmed owners.
  const second={...next(),opusId:c.mblogid,uid:"2200000123"};await upsertMaterial({...material(second),url:`https://m.weibo.cn/detail/${second.opusId}`});
  await assert.rejects(upsertMaterial({sourceId:source,url:short(c),title:"Ambiguous",via:"fetch"}),MaterialIdentityConflict);
});
test("database evidence constraint rejects missing and JSON null fields",async()=>{
  const c=next(),article=await upsertMaterial(material(c));
  for(const evidence of [{},{kind:"result"},{reference:"r"},{kind:null,reference:"r"},{kind:"result",reference:null}]){
    await assert.rejects(sql`INSERT INTO article_identity_aliases(alias_key,article_id,evidence) VALUES (${`invalid:${tag()}`},${article.articleId},${sql.json(evidence)})`,{code:"23514"});
  }
});

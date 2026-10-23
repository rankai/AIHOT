import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createAgentKeyQuery} from '@aihot/backend/providers/agentkey/queries';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
import {importDouyinResult} from '@aihot/backend/providers/redfox/import-douyin';
import {parseDouyinSearch} from '@aihot/backend/providers/agentkey/douyin-parser';
import {douyinSearchInput} from '@aihot/backend/providers/agentkey/douyin-contract';
import {stub,tag,assertConfiguredTestDatabase} from './setup.ts';

function work(description:string|undefined='Verified V4 Desc'){
 const id=String(Date.now())+String(Math.floor(Math.random()*100000));
 return {AwemeId:id,...(description===undefined?{}:{Desc:description}),CreateTime:'1729400000000',Author:{Uid:id+'1',SecUid:'sec-'+id,Nickname:'Verified author'},Video:{ItemID:id,Cover:{UrlList:['https://example.test/verified-cover.jpg']}},content:'Unknown content must stay in receipt',imageUrlList:['https://example.test/unverified-image.jpg'],private_unknown:'receipt only'};
}
const response=(item:unknown)=>({envelope:{provider:'TikHub',data:{code:200,data:{code:0,data:{itemList:[{AwemeInfo:item}],hasMore:false,cursor:0}}}}});
let budgets:any[]=[];
before(async()=>{
 const [db]=await sql`SELECT current_database() AS name,inet_server_port() AS port`;assertConfiguredTestDatabase(db!.name,db!.port);
 budgets=await sql`SELECT * FROM budgets WHERE service='agentkey.query'`;
 await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='agentkey.query'`;
});
after(async()=>{for(const b of budgets)await sql`UPDATE budgets SET per_minute=${b.per_minute},per_hour=${b.per_hour},per_day=${b.per_day} WHERE service=${b.service}`;await stopBoss();await closeDb();});
async function query(item:ReturnType<typeof work>,run:(result:any,calls:unknown[])=>Promise<void>){
 const calls:unknown[]=[],server=await stub(async(_hit,req)=>{
  const q=JSON.parse(req.body);if(q.method?.startsWith('notifications/'))return {};
  if(q.method==='initialize')return {jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake-v4',version:'1'}}};
  calls.push(q.params.arguments);return {jsonrpc:'2.0',id:q.id,result:{content:[],structuredContent:response(item).envelope}};
 });
 const previous={...process.env};Object.assign(process.env,{AGENTKEY_API_KEY:'fake-v4-materials-key',AGENTKEY_MCP_URL:server.url,AGENTKEY_CALLS_ENABLED:'true'});
 try{
  const q=await createAgentKeyQuery({provider:'agentkey',operationId:'OWIBYU1V',parameters:{keyword:'V4 material proof'}},'fixture',tag());
  await executeOperationStep(q.id,q.step_version,randomUUID());
  const [state]=await sql`SELECT status FROM operation_runs WHERE id=${q.id}`;assert.equal(state!.status,'completed');
  const [result]=await sql`SELECT * FROM operation_results WHERE run_id=${q.id} AND kind='douyin_work'`;assert.ok(result);
  // Import is a local evidence operation with both paid/collection valves closed.
  process.env.AGENTKEY_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';await run(result,calls);
 }finally{await server.close();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
}
test('V4 material record contains only verified description, author and cover projections',()=>{
 const item=work(),candidate=parseDouyinSearch(response(item),douyinSearchInput.parse({keyword:'fixture'})).candidates[0]!;
 assert.deepEqual(candidate.data.record,{desc:item.Desc,aweme_desc:item.Desc,authorName:item.Author.Nickname,coverUrl:item.Video.Cover.UrlList[0]});
});
test('query receipt import chooses verified Desc and keeps unknown content in receipt only',async()=>{
 const item=work();await query(item,async(result,calls)=>{
  const imported=await importDouyinResult(result.id,{reason:'V4 evidence fixture'},'fixture',tag());assert.ok(imported?.articleId);
  const [a]=await sql`SELECT body_text,body_status,author,media FROM articles WHERE id=${imported!.articleId}`;
  assert.equal(a!.body_text,item.Desc);assert.equal(a!.body_status,'ok');assert.equal(a!.author,item.Author.Nickname);assert.deepEqual(a!.media,[{kind:'image',url:item.Video.Cover.UrlList[0]}]);
  assert.equal(Object.hasOwn(result.data.record,'content'),false);
  const [receipt]=await sql`SELECT response FROM receipts WHERE id=${result.receipt_id}`;
  assert.equal(receipt!.response.envelope.data.data.data.itemList[0].AwemeInfo.content,item.content);assert.equal(calls.length,1);
 });
});
test('legacy V4 raw record imports safely and still rejects verified-field or outer-data tampering',async()=>{
 const item=work();await query(item,async(result,calls)=>{
  // Exact old {...AwemeInfo,...normalized} shape, made explicitly without the current parser.
  const legacy={...result.data,record:{...item,desc:item.Desc,aweme_desc:item.Desc,authorName:item.Author.Nickname,coverUrl:item.Video.Cover.UrlList[0]}};
  for(const data of [{...legacy,title:'forged title'},{...legacy,record:{...legacy.record,desc:'forged desc'}},{...legacy,record:{...legacy.record,Desc:'forged raw Desc'}},{...legacy,record:{...legacy.record,authorName:'forged author'}},{...legacy,record:{...legacy.record,coverUrl:'https://example.test/forged.jpg'}},{...legacy,record:{...legacy.record,unexpected:'not present in receipt'}},{...result.data,record:{...result.data.record,content:item.content}}]){
   await sql`UPDATE operation_results SET data=${sql.json(data)} WHERE id=${result.id}`;
   await assert.rejects(importDouyinResult(result.id,{reason:'reject forged V4 evidence'},'fixture',tag()),/differs/);
  }
  await sql`UPDATE operation_results SET data=${sql.json(legacy)} WHERE id=${result.id}`;
  const imported=await importDouyinResult(result.id,{reason:'historical V4 import'},'fixture',tag());assert.ok(imported?.articleId);
  assert.equal((await sql`SELECT body_text FROM articles WHERE id=${imported!.articleId}`)[0]!.body_text,item.Desc);assert.equal(calls.length,1);
 });
});
test('unknown V4 content alone cannot mark a material body as confirmed',async()=>{
 const item=work();delete item.Desc;await query(item,async(result,calls)=>{
  const imported=await importDouyinResult(result.id,{reason:'missing verified Desc'},'fixture',tag());assert.ok(imported?.articleId);
  const [a]=await sql`SELECT body_text,body_status FROM articles WHERE id=${imported!.articleId}`;assert.equal(a!.body_text,null);assert.equal(a!.body_status,'pending');assert.equal(calls.length,1);
 });
});

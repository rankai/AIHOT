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
import {resumeRun} from '@aihot/backend/providers/operations/store';
import {socialResearchOperations as operations,type SocialResearchOperation} from '@aihot/backend/providers/redfox/social-research-contract';
import {parseSocialResearch} from '@aihot/backend/providers/redfox/social-research';
import {parseRedfoxJson} from '@aihot/backend/providers/redfox/client';
const big='900719925474099312345',opaque='  raw/+==|token  ',secret='synthetic-social-key';
// Synthetic fixtures follow each documented response shape; no provider request is made.
const cases:[SocialResearchOperation,Record<string,unknown>,unknown][]=[
 ['ZMFVK589',{opusId:big,offset:opaque},{opusId:big,total:0,offset:opaque,hasMore:false,comments:[{cid:big,uid:'11',content:'Synthetic comment',createTime:'1700000000',updateTime:'2026-10-20 12:00:00',likeNum:'0'}]}],
 ['API_1790577699794',{userId:big,minTime:'0',pageToken:''},{followingList:[{userId:'22',secUserId:'received-sec',userHandle:'actual_followee',isVerified:false}],hasMore:1,minTime:'0',pageToken:null}],
 ['API_1790581645603',{aweme_id:big,cursor:0},{commentList:[{commentId:big,workId:big,content:'Synthetic',likeCount:0,likedByAuthor:false,shareData:{url:'https://example.com/media'},userData:{userId:'33'}}],hasMore:0,nextCursor:0}],
 ['API_1791446025175',{itemId:big,commentId:'root-comment',cursor:0,count:10},{commentList:[{commentId:'reply-id',workId:big,content:'Reply',replyToUserId:null,replyToUserHandle:null,threadId:0,userData:{userId:'44'}}],hasMore:0,nextCursor:0,total:1}],
 ['WULKP6JP',{videoId:'syntheticID',continuationToken:opaque},{code:2000,data:{comments:[{commentId:'yt-comment',content:'Synthetic',likeCount:'1万',replyCount:'0',publishedTime:'4年前',author:{channelId:'actual-channel',isCreator:false}}]},continuationToken:null}],
 ['U1SGKF2G',{codeOrUrl:'SyntheticCode',sortBy:'recent',paginationToken:opaque},{comments:[{commentId:'ig-comment',text:'Synthetic',createdAt:1700000000,isPinned:false,likeCount:0,user:{id:'55',username:'display_only'}}],count:15,total:2811,paginationToken:opaque}],
];
let current=cases[0]!,raw:string|undefined,hits=0,saved:Record<string,unknown>|undefined;
const errors:string[]=[];
const server=http.createServer((req,res)=>{hits++;let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,operations[current[0]].path);assert.equal(req.headers.redfox_api_key,secret);assert.deepEqual(JSON.parse(body),current[1]);res.setHeader('Content-Type','application/json');res.end(raw??JSON.stringify(['ZMFVK589','WULKP6JP'].includes(current[0])?current[2]:{code:2000,data:current[2]}));}catch(e){errors.push(String(e));res.statusCode=400;res.end('{}');}});});
before(async()=>{assert.match((await sql`SELECT current_database() AS name`)[0]!.name,/_(test|ci)$/);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY=secret;process.env.REDFOX_CALLS_ENABLED='true';config.allowPrivateNetworkFetch=true;saved=(await sql`SELECT * FROM budgets WHERE service='redfox.query'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.query'`;});
after(async()=>{if(saved)await sql`UPDATE budgets SET per_minute=${saved.per_minute as number},per_hour=${saved.per_hour as number},per_day=${saved.per_day as number} WHERE service='redfox.query'`;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function query(){const run=await createSynchronousQuery({operationId:current[0],parameters:current[1]},'social-research-test',tag());await step(run.id);return {run:await row(run.id),results:await sql`SELECT * FROM operation_results WHERE run_id=${run.id} ORDER BY id`};}
test('six POST body contracts preserve author roles, large IDs, nulls, false and independent reported paging',async()=>{
 const before=hits;for(const c of cases){current=c;const q=await query();assert.equal(q.run.status,'completed',`${c[0]}: ${q.run.wait_reason}`);const result=q.results[0]!,summary=q.results.at(-1)!.data;assert.equal(result.kind,c[0]==='API_1790577699794'?'social_followee':'social_comment');assert.equal(summary.count,1);assert.deepEqual(result.data.requestedScope,c[1]);assert.equal(result.data.identityRole,c[0]==='API_1790577699794'?'followee':'comment-author');
 const [receipt]=await sql`SELECT service,cost,cost_basis FROM receipts WHERE id=${result.receipt_id}`;assert.equal(receipt!.service,'redfox.query');assert.equal(Number(receipt!.cost),0.06);assert.equal(receipt!.cost_basis,'estimated');
 if(c[0]==='ZMFVK589'){assert.deepEqual(result.data.identity,{uid:'11'});assert.equal(summary.reportedPaging.root.hasMore,false);assert.equal(result.data.commentId,big);assert.deepEqual(result.data.timeUnits,{createTime:'seconds',updateTime:'unspecified'});assert.equal(result.data.record.updateTime,'2026-10-20 12:00:00');}
 if(c[0]==='API_1790577699794'){assert.deepEqual(result.data.identity,{userId:'22',secUserId:'received-sec'});assert.equal(summary.reportedPaging.data.pageToken,null);assert.equal(summary.reportedPaging.data.hasMore,1);assert.equal(result.data.record.isVerified,false);assert.deepEqual(result.data.timeUnits,{createTime:'seconds'});}
 if(c[0]==='API_1790581645603'){assert.deepEqual(result.data.identity,{userId:'33'});assert.equal(result.data.record.likedByAuthor,false);assert.equal(summary.reportedPaging.data.nextCursor,0);}
 if(c[0]==='API_1791446025175'){assert.equal(result.data.role,'comment-reply');assert.equal(result.data.record.replyToUserId,null);assert.deepEqual(result.data.identity,{userId:'44'});}
 if(c[0]==='WULKP6JP'){assert.deepEqual(result.data.identity,{channelId:'actual-channel'});assert.equal(summary.reportedPaging.root.continuationToken,null);assert.deepEqual(summary.reportedPaging.data,{});assert.equal(result.data.record.publishedTime,'4年前');assert.equal(result.data.commentTimeUnit,undefined);}
 if(c[0]==='U1SGKF2G'){assert.equal(summary.reportedPaging.data.count,15);assert.equal(summary.reportedPaging.data.paginationToken,opaque);assert.deepEqual(result.data.identity,{userId:'55'});}}
 assert.equal(hits,before+6);assert.deepEqual(errors,[]);
});
test('strict credentials, required prose fields, declared integer cursors and exact sorting reject before a run',async()=>{
 const before=hits;for(const [op,p] of cases)for(const field of ['apiKey','REDFOX_API_KEY']){const key=tag();await assert.rejects(createSynchronousQuery({operationId:op,parameters:{...p,[field]:'forbidden'}},'social-reject',key));assert.equal((await sql`SELECT id FROM operation_runs WHERE actor='social-reject' AND command_key=${key}`).length,0);}
 for(const p of [{userId:big,secUserId:'sec',minTime:'0',pageToken:''},{minTime:'0',pageToken:''},{userId:big,minTime:'0',pageToken:null}])assert.equal(operations.API_1790577699794.schema.safeParse(p).success,false);
 for(const p of [{aweme_id:big,cursor:'0'},{aweme_id:big},{cursor:0},{aweme_id:big,cursor:Number.MAX_SAFE_INTEGER+1}])assert.equal(operations.API_1790581645603.schema.safeParse(p).success,false);
 assert.equal(operations.U1SGKF2G.schema.safeParse({codeOrUrl:'code'}).success,false);assert.equal(operations.U1SGKF2G.schema.safeParse({codeOrUrl:'code',sortBy:'top'}).success,false);
 assert.deepEqual(operations.WULKP6JP.schema.parse({videoId:'id',continuationToken:null}),{videoId:'id',continuationToken:null});assert.equal(hits,before);
});
test('empty pages retain actual root/data facts without inventing an end or request-based author',()=>{
 const pages:unknown[]=[{comments:[],hasMore:false,total:0,offset:''},{followingList:[],hasMore:1,pageToken:null,minTime:'0'},{commentList:[],nextCursor:0},{commentList:[],hasMore:0},{code:2000,data:{comments:[],continuationToken:' table-path '},continuationToken:' root-path '},{comments:[],count:0,total:0,paginationToken:''}];
 cases.forEach(([op,p],index)=>{const results=parseSocialResearch(op,pages[index],p);assert.equal(results.length,1);assert.equal(results[0]!.data.count,0);assert.equal(results[0]!.data.hasMore,undefined);});
 const bothTokens=parseSocialResearch('WULKP6JP',pages[4],{})[0]!.data.reportedPaging;assert.deepEqual(bothTokens,{root:{continuationToken:' root-path '},data:{continuationToken:' table-path '}});
 const noAuthor=parseSocialResearch('API_1790577699794',{followingList:[{userName:'Only display'}]},cases[1]![1])[0]!;assert.deepEqual(noAuthor.data.identity,{});
 const large=parseSocialResearch('API_1790581645603',parseRedfoxJson(`{"commentList":[{"commentId":${big},"content":"Synthetic","userData":{"userId":${big}}}],"nextCursor":${big}}`),{aweme_id:big,cursor:0});assert.equal(large[0]!.data.commentId,big);assert.deepEqual(large[0]!.data.identity,{userId:big});assert.equal((large.at(-1)!.data.reportedPaging as {data:{nextCursor:string}}).data.nextCursor,big);
 assert.throws(()=>parseSocialResearch('ZMFVK589',{opusId:'wrong',comments:[]},{opusId:big}));assert.throws(()=>parseSocialResearch('API_1791446025175',{commentList:[{workId:'wrong',content:'Synthetic'}]},{itemId:big}));
});
test('bad JSON, explicit business failure and invalid shapes retain raw receipt and reread without outbound calls',async()=>{
 for(const [op,body] of [['ZMFVK589','{broken'],['ZMFVK589',JSON.stringify({code:5000,comments:[]})],['WULKP6JP',JSON.stringify({code:2000,data:{}})],['WULKP6JP',JSON.stringify({code:200,data:{comments:[]}})]] as const){current=cases.find(c=>c[0]===op)!;raw=body;try{const q=await query();assert.equal(q.run.status,'needs_review');const before=hits;process.env.REDFOX_CALLS_ENABLED='false';delete process.env.REDFOX_API_KEY;await sql.begin(tx=>resumeRun(tx,{runId:q.run.id,stepVersion:q.run.step_version,generation:q.run.generation}));await step(q.run.id);assert.equal(hits,before);const [receipt]=await sql`SELECT response,attempts FROM receipts WHERE id=${q.run.current_receipt_id}`;assert.equal(receipt!.response.body,body);assert.equal(receipt!.attempts,1);}finally{raw=undefined;process.env.REDFOX_CALLS_ENABLED='true';process.env.REDFOX_API_KEY=secret;}}
});
test('catalog and reads are free, six commands are idempotent, research cannot import or attach work origin',async()=>{
 const {buildApp}=await import('../apps/api/src/app.ts'),app=await buildApp();config.devAdmin={displayName:'Synthetic social admin'};
 try{const before=hits,catalog=(await app.inject({url:'/api/admin/redfox/operations'})).json();for(const [op,p] of cases){const descriptor=catalog.find((d:{id:string})=>d.id===op);assert.equal(descriptor.platform,operations[op].platform);assert.equal(descriptor.schedulableType,null);assert.equal(descriptor.fields.some((f:{name:string})=>['apiKey','REDFOX_API_KEY'].includes(f.name)),false);const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:op,parameters:p},url='/api/admin/redfox/queries';const a=await app.inject({method:'POST',url,headers,payload});assert.equal(a.statusCode,202,a.body);assert.deepEqual((await app.inject({method:'POST',url,headers,payload})).json(),a.json());assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,parameters:{...p,extra:true}}})).statusCode,400);assert.equal((await app.inject({url:`/api/admin/operations/runs/${a.json().runId}`})).statusCode,200);await assert.rejects(createSynchronousQuery({...payload,sourceResultId:1},'social-origin',tag()),/only/);}
 const headers={'x-csrf-token':'dev','idempotency-key':tag()},payload={operationId:'ZMFVK589',parameters:{opusId:'one'}};assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload})).statusCode,202);assert.equal((await app.inject({method:'POST',url:'/api/admin/redfox/queries',headers,payload:{...payload,parameters:{opusId:'two'}}})).statusCode,409);assert.equal(hits,before);
 current=cases[2]!;const q=await query(),sourceId=tag();await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext,config) VALUES (${sourceId},'Synthetic source','x_search','isolated',false,${sql.json({query:'from:synthetic'})})`;const response=await app.inject({method:'POST',url:`/api/admin/operations/results/${q.results[0]!.id}/import`,headers:{'x-csrf-token':'dev','idempotency-key':tag()},payload:{sourceId,reason:'Synthetic forced import'}});assert.equal(response.statusCode,422);assert.equal(response.json().detail,'This result type does not support local import');assert.equal((await sql`SELECT source_id FROM operation_results WHERE id=${q.results[0]!.id}`)[0]!.source_id,null);assert.equal((await sql`SELECT count(*)::int AS n FROM source_account_bindings WHERE source_id=${sourceId}`)[0]!.n,0);assert.equal(hits,before+1);
 }finally{config.devAdmin=null;await app.close();}
});

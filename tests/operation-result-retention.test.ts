import {tag,assertConfiguredTestDatabase} from './setup.ts';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sql,closeDb} from '@aihot/backend/db';
import {expireOperationResults,lockOriginResult,requireLiveResult} from '@aihot/backend/operations/result-retention';
import {saveResult} from '@aihot/backend/providers/operations/store';
import {createSynchronousQuery} from '@aihot/backend/providers/redfox/synchronous';
import {saveResultAttachment} from '@aihot/backend/operations/result-attachments';
import {workDetailOptions} from '@aihot/backend/providers/redfox/work-detail-options';
const actor=tag(),now=new Date('2001-02-01T00:00:00Z'),old=new Date('2000-01-01T00:00:00Z');
const runs:number[]=[],receipts:number[]=[];const source=tag(),file=`uploads/redfox/${tag()}`;
let databaseVerified=false;
before(async()=>{const [r]=await sql`SELECT current_database() db,inet_server_port() port`;assertConfiguredTestDatabase(r!.db,r!.port);databaseVerified=true;await sql`INSERT INTO sources(id,name,kind,config) VALUES(${source},'Retention fixture','external','{}')`;await sql`INSERT INTO stored_files(key,content_type,bytes,purpose) VALUES(${file},'text/plain',1,'operation-output')`;});
after(async()=>{try{if(!databaseVerified)return;await sql`DELETE FROM source_account_bindings WHERE source_id=${source}`;if(runs.length){await sql`DELETE FROM operation_results WHERE run_id IN ${sql(runs)}`;await sql`DELETE FROM operation_runs WHERE id IN ${sql(runs)}`;}if(receipts.length)await sql`DELETE FROM receipts WHERE id IN ${sql(receipts)}`;await sql`DELETE FROM stored_files WHERE key=${file}`;await sql`DELETE FROM sources WHERE id=${source}`;}finally{await closeDb();}});
async function run(status='completed'){const [r]=await sql`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key) VALUES(${actor},${tag()},'redfox','redfox.sync.query',1,'{"members":[],"mode":"query"}','fixture',${status},'redfox.sync.query') RETURNING id`;runs.push(r!.id);return Number(r!.id);}
async function result(runId:number,kind='douyin_work',provenance:Record<string,unknown>={},options:{receiptId?:number;item?:string;sourceId?:string;fileKey?:string;created?:Date}={}){const [r]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,provenance,created_at,receipt_id,source_id,file_key) VALUES(${runId},1,${options.item??tag()},${kind},' {"original":"retained"}',${sql.json(provenance as never)},${options.created??old},${options.receiptId??null},${options.sourceId??null},${options.fileKey??null}) RETURNING id`;return Number(r!.id);}
const get=async(id:number)=>(await sql`SELECT * FROM operation_results WHERE id=${id}`)[0]!;
test('more than 200 results and dependent parents converge in one run; raw and provenance remain untouched',async()=>{
 const id=await run();const [receipt]=await sql`INSERT INTO receipts(logical_key,service,purpose,status,response,request) VALUES(${tag()},'redfox.query','query','completed','{"raw":"unchanged"}','{"input":"unchanged"}') RETURNING id`;receipts.push(receipt!.id);
 const parent=await result(id,'query_summary',{}, {receiptId:receipt!.id});
 const child=await result(id,'douyin_work',{sourcePageResultId:parent},{receiptId:receipt!.id});
 await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,created_at) SELECT ${id},1,'bulk:'||n,'research','{"sample":true}',${old} FROM generate_series(1,405) n`;
 const count=await expireOperationResults(now);assert.ok(count>=407);assert.equal((await get(parent)).kind,'result_expired');assert.equal((await get(child)).kind,'result_expired');assert.deepEqual((await get(child)).provenance,{sourcePageResultId:parent});assert.deepEqual((await get(child)).data,{originalKind:'douyin_work',expiredAt:now.toISOString()});
 assert.deepEqual((await sql`SELECT response FROM receipts WHERE id=${receipt!.id}`)[0]!.response,{raw:'unchanged'});assert.equal(await expireOperationResults(now),0);
});
test('live runs, recent results, explicit associations and exact reread dependencies stay intact',async()=>{
 const protectedIds:number[]=[];
 for(const status of ['active','waiting','needs_review','stopped'])protectedIds.push(await result(await run(status)));
 const id=await run();protectedIds.push(await result(id,'research',{}, {created:new Date('2001-01-20')}));protectedIds.push(await result(id,'research',{}, {sourceId:source}));protectedIds.push(await result(id,'image',{}, {fileKey:file}));
 const binding=await result(id,'wechat_account');await sql`INSERT INTO source_account_bindings(platform,id_kind,id_value,source_id,evidence) VALUES('wechat','wxId',${tag()},${source},${sql.json({kind:'result',reference:String(binding)})})`;protectedIds.push(binding);
 const attachmentParent=await result(id,'transcription');protectedIds.push(attachmentParent);await result(id,'result_attachment',{parentResultId:attachmentParent},{fileKey:file});
 const page=await result(id,'query_summary'),work=await result(id,'wechat_work',{sourcePageResultId:page}),detail=await result(id,'wechat_work',{detailSourceResultId:work,sourcePageResultId:page},{sourceId:source});protectedIds.push(page,work,detail);
 const [receipt]=await sql`INSERT INTO receipts(logical_key,service,purpose,status) VALUES(${tag()},'redfox.query','query','completed') RETURNING id`;receipts.push(receipt!.id);
 const rank=await result(id,'wechat_account_rank',{}, {receiptId:receipt!.id,item:'rank:0'});await result(id,'wechat_work',{}, {receiptId:receipt!.id,item:'rank:0:minWork',sourceId:source});protectedIds.push(rank);
 const account=await result(id,'dongchedi_account',{}, {receiptId:receipt!.id});await result(id,'dongchedi_work',{}, {receiptId:receipt!.id,sourceId:source});protectedIds.push(account);
 await expireOperationResults(now);for(const n of protectedIds)assert.notEqual((await get(n)).kind,'result_expired',String(n));
});
test('result locks serialize import and origin freezing against expiration without automatic query',async()=>{
 const id=await run(),importId=await result(id),originId=await result(id);
 let unlocked!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),release=new Promise<void>(r=>unlocked=r);
 const importing=sql.begin(async tx=>{await tx`SELECT id FROM sources WHERE id=${source} FOR UPDATE`;const [r]=await tx`SELECT * FROM operation_results WHERE id=${importId} FOR UPDATE`;requireLiveResult(r,'douyin_work');locked();await release;await tx`UPDATE operation_results SET source_id=${source} WHERE id=${importId}`;});
 await ready;await expireOperationResults(now);assert.notEqual((await get(importId)).kind,'result_expired');unlocked();await importing;
 // The other result expired while no consumer held it; late stale snapshot cannot commit.
 await assert.rejects(sql.begin(async tx=>{const [r]=await tx`SELECT * FROM operation_results WHERE id=${originId} FOR UPDATE`;requireLiveResult(r,'douyin_work');}),/expired/);
 const sharedId=await result(id);let sharedReady!:()=>void,sharedRelease!:()=>void;const sharedLocked=new Promise<void>(r=>sharedReady=r),sharedWait=new Promise<void>(r=>sharedRelease=r);
 const freezing=sql.begin(async tx=>{await lockOriginResult(tx,sharedId);sharedReady();await sharedWait;});await sharedLocked;await expireOperationResults(now);assert.notEqual((await get(sharedId)).kind,'result_expired');sharedRelease();await freezing;await expireOperationResults(now);assert.equal((await get(sharedId)).kind,'result_expired');
 const [before]=await sql`SELECT count(*) n FROM operation_runs WHERE actor=${actor}`;
 await assert.rejects(createSynchronousQuery({operationId:'FK67XDVQ',parameters:{videoId:'123'},sourceResultId:sharedId},actor,tag()),/expired/);
 await assert.rejects(saveResultAttachment(sharedId,{reason:'Expired cannot download'},actor,tag()),/expired/);
 await assert.rejects(workDetailOptions(sharedId),/expired/);
 assert.equal((await sql`SELECT count(*) n FROM operation_runs WHERE actor=${actor}`)[0]!.n,before!.n);
});
test('saveResult assigns expiry once and repeated writes keep the first lifetime',async()=>{
 const id=await run('active'),execution={runId:id,stepVersion:1,generation:0};
 const saved=await sql.begin(tx=>saveResult(tx,execution,{itemKey:'one',kind:'research',data:{value:1}}));const initial=await get(saved);assert.equal(initial.expires_at.getTime()-initial.created_at.getTime(),30*86400_000);
 assert.equal(await sql.begin(tx=>saveResult(tx,execution,{itemKey:'one',kind:'research',data:{value:2}})),saved);assert.equal((await get(saved)).expires_at.getTime(),initial.expires_at.getTime());
});
test('AgentKey data references retain exact query/origin chains, then expire after their leaf is released',async()=>{
 const id=await run(),otherRun=await run();
 const [receipt]=await sql`INSERT INTO receipts(logical_key,service,purpose,status) VALUES(${tag()},'agentkey.query','query','completed') RETURNING id`;receipts.push(receipt!.id);
 const page=await result(id,'query_summary',{}, {receiptId:receipt!.id}),work=await result(id,'wechat_work',{}, {receiptId:receipt!.id}),summary=await result(id,'query_summary',{}, {receiptId:receipt!.id}),detail=await result(id,'wechat_work',{}, {receiptId:receipt!.id,sourceId:source});
 await sql`UPDATE operation_results SET data=${sql.json({querySummaryId:page})} WHERE id=${work}`;
 await sql`UPDATE operation_results SET step_version=2,data=${sql.json({originResultId:work})} WHERE id=${summary}`;
 await sql`UPDATE operation_results SET step_version=2,data=${sql.json({querySummaryId:summary})} WHERE id=${detail}`;
 const wrong=await result(otherRun,'query_summary',{}, {receiptId:receipt!.id});
 const unrelated=await result(id,'wechat_work',{}, {receiptId:receipt!.id,sourceId:source});await sql`UPDATE operation_results SET data=${sql.json({querySummaryId:wrong})} WHERE id=${unrelated}`;
 await expireOperationResults(now);for(const n of [page,work,summary,detail])assert.notEqual((await get(n)).kind,'result_expired');assert.equal((await get(wrong)).kind,'result_expired','unrelated run cannot retain a query summary');
 await sql`UPDATE operation_results SET source_id=NULL WHERE id=${detail}`;await expireOperationResults(now);for(const n of [page,work,summary,detail])assert.equal((await get(n)).kind,'result_expired');
});

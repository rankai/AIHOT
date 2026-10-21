import {assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { redfoxCosts, RedfoxCostsQuery, summarizeBillRecords } from '@aihot/backend/admin/redfox-costs';
import { parseRedfoxAccount } from '@aihot/backend/providers/redfox/redfox-account';
import Fastify from 'fastify';
import { registerAdminRedfoxCosts } from '../apps/api/src/routes/admin-redfox-costs.ts';
const op='API_1792043329817', ids:number[]=[], runs:number[]=[];
const interval={start:'2091-01-01T00:00:00Z',end:'2091-01-02T00:00:00Z'};
before(async()=>{assertConfiguredTestDatabase((await sql`SELECT current_database() AS name`)[0]!.name);});
after(async()=>{try{if(runs.length){await sql`DELETE FROM operation_results WHERE run_id IN ${sql(runs)}`;await sql`DELETE FROM operation_runs WHERE id IN ${sql(runs)}`;}if(ids.length)await sql`DELETE FROM receipts WHERE id IN ${sql(ids)}`;}finally{await closeDb();}});
async function receipt(base:string|null='https://redfox.hk'){
 const [r]=await sql`INSERT INTO receipts(logical_key,service,model,purpose,status,request,response) VALUES (${randomUUID()},'redfox.account',${op},'bill-test','received',${sql.json({...(base?{base}:{}),operation:op,input:{}})},${sql.json({status:200,body:JSON.stringify({code:2000,data:{total:4,pages:2,records:[{points:-0.1,reason:'api_consume',reasonDesc:'consume',gmtCreate:'2026-10-12 17:00:04'},{points:-0.1,reason:'api_consume',reasonDesc:'consume',gmtCreate:'2026-10-12 17:00:04'},{points:0.2,reason:'unrecognized',reasonDesc:'positive unknown',gmtCreate:'2026-10-12 17:00:05'},{points:-0.2,reason:'api_consume',reasonDesc:'consume',gmtCreate:'2026-10-12 17:00:06'}]}})})}) RETURNING id`;
 ids.push(r!.id);return r!.id as number;
}
async function bill(id:number){
 const [r]=await sql`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key) VALUES ('bill-test',${randomUUID()},'redfox','redfox.sync.query',1,${sql.json({platform:'redfox-account',operationId:op,parameters:{}})},'test','completed','redfox.sync.query') RETURNING id`;
 runs.push(r!.id);const [p]=await sql`SELECT response FROM receipts WHERE id=${id}`;
 for(const e of parseRedfoxAccount(op,JSON.parse(p!.response.body).data))await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id) VALUES (${r!.id},1,${e.itemKey},${e.kind},${sql.json(e.data as Parameters<typeof sql.json>[0])},${id})`;
 return r!.id as number;
}
test('explicit offsets and exact decimal arithmetic',()=>{
 for(const start of ['2091-01-01T00:00:00','2091-02-30T00:00:00Z',interval.end])assert.equal(RedfoxCostsQuery.safeParse({...interval,start}).success,false);
 for(const billRunId of ['0','1.5','9007199254740992'])assert.equal(RedfoxCostsQuery.safeParse({...interval,billRunId}).success,false);
 const result=summarizeBillRecords([0.1,0.2].map(points=>({points,reason:'unknown',reasonDesc:'positive',gmtCreate:'raw'})));
 assert.equal(result.summary.signedPoints,'0.3');assert.equal(result.summary.otherRecords,2);assert.equal(result.summary.knownApiConsumptionPoints,'0');
 assert.throws(()=>summarizeBillRecords([{points:Infinity,reason:'unknown',reasonDesc:'',gmtCreate:''}]));
});
test('attempts do not multiply with shared run results, groups preserve cost basis currency origin and base',async()=>{
 const p=await receipt(),stub=await receipt('http://127.0.0.1:34567'),unknown=await receipt(null);
 await bill(p);await bill(p);
 const entries=[{id:p,cost:'0.1',currency:'CNY',basis:'estimated',origin:'live'},{id:p,cost:'0.2',currency:'CNY',basis:'estimated',origin:'live'},{id:p,cost:null,currency:'CNY',basis:'estimated',origin:'live'},{id:p,cost:'1',currency:'USD',basis:'actual',origin:'live'},{id:p,cost:null,currency:null,basis:null,origin:'replay'},{id:stub,cost:'0',currency:'CNY',basis:'estimated',origin:'live'},{id:unknown,cost:null,currency:null,basis:null,origin:'imported'}];
 for(const [i,e] of entries.entries())await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,origin,status,cost,currency,cost_basis,started_at) VALUES (${e.id},${i+1},'redfox.account',${op},${e.origin},${e.cost===null?'unknown':'received'},${e.cost},${e.currency},${e.basis},${interval.start})`;
 const result=await redfoxCosts(interval),groups=result.local.groups;
 assert.equal(groups.reduce((n,g)=>n+g.attempts,0),7);
 const known=groups.find(g=>g.base==='https://redfox.hk'&&g.currency==='CNY')!;
 assert.equal(known.knownCost,'0.300000');assert.equal(known.attempts,3);assert.equal(known.unknownCostCount,1);assert.equal(known.statusCounts.unknown,1);
 assert.equal(groups.find(g=>g.base?.startsWith('http:'))!.environment,'other');assert.equal(groups.find(g=>g.base===null)!.environment,'unknown');
 assert.equal(groups.find(g=>g.origin==='replay')!.knownCost,null);assert.equal(groups.find(g=>g.currency==='USD')!.costBasis,'actual');
});
test('AgentKey credit estimates and reported charges share the existing attempt view without treating missing values as zero',async()=>{
 const [r]=await sql`INSERT INTO receipts(logical_key,service,model,purpose,status,request,response) VALUES (${randomUUID()},'agentkey.collect','TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post','agentkey.douyin.search','received',${sql.json({endpoint:'http://local-synthetic.test/v1/mcp',params:{keyword:'synthetic'}})},${sql.json({status:200,body:'{}'})}) RETURNING id`;
 ids.push(r!.id);
 await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,origin,status,cost,currency,cost_basis,started_at,usage) VALUES (${r!.id},1,'agentkey.collect','TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post','live','received',NULL,NULL,NULL,${interval.start},${sql.json({estimatedCredits:0.2,chargedCredits:0.2})})`;
 await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,origin,status,cost,currency,cost_basis,started_at,usage) VALUES (${r!.id},2,'agentkey.collect','TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post','live','unknown',NULL,NULL,NULL,${interval.start},${sql.json({estimatedCredits:0.3})})`;
 const result=await redfoxCosts(interval),group=result.local.groups.find(g=>g.service==='agentkey.collect')!;
 assert.deepEqual({attempts:group.attempts,estimatedCredits:group.estimatedCredits,chargedCredits:group.chargedCredits,unknownEstimatedCreditsCount:group.unknownEstimatedCreditsCount,unknownChargedCreditsCount:group.unknownChargedCreditsCount},{attempts:2,estimatedCredits:'0.5',chargedCredits:'0.2',unknownEstimatedCreditsCount:0,unknownChargedCreditsCount:1});
});
test('one complete bill snapshot keeps duplicate rows and raw times, blocks unrelated or incomplete results',async()=>{
 const id=await receipt(),run=await bill(id),other=await bill(id);
 const result=await redfoxCosts({...interval,billRunId:String(run)}),page=result.selectedBill!;
 assert.equal(page.records.length,4);assert.deepEqual(page.records[0]!.gmtCreate,page.records[1]!.gmtCreate);assert.equal(page.summary.signedPoints,'-0.2');assert.equal(page.summary.knownApiConsumptionPoints,'0.4');assert.equal(page.summary.nominalCny.amount,'0.04');assert.equal(page.summary.otherRecords,1);assert.equal(page.rawTimeRange.timezone,null);assert.deepEqual(page.parameters,{});assert.equal(result.comparison.comparable,false);
 assert.equal(result.billPages.find(r=>r.runId===other)!.responseIdentity,page.responseIdentity);
 await assert.rejects(redfoxCosts({...interval,billRunId:'9007199254740991'}));
 await sql`UPDATE operation_runs SET provider='wrong' WHERE id=${other}`;await assert.rejects(redfoxCosts({...interval,billRunId:String(other)}));
 await sql`DELETE FROM operation_results WHERE run_id=${run} AND item_key='entry:0'`;await assert.rejects(redfoxCosts({...interval,billRunId:String(run)}));
 const preciseId=await receipt();
 await sql`UPDATE receipts SET response=${sql.json({status:200,body:'{"code":2000,"data":{"total":2,"pages":1,"records":[{"points":-0.1234567890123456789,"reason":"api_consume","reasonDesc":"decimal","gmtCreate":"raw"},{"points":-1e-7,"reason":"api_consume","reasonDesc":"exponent","gmtCreate":"raw"}]}}'})} WHERE id=${preciseId}`;
 const preciseRun=await bill(preciseId),precise=(await redfoxCosts({...interval,billRunId:String(preciseRun)})).selectedBill!;
 assert.equal(precise.records[0]!.points,'-0.1234567890123456789');assert.equal(precise.records[1]!.points,'-0.0000001');assert.equal(precise.summary.knownApiConsumptionPoints,'0.1234568890123456789');
 const wrong=await bill(id);await sql`UPDATE receipts SET model='wrong' WHERE id=${id}`;await assert.rejects(redfoxCosts({...interval,billRunId:String(wrong)}));
});
test('GET is admin-only, no-store, validates interval and does not create attempts or runs',async()=>{
 const app=Fastify();registerAdminRedfoxCosts(app);
 const url='/api/admin/redfox/costs?'+new URLSearchParams(interval);
 try{config.devAdmin=null;assert.equal((await app.inject({url})).statusCode,401);config.devAdmin={displayName:'Synthetic bill admin'};
 const before=await sql`SELECT (SELECT count(*) FROM receipts) receipts,(SELECT count(*) FROM receipt_attempts) attempts,(SELECT count(*) FROM operation_runs) runs`;
 const reply=await app.inject({url});assert.equal(reply.statusCode,200,reply.body);assert.equal(reply.headers['cache-control'],'no-store');assert.equal((await app.inject({url:'/api/admin/redfox/costs'})).statusCode,400);
 assert.deepEqual(await sql`SELECT (SELECT count(*) FROM receipts) receipts,(SELECT count(*) FROM receipt_attempts) attempts,(SELECT count(*) FROM operation_runs) runs`,before);
 }finally{config.devAdmin=null;await app.close();}
});

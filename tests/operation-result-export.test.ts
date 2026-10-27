import {assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { buildApp } from '../apps/api/src/app.ts';

test('admin page export matches existing pagination and DTO without writes or external fetch',async()=>{
 try{
 assertConfiguredTestDatabase((await sql`SELECT current_database() AS name`)[0]!.name);
 const app=await buildApp(),runs:number[]=[],originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('Export must not fetch external resources');};
 try{
 for(const provider of ['redfox','socialdata','dajiala']){
 const [run]=await sql`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key) VALUES ('export-test',${randomUUID()},${provider},'synthetic.query',1,'{}','test','completed','query') RETURNING id`;runs.push(run!.id);
 for(let i=0;i<101;i++)await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,expires_at) VALUES (${run!.id},1,${String(i)},'query_summary',${sql.json({index:i,text:'中文',url:'https://example.invalid/no-fetch',nested:{value:0}})},${i===0?new Date('2000-01-01'):null})`;
 const base=`/api/admin/operations/runs/${run!.id}/results`;
 config.devAdmin=null;assert.equal((await app.inject({url:base+'/export'})).statusCode,401);
 config.devAdmin={displayName:'Synthetic export admin'};
 const before=(await sql`SELECT (SELECT count(*) FROM receipt_attempts) attempts,(SELECT count(*) FROM operation_runs) runs`)[0];
 for(const cursor of [0,Number((await app.inject({url:base})).json().nextCursor)]){
 const original=(await app.inject({url:`${base}?cursor=${cursor}&limit=100`})).json();
 const res=await app.inject({url:`${base}/export?cursor=${cursor}`}),data=res.json();
 assert.equal(res.statusCode,200,res.body);assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['content-type'],'application/json; charset=utf-8');assert.equal(res.headers['content-disposition'],`attachment; filename="operation-${run!.id}-results-${cursor}.json"`);
 assert.deepEqual(data,{runId:run!.id,scope:'page',cursor,limit:100,...original});assert.equal(data.results.length,cursor===0?100:1);
 }
 assert.deepEqual((await sql`SELECT (SELECT count(*) FROM receipt_attempts) attempts,(SELECT count(*) FROM operation_runs) runs`)[0],before);
 assert.equal((await app.inject({url:base+'/export?limit=200'})).statusCode,400);assert.equal((await app.inject({url:base+'/export?cursor=-1'})).statusCode,400);
 }
 assert.equal((await app.inject({url:'/api/admin/operations/runs/9007199254740991/results/export'})).statusCode,404);
 }finally{globalThis.fetch=originalFetch;config.devAdmin=null;await sql`DELETE FROM operation_results WHERE run_id IN ${sql(runs)}`;await sql`DELETE FROM operation_runs WHERE id IN ${sql(runs)}`;await app.close();}
 }finally{await closeDb();}
});

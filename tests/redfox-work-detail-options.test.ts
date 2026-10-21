import {assertConfiguredTestDatabase} from './setup.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { workDetailOptions } from '@aihot/backend/providers/redfox/work-detail-options';
import { resultDetailOptions } from '@aihot/backend/providers/redfox/account-detail-options';
import { parseDouyin } from '@aihot/backend/providers/redfox/douyin';
import { parseXiaohongshu } from '@aihot/backend/providers/redfox/xiaohongshu-parser';
import { parseWechat } from '@aihot/backend/providers/redfox/wechat';
import { parseTiktok } from '@aihot/backend/providers/redfox/tiktok';
import { parseBilibili } from '@aihot/backend/providers/redfox/bilibili';
import { parseWeibo } from '@aihot/backend/providers/redfox/weibo';
import { parseQichezhijia } from '@aihot/backend/providers/redfox/qichezhijia';
import { parseDongchedi } from '@aihot/backend/providers/redfox/dongchedi';
import { parseYiche } from '@aihot/backend/providers/redfox/yiche';
import { qichezhijiaDescriptors } from '@aihot/backend/providers/redfox/qichezhijia-contract';
import { registerAdminOperationDetails } from '../apps/api/src/routes/admin-operation-details.ts';
type Result={kind:string;itemKey:string;data:Record<string,unknown>};
const runs:number[]=[],receipts:number[]=[];
async function save(platform:string,operationId:string,parameters:Record<string,unknown>,results:Result[]){
 const [p]=await sql`INSERT INTO receipts(logical_key,service,model,purpose,status) VALUES (${randomUUID()},'redfox.query',${operationId},'options-test','received') RETURNING id`;receipts.push(p!.id);
 const [r]=await sql`INSERT INTO operation_runs(actor,command_key,provider,operation_key,contract_version,input,input_hash,status,step_key) VALUES ('options-test',${randomUUID()},'redfox','redfox.sync.query',1,${sql.json({platform,operationId,parameters} as Parameters<typeof sql.json>[0])},'test','completed','query') RETURNING id`;runs.push(r!.id);
 const ids:number[]=[];for(const result of results){const [row]=await sql`INSERT INTO operation_results(run_id,step_version,item_key,kind,data,receipt_id) VALUES (${r!.id},1,${result.itemKey},${result.kind},${sql.json(result.data as Parameters<typeof sql.json>[0])},${p!.id}) RETURNING id`;ids.push(row!.id);}
 return {runId:r!.id as number,receiptId:p!.id as number,id:ids[results.findIndex(r=>r.kind===platform+'_work')]??ids[0]!,ids};
}
test('nine platform options prove stored work relation, preserve typed libraries and never call providers',async()=>{
 try{
 assertConfiguredTestDatabase((await sql`SELECT current_database() AS name`)[0]!.name);
 const app=Fastify();registerAdminOperationDetails(app);const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No outbound fetch allowed');};
 try{
 const dyP={keyword:'synthetic'},dy=await save('douyin','OWIBYU1V',dyP,parseDouyin('OWIBYU1V',{list:[{videoId:'123',content:'test',authorUid:'456'}]},dyP));
 const xhP={keyword:'synthetic'},xh=await save('xiaohongshu','384C6W6B',xhP,parseXiaohongshu('384C6W6B',{list:[{workId:'note1',workTitle:'test'}]},xhP));
 const wxP={keyword:'synthetic'},wx=await save('wechat','FVQ8D4W5',wxP,parseWechat('FVQ8D4W5',{list:[{workUuid:'uuid1',title:'test',workUrl:'https://mp.weixin.qq.com/s/Synthetic'}]},wxP));
 const ttP={secUserId:'456'},tt=await save('tiktok','R473NUE9',ttP,parseTiktok('R473NUE9',[{workId:'123',content:'test'}],ttP));
 const biP={mid:'456'},bi=await save('bilibili','VPA67I98',biP,parseBilibili('VPA67I98',{mid:'456',workList:[{bvId:'BV1234567890',title:'test'}]},biP));
 const wbP={searchType:'1',page:'1',keyword:'test'},wb=await save('weibo','TXQPVGJG',wbP,parseWeibo('TXQPVGJG',[{opusId:'123',text:'test'}],wbP));
 const qcP={keyword:'test',offset:'0',page:'1',sourceType:'video'},qc=await save('qichezhijia','CI7VW144',qcP,parseQichezhijia('CI7VW144',[{workId:'123',workType:'14',authorId:'456',title:'test',workUrl:'https://chejiahao.autohome.com.cn/info/123'}],qcP));
 const dcP={keyword:'test',offset:'0',sourceType:'2'},dc=await save('dongchedi','W86F8SSK',dcP,parseDongchedi('W86F8SSK',{workList:[{workId:'123',title:'test'}]},dcP));
 const ycP={keyword:'test',page:1,sourceType:'xinwen'},yc=await save('yiche','YIGCY5US',ycP,parseYiche('YIGCY5US',[{title:'test',workUrl:'https://news.yiche.com/zonghexinwen/20261021/999.html'}],ycP));
 const cases:[[typeof dy,string,Record<string,unknown>],...[typeof dy,string,Record<string,unknown>][]]=[[dy,'FK67XDVQ',{videoId:'123'}],[xh,'KR1LPTBF',{workId:'note1'}],[wx,'1LDQ7E1C',{workUuid:'uuid1'}],[tt,'6SE9WIHJ',{awemeId:'123'}],[bi,'TIN1NMTZ',{bvId:'BV1234567890'}],[wb,'API_1789098514899',{opusId:'123'}],[qc,'TE6AGWAF',{videoId:'123',videoType:4}],[dc,'QQ5E3EZ9',{workId:'123',workType:'video'}],[yc,'VYSP68M2',{url:'https://news.yiche.com/zonghexinwen/20261021/999.html'}]];
 const before=(await sql`SELECT (SELECT count(*) FROM operation_runs) runs,(SELECT count(*) FROM receipt_attempts) attempts`)[0];
 for(const [source,target,parameters] of cases){const result=await workDetailOptions(source.id),choice=result!.choices.find(c=>c.operationId===target);assert.ok(choice,target);assert.deepEqual(choice.parameters,parameters);assert.deepEqual(choice.fields,[]);assert.equal(choice.price.basis,'estimated');assert.equal(choice.purpose,'query');assert.equal(choice.price.amount===null||typeof choice.price.amount==='string',true);}
 assert.equal((await workDetailOptions(dy.id))!.choices.some(c=>c.operationId==='0OT1E306'),false);
 assert.equal((await workDetailOptions(wx.id))!.choices.some(c=>c.operationId==='XEO0QQNF'),false);assert.ok((await workDetailOptions(wx.id))!.choices.some(c=>c.operationId==='I3CIBRI2'));
 assert.deepEqual((await sql`SELECT (SELECT count(*) FROM operation_runs) runs,(SELECT count(*) FROM receipt_attempts) attempts`)[0],before);
 const qcArticleP={...qcP,sourceType:'article'},article=await save('qichezhijia','CI7VW144',qcArticleP,parseQichezhijia('CI7VW144',[{workId:'123',title:'test',workUrl:'https://chejiahao.autohome.com.cn/info/123'}],qcArticleP));
 const articleChoice=(await workDetailOptions(article.id))!.choices[0]!;assert.equal(articleChoice.operationId,'LLCI8QTE');assert.deepEqual(articleChoice.parameters,{workId:'123'});assert.deepEqual(articleChoice.fields,qichezhijiaDescriptors().find(d=>d.id==='LLCI8QTE')!.fields.filter(f=>f.name==='page'));assert.equal('default' in articleChoice.fields[0]!,false);
 const original=await save('qichezhijia','CI7VW144',qcP,parseQichezhijia('CI7VW144',[{workId:'123',workType:'3',authorId:'456',title:'test'}],qcP));assert.equal((await workDetailOptions(original.id))!.choices[0]!.parameters.videoType,0);
 const unknown=await save('dongchedi','W86F8SSK',{...dcP,sourceType:'1'},parseDongchedi('W86F8SSK',{workList:[{workId:'123',title:'test'}]},{...dcP,sourceType:'1'}));assert.deepEqual((await workDetailOptions(unknown.id))!.choices,[]);
 const growth=await save('douyin','WD6UT8DQ',{},parseDouyin('WD6UT8DQ',[{aweme_id:'123',share_url:'https://www.douyin.com/video/123'}],{}));assert.deepEqual((await workDetailOptions(growth.id))!.choices.map(c=>c.operationId),['0OT1E306','FK67XDVQ']);
 const missing=await save('douyin','OWIBYU1V',dyP,parseDouyin('OWIBYU1V',{list:[{content:'no identifier'}]},dyP));assert.deepEqual((await workDetailOptions(missing.id))!.choices,[]);
 const account=await save('weibo','TXQPVGJG',{...wbP,searchType:'3'},parseWeibo('TXQPVGJG',[{uid:'456',nickname:'account'}],{...wbP,searchType:'3'}));assert.deepEqual((await workDetailOptions(account.id))!.choices,[]);
 await sql`UPDATE operation_results SET data=jsonb_set(data,'{identity}','{"uid":"forged"}') WHERE id=${dy.id}`;assert.deepEqual((await workDetailOptions(dy.id))!.choices,[]);
 await sql`UPDATE operation_runs SET operation_key='redfox.platform.collection' WHERE id=${xh.runId}`;await sql`UPDATE operation_results SET provenance='{"sourcePageResultId":1}' WHERE id=${xh.id}`;assert.deepEqual((await workDetailOptions(xh.id))!.choices,[]);
 await sql`UPDATE receipts SET model='wrong' WHERE id=${tt.receiptId}`;await assert.rejects(workDetailOptions(tt.id),/回执/);
 await sql`UPDATE operation_results SET receipt_id=NULL WHERE id=${wb.id}`;await assert.rejects(workDetailOptions(wb.id),/回执/);
 const path=`/api/admin/operations/results/${bi.id}/detail-options`;config.devAdmin=null;assert.equal((await app.inject({url:path})).statusCode,401);config.devAdmin={displayName:'Synthetic options admin'};const reply=await app.inject({url:path});assert.equal(reply.statusCode,200,reply.body);assert.equal(reply.headers['cache-control'],'no-store');assert.deepEqual(reply.json(),await resultDetailOptions(bi.id));assert.equal((await app.inject({url:'/api/admin/operations/results/9007199254740991/detail-options'})).statusCode,404);assert.equal((await app.inject({url:`/api/admin/operations/results/${wb.id}/detail-options`})).statusCode,422);
 }finally{globalThis.fetch=originalFetch;config.devAdmin=null;await sql`DELETE FROM operation_results WHERE run_id IN ${sql(runs)}`;await sql`DELETE FROM operation_runs WHERE id IN ${sql(runs)}`;await sql`DELETE FROM receipts WHERE id IN ${sql(receipts)}`;await app.close();}
 }finally{await closeDb();}
});

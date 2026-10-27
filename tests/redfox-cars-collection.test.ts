import {tag} from './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {sql,closeDb} from '@aihot/backend/db';
import {config} from '@aihot/backend/config';
import {stopBoss} from '@aihot/backend/jobs/queue';
import {createPlatformSubscription,startPlatformSubscription} from '@aihot/backend/sources/platform-subscriptions';
import {executeOperationStep} from '@aihot/backend/providers/operations/execute';
const requests:{path:string;parameters:Record<string,unknown>;body:string}[]=[];
let respond:(p:Record<string,unknown>)=>unknown=()=>({});
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const url=new URL(req.url!,'http://localhost');const parameters=req.method==='GET'?Object.fromEntries(url.searchParams):JSON.parse(body);requests.push({path:url.pathname,parameters,body});res.end(JSON.stringify({code:url.pathname==='/story/api/dongchedi/searchWork'?200:2000,data:respond(parameters)}));});});
let budget:Record<string,unknown>;
before(async()=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.REDFOX_TEST_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.REDFOX_API_KEY='fake-cars-collection';process.env.REDFOX_CALLS_ENABLED='true';process.env.COLLECT_ENABLED='true';config.allowPrivateNetworkFetch=true;budget=(await sql`SELECT * FROM budgets WHERE service='redfox.collect'`)[0]!;await sql`UPDATE budgets SET per_minute=1000,per_hour=10000,per_day=100000 WHERE service='redfox.collect'`;});
after(async()=>{await sql`UPDATE budgets SET per_minute=${budget.per_minute as number},per_hour=${budget.per_hour as number},per_day=${budget.per_day as number} WHERE service='redfox.collect'`;process.env.REDFOX_CALLS_ENABLED='false';process.env.COLLECT_ENABLED='false';delete process.env.REDFOX_API_KEY;await new Promise<void>(r=>server.close(()=>r()));await stopBoss();await closeDb();});
const row=async(id:number)=>(await sql`SELECT * FROM operation_runs WHERE id=${id}`)[0]!;
const step=async(id:number)=>{const r=await row(id);await executeOperationStep(id,r.step_version,randomUUID());};
async function start(operationId:string,parameters:Record<string,unknown>,pages=2,items=10){const sub=await createPlatformSubscription({sourceId:await selectedSource(),name:tag(),operationId,parameters,enabled:true,limits:{pages,items,details:0}},'test',tag());return startPlatformSubscription(sub.id,'test',tag());}
async function finish(id:number){for(let i=0;i<30;i++){const r=await row(id);if(r.status!=='active')return r;await step(id);}throw new Error('Fixture exceeded bounded steps');}
test('domain author conflict is pending inside importer savepoint, next item commits and run completes',async()=>{
 const userId=tag(),workId=String(Date.now());respond=()=>({account:{userId,displayName:'Synthetic author'},workList:[{workId:workId+'1',authorId:'conflicting-'+tag(),title:'Rejected author',articleType:7,articleTypeStr:'ugc_article',workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${workId}1`},{workId:workId+'2',title:'Valid author',description:'<p>Complete body</p>',articleType:7,articleTypeStr:'ugc_article',workUrl:`https://www.dcdapp.com/motor/m/feed/detail?group_id=${workId}2`}]});
 const run=await start('API_1791793668086',{userId},1);assert.equal((await finish(run.id)).status,'completed');
 const results=await sql`SELECT * FROM operation_results WHERE run_id=${run.id} AND kind='dongchedi_work' ORDER BY id`;
 assert.equal(results[0]!.article_id,null);assert.match(results[0]!.data.pendingReason,/author conflicts/);assert.ok(results[1]!.article_id);assert.equal((await sql`SELECT count(*)::int n FROM source_account_bindings WHERE id_value=${results[0]!.data.record.authorId}`)[0]!.n,0);assert.equal((await sql`SELECT progress FROM collection_subscriptions WHERE id=${(await row(run.id)).subscription_id}`)[0]!.progress.items,3);
});
test('eight fixed collection adapters use collect receipts and exact original request parameters',async()=>{
 const cases:[string,Record<string,unknown>,unknown][]=[
 ['CI7VW144',{keyword:tag(),offset:'900719925474099300',page:'1',sourceType:'video'},[{workId:tag(),title:'Synthetic',workType:'3'}]],
 ['4BOZ9DLE',{authorId:tag(),page:1},{workList:[{workId:tag(),title:'Synthetic'}]}],
 ['W86F8SSK',{keyword:tag(),offset:'0',sourceType:'2'},{workList:[{workId:tag(),title:'Synthetic'}],hasMore:'0'}],
 ['API_1791793668086',{userId:'user-'+tag()},null],
 ['YIGCY5US',{keyword:tag(),page:1,sourceType:'xinwen'},[{workId:tag(),title:'Synthetic'}]],
 ['YGYYT0G0',{userId:tag(),timestamp:''},{workList:[{workId:tag(),title:'Synthetic',publishTime:'1700000000000'}]}],
 ['API_1789097000858',{keyWord:tag(),pn:'0'},[{opusId:tag(),title:'Synthetic'}]],
 ['API_1789095347662',{keword:tag(),offset:'0',vertical:'answer'},[{opusId:tag(),title:'Synthetic'}]],
 ];
 for(const [op,parameters,data] of cases){respond=()=>data??{account:{userId:parameters.userId},workList:[]};const initial=requests.length,run=await start(op,parameters,1);const done=await finish(run.id);assert.equal(done.status,'completed',`${op}: ${done.wait_reason}`);assert.equal(requests.length,initial+1,op);assert.deepEqual(requests.at(-1)!.parameters,parameters);const [receipt]=await sql`SELECT p.* FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.run_id=${run.id} LIMIT 1`;assert.equal(receipt!.service,'redfox.collect');assert.equal(receipt!.model,op);assert.ok(receipt!.cost!==null);}
});
test('documented decimal pagination and raw Yiche timestamp advance without number rounding',async()=>{
 const huge='900719925474099300';
 for(const [op,parameters,response,field,expected] of [
 ['CI7VW144',{keyword:tag(),offset:huge,page:huge,sourceType:'article'},[{workId:tag(),title:'Synthetic'}],'offset',String(BigInt(huge)+10n)],
 ['API_1789097000858',{keyWord:tag(),pn:huge},[{opusId:tag(),title:'Synthetic'}],'pn',String(BigInt(huge)+10n)],
 ['API_1789095347662',{keword:tag(),offset:huge},[{opusId:tag(),title:'Synthetic'}],'offset',String(BigInt(huge)+20n)],
 ['W86F8SSK',{keyword:tag(),offset:huge,sourceType:'1'},{workList:[{workId:tag(),title:'Synthetic'}],hasMore:'1'},'offset',String(BigInt(huge)+20n)],
 ['YIGCY5US',{keyword:tag(),page:99,sourceType:'xinwen'},[{workId:tag(),title:'Synthetic'}],'page',100],
 ['YGYYT0G0',{userId:tag(),timestamp:''},{workList:[{workId:tag(),title:'Synthetic',publishTime:' 1700000000000 '}]},'timestamp',' 1700000000000 '],
 ] as [string,Record<string,unknown>,unknown,string,string|number][]){respond=()=>response;const initial=requests.length,run=await start(op,parameters,2);assert.equal((await finish(run.id)).status,'completed',op);assert.equal(requests.length,initial+2,op);assert.equal(requests.at(-1)!.parameters[field],expected,op);if(op==='YGYYT0G0'){const summaries=await sql`SELECT data FROM operation_results WHERE run_id=${run.id} AND kind='query_summary' ORDER BY id`;assert.equal(summaries[1]!.data.nextParameters,null);}}
});

const chosenWorkSource=tag();
async function selectedSource(){await sql`INSERT INTO sources(id,name,kind,participation_mode,site_fulltext) VALUES (${chosenWorkSource},'Chosen work source','rss','isolated',false) ON CONFLICT(id) DO NOTHING`;return chosenWorkSource;}

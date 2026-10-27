import {douyinKeywordInput,douyinSearchRoute,douyinProviderVariant} from "../providers/agentkey/douyin-contract.ts";
import {CollectionDetailTarget,collectionDetailTargets} from "../providers/redfox/collection-detail.ts";
import {xResearchOperations} from "../providers/redfox/x-research-contract.ts";
import { qichezhijiaOperations } from "../providers/redfox/qichezhijia-contract.ts";
import { dongchediOperations } from "../providers/redfox/dongchedi-contract.ts";
import { yicheOperations } from "../providers/redfox/yiche-contract.ts";
import { baijiahaoOperations } from "../providers/redfox/baijiahao-contract.ts";
import { zhihuOperations } from "../providers/redfox/zhihu-contract.ts";
import { kuaishouOperations } from "../providers/redfox/kuaishou-contract.ts";
import { shipinhaoOperations } from "../providers/redfox/shipinhao-contract.ts";
import { toutiaoOperations } from "../providers/redfox/toutiao-contract.ts";
import { instagramOperations } from "../providers/redfox/instagram-contract.ts";
import { youtubeOperations } from "../providers/redfox/youtube-contract.ts";
import { bilibiliOperations } from "../providers/redfox/bilibili-contract.ts";
import { tiktokOperations } from "../providers/redfox/tiktok-contract.ts";
import { wechatOperations } from "../providers/redfox/wechat-contract.ts";
import { z } from "zod";
import { sql, type Db } from "../db.ts";
import { credential } from "../config.ts";
import type { PlatformCollectionProviderPreflight } from "@aihot/contracts/redfox";
import { UnsupportedReplacement } from "./x-replacement.ts";
import { stableJson,sha256 } from "../lib/ids.ts";
import { audit } from "../admin/auth.ts";
import { createSubscription } from "./subscriptions.ts";
import { createRun,StaleOperationError,type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { weiboOperations } from "../providers/redfox/weibo-contract.ts";
import { douyinOperations } from "../providers/redfox/douyin-contract.ts";
import { xiaohongshuOperations } from "../providers/redfox/xiaohongshu-contract.ts";
import {HotResearchOperationId,hotResearchCollectionSchemas,hotResearchDayParameters} from "../providers/redfox/hot-research-contract.ts";
export const collectionOperationIds=["TXQPVGJG","UAQ90A1F","QEQLCKD6","QSL2ZSXM","774OBKK0","OWIBYU1V","HUCIASU","I8P3HTVH","WD6UT8DQ","0ZB9S2FW","384C6W6B","047JJ3UA","3X8FGEEM","LBYLC5AK","XN3ULENA","P3W2W18P","AEA6YE0J","PW97QFBS","FVQ8D4W5","IE0887SO","ZIGAGYYT","OFFSPQ0U","DL4YNCTQ","R473NUE9","PXZXY8KQ","API_1790149158205","API_1790581450500","LEN9QXR3","VPA67I98","GC5SC5HS","GM0TISWI","28CFGF5I","R1IGR09H","E7G00COY","OVUTOTCV","27DQ6SF9","ZWR31P2A","CI7VW144","4BOZ9DLE","W86F8SSK","API_1791793668086","YIGCY5US","YGYYT0G0","API_1789097000858","API_1789095347662","5K5EG87P","9Y4EX7RW","W94P1QH1","S28Q6HUD"] as const;
export type CollectionPlatform="weibo"|"douyin"|"xiaohongshu"|"wechat"|"tiktok"|"bilibili"|"youtube"|"instagram"|"toutiao"|"shipinhao"|"kuaishou"|"qichezhijia"|"dongchedi"|"yiche"|"baijiahao"|"zhihu"|"x-research"|"hot-research";
export const platformCollectionProviderIds=["redfox","agentkey"] as const;
export type PlatformCollectionProviderId=typeof platformCollectionProviderIds[number];
const platformCollectionProviders=[{id:"redfox",label:"Redfox"}] as const;
/** Only advertise providers whose create, schedule and execution paths are all implemented for this operation. */
export function collectionProviderOptions(operationId:string){return operationId==="OWIBYU1V"?[...platformCollectionProviders,douyinProviderVariant]:platformCollectionProviders;}
function collectionExecution(provider:string,platform:string){
  if(provider==="agentkey"&&platform==="douyin")return douyinSearchRoute;
  if(provider==="redfox")return {operationKey:platform==="weibo"?"redfox.weibo.collection":"redfox.platform.collection",stepKey:platform==="weibo"?"redfox.weibo.page":"redfox.platform.page"};
  throw new StaleOperationError(`Unsupported collection provider: ${provider}`);
}
export function collectionContract(operationId:typeof collectionOperationIds[number]) {
  if(HotResearchOperationId.safeParse(operationId).success)return {platform:"hot-research" as const,schema:hotResearchCollectionSchemas[HotResearchOperationId.parse(operationId)]};
  if(operationId==="TXQPVGJG"||operationId==="UAQ90A1F")return {platform:"weibo" as const,schema:weiboOperations[operationId].schema};
  if(operationId in douyinOperations)return {platform:"douyin" as const,schema:douyinOperations[operationId as keyof typeof douyinOperations].schema};
  if(operationId in wechatOperations)return {platform:"wechat" as const,schema:wechatOperations[operationId as keyof typeof wechatOperations].schema};
  if(operationId in tiktokOperations)return {platform:"tiktok" as const,schema:tiktokOperations[operationId as keyof typeof tiktokOperations].schema};
  if(operationId in bilibiliOperations)return {platform:"bilibili" as const,schema:bilibiliOperations[operationId as keyof typeof bilibiliOperations].schema};
  if(operationId in youtubeOperations)return {platform:"youtube" as const,schema:youtubeOperations[operationId as keyof typeof youtubeOperations].schema};
  if(operationId in instagramOperations)return {platform:"instagram" as const,schema:instagramOperations[operationId as keyof typeof instagramOperations].schema};
  if(operationId in toutiaoOperations)return {platform:"toutiao" as const,schema:toutiaoOperations[operationId as keyof typeof toutiaoOperations].schema};
  if(operationId in shipinhaoOperations)return {platform:"shipinhao" as const,schema:shipinhaoOperations[operationId as keyof typeof shipinhaoOperations].schema};
  if(operationId in kuaishouOperations)return {platform:"kuaishou" as const,schema:kuaishouOperations[operationId as keyof typeof kuaishouOperations].schema};
  if(operationId in qichezhijiaOperations)return {platform:"qichezhijia" as const,schema:qichezhijiaOperations[operationId as keyof typeof qichezhijiaOperations].schema};
  if(operationId in dongchediOperations)return {platform:"dongchedi" as const,schema:dongchediOperations[operationId as keyof typeof dongchediOperations].schema};
  if(operationId in yicheOperations)return {platform:"yiche" as const,schema:yicheOperations[operationId as keyof typeof yicheOperations].schema};
  if(operationId in baijiahaoOperations)return {platform:"baijiahao" as const,schema:baijiahaoOperations[operationId as keyof typeof baijiahaoOperations].schema};
  if(operationId in zhihuOperations)return {platform:"zhihu" as const,schema:zhihuOperations[operationId as keyof typeof zhihuOperations].schema};
  if(operationId==="5K5EG87P")return {platform:"x-research" as const,schema:xResearchOperations["5K5EG87P"].schema};
  return {platform:"xiaohongshu" as const,schema:xiaohongshuOperations[operationId as keyof typeof xiaohongshuOperations].schema};
}
const Config=z.object({name:z.string().trim().min(1).max(100),provider:z.enum(platformCollectionProviderIds).default("redfox"),operationId:z.enum(collectionOperationIds),parameters:z.record(z.string(),z.unknown()),enabled:z.boolean().default(false),intervalMinutes:z.number().int().min(1).max(10080).optional(),enrichDetails:z.boolean().default(false),detailOperationId:CollectionDetailTarget.optional(),detailPage:z.number().int().safe().optional(),limits:z.object({pages:z.number().int().min(1).max(10),items:z.number().int().min(1).max(500),details:z.number().int().min(0).max(100)}).strict().default({pages:3,items:100,details:20})}).strict();
function validated(raw:unknown,onlyPlatform?:CollectionPlatform){
  const input=Config.parse(raw),contract=collectionContract(input.operationId);
  if(onlyPlatform && contract.platform!==onlyPlatform)throw new StaleOperationError("Operation is outside this platform endpoint");
  if(!collectionProviderOptions(input.operationId).some(provider=>provider.id===input.provider))throw new StaleOperationError("Provider is not available for this collection operation");
  const parameters=input.provider==="agentkey"?douyinKeywordInput.parse(input.parameters):contract.schema.parse(input.parameters);
  if(input.provider==="agentkey"&&(input.enrichDetails||input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("AgentKey search does not support detail enrichment");
  if(contract.platform==="weibo" && "searchType" in parameters && String(parameters.searchType)==="3")throw new StaleOperationError("Account search mode cannot collect material automatically");
  if(contract.platform==="x-research"&&!["Top","Latest"].includes(String((parameters as Record<string,unknown>).searchType??"Top")))throw new StaleOperationError("X search collection supports only Top or Latest");
  if(!input.enrichDetails&&(input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("Detail configuration requires enrichment");
  const target=input.detailOperationId??(input.enrichDetails&&input.operationId==="TXQPVGJG"?"API_1789098514899":undefined);
  if(input.enrichDetails&&(!target||!collectionDetailTargets(input.operationId,parameters).includes(target)))throw new StaleOperationError("Select an implemented detail operation for this source");
  if(target==="LLCI8QTE"&&input.detailPage===undefined||target!=="LLCI8QTE"&&input.detailPage!==undefined)throw new StaleOperationError("Only LLCI8QTE requires an explicit detail page");
  return {...input,parameters,intervalMinutes:input.intervalMinutes??(contract.platform==="hot-research"?60:15)};
}
export async function listPlatformSubscriptions(onlyPlatform?:CollectionPlatform){return sql`SELECT s.id,s.provider,s.platform,s.config->>'name' AS name,s.config->>'operationId' AS "operationId",s.config->'parameters' AS parameters,s.config->'enrichDetails' AS "enrichDetails",s.config->>'detailOperationId' AS "detailOperationId",s.config->'detailPage' AS "detailPage",s.enabled,s.interval_minutes AS "intervalMinutes",s.limits,s.edit_version AS "editVersion",s.execution_version AS "executionVersion",s.next_run_at AS "nextRunAt",CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'status',r.status,'step',r.step_key,'waitReason',r.wait_reason) END AS "activeRun" FROM collection_subscriptions s LEFT JOIN operation_runs r ON r.id=s.active_run_id WHERE s.control_source_id IS NULL AND (${onlyPlatform??null}::text IS NULL OR s.platform=${onlyPlatform??null}) ORDER BY s.id DESC`;}
export async function createPlatformSubscription(raw:unknown,actor:string,key:unknown,onlyPlatform?:CollectionPlatform){
  const input=validated(raw,onlyPlatform),clientKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const creationKey=stableJson([actor,clientKey]),hash=sha256(stableJson(input));
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`subscription:create:${creationKey}`},0))`;
    const [existing]=await tx`SELECT id,edit_version,creation_input_hash FROM collection_subscriptions WHERE creation_command_key=${creationKey}`;
    if(existing){if(existing.creation_input_hash!==hash)throw new StaleOperationError("Creation key reused with different subscription input");return {id:existing.id,editVersion:existing.edit_version};}
    const platform=collectionContract(input.operationId).platform,execution=collectionExecution(input.provider,platform);
    const id=await createSubscription(tx,{provider:input.provider,platform,operationKey:execution.operationKey,contractVersion:1,config:{name:input.name,operationId:input.operationId,parameters:input.parameters,enrichDetails:input.enrichDetails,...(input.detailOperationId?{detailOperationId:input.detailOperationId}:{}),...(input.detailPage!==undefined?{detailPage:input.detailPage}:{})},intervalMinutes:input.intervalMinutes,enabled:input.enabled,limits:input.limits});
    await tx`UPDATE collection_subscriptions SET next_run_at=${input.enabled?new Date():null},creation_command_key=${creationKey},creation_input_hash=${hash} WHERE id=${id}`;
    await audit(actor,"subscription.create",`subscription:${id}`,null,null,input,undefined,tx);return {id,editVersion:1};
  });
}
/** Compare only execution semantics; persisted configuration/audit and creation hashes remain exact. */
function executionConfig(config:Record<string,unknown>){
  return {...config,name:undefined,...(config.operationId==="TXQPVGJG"&&config.enrichDetails===true&&config.detailOperationId===undefined?{detailOperationId:"API_1789098514899"}:{})};
}
export async function updatePlatformSubscription(id:number,raw:unknown,actor:string,onlyPlatform?:CollectionPlatform){const request=z.object({editVersion:z.number().int().positive(),config:Config}).strict().parse(raw),input=validated(request.config,onlyPlatform);return sql.begin(async tx=>{
  const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE id=${id} AND control_source_id IS NULL AND (${onlyPlatform??null}::text IS NULL OR platform=${onlyPlatform??null}) FOR UPDATE`;if(!sub)return null;if(sub.edit_version!==request.editVersion)throw new StaleOperationError("Subscription changed; refresh first");
  if(sub.provider!==input.provider)throw new StaleOperationError("Collection provider cannot be changed in the subscription editor");
  if(sub.platform!==collectionContract(input.operationId).platform)throw new StaleOperationError("Subscription platform cannot change");
  const execution=collectionExecution(input.provider,sub.platform);
  if(sub.operation_key!==execution.operationKey)throw new StaleOperationError("Subscription execution contract changed");
  const config={name:input.name,operationId:input.operationId,parameters:input.parameters,enrichDetails:input.enrichDetails,...(input.detailOperationId?{detailOperationId:input.detailOperationId}:{}),...(input.detailPage!==undefined?{detailPage:input.detailPage}:{})};
  const changed=stableJson(executionConfig(sub.config))!==stableJson(executionConfig(config)) || stableJson(sub.limits)!==stableJson(input.limits) || sub.enabled!==input.enabled;
  if(changed && sub.active_run_id)await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,wait_reason='Subscription execution configuration changed',next_attempt_at=NULL WHERE id=${sub.active_run_id} AND status NOT IN ('completed','failed')`;
  await tx`UPDATE collection_subscriptions SET config=${tx.json(config)},limits=${tx.json(input.limits)},enabled=${input.enabled},interval_minutes=${input.intervalMinutes},edit_version=edit_version+1,execution_version=execution_version+${changed?1:0},active_run_id=CASE WHEN ${changed} THEN NULL ELSE active_run_id END,next_run_at=${input.enabled?new Date(Date.now()+input.intervalMinutes*60_000):null},updated_at=now() WHERE id=${id}`;
  await audit(actor,"subscription.update",`subscription:${id}`,null,{config:sub.config,limits:sub.limits,enabled:sub.enabled,intervalMinutes:sub.interval_minutes},input,undefined,tx);return {id,editVersion:sub.edit_version+1};
});}
const ProviderPreflightInput=z.strictObject({editVersion:z.number().int().positive(),targetProvider:z.enum(platformCollectionProviderIds)});
const ProviderSwitchInput=ProviderPreflightInput.extend({reason:z.string().trim().min(1).max(500)});
interface ProviderSwitchSnapshot {
  id:number;provider:string;platform:string;operation_key:string;contract_version:number;config:Record<string,unknown>;
  enabled:boolean;interval_minutes:number;limits:{pages:number;items:number;details:number};progress:Record<string,unknown>;
  edit_version:number;execution_version:number;active_run_id:number|null;
}
function providerPreflight(sub:ProviderSwitchSnapshot,targetProvider:PlatformCollectionProviderId){
  const checks:PlatformCollectionProviderPreflight["checks"]=[];
  const check=(key:PlatformCollectionProviderPreflight["checks"][number]["key"],ok:boolean,evidence:string,failed:"unsupported"|"unavailable"="unsupported")=>checks.push({key,conclusion:ok?"supported":failed,evidence});
  const operation=sub.config.operationId;
  const operationSupported=operation==="OWIBYU1V"&&sub.platform==="douyin"&&platformCollectionProviderIds.includes(sub.provider as PlatformCollectionProviderId)&&targetProvider!==sub.provider&&collectionProviderOptions(operation).some(p=>p.id===targetProvider);
  check("operation",operationSupported,operationSupported?"同一抖音广域搜索操作支持显式切换":targetProvider===sub.provider?"请选择不同的目标供应商":"仅开放 OWIBYU1V 抖音广域搜索的 Redfox / AgentKey 双向切换");
  const parameters=(targetProvider==="agentkey"?douyinKeywordInput:douyinOperations.OWIBYU1V.schema).safeParse(sub.config.parameters);
  check("parameters",parameters.success,parameters.success?"完整保留已保存的关键词条件":"目标不能完整承接已保存参数；请先编辑并保存为目标支持的条件，不会静默删除精准匹配、日期或分页参数");
  const details=!sub.config.enrichDetails&&sub.config.detailOperationId===undefined&&sub.config.detailPage===undefined;
  check("details",details,details?"当前没有需要迁移的详情补全":"此切换路径不承接详情补全，请先显式关闭并保存");
  const hasCredential=targetProvider==="agentkey"?!!process.env.AGENTKEY_API_KEY?.trim()&&!/[\r\n]/.test(process.env.AGENTKEY_API_KEY):!!credential("collectors","REDFOX_API_KEY");
  check("credentials",hasCredential,hasCredential?"服务端已配置目标凭证；预检不请求供应商":`服务端未配置有效的 ${targetProvider==="agentkey"?"AGENTKEY_API_KEY":"REDFOX_API_KEY"} 凭证`,"unavailable");
  let input:ReturnType<typeof validated>|undefined;
  if(operationSupported&&parameters.success&&details){
    try{
      if(sub.contract_version!==1||sub.operation_key!==collectionExecution(sub.provider,sub.platform).operationKey)throw new Error("Current contract changed");
      input=validated({...sub.config,provider:targetProvider,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits});
      collectionExecution(targetProvider,sub.platform);
    }catch{/* A stored incompatible contract must be repaired explicitly, never translated by dropping fields. */}
  }
  check("execution",!!input,input?"目标已有固定输入/输出合同、调度、执行与恢复路径；外发仍受独立安全阀和预算控制":"当前配置或合同未通过目标执行路径校验");
  const preflight:PlatformCollectionProviderPreflight={subscriptionId:sub.id,editVersion:sub.edit_version,currentProvider:sub.provider,targetProvider,supported:checks.every(c=>c.conclusion==="supported"),checks,
    impact:{activeRunId:sub.active_run_id,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits,note:"保留同一订阅、周期、限额和全部历史；停止旧在途任务，已发请求仍可能完成计费。旧游标不迁移，目标从合法起点开始；数据覆盖与时效可能变化，不自动回切。"}};
  return {preflight,input};
}
export async function preflightPlatformSubscriptionProvider(id:number,raw:unknown,db:Db=sql){
  const request=ProviderPreflightInput.parse(raw);
  const [sub]=await db<ProviderSwitchSnapshot[]>`SELECT * FROM collection_subscriptions WHERE id=${id} AND control_source_id IS NULL`;
  if(!sub)return null;
  if(sub.edit_version!==request.editVersion)throw new StaleOperationError("Subscription changed; refresh provider preflight");
  return providerPreflight(sub,request.targetProvider).preflight;
}
export async function switchPlatformSubscriptionProvider(id:number,raw:unknown,actor:string){
  const request=ProviderSwitchInput.parse(raw);
  return sql.begin(async tx=>{
    const [sub]=await tx<ProviderSwitchSnapshot[]>`SELECT * FROM collection_subscriptions WHERE id=${id} AND control_source_id IS NULL FOR UPDATE`;
    if(!sub)return null;
    if(sub.edit_version!==request.editVersion)throw new StaleOperationError("Subscription changed; refresh provider preflight");
    const {preflight,input}=providerPreflight(sub,request.targetProvider);
    if(!preflight.supported||!input)throw new UnsupportedReplacement(preflight.checks.filter(c=>c.conclusion!=="supported").map(c=>c.evidence).join("；"));
    const {provider,enabled:_enabled,intervalMinutes:_interval,limits:_limits,...config}=input;
    const operationKey=collectionExecution(provider,sub.platform).operationKey;
    if(sub.active_run_id)await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,wait_reason='Subscription provider changed',next_attempt_at=NULL,job_id=NULL,updated_at=now() WHERE id=${sub.active_run_id} AND status NOT IN ('completed','failed')`;
    await tx`UPDATE collection_subscriptions SET provider=${provider},operation_key=${operationKey},config=${tx.json(config)},progress='{}'::jsonb,execution_version=execution_version+1,edit_version=edit_version+1,active_run_id=NULL,next_run_at=CASE WHEN enabled THEN now()+interval_minutes*interval '1 minute' ELSE NULL END,updated_at=now() WHERE id=${id}`;
    await audit(actor,"subscription.switch_provider",`subscription:${id}`,request.reason,{provider:sub.provider,operationKey:sub.operation_key,config:sub.config,progress:sub.progress,activeRunId:sub.active_run_id},{provider,operationKey,config,progress:{},activeRunId:null},undefined,tx);
    return {id,editVersion:sub.edit_version+1,executionVersion:sub.execution_version+1,config:input};
  });
}
export async function startPlatformSubscription(id:number,actor:string,key:unknown,onlyPlatform?:CollectionPlatform){const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),intent={subscriptionId:id};return sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
  const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;if(existing){if(onlyPlatform && existing.input.platform!==onlyPlatform)throw new StaleOperationError("Subscription is outside this platform endpoint");if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
  const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE id=${id} AND control_source_id IS NULL AND (${onlyPlatform??null}::text IS NULL OR platform=${onlyPlatform??null}) FOR UPDATE`;if(!sub)throw new StaleOperationError("Subscription not found");
  if(!collectionProviderOptions(String(sub.config.operationId)).some(provider=>provider.id===sub.provider))throw new StaleOperationError("Subscription provider is no longer available");
  const execution=collectionExecution(sub.provider,sub.platform);
  if(sub.operation_key!==execution.operationKey)throw new StaleOperationError("Subscription execution contract changed");
  const parameters=sub.platform==="hot-research"?hotResearchDayParameters(HotResearchOperationId.parse(sub.config.operationId),sub.config.parameters,new Date()):sub.config.parameters;
  const run=await createRun(tx,{actor,commandKey,provider:sub.provider,operationKey:sub.operation_key,contractVersion:1,subscriptionIds:[id],stepKey:execution.stepKey,input:{...(sub.provider==="agentkey"?{tool:douyinSearchRoute.tool,upstream:"TikHub"}:{}),commandIntent:intent,mode:"collection",platform:sub.platform,...sub.config,parameters,window:`subscription:${id}:${commandKey}`},limits:{...sub.limits,retries:3}});
  await queueOperationStep(tx,run.id);return run;
});}
export async function schedulePlatformSubscriptions(){
  if(process.env.COLLECT_ENABLED==="false")return 0;
  const [unknown]=await sql`SELECT id,provider FROM collection_subscriptions WHERE control_source_id IS NULL AND enabled AND active_run_id IS NULL AND next_run_at<=now() AND provider NOT IN ('redfox','agentkey') ORDER BY next_run_at,id LIMIT 1`;
  if(unknown)throw new Error(`Unsupported collection provider: ${unknown.provider} (subscription ${unknown.id})`);
  const providers=platformCollectionProviderIds.filter(provider=>provider==="agentkey"?process.env.AGENTKEY_CALLS_ENABLED==="true":process.env.REDFOX_CALLS_ENABLED==="true");
  if(!providers.length)return 0;
  const rows=await sql`SELECT id,provider,platform,next_run_at FROM collection_subscriptions WHERE control_source_id IS NULL AND enabled AND active_run_id IS NULL AND next_run_at<=now() AND provider IN ${sql(providers)} ORDER BY next_run_at,id LIMIT 100`;
  let count=0;
  for(const sub of rows){
    try{await startPlatformSubscription(sub.id,"schedule",`${sub.platform}:${sub.id}:${sub.next_run_at.toISOString()}`);count++;}
    catch(error){if(!(error instanceof StaleOperationError))throw error;}
  }
  return count;
}

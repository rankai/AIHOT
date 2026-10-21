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
import { sql } from "../db.ts";
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
const Config=z.object({name:z.string().trim().min(1).max(100),operationId:z.enum(collectionOperationIds),parameters:z.record(z.string(),z.unknown()),enabled:z.boolean().default(false),intervalMinutes:z.number().int().min(1).max(10080).optional(),enrichDetails:z.boolean().default(false),detailOperationId:CollectionDetailTarget.optional(),detailPage:z.number().int().safe().optional(),limits:z.object({pages:z.number().int().min(1).max(10),items:z.number().int().min(1).max(500),details:z.number().int().min(0).max(100)}).strict().default({pages:3,items:100,details:20})}).strict();
function validated(raw:unknown,onlyPlatform?:CollectionPlatform){
  const input=Config.parse(raw),contract=collectionContract(input.operationId);
  if(onlyPlatform && contract.platform!==onlyPlatform)throw new StaleOperationError("Operation is outside this platform endpoint");
  const parameters=contract.schema.parse(input.parameters);
  if(contract.platform==="weibo" && "searchType" in parameters && String(parameters.searchType)==="3")throw new StaleOperationError("Account search mode cannot collect material automatically");
  if(contract.platform==="x-research"&&!["Top","Latest"].includes(String((parameters as Record<string,unknown>).searchType??"Top")))throw new StaleOperationError("X search collection supports only Top or Latest");
  if(!input.enrichDetails&&(input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("Detail configuration requires enrichment");
  const target=input.detailOperationId??(input.enrichDetails&&input.operationId==="TXQPVGJG"?"API_1789098514899":undefined);
  if(input.enrichDetails&&(!target||!collectionDetailTargets(input.operationId,parameters).includes(target)))throw new StaleOperationError("Select an implemented detail operation for this source");
  if(target==="LLCI8QTE"&&input.detailPage===undefined||target!=="LLCI8QTE"&&input.detailPage!==undefined)throw new StaleOperationError("Only LLCI8QTE requires an explicit detail page");
  return {...input,parameters,intervalMinutes:input.intervalMinutes??(contract.platform==="hot-research"?60:15)};
}
export async function listPlatformSubscriptions(onlyPlatform?:CollectionPlatform){return sql`SELECT s.id,s.platform,s.config->>'name' AS name,s.config->>'operationId' AS "operationId",s.config->'parameters' AS parameters,s.config->'enrichDetails' AS "enrichDetails",s.config->>'detailOperationId' AS "detailOperationId",s.config->'detailPage' AS "detailPage",s.enabled,s.interval_minutes AS "intervalMinutes",s.limits,s.edit_version AS "editVersion",s.execution_version AS "executionVersion",s.next_run_at AS "nextRunAt",CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'status',r.status,'step',r.step_key,'waitReason',r.wait_reason) END AS "activeRun" FROM collection_subscriptions s LEFT JOIN operation_runs r ON r.id=s.active_run_id WHERE s.operation_key IN ('redfox.weibo.collection','redfox.platform.collection') AND (${onlyPlatform??null}::text IS NULL OR s.platform=${onlyPlatform??null}) ORDER BY s.id DESC`;}
export async function createPlatformSubscription(raw:unknown,actor:string,key:unknown,onlyPlatform?:CollectionPlatform){
  const input=validated(raw,onlyPlatform),clientKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const creationKey=stableJson([actor,clientKey]),hash=sha256(stableJson(input));
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`subscription:create:${creationKey}`},0))`;
    const [existing]=await tx`SELECT id,edit_version,creation_input_hash FROM collection_subscriptions WHERE creation_command_key=${creationKey}`;
    if(existing){if(existing.creation_input_hash!==hash)throw new StaleOperationError("Creation key reused with different subscription input");return {id:existing.id,editVersion:existing.edit_version};}
    const platform=collectionContract(input.operationId).platform;
    const id=await createSubscription(tx,{provider:"redfox",platform,operationKey:platform==="weibo"?"redfox.weibo.collection":"redfox.platform.collection",contractVersion:1,config:{name:input.name,operationId:input.operationId,parameters:input.parameters,enrichDetails:input.enrichDetails,...(input.detailOperationId?{detailOperationId:input.detailOperationId}:{}),...(input.detailPage!==undefined?{detailPage:input.detailPage}:{})},intervalMinutes:input.intervalMinutes,enabled:input.enabled,limits:input.limits});
    await tx`UPDATE collection_subscriptions SET next_run_at=${input.enabled?new Date():null},creation_command_key=${creationKey},creation_input_hash=${hash} WHERE id=${id}`;
    await audit(actor,"subscription.create",`subscription:${id}`,null,null,input,undefined,tx);return {id,editVersion:1};
  });
}
/** Compare only execution semantics; persisted configuration/audit and creation hashes remain exact. */
function executionConfig(config:Record<string,unknown>){
  return {...config,name:undefined,...(config.operationId==="TXQPVGJG"&&config.enrichDetails===true&&config.detailOperationId===undefined?{detailOperationId:"API_1789098514899"}:{})};
}
export async function updatePlatformSubscription(id:number,raw:unknown,actor:string,onlyPlatform?:CollectionPlatform){const request=z.object({editVersion:z.number().int().positive(),config:Config}).strict().parse(raw),input=validated(request.config,onlyPlatform);return sql.begin(async tx=>{
  const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE id=${id} AND operation_key IN ('redfox.weibo.collection','redfox.platform.collection') AND (${onlyPlatform??null}::text IS NULL OR platform=${onlyPlatform??null}) FOR UPDATE`;if(!sub)return null;if(sub.edit_version!==request.editVersion)throw new StaleOperationError("Subscription changed; refresh first");
  if(sub.platform!==collectionContract(input.operationId).platform)throw new StaleOperationError("Subscription platform cannot change");
  const config={name:input.name,operationId:input.operationId,parameters:input.parameters,enrichDetails:input.enrichDetails,...(input.detailOperationId?{detailOperationId:input.detailOperationId}:{}),...(input.detailPage!==undefined?{detailPage:input.detailPage}:{})};
  const changed=stableJson(executionConfig(sub.config))!==stableJson(executionConfig(config)) || stableJson(sub.limits)!==stableJson(input.limits) || sub.enabled!==input.enabled;
  if(changed && sub.active_run_id)await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,wait_reason='Subscription execution configuration changed',next_attempt_at=NULL WHERE id=${sub.active_run_id} AND status NOT IN ('completed','failed')`;
  await tx`UPDATE collection_subscriptions SET config=${tx.json(config)},limits=${tx.json(input.limits)},enabled=${input.enabled},interval_minutes=${input.intervalMinutes},edit_version=edit_version+1,execution_version=execution_version+${changed?1:0},active_run_id=CASE WHEN ${changed} THEN NULL ELSE active_run_id END,next_run_at=${input.enabled?new Date(Date.now()+input.intervalMinutes*60_000):null},updated_at=now() WHERE id=${id}`;
  await audit(actor,"subscription.update",`subscription:${id}`,null,{config:sub.config,limits:sub.limits,enabled:sub.enabled,intervalMinutes:sub.interval_minutes},input,undefined,tx);return {id,editVersion:sub.edit_version+1};
});}
export async function startPlatformSubscription(id:number,actor:string,key:unknown,onlyPlatform?:CollectionPlatform){const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key),intent={subscriptionId:id};return sql.begin(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`operation:${actor}:${commandKey}`}))`;
  const [existing]=await tx<RunRow[]>`SELECT * FROM operation_runs WHERE actor=${actor} AND command_key=${commandKey}`;if(existing){if(onlyPlatform && existing.input.platform!==onlyPlatform)throw new StaleOperationError("Subscription is outside this platform endpoint");if(stableJson(existing.input.commandIntent)!==stableJson(intent))throw new StaleOperationError("Command key reused with different input");return existing;}
  const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE id=${id} AND operation_key IN ('redfox.weibo.collection','redfox.platform.collection') AND (${onlyPlatform??null}::text IS NULL OR platform=${onlyPlatform??null}) FOR UPDATE`;if(!sub)throw new StaleOperationError("Subscription not found");
  const parameters=sub.platform==="hot-research"?hotResearchDayParameters(HotResearchOperationId.parse(sub.config.operationId),sub.config.parameters,new Date()):sub.config.parameters;
  const run=await createRun(tx,{actor,commandKey,provider:"redfox",operationKey:sub.operation_key,contractVersion:1,subscriptionIds:[id],stepKey:sub.platform==="weibo"?"redfox.weibo.page":"redfox.platform.page",input:{commandIntent:intent,mode:"collection",platform:sub.platform,...sub.config,parameters,window:`subscription:${id}:${commandKey}`},limits:{...sub.limits,retries:3}});
  await queueOperationStep(tx,run.id);return run;
});}
export async function schedulePlatformSubscriptions(){if(process.env.COLLECT_ENABLED==="false" || process.env.REDFOX_CALLS_ENABLED!=="true")return 0;const rows=await sql`SELECT id,platform,next_run_at FROM collection_subscriptions WHERE operation_key IN ('redfox.weibo.collection','redfox.platform.collection') AND enabled AND active_run_id IS NULL AND next_run_at<=now() ORDER BY next_run_at,id LIMIT 100`;let count=0;for(const sub of rows){try{await startPlatformSubscription(sub.id,"schedule",`${sub.platform}:${sub.id}:${sub.next_run_at.toISOString()}`);count++;}catch(error){if(!(error instanceof StaleOperationError))throw error;}}return count;}

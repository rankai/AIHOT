import {videoDownloadCapability} from "./subscription-video-candidates.ts";
import {videoDownloadSummaries} from "../providers/operations/read.ts";
import {xCollectionIds,xCollectionSearchInput,agentKeyXOperations,xProviderVariants} from '../providers/agentkey/x-contract.ts';
import {weiboCollectionIds,weiboEnrichmentIds,weiboSearchInput,agentKeyWeiboOperations,weiboProviderVariants} from "../providers/agentkey/weibo-contract.ts";
import {bilibiliCollectionIds,bilibiliEnrichmentIds,agentKeyBilibiliOperations,bilibiliProviderVariants} from "../providers/agentkey/bilibili-contract.ts";
import {xiaohongshuCollectionIds,agentKeyXiaohongshuOperations,xiaohongshuProviderVariants} from "../providers/agentkey/xiaohongshu-contract.ts";
import {agentKeyOperation} from "../providers/agentkey/routes.ts";
import {toutiaoCommentsRoute,toutiaoCommentsInput,toutiaoProviderVariants} from "../providers/agentkey/toutiao-contract.ts";
import {douyinSnapshotOperations,douyinSnapshotCollectionIds,douyinSnapshotVariant,douyinKeywordInput,douyinSearchRoute,douyinProviderVariant,douyinAccountPostsVariant,douyinDetailVariant,douyinAccountSearchVariant,douyinAccountPostsInput} from "../providers/agentkey/douyin-contract.ts";
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
import { contentSubscription, createSubscription } from "./subscriptions.ts";
import { createRun,StaleOperationError,type RunRow } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import { weiboOperations } from "../providers/redfox/weibo-contract.ts";
import { douyinOperations } from "../providers/redfox/douyin-contract.ts";
import { xiaohongshuOperations } from "../providers/redfox/xiaohongshu-contract.ts";
import {HotResearchOperationId,hotResearchCollectionSchemas,hotResearchDayParameters} from "../providers/redfox/hot-research-contract.ts";
export const collectionOperationIds=[...xCollectionIds,"weibo.account_posts","weibo.comments","weibo.following","weibo.related_search","bilibili.typed_search","bilibili.comments","bilibili.comment_replies","bilibili.relation_stats","bilibili.dynamics","bilibili.trending","bilibili.hot_search","xiaohongshu.topic_posts","xiaohongshu.comments","xiaohongshu.recommendations","toutiao.comments",...douyinSnapshotCollectionIds,"TXQPVGJG","UAQ90A1F","QEQLCKD6","QSL2ZSXM","774OBKK0","OWIBYU1V","HUCIASU","I8P3HTVH","WD6UT8DQ","0ZB9S2FW","384C6W6B","047JJ3UA","3X8FGEEM","LBYLC5AK","XN3ULENA","P3W2W18P","AEA6YE0J","PW97QFBS","FVQ8D4W5","IE0887SO","ZIGAGYYT","OFFSPQ0U","DL4YNCTQ","R473NUE9","PXZXY8KQ","API_1790149158205","API_1790581450500","LEN9QXR3","VPA67I98","GC5SC5HS","GM0TISWI","28CFGF5I","R1IGR09H","E7G00COY","OVUTOTCV","27DQ6SF9","ZWR31P2A","CI7VW144","4BOZ9DLE","W86F8SSK","API_1791793668086","YIGCY5US","YGYYT0G0","API_1789097000858","API_1789095347662","5K5EG87P","9Y4EX7RW","W94P1QH1","S28Q6HUD"] as const;
export type CollectionPlatform="weibo"|"douyin"|"xiaohongshu"|"wechat"|"tiktok"|"bilibili"|"youtube"|"instagram"|"toutiao"|"shipinhao"|"kuaishou"|"qichezhijia"|"dongchedi"|"yiche"|"baijiahao"|"zhihu"|"x-research"|"hot-research";
export const platformCollectionProviderIds=["redfox","agentkey"] as const;
export type PlatformCollectionProviderId=typeof platformCollectionProviderIds[number];
const platformCollectionProviders=[{id:"redfox",label:"Redfox"}] as const;
/** Query variants also serve forms for nonschedulable operations; scheduling remains explicitly whitelisted below. */
export function collectionProviderOptions(operationId:string){const x=xProviderVariants.find(v=>v.operationId===operationId);if(x)return operationId==="5K5EG87P"?[...platformCollectionProviders,x]:[x];const weibo=weiboProviderVariants.find(v=>v.operationId===operationId);if(weibo)return operationId.startsWith("weibo.")?[weibo]:[...platformCollectionProviders,weibo];const bili=bilibiliProviderVariants.find(v=>v.operationId===operationId);if(bili)return operationId.startsWith("bilibili.")?[bili]:[...platformCollectionProviders,bili];const xhs=xiaohongshuProviderVariants.find(v=>v.operationId===operationId);if(xhs)return operationId.startsWith("xiaohongshu.")?[xhs]:[...platformCollectionProviders,xhs];const toutiao=toutiaoProviderVariants.find(v=>v.operationId===operationId);if(toutiao)return operationId==="PAB6Z75Y"?[...platformCollectionProviders,toutiao]:[toutiao];const snapshot=douyinSnapshotVariant(operationId);if(snapshot)return operationId==="XUT4CECZ"?[...platformCollectionProviders,snapshot]:[snapshot];return operationId==="OWIBYU1V"?[...platformCollectionProviders,douyinProviderVariant]:operationId==="QEQLCKD6"?[...platformCollectionProviders,douyinAccountPostsVariant]:operationId==="FK67XDVQ"?[...platformCollectionProviders,douyinDetailVariant]:operationId==="P5CHB3BZ"?[...platformCollectionProviders,douyinAccountSearchVariant]:platformCollectionProviders;}
function collectionExecution(provider:string,platform:string,operationId:unknown){
  if(provider==="agentkey"&&platform==="x-research"&&(xCollectionIds as readonly string[]).includes(String(operationId)))return agentKeyOperation(operationId)!.route;
  if(provider==="agentkey"&&platform==="weibo"&&(weiboCollectionIds as readonly string[]).includes(String(operationId)))return agentKeyOperation(operationId)!.route;
  if(provider==="agentkey"&&platform==="bilibili"&&(bilibiliCollectionIds as readonly string[]).includes(String(operationId)))return agentKeyOperation(operationId)!.route;
  if(provider==="agentkey"&&platform==="xiaohongshu"&&(xiaohongshuCollectionIds as readonly string[]).includes(String(operationId)))return agentKeyOperation(operationId)!.route;
  if(provider==="agentkey"&&platform==="toutiao"&&operationId==="toutiao.comments")return toutiaoCommentsRoute;
  if(provider==="agentkey"&&platform==="douyin"&&["OWIBYU1V","QEQLCKD6",...douyinSnapshotCollectionIds].includes(String(operationId)))return agentKeyOperation(operationId)!.route;
  if(provider==="redfox")return {operationKey:platform==="weibo"?"redfox.weibo.collection":"redfox.platform.collection",stepKey:platform==="weibo"?"redfox.weibo.page":"redfox.platform.page"};
  throw new StaleOperationError(`Unsupported collection provider: ${provider}`);
}
export function collectionContract(operationId:typeof collectionOperationIds[number]) {
  const x=agentKeyXOperations.find(o=>o.operationId===operationId&&o.operationId!=="5K5EG87P");
  if(x)return {platform:"x-research" as const,schema:x.schema};
  const weibo=agentKeyWeiboOperations.find(o=>o.operationId===operationId&&o.operationId.startsWith("weibo."));
  if(weibo)return {platform:"weibo" as const,schema:weibo.schema};
  const bili=agentKeyBilibiliOperations.find(o=>o.operationId===operationId&&o.operationId.startsWith("bilibili."));
  if(bili)return {platform:"bilibili" as const,schema:bili.schema};
  const xhs=agentKeyXiaohongshuOperations.find(o=>o.operationId===operationId&&o.operationId.startsWith("xiaohongshu."));
  if(xhs)return {platform:"xiaohongshu" as const,schema:xhs.schema};
  if(operationId==="toutiao.comments")return {platform:"toutiao" as const,schema:toutiaoCommentsInput};
  const snapshot=douyinSnapshotOperations.find(o=>o.operationId===operationId);
  if(snapshot)return {platform:"douyin" as const,schema:snapshot.schema};
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
const Config=z.object({sourceId:z.string().trim().min(1).max(200).optional(),name:z.string().trim().min(1).max(100),provider:z.enum(platformCollectionProviderIds).default("redfox"),operationId:z.enum(collectionOperationIds),parameters:z.record(z.string(),z.unknown()),enabled:z.boolean().default(false),intervalMinutes:z.number().int().min(1).max(10080).optional(),enrichDetails:z.boolean().default(false),autoDownloadVideo:z.boolean().default(false),detailOperationId:CollectionDetailTarget.optional(),detailPage:z.number().int().safe().optional(),limits:z.object({pages:z.number().int().min(1).max(10),items:z.number().int().min(1).max(500),details:z.number().int().min(0).max(100)}).strict().default({pages:3,items:100,details:20})}).strict();
function validated(raw:unknown,onlyPlatform?:CollectionPlatform){
  const input=Config.parse(raw),contract=collectionContract(input.operationId);
  if(onlyPlatform && contract.platform!==onlyPlatform)throw new StaleOperationError("Operation is outside this platform endpoint");
  if(!collectionProviderOptions(input.operationId).some(provider=>provider.id===input.provider))throw new StaleOperationError("Provider is not available for this collection operation");
  const x=input.provider==="agentkey"&&(xCollectionIds as readonly string[]).includes(input.operationId);
  if(x&&(raw as {limits?:unknown}).limits!==undefined&&(input.limits.pages!==1||input.limits.details!==0))throw new StaleOperationError("X snapshots require one homepage and zero details");
  if(x&&(input.enrichDetails||input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("X snapshots do not support detail enrichment");
  const weibo=input.provider==="agentkey"&&(weiboCollectionIds as readonly string[]).includes(input.operationId);
  if(weibo&&(raw as {limits?:unknown}).limits!==undefined&&input.limits.pages!==1)throw new StaleOperationError("Weibo collection supports exactly one homepage per run");
  const weiboEnrichment=weibo&&(weiboEnrichmentIds as readonly string[]).includes(input.operationId);
  if(weibo&&!weiboEnrichment&&(input.enrichDetails||input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("Weibo research snapshots do not support detail enrichment");
  const bili=input.provider==="agentkey"&&(bilibiliCollectionIds as readonly string[]).includes(input.operationId);
  if(bili&&(raw as {limits?:unknown}).limits!==undefined&&input.limits.pages!==1)throw new StaleOperationError("Bilibili collection supports exactly one homepage per run");
  const xhs=input.provider==="agentkey"&&(xiaohongshuCollectionIds as readonly string[]).includes(input.operationId);
  const biliEnrichment=bili&&(bilibiliEnrichmentIds as readonly string[]).includes(input.operationId);
  const snapshot=input.provider==="agentkey"&&(["toutiao.comments",...douyinSnapshotCollectionIds,"xiaohongshu.topic_posts","xiaohongshu.comments","xiaohongshu.recommendations"] as readonly string[]).includes(input.operationId);
  if((snapshot||bili&&!biliEnrichment)&&(input.enrichDetails||input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("Single-page snapshots do not support detail enrichment");
  const parameters=input.provider==="agentkey"?agentKeyOperation(input.operationId)!.querySchema.parse(input.parameters):contract.schema.parse(input.parameters);
  if(x&&input.operationId==="5K5EG87P")xCollectionSearchInput.parse(parameters);
  if(input.provider==="agentkey"&&input.operationId==="OWIBYU1V"&&(input.enrichDetails||input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("AgentKey search does not support detail enrichment");
  if(contract.platform==="weibo" && "searchType" in parameters && String(parameters.searchType)==="3")throw new StaleOperationError("Account search mode cannot collect material automatically");
  if(contract.platform==="x-research"&&!["Top","Latest"].includes(String((parameters as Record<string,unknown>).searchType??"Top")))throw new StaleOperationError("X search collection supports only Top or Latest");
  if(!input.enrichDetails&&(input.detailOperationId!==undefined||input.detailPage!==undefined))throw new StaleOperationError("Detail configuration requires enrichment");
  const target=input.detailOperationId??(input.enrichDetails&&input.operationId==="TXQPVGJG"?"API_1789098514899":undefined);
  if(input.enrichDetails&&(!target||!(input.provider==="agentkey"?(weiboEnrichment?["API_1789098514899"]:biliEnrichment?["TIN1NMTZ"]:input.operationId==="QEQLCKD6"?["FK67XDVQ"]:["384C6W6B","XN3ULENA"].includes(input.operationId)?["KR1LPTBF"]:[]):collectionDetailTargets(input.operationId,parameters)).includes(target)))throw new StaleOperationError("Select an implemented detail operation for this source");
  if(target==="LLCI8QTE"&&input.detailPage===undefined||target!=="LLCI8QTE"&&input.detailPage!==undefined)throw new StaleOperationError("Only LLCI8QTE requires an explicit detail page");
  return {...input,parameters,...(weibo&&target?{detailOperationId:target}:{}),...(x||snapshot||xhs||bili||weibo?{limits:{pages:1,items:input.limits.items,details:(xhs||biliEnrichment||weiboEnrichment)&&input.enrichDetails&&(!(bili||weibo)||(raw as {limits?:unknown}).limits!==undefined)?input.limits.details:0}}:{}),intervalMinutes:input.intervalMinutes??(contract.platform==="hot-research"?60:15)};
}
export async function listPlatformSubscriptions(onlyPlatform?:CollectionPlatform){const rows=await sql`SELECT s.id,s.provider,s.platform,s.config->>'sourceId' AS "sourceId",owner.name AS "sourceName",s.config->>'name' AS name,s.config->>'operationId' AS "operationId",s.config->'parameters' AS parameters,s.config->'enrichDetails' AS "enrichDetails",COALESCE(s.config->'autoDownloadVideo','false'::jsonb) AS "autoDownloadVideo",s.config->>'detailOperationId' AS "detailOperationId",s.config->'detailPage' AS "detailPage",s.enabled,s.interval_minutes AS "intervalMinutes",s.limits,s.edit_version AS "editVersion",s.execution_version AS "executionVersion",s.next_run_at AS "nextRunAt",CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'status',r.status,'step',r.step_key,'waitReason',r.wait_reason) END AS "activeRun" FROM collection_subscriptions s LEFT JOIN sources owner ON owner.id=s.config->>'sourceId' LEFT JOIN operation_runs r ON r.id=s.active_run_id WHERE s.control_source_id IS NULL AND (${onlyPlatform??null}::text IS NULL OR s.platform=${onlyPlatform??null}) ORDER BY s.id DESC`;const summaries=await videoDownloadSummaries(rows.map(row=>Number(row.id)));for(const row of rows){row.videoDownloads=summaries.get(Number(row.id))??null;row.sourceRequired=contentSubscription({platform:row.platform,config:{operationId:row.operationId}});}return rows;}
export async function createPlatformSubscription(raw:unknown,actor:string,key:unknown,onlyPlatform?:CollectionPlatform){
  const input=validated(raw,onlyPlatform),clientKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  const creationKey=stableJson([actor,clientKey]),hash=sha256(stableJson(input));
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`subscription:create:${creationKey}`},0))`;
    const [existing]=await tx`SELECT id,edit_version,creation_input_hash FROM collection_subscriptions WHERE creation_command_key=${creationKey}`;
    if(existing){if(existing.creation_input_hash!==hash)throw new StaleOperationError("Creation key reused with different subscription input");return {id:existing.id,editVersion:existing.edit_version};}
    const platform=collectionContract(input.operationId).platform,execution=collectionExecution(input.provider,platform,input.operationId);
    if(contentSubscription({platform,config:input})&&!input.sourceId)throw new StaleOperationError("Subscription requires an associated source");
    if(input.sourceId){const [source]=await tx`SELECT id FROM sources WHERE id=${input.sourceId} FOR SHARE`;if(!source)throw new StaleOperationError("Associated source not found");}
    const id=await createSubscription(tx,{provider:input.provider,platform,operationKey:execution.operationKey,contractVersion:1,config:{...(input.sourceId?{sourceId:input.sourceId}:{}),name:input.name,operationId:input.operationId,parameters:input.parameters,enrichDetails:input.enrichDetails,autoDownloadVideo:input.autoDownloadVideo,...(input.detailOperationId?{detailOperationId:input.detailOperationId}:{}),...(input.detailPage!==undefined?{detailPage:input.detailPage}:{})},intervalMinutes:input.intervalMinutes,enabled:input.enabled,limits:input.limits});
    await tx`UPDATE collection_subscriptions SET next_run_at=${input.enabled?new Date():null},creation_command_key=${creationKey},creation_input_hash=${hash} WHERE id=${id}`;
    await audit(actor,"subscription.create",`subscription:${id}`,null,null,input,undefined,tx);return {id,editVersion:1};
  });
}
/** Compare only execution semantics; persisted configuration/audit and creation hashes remain exact. */
function executionConfig(config:Record<string,unknown>){
  return {...config,name:undefined,autoDownloadVideo:config.autoDownloadVideo===true,...(config.operationId==="TXQPVGJG"&&config.enrichDetails===true&&config.detailOperationId===undefined?{detailOperationId:"API_1789098514899"}:{})};
}
export async function updatePlatformSubscription(id:number,raw:unknown,actor:string,onlyPlatform?:CollectionPlatform){const request=z.object({editVersion:z.number().int().positive(),config:Config}).strict().parse(raw),input=validated(request.config,onlyPlatform);return sql.begin(async tx=>{
  const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE id=${id} AND control_source_id IS NULL AND (${onlyPlatform??null}::text IS NULL OR platform=${onlyPlatform??null}) FOR UPDATE`;if(!sub)return null;if(sub.edit_version!==request.editVersion)throw new StaleOperationError("Subscription changed; refresh first");
  if(sub.provider!==input.provider)throw new StaleOperationError("Collection provider cannot be changed in the subscription editor");
  if(sub.platform!==collectionContract(input.operationId).platform)throw new StaleOperationError("Subscription platform cannot change");
  const execution=collectionExecution(input.provider,sub.platform,input.operationId);
  if(sub.operation_key!==execution.operationKey)throw new StaleOperationError("Subscription execution contract changed");
  if(sub.config.sourceId&&input.sourceId&&sub.config.sourceId!==input.sourceId)throw new StaleOperationError("Subscription source cannot change");
  const sourceId=sub.config.sourceId??input.sourceId;
  if(input.enabled&&!sourceId&&contentSubscription({platform:sub.platform,config:input}))throw new StaleOperationError("Subscription requires an associated source");
  if(sourceId){const [source]=await tx`SELECT id FROM sources WHERE id=${sourceId} FOR SHARE`;if(!source)throw new StaleOperationError("Associated source not found");}
  const config={...(sourceId?{sourceId}:{}),name:input.name,operationId:input.operationId,parameters:input.parameters,enrichDetails:input.enrichDetails,autoDownloadVideo:input.autoDownloadVideo,...(input.detailOperationId?{detailOperationId:input.detailOperationId}:{}),...(input.detailPage!==undefined?{detailPage:input.detailPage}:{})};
  const changed=stableJson(executionConfig(sub.config))!==stableJson(executionConfig(config)) || stableJson(sub.limits)!==stableJson(input.limits) || sub.enabled!==input.enabled;
  if(changed)await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,wait_reason='Subscription execution configuration changed',next_attempt_at=NULL,job_id=NULL WHERE subscription_id=${id} AND operation_key='subscription.video.download' AND status NOT IN ('completed','failed')`;
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
function switchParameters(sub:ProviderSwitchSnapshot,target:PlatformCollectionProviderId):{success:boolean;data?:unknown}{
  if(sub.config.operationId!=="QEQLCKD6")return (target==="agentkey"?douyinKeywordInput:douyinOperations.OWIBYU1V.schema).safeParse(sub.config.parameters);
  // Only the secure identity is interchangeable. Explicit sort/filter or noninitial positions
  // have no verified cross-provider semantics and must not be silently removed.
  if(target==="agentkey"){
    const source=z.strictObject({secUserId:z.string().trim().min(1),offset:z.literal(0).optional(),sortType:z.enum(["_2","_4"]).optional()}).safeParse(sub.config.parameters);
    return source.success?douyinAccountPostsInput.safeParse({sec_user_id:source.data.secUserId,sort_type:source.data.sortType==="_4"?1:0}):{success:false};
  }
  const source=douyinAccountPostsInput.safeParse(sub.config.parameters);
  if(!source.success||source.data.max_cursor!==0||source.data.count!==20)return {success:false};
  return douyinOperations.QEQLCKD6.schema.safeParse({secUserId:source.data.sec_user_id,sortType:source.data.sort_type===0?"_2":"_4"});
}
function providerPreflight(sub:ProviderSwitchSnapshot,targetProvider:PlatformCollectionProviderId){
  const checks:PlatformCollectionProviderPreflight["checks"]=[];
  const check=(key:PlatformCollectionProviderPreflight["checks"][number]["key"],ok:boolean,evidence:string,failed:"unsupported"|"unavailable"="unsupported")=>checks.push({key,conclusion:ok?"supported":failed,evidence});
  const operation=sub.config.operationId;
  if(sub.platform==="x-research"){
    const supported=operation==='5K5EG87P'&&platformCollectionProviderIds.includes(sub.provider as PlatformCollectionProviderId)&&targetProvider!==sub.provider;
    check('operation',supported,supported?'同一 X 基础关键词首页搜索支持显式双向切换':'只有 X 基础关键词搜索具有已验证的跨供应商配方；不支持原生 X 主采集切换');
    let mapped:unknown;
    if(sub.provider==='redfox'){
      const source=z.strictObject({keyword:z.string(),searchType:z.enum(['Top','Latest']).optional()}).safeParse(sub.config.parameters);
      if(source.success){const target=xCollectionSearchInput.safeParse({keyword:source.data.keyword,search_type:source.data.searchType??'Top'});if(target.success&&target.data.keyword===source.data.keyword)mapped=target.data;}
    }else if(sub.provider==='agentkey'){
      const source=xCollectionSearchInput.safeParse(sub.config.parameters);
      if(source.success){const target=xResearchOperations['5K5EG87P'].schema.safeParse({keyword:source.data.keyword,searchType:source.data.search_type});if(target.success&&target.data.keyword===source.data.keyword)mapped=target.data;}
    }
    const parameters=mapped!==undefined&&sub.limits.pages===1;
    check('parameters',parameters,parameters?'精确保留普通关键词与 Top/Latest；只执行首页，不迁移游标':'高级算子、游标、多页、额外字段或关键词字节变化没有等价证据；保留原参数');
    const details=!sub.config.enrichDetails&&sub.config.detailOperationId===undefined&&sub.config.detailPage===undefined&&sub.limits.details===0;
    check('details',details,details?'未要求详情补全':'此路径只接受零详情限额且未启用详情配方；不会静默丢弃要求');
    const present=targetProvider==='agentkey'?!!process.env.AGENTKEY_API_KEY?.trim()&&!/[\r\n]/.test(process.env.AGENTKEY_API_KEY):!!credential('collectors','REDFOX_API_KEY');
    check('credentials',present,present?'目标凭证已配置；预检不访问供应商':'目标凭证未配置','unavailable');
    let input:ReturnType<typeof validated>|undefined;
    if(supported&&parameters&&details){try{
      if(sub.contract_version!==1||sub.operation_key!==collectionExecution(sub.provider,sub.platform,operation).operationKey)throw new Error('Current contract changed');
      input=validated({...sub.config,provider:targetProvider,parameters:mapped,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits});
      collectionExecution(targetProvider,sub.platform,operation);
    }catch{/* Do not translate incompatible frozen contracts by dropping requirements. */}}
    check('execution',!!input,input?'首页执行、导入与恢复已接通；仍受预算和安全阀约束':'当前配置或合同未通过目标执行校验');
    const preflight:PlatformCollectionProviderPreflight={subscriptionId:sub.id,editVersion:sub.edit_version,currentProvider:sub.provider,targetProvider,supported:checks.every(c=>c.conclusion==='supported'),checks,impact:{activeRunId:sub.active_run_id,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits,note:'保留订阅身份、历史与周期；停止旧轮并重置进度。仅首页快照，覆盖与时效可能不同；AgentKey 实收文字不证明完整长文，正文待确认，不自动补购。估计每请求 0.2 credits，不是每轮实扣；不接通原生 X 主采集。'}};
    return {preflight,input};
  }
  if(sub.platform==="weibo"){
    const supported=operation==='TXQPVGJG'&&platformCollectionProviderIds.includes(sub.provider as PlatformCollectionProviderId)&&targetProvider!==sub.provider;
    check('operation',supported,supported?'同一微博基础搜索支持显式双向切换':'只有微博基础作品搜索具有已验证的跨供应商配方');
    let mapped:unknown;
    if(sub.provider==='redfox'){
      const source=z.strictObject({keyword:z.string(),searchType:z.enum(['1','61']),page:z.literal('1')}).safeParse(sub.config.parameters);
      if(source.success){const target=weiboSearchInput.safeParse({query:source.data.keyword,search_type:Number(source.data.searchType),page:1});if(target.success&&target.data.query===source.data.keyword)mapped=target.data;}
    }else if(sub.provider==='agentkey'){
      const source=weiboSearchInput.safeParse(sub.config.parameters);
      if(source.success&&source.data.query===(sub.config.parameters as Record<string,unknown>)?.query){const target=weiboOperations.TXQPVGJG.schema.safeParse({keyword:source.data.query,searchType:String(source.data.search_type),page:'1'});if(target.success&&target.data.keyword===source.data.query)mapped=target.data;}
    }
    const parameters=mapped!==undefined&&sub.limits.pages===1;
    check('parameters',parameters,parameters?'保留关键词、综合或实时类别，只执行首页':'认证筛选、其他搜索类型、多页或目标长度限制无法精确映射；保留原参数');
    const details=!sub.config.enrichDetails&&sub.config.detailOperationId===undefined&&sub.config.detailPage===undefined;
    check('details',details,details?'当前未启用详情配方':'先显式关闭详情配方；不迁移或静默丢弃详情要求');
    const present=targetProvider==='agentkey'?!!process.env.AGENTKEY_API_KEY?.trim()&&!/[\r\n]/.test(process.env.AGENTKEY_API_KEY):!!credential('collectors','REDFOX_API_KEY');
    check('credentials',present,present?'目标凭证已配置；预检不访问供应商':'目标凭证未配置','unavailable');
    let input:ReturnType<typeof validated>|undefined;
    if(supported&&parameters&&details){try{
      if(sub.contract_version!==1||sub.operation_key!==collectionExecution(sub.provider,sub.platform,operation).operationKey)throw new Error('Current contract changed');
      input=validated({...sub.config,provider:targetProvider,parameters:mapped,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits});
      collectionExecution(targetProvider,sub.platform,operation);
    }catch{/* Preserve incompatible saved contracts rather than approximating them. */}}
    check('execution',!!input,input?'目标首页执行、导入与恢复已接通，仍受预算和安全阀约束':'当前配置或合同未通过目标执行校验');
    const preflight:PlatformCollectionProviderPreflight={subscriptionId:sub.id,editVersion:sub.edit_version,currentProvider:sub.provider,targetProvider,supported:checks.every(c=>c.conclusion==='supported'),checks,impact:{activeRunId:sub.active_run_id,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits,note:'保留订阅身份、历史、周期与权限；停止旧轮并清空游标。仅首页，供应商覆盖和时效可能不同；AgentKey 长微博片段保存为正文待补，不自动付费补详情或回切。'}};
    return {preflight,input};
  }
  if(sub.platform==="bilibili"){
    const sameOperation=["LEN9QXR3","VPA67I98"].includes(String(operation))&&targetProvider!==sub.provider&&collectionProviderOptions(String(operation)).some(p=>p.id===targetProvider);
    check("operation",sameOperation,sameOperation?"同一 B站搜索或账号作品具有两家供应商入口":"该 B站研究操作没有等价的另一供应商入口");
    const plain=sub.provider==="redfox"?(operation==="LEN9QXR3"?z.strictObject({keyword:z.string().min(1),page:z.literal('1'),exactMatch:z.literal(false).optional(),pageSize:z.literal(20).optional()}):z.strictObject({mid:z.string().regex(/^[0-9]+$/),page:z.literal(1).optional(),pageSize:z.literal(20).optional()})).safeParse(sub.config.parameters).success:agentKeyOperation(operation)?.querySchema.safeParse(sub.config.parameters).success===true;
    check("parameters",plain&&sub.limits.pages===1,sub.limits.pages!==1?"目标只支持单首页快照，不能承接现有多页限额":plain?"仅基本首页条件可识别；不迁移旧游标":"排序、精准匹配、主页链接或页大小等参数缺少等价证据，不能静默删除");
    check("details",!sub.config.enrichDetails&&!sub.config.detailOperationId,!sub.config.enrichDetails?"当前无详情补全配方":"跨商详情的列表 AV/BV 和作者证据不同，不能原样迁移详情配方");
    const present=targetProvider==="agentkey"?!!process.env.AGENTKEY_API_KEY?.trim()&&!/[\r\n]/.test(process.env.AGENTKEY_API_KEY):!!credential("collectors","REDFOX_API_KEY");
    check("credentials",present,present?"目标凭证已配置；预检不请求供应商":"目标凭证未配置","unavailable");
    check("execution",false,"Redfox 列表可直接提供 BV 与 MID 材料；AgentKey 搜索仅 AV、账号列表缺 MID，需要额外付费详情。无法等价承接原材料语义；可另建有界订阅，原订阅保持不变");
    const preflight:PlatformCollectionProviderPreflight={subscriptionId:sub.id,editVersion:sub.edit_version,currentProvider:sub.provider,targetProvider,supported:false,checks,impact:{activeRunId:sub.active_run_id,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits,note:"未修改原订阅、参数、限额、在途任务或历史；不自动增加详情购买。"}};
    return {preflight,input:undefined};
  }
  if(sub.platform==="xiaohongshu"){
    const supported=["384C6W6B","XN3ULENA"].includes(String(operation))&&targetProvider!==sub.provider&&collectionProviderOptions(String(operation)).some(p=>p.id===targetProvider);
    check("operation",supported,supported?"同一小红书搜索/账号作品操作具有两家供应商，但材料语义仍需验证":"该小红书操作没有可互换的供应商合同");
    const noDetails=!sub.config.enrichDetails&&sub.config.detailOperationId===undefined&&sub.config.detailPage===undefined;
    const plain=sub.provider==="redfox"?(operation==="384C6W6B"?z.strictObject({keyword:z.string().min(1),offset:z.literal(0).optional(),exactMatch:z.literal(false).optional()}):z.strictObject({userid:z.string().min(1),offset:z.literal(0).optional()})).safeParse(sub.config.parameters).success:agentKeyOperation(operation)?.querySchema.safeParse(sub.config.parameters).success===true;
    check("parameters",plain&&sub.limits.pages===1,sub.limits.pages!==1?"目标只支持首页快照，不能承接现有多页限额":plain?"基本首页参数可识别；不迁移旧游标":"精准匹配、任意日期、展示账号或排序条件没有等价证据，不能静默丢弃");
    check("details",noDetails,noDetails?"当前未要求详情补全":"跨商详情配方的原生 ID、签名 URL 和正文语义未证明等价；保留原配置并阻断切换");
    const credentialPresent=targetProvider==="agentkey"?!!process.env.AGENTKEY_API_KEY?.trim()&&!/[\r\n]/.test(process.env.AGENTKEY_API_KEY):!!credential("collectors","REDFOX_API_KEY");
    check("credentials",credentialPresent,credentialPresent?"目标凭证已配置；预检不请求供应商":"目标凭证未配置","unavailable");
    check("execution",false,"AgentKey 搜索/账号列表没有已收原文 URL；基本快照不能保证原材料导入语义。可新建显式有界详情订阅，当前不自动转换原订阅");
    const preflight:PlatformCollectionProviderPreflight={subscriptionId:sub.id,editVersion:sub.edit_version,currentProvider:sub.provider,targetProvider,supported:false,checks,impact:{activeRunId:sub.active_run_id,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits,note:"未修改原订阅、限额、条件、在途任务或历史；小红书跨商配方仍待等价证据。"}};
    return {preflight,input:undefined};
  }
  const operationSupported=["OWIBYU1V","QEQLCKD6"].includes(String(operation))&&sub.platform==="douyin"&&platformCollectionProviderIds.includes(sub.provider as PlatformCollectionProviderId)&&targetProvider!==sub.provider&&collectionProviderOptions(String(operation)).some(p=>p.id===targetProvider);
  check("operation",operationSupported,operationSupported?"同一抖音操作支持显式切换":targetProvider===sub.provider?"请选择不同的目标供应商":"仅开放 OWIBYU1V 抖音搜索和 QEQLCKD6 账号作品的 Redfox / AgentKey 双向切换");
  const parameters=switchParameters(sub,targetProvider);
  check("parameters",parameters.success,parameters.success?"完整保留已保存的身份和支持的条件；分页从目标起点开始":"目标不能完整承接已保存参数；请先编辑并保存为目标支持的条件，不会静默删除精准匹配、日期或分页参数");
  const details=!sub.config.enrichDetails&&sub.config.detailOperationId===undefined&&sub.config.detailPage===undefined;
  check("details",details,details?"当前没有需要迁移的详情补全":operation==="QEQLCKD6"?"当前详情要求未证明可跨商保持正文及原生作品身份语义；本批保留原详情配置并阻断切换":"此切换路径不承接详情补全，请先显式关闭并保存");
  const hasCredential=targetProvider==="agentkey"?!!process.env.AGENTKEY_API_KEY?.trim()&&!/[\r\n]/.test(process.env.AGENTKEY_API_KEY):!!credential("collectors","REDFOX_API_KEY");
  check("credentials",hasCredential,hasCredential?"服务端已配置目标凭证；预检不请求供应商":`服务端未配置有效的 ${targetProvider==="agentkey"?"AGENTKEY_API_KEY":"REDFOX_API_KEY"} 凭证`,"unavailable");
  let input:ReturnType<typeof validated>|undefined;
  if(operationSupported&&parameters.success&&details){
    try{
      if(sub.contract_version!==1||sub.operation_key!==collectionExecution(sub.provider,sub.platform,sub.config.operationId).operationKey)throw new Error("Current contract changed");
      input=validated({...sub.config,parameters:parameters.data,provider:targetProvider,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits});
      collectionExecution(targetProvider,sub.platform,sub.config.operationId);
    }catch{/* A stored incompatible contract must be repaired explicitly, never translated by dropping fields. */}
  }
  check("execution",!!input,input?"目标已有固定输入/输出合同、调度、执行与恢复路径；外发仍受独立安全阀和预算控制":"当前配置或合同未通过目标执行路径校验");
  const preflight:PlatformCollectionProviderPreflight={subscriptionId:sub.id,editVersion:sub.edit_version,currentProvider:sub.provider,targetProvider,supported:checks.every(c=>c.conclusion==="supported"),checks,
    impact:{activeRunId:sub.active_run_id,enabled:sub.enabled,intervalMinutes:sub.interval_minutes,limits:sub.limits,note:"保留同一订阅、周期、限额和全部历史；停止旧在途任务，已发请求仍可能完成计费。旧游标不迁移，目标从合法起点开始；数据覆盖与时效可能变化；账号作品未指定排序时目标使用最新排序，不自动回切。"}};
  return {preflight,input};
}
export async function preflightPlatformSubscriptionProvider(id:number,raw:unknown,db:Db=sql){
  const request=ProviderPreflightInput.parse(raw);
  const [sub]=await db<ProviderSwitchSnapshot[]>`SELECT * FROM collection_subscriptions WHERE id=${id} AND control_source_id IS NULL`;
  if(!sub)return null;
  if(sub.edit_version!==request.editVersion)throw new StaleOperationError("Subscription changed; refresh provider preflight");
  const result=providerPreflight(sub,request.targetProvider).preflight;
  result.checks.push({key:"videoDownload",conclusion:"supported",evidence:videoDownloadCapability(sub.platform,request.targetProvider,String(sub.config.operationId))});
  return result;
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
    const operationKey=collectionExecution(provider,sub.platform,input.operationId).operationKey;
    await tx`UPDATE operation_runs SET status='stopped',generation=generation+1,wait_reason='Subscription provider changed',next_attempt_at=NULL,job_id=NULL WHERE subscription_id=${id} AND operation_key='subscription.video.download' AND status NOT IN ('completed','failed')`;
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
  const execution=collectionExecution(sub.provider,sub.platform,sub.config.operationId);
  if(sub.operation_key!==execution.operationKey)throw new StaleOperationError("Subscription execution contract changed");
  const parameters=sub.platform==="hot-research"?hotResearchDayParameters(HotResearchOperationId.parse(sub.config.operationId),sub.config.parameters,new Date()):sub.config.parameters;
  const {sourceId:_sourceId,...runConfig}=sub.config;
  const run=await createRun(tx,{actor,commandKey,provider:sub.provider,operationKey:sub.operation_key,contractVersion:1,subscriptionIds:[id],stepKey:execution.stepKey,input:{...(sub.provider==="agentkey"?{tool:agentKeyOperation(sub.config.operationId)!.route.tool,upstream:"TikHub"}:{}),commandIntent:intent,mode:"collection",platform:sub.platform,...runConfig,parameters,window:`subscription:${id}:${commandKey}`},limits:{...sub.limits,retries:3}});
  await queueOperationStep(tx,run.id);return run;
});}
export async function schedulePlatformSubscriptions(){
  if(process.env.COLLECT_ENABLED==="false")return 0;
  const [unknown]=await sql`SELECT id,provider FROM collection_subscriptions WHERE control_source_id IS NULL AND enabled AND active_run_id IS NULL AND next_run_at<=now() AND provider NOT IN ('redfox','agentkey') ORDER BY next_run_at,id LIMIT 1`;
  if(unknown)throw new Error(`Unsupported collection provider: ${unknown.provider} (subscription ${unknown.id})`);
  const providers=platformCollectionProviderIds.filter(provider=>provider==="agentkey"?process.env.AGENTKEY_CALLS_ENABLED==="true":process.env.REDFOX_CALLS_ENABLED==="true");
  if(!providers.length)return 0;
  const researchOperations=collectionOperationIds.filter(operationId=>!contentSubscription({config:{operationId}}));
  const rows=await sql`SELECT s.id,s.provider,s.platform,s.next_run_at FROM collection_subscriptions s LEFT JOIN sources owner ON owner.id=s.config->>'sourceId'
    WHERE s.control_source_id IS NULL AND s.enabled AND s.active_run_id IS NULL AND s.next_run_at<=now() AND s.provider IN ${sql(providers)}
      AND (owner.enabled OR (NULLIF(s.config->>'sourceId','') IS NULL AND s.config->>'operationId' IN ${sql(researchOperations)}))
    ORDER BY s.next_run_at,s.id LIMIT 100`;
  let count=0;
  for(const sub of rows){
    try{await startPlatformSubscription(sub.id,"schedule",`${sub.platform}:${sub.id}:${sub.next_run_at.toISOString()}`);count++;}
    catch(error){if(!(error instanceof StaleOperationError))throw error;}
  }
  return count;
}

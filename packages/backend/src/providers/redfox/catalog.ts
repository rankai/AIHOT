import { contentSubscription } from "../../sources/subscriptions.ts";
import { xCollectionIds, xProviderVariants, xResearchDescriptors as agentKeyXDescriptors } from "../agentkey/x-contract.ts";
import { weiboProviderVariants, weiboResearchDescriptors } from "../agentkey/weibo-contract.ts";
import { bilibiliProviderVariants, bilibiliResearchDescriptors } from "../agentkey/bilibili-contract.ts";
import { xiaohongshuResearchDescriptors, xiaohongshuProviderVariants } from "../agentkey/xiaohongshu-contract.ts";
import { toutiaoResearchDescriptors, toutiaoProviderVariants } from "../agentkey/toutiao-contract.ts";
import { wechatResearchDescriptors, wechatAgentKeyVariant } from "../agentkey/wechat-contract.ts";
import { douyinSnapshotDescriptors, douyinSuggestDescriptor } from "../agentkey/douyin-contract.ts";
import type { PlatformOperationDescriptor } from "@aihot/contracts/redfox";
import { CollectionDetailTarget, collectionDetailTargets } from "./collection-detail.ts";
import { mediaToolDescriptors } from "./media-tools-contract.ts";
import { socialResearchDescriptors } from "./social-research-contract.ts";
import { redfoxAccountDescriptors } from "./redfox-account-contract.ts";
import { hotResearchDescriptors } from "./hot-research-contract.ts";
import { xResearchDescriptors } from "./x-research-contract.ts";
import { qichezhijiaDescriptors } from "./qichezhijia-contract.ts";
import { dongchediDescriptors } from "./dongchedi-contract.ts";
import { yicheDescriptors } from "./yiche-contract.ts";
import { baijiahaoDescriptors } from "./baijiahao-contract.ts";
import { zhihuDescriptors } from "./zhihu-contract.ts";
import { toutiaoDescriptors } from "./toutiao-contract.ts";
import { kuaishouDescriptors } from "./kuaishou-contract.ts";
import { shipinhaoDescriptors } from "./shipinhao-contract.ts";
import { instagramDescriptors } from "./instagram-contract.ts";
import { youtubeDescriptors } from "./youtube-contract.ts";
import { bilibiliDescriptors } from "./bilibili-contract.ts";
import { tiktokDescriptors } from "./tiktok-contract.ts";
import { xiaohongshuDescriptors } from "./xiaohongshu-contract.ts";
import { douyinDescriptors } from "./douyin-contract.ts";
import { wechatDescriptors } from "./wechat-contract.ts";
import { collectionOperationIds, collectionProviderOptions } from "../../sources/platform-subscriptions.ts";
import { sql } from "../../db.ts";
import { synchronousOperations } from "./weibo-contract.ts";

/** Shared query descriptors; authentication and member visibility belong to their adapters. */
export async function platformToolCatalog(): Promise<PlatformOperationDescriptor[]> {
    const operations:PlatformOperationDescriptor[]=[...agentKeyXDescriptors,...weiboResearchDescriptors,...bilibiliResearchDescriptors,...xiaohongshuResearchDescriptors,...toutiaoResearchDescriptors,douyinSuggestDescriptor,...douyinSnapshotDescriptors,...mediaToolDescriptors(),...synchronousOperations(),...wechatDescriptors(),...wechatResearchDescriptors,...douyinDescriptors(),...xiaohongshuDescriptors(),...tiktokDescriptors(),...bilibiliDescriptors(),...youtubeDescriptors(),...instagramDescriptors(),...shipinhaoDescriptors(),...kuaishouDescriptors(),...toutiaoDescriptors(),...qichezhijiaDescriptors(),...dongchediDescriptors(),...yicheDescriptors(),...baijiahaoDescriptors(),...xResearchDescriptors(),...hotResearchDescriptors(),...redfoxAccountDescriptors(),...zhihuDescriptors(),...socialResearchDescriptors()];
    const prices=await sql`SELECT model,currency,per_request FROM service_prices WHERE service='redfox.collect' AND model IN ${sql([...collectionOperationIds,...CollectionDetailTarget.options])}`;
    return operations.map(operation=>{
      const sourceRequired=contentSubscription({platform:operation.platform,config:{operationId:operation.id}});
      if((collectionOperationIds as readonly string[]).includes(operation.id))operation={...operation,collectionCapabilities:{detailEnrichment:false,...operation.collectionCapabilities,sourceRequired}};
      if(operation.collectionProviders?.length&&operation.collectionProviders.every(provider=>provider.id==="agentkey"))return operation;
      if((collectionOperationIds as readonly string[]).includes(operation.id)){
        const price=prices.find(p=>p.model===operation.id);
        const detailOperations=collectionDetailTargets(operation.id).map(operationId=>{const definition=operations.find(o=>o.id===operationId),p=prices.find(x=>x.model===operationId);return {operationId,label:definition?.label??operationId,fields:operationId==="LLCI8QTE"?(definition?.fields??[]).filter(f=>f.name==="page"):[],price:p?{amount:p.per_request==null?null:Number(p.per_request),currency:p.currency,basis:"estimated" as const}:null};});
        operation={...operation,collectionPrice:price?{amount:price.per_request==null?null:Number(price.per_request),currency:price.currency,basis:"estimated" as const}:null,collectionProviders:collectionProviderOptions(operation.id),collectionCapabilities:{sourceRequired,detailEnrichment:detailOperations.length>0,detailOperations}};
      }
      const xVariant=xProviderVariants.find(v=>v.operationId===operation.id);
      if(xVariant)return operation.id.startsWith('x.')?operation:{...operation,schedulableType:(xCollectionIds as readonly string[]).includes(operation.id)?(operation.id==='5K5EG87P'?'search' as const:'list' as const):operation.schedulableType,queryProviders:[{id:'redfox',label:'Redfox'},xVariant],collectionProviders:collectionProviderOptions(operation.id)};
      const weiboVariant=weiboProviderVariants.find(v=>v.operationId===operation.id);
      if(weiboVariant)return operation.id.startsWith("weibo.")?operation:{...operation,collectionProviders:[{id:"redfox",label:"Redfox"},weiboVariant]};
      const biliVariant=bilibiliProviderVariants.find(v=>v.operationId===operation.id);
      if(biliVariant)return operation.id.startsWith("bilibili.")?operation:{...operation,collectionProviders:[{id:"redfox",label:"Redfox"},biliVariant]};
      const xhsVariant=xiaohongshuProviderVariants.find(v=>v.operationId===operation.id);
      if(xhsVariant)return operation.id.startsWith("xiaohongshu.")?operation:{...operation,collectionProviders:[{id:"redfox",label:"Redfox"},xhsVariant]};
      const toutiaoVariant=toutiaoProviderVariants.find(v=>v.operationId===operation.id);
      if(toutiaoVariant)return operation.id==='PAB6Z75Y'?{...operation,collectionProviders:[{id:'redfox',label:'Redfox'},toutiaoVariant]}:operation;
      const wechatVariant=wechatAgentKeyVariant(operation.id);
      if(wechatVariant&&!operation.id.startsWith("wechat."))return {...operation,collectionProviders:[...(operation.collectionProviders??[{id:"redfox",label:"Redfox"}]),wechatVariant]};
      return ["FK67XDVQ","P5CHB3BZ","XUT4CECZ"].includes(operation.id)?{...operation,collectionProviders:collectionProviderOptions(operation.id)}:operation;
    });
}

// The existing API stays Weibo-only; all lifecycle mutations use the shared implementation.
import { listPlatformSubscriptions,createPlatformSubscription,updatePlatformSubscription,startPlatformSubscription,schedulePlatformSubscriptions } from "./platform-subscriptions.ts";
export const listWeiboSubscriptions=()=>listPlatformSubscriptions("weibo");
export const createWeiboSubscription=(raw:unknown,actor:string,key:unknown)=>createPlatformSubscription(raw,actor,key,"weibo");
export const updateWeiboSubscription=(id:number,raw:unknown,actor:string)=>updatePlatformSubscription(id,raw,actor,"weibo");
export const startWeiboSubscription=(id:number,actor:string,key:unknown)=>startPlatformSubscription(id,actor,key,"weibo");
export { schedulePlatformSubscriptions as scheduleWeiboSubscriptions };

import {registerImportedVideo} from "./subscription-video.ts";
import { sql,type Tx } from "../db.ts";
import { upsertMaterial } from "../content/materials.ts";
import { queueProcessing } from "../jobs/content.ts";
import { tweetToCandidate } from "./x.ts";
import { noiseFiltered,rewriteUrl } from "./collect.ts";
import { singleXAccount } from "./x-replacement.ts";
import { xTimeline,xDetail,parseTimeline,XAccount,type RedfoxAccount,type RedfoxTweet,type RedfoxTimeline } from "../providers/redfox/x.ts";
import { parseRedfoxJson,RedfoxResponseError,type RawResponse } from "../providers/redfox/client.ts";
import { advanceRun,receiptOptions,retainCurrentReceipt,requireExecution,saveResult,type Execution,type RunRow,type OperationProgress } from "../providers/operations/store.ts";
import { queueOperationStep } from "../providers/operations/queue.ts";
import type { SdMedia } from "../providers/socialdata.ts";
import {redfoxXHasVideo} from "../providers/redfox/video-media.ts";
import {confirmedVideoMedia} from "../content/media.ts";

interface Input {mode:string;source:{id:string;config:Record<string,any>;cursor:Record<string,any>};restId:string;window:string;startedAt:string;continuation?:{cursor:string;stopId:string|null;headId:string|null}}
interface Progress extends OperationProgress {cursor?:string;stopId:string|null;headId:string|null;pages:number;seen:string[];items:number;details:number;pageReceiptId?:number;index?:number;indices?:number[];nextCursor?:string|null;done?:boolean}
function initial(input:Input):Progress{return {cursor:input.continuation?.cursor,stopId:input.continuation?.stopId??input.source.cursor.lastTweetId??null,headId:input.continuation?.headId??null,pages:0,seen:[],items:0,details:0};}
function items(page:RedfoxTimeline){return [...(page.pinned?[page.pinned]:[]),...page.timeline];}
function candidate(tweet:RedfoxTweet,page:RedfoxTimeline,restId:string,fallback?:RedfoxAccount) {
  if(tweet.author.userId!==undefined&&tweet.author.userId!==restId)throw new RedfoxResponseError("Timeline item author does not match the bound stable account");
  const user=tweet.author.username?tweet.author:(tweet.author.userId===undefined||page.user.userId===undefined||page.user.userId===tweet.author.userId) && page.user.username?page.user:fallback;
  if(!user?.username || !/^[A-Za-z0-9_]{1,15}$/.test(user.username))throw new RedfoxResponseError("Timeline item lacks a verified author handle");
  const text=tweet.text??tweet.content;
  if(typeof text!=="string" || !Number.isFinite(Date.parse(tweet.createdAt)))throw new RedfoxResponseError("Tweet content or source time is invalid");
  const rawMedia=tweet.medias as any;
  const media:SdMedia[]=Array.isArray(rawMedia)?rawMedia.filter(m=>m.type==="photo" && m.coverUrl).map(m=>({type:"photo",media_url_https:m.coverUrl})):Array.isArray(rawMedia?.photos)?rawMedia.photos.map((m:any)=>({type:"photo",media_url_https:m.url})):[];
  const value=tweetToCandidate({id_str:tweet.tweetId,tweet_created_at:tweet.createdAt,full_text:text,user:{screen_name:user.username,name:user.displayName??user.username,profile_image_url_https:user.avatar??undefined},extended_entities:{media}});
  if(redfoxXHasVideo(tweet.medias))value.media=confirmedVideoMedia(value.media);
  return value;
}
async function nextStep(tx:Tx,e:Execution,step:string,progress:Progress){await advanceRun(tx,e,{stepKey:step,progress});await queueOperationStep(tx,e.runId);}
async function boundAccount(tx:Tx,input:Input) {
  const [result]=await tx`SELECT z.id,z.data FROM source_account_bindings b
    JOIN operation_results z ON z.id::text=b.evidence->>'reference'
    JOIN operation_runs r ON r.id=z.run_id
    WHERE b.platform='x' AND b.id_kind='user_id' AND b.id_value=${input.restId} AND b.source_id=${input.source.id}
      AND b.evidence->>'kind'='result' AND z.kind='account' AND z.source_id=${input.source.id}
      AND r.provider='redfox' AND r.operation_key='redfox.x.account'`;
  const account=XAccount.safeParse(result?.data);
  if(!result || !account.success || account.data.userId!==input.restId)return null;
  return {account:account.data,resultId:result.id as number};
}
async function saveTweet(tx:Tx,e:Execution,input:Input,page:RedfoxTimeline,tweet:RedfoxTweet,receiptId:number) {
  const expectedHandle=singleXAccount(input.source.config.query)?.handle;
  const handles=[tweet.author.username,page.user.username].filter((value):value is string=>typeof value==="string"&&/^[A-Za-z0-9_]{1,15}$/.test(value)).map(value=>value.toLowerCase());
  if(new Set(handles).size>1||expectedHandle&&handles.some(handle=>handle!==expectedHandle))throw new RedfoxResponseError("Timeline received handle conflicts with the configured account scope");
  const reused=!tweet.author.username && !((tweet.author.userId===undefined||page.user.userId===undefined||page.user.userId===tweet.author.userId) && page.user.username)?await boundAccount(tx,input):null;
  let value=candidate(tweet,page,input.restId,reused?.account);
  value=rewriteUrl(value,input.source);
  if(noiseFiltered(value,input.source)){
    await saveResult(tx,e,{itemKey:`filtered:${tweet.tweetId}`,kind:"filtered",data:{reason:"noise"},receiptId});
    return;
  }
  const material=input.mode==="collection"?await upsertMaterial({...value,sourceId:input.source.id,via:"fetch",discoveredAt:new Date(input.startedAt),backfill:!input.source.cursor.initializedAt?"first-import":null},tx):null;
  const resultId=await saveResult(tx,e,{itemKey:`x:${tweet.tweetId}`,kind:"article",data:input.mode==="preview"?value as unknown as Record<string,unknown>:{tweetId:tweet.tweetId},receiptId,...(material?{articleId:material.articleId,sourceId:input.source.id}:{})});
  if(material){const [receipt]=await tx`SELECT model FROM receipts WHERE id=${receiptId}`;
    const videos=Array.isArray(tweet.medias)?tweet.medias.filter(m=>redfoxXHasVideo([m])):(tweet.medias as {videos?:unknown[]}|null)?.videos?.filter(m=>redfoxXHasVideo({videos:[m]}))??[];
    await registerImportedVideo(tx,resultId,{platform:"x",operationId:receipt.model,record:tweet,confirmed:redfoxXHasVideo(tweet.medias),singleVideo:videos.length===1,videoProof:"verified-own-media-type",workId:tweet.tweetId});}
  if(reused)await tx`UPDATE operation_results SET provenance=provenance || ${tx.json({accountResultId:reused.resultId,accountUserId:input.restId})} WHERE id=${resultId}`;
  if(material && (material.created || material.revised))await queueProcessing(material.articleId,{db:tx});
}
async function finishPage(tx:Tx,e:Execution,run:RunRow,input:Input,p:Progress) {
  await saveResult(tx,e,{itemKey:"page",kind:"page",data:{count:p.indices!.length},receiptId:p.pageReceiptId});
  const more=!p.done && !!p.nextCursor;
  if(input.mode==="collection") {
    const continuation=more?{cursor:p.nextCursor,stopId:p.stopId,headId:p.headId,window:input.window,startedAt:input.startedAt}:null;
    const progress={...input.source.cursor,lastTweetId:more?input.source.cursor.lastTweetId??null:p.headId??input.source.cursor.lastTweetId??null,initializedAt:input.source.cursor.initializedAt??input.startedAt,continuation};
    await tx`UPDATE collection_subscriptions SET progress=${tx.json(progress as never)},next_run_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${run.input.members[0]!.subscriptionId} AND active_run_id=${run.id}`;
  }
  const next={...p,pageReceiptId:undefined,index:undefined,indices:undefined,retainedReceiptIds:[],cursor:p.nextCursor??undefined};
  if(more && p.pages<10 && p.items<100){await nextStep(tx,e,"redfox.x.page",next);return;}
  if(input.mode==="collection")await tx`UPDATE sources SET last_ok_at=now(),last_fetch_at=now(),fail_count=0,last_error=NULL,health='ok' WHERE id=${input.source.id}`;
  await advanceRun(tx,e,null);
}
export async function executeRedfoxCollectionStep(e:Execution,snapshot:RunRow) {
  const input=snapshot.input as unknown as Input;
  const p=(snapshot.progress.pages===undefined?initial(input):structuredClone(snapshot.progress)) as Progress;
  if(snapshot.step_key==="redfox.x.page") {
    const result=await xTimeline({restId:input.restId,...(p.cursor?{cursor:p.cursor}:{})},input.window,receiptOptions(e));
    await sql.begin(async(tx)=>{
      const run=await requireExecution(tx,e),all=items(result.page);
      const seen=new Set(p.seen);const indices:number[]=[];
      let done=false;
      for(const [index,tweet] of all.entries()) {
        if(tweet.retweetedTweet || seen.has(tweet.tweetId))continue;
        seen.add(tweet.tweetId);
        if(p.stopId && BigInt(tweet.tweetId)<=BigInt(p.stopId)){if(!result.page.pinned || index!==0)done=true;continue;}
        if(!p.headId || BigInt(tweet.tweetId)>BigInt(p.headId))p.headId=tweet.tweetId;
        if(!input.source.cursor.initializedAt) {
          const cutoff=Date.parse(input.startedAt)-Number(input.source.config._aihot?.initialBackfillMonths??12)*30*86400000;
          if(Date.parse(tweet.createdAt)<cutoff){done=true;continue;}
          if(p.items+indices.length>=Number(input.source.config._aihot?.initialBackfillLimit??30)){done=true;continue;}
        }
        if(p.items+indices.length>=100)throw new RedfoxResponseError("Timeline page exceeds bounded item plan; page retained for review");
        indices.push(index);
      }
      const progress={...p,retainedReceiptIds:[result.receiptId],pages:p.pages+1,seen:[...seen],indices,index:0,pageReceiptId:result.receiptId,nextCursor:result.page.nextCursor,done:done || all.length===0};
      await retainCurrentReceipt(tx,e,progress);
      if(!indices.length){await finishPage(tx,e,run,input,progress);return;}
      await nextStep(tx,e,"redfox.x.item",progress);
    });return;
  }
  const [pageReceipt]=await sql`SELECT response FROM receipts WHERE id=${p.pageReceiptId!}`;
  const raw=pageReceipt?.response as RawResponse;
  const page=parseTimeline((parseRedfoxJson(raw.body) as {data:unknown}).data,input.restId);
  let tweet=items(page)[p.indices![p.index!]!]!;
  const excludeReplies=singleXAccount(input.source.config.query)!.excludeReplies;
  const needsDetail=excludeReplies || typeof tweet.text!=="string";
  let receiptId=p.pageReceiptId!;
  if(needsDetail){if(p.details>=100)throw new RedfoxResponseError("Detail limit exhausted");const detail=await xDetail(tweet.tweetId,input.window,"collect",receiptOptions(e));tweet=detail.tweet;receiptId=detail.receiptId;p.details++;}
  await sql.begin(async(tx)=>{
    const run=await requireExecution(tx,e);
    // Even a filtered reply must identify the actual bound author.
    if(tweet.author.userId!==undefined&&tweet.author.userId!==input.restId)throw new RedfoxResponseError("Detail author does not match bound account");
    if(excludeReplies && !["replyToTweetId","replyToUserId","replyToUsername"].every(k=>Object.hasOwn(tweet,k)))throw new RedfoxResponseError("Detail lacks explicit reply classification");
    const reply=excludeReplies && !!(tweet.replyToTweetId || tweet.replyToUserId || tweet.replyToUsername);
    if(!reply)await saveTweet(tx,e,input,page,tweet,receiptId);
    else await saveResult(tx,e,{itemKey:`filtered:${tweet.tweetId}`,kind:"filtered",data:{reason:"reply"},receiptId});
    const next={...p,index:p.index!+1,items:p.items+1};
    if(next.index<next.indices!.length){await nextStep(tx,e,"redfox.x.item",next);return;}
    await finishPage(tx,e,run,input,next);
  });
}

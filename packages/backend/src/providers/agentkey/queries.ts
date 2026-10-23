import {z} from "zod";
import {sql} from "../../db.ts";
import {createRun} from "../operations/store.ts";
import {queueOperationStep} from "../operations/queue.ts";
import {agentKeyOperation} from "./routes.ts";
export async function createAgentKeyQuery(raw:unknown,actor:string,key:unknown){
  const request=z.strictObject({provider:z.literal("agentkey"),operationId:z.enum(["5K5EG87P","x.account_posts","x.detail","ABJQXHUE","x.account_profile","x.followers","5QY3G5TY","x.list_posts","x.community_posts","x.trending","x.list_members","x.community_members","TXQPVGJG","API_1789098514899","API_1789098515117","UAQ90A1F","weibo.account_posts","weibo.comments","weibo.following","weibo.related_search","LEN9QXR3","VPA67I98","TIN1NMTZ","EH53TOT7","bilibili.typed_search","bilibili.comments","bilibili.comment_replies","bilibili.relation_stats","bilibili.dynamics","bilibili.trending","bilibili.hot_search","OWIBYU1V","QEQLCKD6","FK67XDVQ","P5CHB3BZ","douyin.suggest","XUT4CECZ","douyin.trending","douyin.comments","douyin.comment_replies","douyin.topic_posts","douyin.following","8IQD0BJC","I3CIBRI2","KUQYSQNX","wechat.comments","wechat.comment_replies","wechat.article_stats","PAB6Z75Y","toutiao.comments","toutiao.account_profile","384C6W6B","XN3ULENA","KR1LPTBF","439NFLBD","xiaohongshu.comments","xiaohongshu.account_profile","xiaohongshu.topic_posts","xiaohongshu.suggest","xiaohongshu.recommendations"]),parameters:z.unknown()}).parse(raw);
  const operation=agentKeyOperation(request.operationId)!;
  const parameters=operation.querySchema.parse(request.parameters),route=operation.route;
  const commandKey=z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(key);
  return sql.begin(async tx=>{
    const run=await createRun(tx,{actor,commandKey,provider:"agentkey",operationKey:route.operationKey,stepKey:route.stepKey,contractVersion:1,input:{...request,parameters,mode:"query",platform:route.operationKey.startsWith("agentkey.x.")?"x-research":route.operationKey.startsWith("agentkey.weibo.")?"weibo":route.operationKey.startsWith("agentkey.bilibili.")?"bilibili":route.operationKey.startsWith("agentkey.xiaohongshu.")?"xiaohongshu":route.operationKey.startsWith("agentkey.wechat_mp.")?"wechat":route.operationKey.startsWith("agentkey.toutiao.")?"toutiao":"douyin",tool:route.tool,upstream:"TikHub"},limits:{pages:1,retries:3}});
    await queueOperationStep(tx,run.id);return run;
  });
}

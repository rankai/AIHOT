import {z} from 'zod';
import {object,explicitAgentKeyError} from './response.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {toutiaoWorkId} from '../../lib/url.ts';
import {agentKeyToutiaoOperations,toutiaoArticleRoute,toutiaoProfileRoute,type AgentKeyToutiaoRoute} from './toutiao-contract.ts';
const id=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe().transform(String)]);
const count=z.number().int().nonnegative().safe();
export interface ToutiaoCandidate {itemKey:string;kind:string;data:Record<string,unknown>}
export function parseAgentKeyToutiao(response:unknown,route:AgentKeyToutiaoRoute,raw:unknown):{candidates:ToutiaoCandidate[];summary:Record<string,unknown>}{
 const op=agentKeyToutiaoOperations.find(o=>o.route===route);if(!op)throw new AgentKeyPayloadError('Unsupported Toutiao route');
 const query=op.schema.parse(raw) as Record<string,unknown>,r=object(response),envelope=object(r?.envelope),payload=object(envelope?.data),body=object(payload?.data);
 if(r?.httpStatus!==200||explicitAgentKeyError(r?.mcp,envelope)||envelope?.provider!=='TikHub'||payload?.code!==200||body?.message!=='success')throw new AgentKeyPayloadError('Unrecognized Toutiao success envelope');
 for(const key of ['err_no','errno','code','status_code'])if(body[key]!==undefined&&body[key]!==0)throw new AgentKeyPayloadError('Toutiao business rejection');
 const common={platform:'toutiao',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool};
 const summary:Record<string,unknown>={count:0,query,stopReason:'single-request'};
 if(route===toutiaoArticleRoute){
  const a=z.object({group_id:id,share_info:z.object({title:z.string().min(1)}),user_info:z.object({user_id:id.optional(),name:z.string().optional()}).optional(),media_info:z.object({user_id:id.optional()}).optional(),itemCell:z.object({articleBase:z.object({gidStr:z.string().regex(/^\d+$/)}),userInfo:z.object({userID:id.optional()}).optional()}),share_url:z.string(),display_url:z.string()}).parse(body.data);
  if(a.group_id!==query.group_id||a.itemCell.articleBase.gidStr!==a.group_id||new Set([a.user_info?.user_id,a.media_info?.user_id,a.itemCell.userInfo?.userID].filter(Boolean)).size>1||toutiaoWorkId(a.share_url)!==a.group_id||toutiaoWorkId(a.display_url)!==a.group_id)throw new AgentKeyPayloadError('Toutiao article identity contradicts original request');
  return {candidates:[{kind:'toutiao_work',itemKey:'work:0',data:{...common,title:a.share_info.title,titleSource:'share_info.title',workId:a.group_id,requestedWorkId:query.group_id,url:a.share_url,identity:a.user_info?.user_id?{uid:a.user_info.user_id}:{},publishedAt:null,record:{workId:a.group_id,workUrl:a.share_url,title:a.share_info.title,authorName:a.user_info?.name,uid:a.user_info?.user_id},missing:['正文不可用','发布时间不可用']}}],summary:{...summary,count:1}};
 }
 if(route===toutiaoProfileRoute){
  if(body.errno!==0)throw new AgentKeyPayloadError('Missing profile success code');
  const profile=z.object({user_id:id,name:z.string(),description:z.string(),avatar_url:z.string(),big_avatar_url:z.string(),publish_count:count,digg_count:count,followers_count:count,followings_count:count}).parse(body.data);
  if(profile.user_id!==query.user_id)throw new AgentKeyPayloadError('Toutiao profile identity differs');
  const profileIsBlank=['name','description','avatar_url','big_avatar_url'].every(k=>profile[k as keyof typeof profile]==='')&&['publish_count','digg_count','followers_count','followings_count'].every(k=>profile[k as keyof typeof profile]===0);
  return {candidates:[],summary:{...summary,record:profile,profileIsBlank,statusText:profileIsBlank?'本次返回空白账号资料；不能据此推断注销或私密':'仅展示本次实收账号字段，不据此推断账号状态或绑定权限',missingFields:['name','description','avatar_url','big_avatar_url'].filter(k=>profile[k as keyof typeof profile]==='')}};
 }
 if(body.err_no!==0)throw new AgentKeyPayloadError('Missing comments success code');
 const p=z.object({group:z.object({group_id:id}),data:z.array(z.object({cell_type:z.literal(1),comment:z.object({id,id_str:z.string().regex(/^\d+$/),text:z.string(),user_id:id,user_name:z.string(),create_time:count,digg_count:count,reply_count:count})})).max(1000),has_more:z.boolean(),offset:count,total_number:count}).parse(body);
 if(p.group.group_id!==query.group_id)throw new AgentKeyPayloadError('Toutiao comment group differs');
 const candidates=p.data.map(({comment:c},index)=>{
  if(c.id!==c.id_str)throw new AgentKeyPayloadError('Toutiao comment identity differs');
  return {kind:'social_comment',itemKey:`item:${index}`,data:{...common,title:c.text,role:'comment',identityRole:'comment-author',commentId:c.id,identity:{uid:c.user_id},record:{...c,user:{uid:c.user_id,nickname:c.user_name}},requestedScope:query,receivedScope:{group_id:p.group.group_id},timeUnits:{create_time:'unspecified'},missing:['仅用于评论研究，不提供材料导入和账号绑定']}};
 });
 return {candidates,summary:{...summary,count:candidates.length,snapshot:true,pagination:{has_more:p.has_more,offset:p.offset,total_number:p.total_number}}};
}

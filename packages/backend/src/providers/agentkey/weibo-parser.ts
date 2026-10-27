import {z} from 'zod';
import {object,explicitAgentKeyError} from './response.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {stripTags} from '../../lib/text.ts';
import {weiboPublishedAt} from '../redfox/weibo.ts';
import {agentKeyWeiboOperations,weiboSearchRoute,weiboPostsRoute,weiboDetailRoute,weiboCommentsRoute,weiboProfileRoute,weiboFollowingRoute,weiboTrendingRoute,type AgentKeyWeiboRoute} from './weibo-contract.ts';
const id=z.union([z.string().regex(/^\d+$/).max(100),z.number().int().nonnegative().safe().transform(String)]);
const count=z.number().int().nonnegative().safe();
const userSchema=z.object({id:id.optional(),idstr:id.optional(),screen_name:z.string().optional(),description:z.string().optional(),followers_count:count.optional(),friends_count:count.optional(),statuses_count:count.optional(),verified:z.boolean().optional(),following:z.boolean().optional()});
function aliases(row:Record<string,unknown>,keys:string[]):string|undefined{
 const values=keys.filter(k=>row[k]!==undefined).map(k=>id.parse(row[k]));
 if(new Set(values).size>1)throw new AgentKeyPayloadError('Weibo identity aliases disagree');
 return values[0];
}
function user(value:unknown){const row=userSchema.parse(value),uid=aliases(row,['id','idstr']);return {...row,...(uid?{uid}:{}),...(row.screen_name?{nickname:row.screen_name}:{})};}
function scope(actual:string|undefined,requested:unknown){if(actual!==undefined&&actual!==requested)throw new AgentKeyPayloadError('Weibo received identity differs from frozen request');}
const rows=z.array(z.record(z.string(),z.unknown())).max(2000);
export interface WeiboCandidate {itemKey:string;kind:string;data:Record<string,unknown>}
export function parseAgentKeyWeibo(response:unknown,route:AgentKeyWeiboRoute,raw:unknown):{candidates:WeiboCandidate[];summary:Record<string,unknown>}{
 const op=agentKeyWeiboOperations.find(o=>o.route===route);if(!op)throw new AgentKeyPayloadError('Unsupported Weibo route');
 const query=op.schema.parse(raw) as Record<string,unknown>,r=object(response),envelope=object(r?.envelope),payload=object(envelope?.data),body=object(payload?.data);
 if(r?.httpStatus!==200||explicitAgentKeyError(r?.mcp,envelope)||envelope?.provider!=='TikHub'||payload?.code!==200||!body)throw new AgentKeyPayloadError('Unrecognized Weibo success envelope');
 for(const key of ['error','error_code','errcode','errno','code','status_code'])if(body[key]!==undefined&&body[key]!==0)throw new AgentKeyPayloadError('Weibo business rejection');
 const common={platform:'weibo',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool,importable:false};
 const candidates:WeiboCandidate[]=[],summary:Record<string,unknown>={count:0,query,requestedScope:query,stopReason:'single-request',scope:'homepage-or-single-object',snapshot:true};
 const add=(kind:string,data:Record<string,unknown>)=>candidates.push({kind,itemKey:`item:${candidates.length}`,data:{...common,...data}});
 const work=(value:unknown)=>{
  const w=z.object({id:id.optional(),idstr:id.optional(),mid:id.optional(),mblogid:z.string().regex(/^[A-Za-z0-9]+$/).optional(),text:z.string().optional(),created_at:z.string().optional(),isLongText:z.boolean().optional(),user:userSchema.optional(),scheme:z.string().optional(),reposts_count:count.optional(),comments_count:count.optional(),attitudes_count:count.optional(),retweeted_status:z.unknown().optional()}).parse(value);
  const opusId=aliases(w,['id','idstr','mid']),author=w.user?user(w.user):undefined,uid=author?.uid;
  if(!opusId&&!w.text&&!w.mblogid)throw new AgentKeyPayloadError('Weibo status has no meaningful received fields');
  if(route===weiboDetailRoute)scope(opusId,query.status_id);
  const retweet=w.retweeted_status!==undefined&&w.retweeted_status!==null;
  if(route===weiboPostsRoute&&!retweet)scope(uid,query.uid);
  const missing:string[]=[];
  if(!uid)missing.push('缺少实收作者 UID');if(!opusId)missing.push('缺少作品数字 ID');if(!w.text)missing.push('缺少正文');
  if(w.isLongText)missing.push('长微博仅实收片段，完整正文未证实');
  if(retweet)missing.push('转发原帖结构未验证，仅展示外层实收微博，不解析原帖作者');
  const publishedAt=weiboPublishedAt(w.created_at)?.toISOString()??null;if(!publishedAt)missing.push('发布时间未知');
  const opusUrl=uid&&opusId?`https://weibo.com/${uid}/${opusId}`:undefined;
  const record={...(opusId?{opusId}:{}),...(uid?{uid}:{}),...(author?.nickname?{nickname:author.nickname}:{}),...(w.text!==undefined?{text:stripTags(w.text)}:{}),...(w.mblogid?{mblogid:w.mblogid}:{}),...(w.created_at?{publishTime:w.created_at}:{}),...(opusUrl?{opusUrl}:{}),...(w.isLongText!==undefined?{isLongText:w.isLongText}:{}),...(w.scheme?{scheme:w.scheme}:{}),...Object.fromEntries(['reposts_count','comments_count','attitudes_count'].filter(k=>w[k as keyof typeof w]!==undefined).map(k=>[k,w[k as keyof typeof w]]))};
  add('weibo_work',{...record,record,importable:!!uid&&!!opusId&&!retweet,title:record.text??w.mblogid??opusId,publishedAt,urlSource:opusUrl?'derived-canonical-permalink':null,bodyStatus:'pending',textScope:w.isLongText?'received-excerpt':'received-text',role:retweet?'outer-status-unparsed-retweet':'status',missing});
 };
 if(route===weiboSearchRoute||route===weiboPostsRoute){
  let filtered=0;const visit=(items:unknown,nested=false)=>{for(const item of rows.parse(items)){
   if(item.category==='feed')work(item.data);
   else if(route===weiboSearchRoute&&item.category==='group'&&!nested)visit(item.items,true);
   else if(['group','card','cell'].includes(String(item.category)))filtered++;
   else throw new AgentKeyPayloadError('Unknown Weibo item category');
  }};visit(body.items);summary.filteredItems=filtered;
  const params=object(object(body.moreInfo)?.params);if(params)summary.pagination=z.object({page:count.optional(),max_id:count.optional(),count:z.union([count,z.string()]).optional()}).parse(params);
 }else if(route===weiboDetailRoute){work(object(body.detailInfo)?.status);
 }else if(route===weiboProfileRoute){
  const u=user(object(object(body.header)?.data)?.userInfo);scope(u.uid,query.uid);
  if(!u.uid&&!u.screen_name&&!u.description)throw new AgentKeyPayloadError('Weibo profile has no meaningful fields');
  add('weibo_account',{...u,record:u,importable:!!u.uid,title:u.screen_name??u.uid,missing:u.uid?[]:['缺少实收用户 UID']});
 }else if(route===weiboCommentsRoute){
  let filtered=0;for(const item of rows.parse(body.items)){
   if(item.type==='trend'){filtered++;continue;}
   if(item.type!=='comment')throw new AgentKeyPayloadError('Unknown Weibo comment item type');
   const c=z.object({id:id.optional(),idstr:id.optional(),rootid:id.optional(),rootidstr:id.optional(),text:z.string().min(1),created_at:z.string().optional(),user:userSchema.optional(),like_counts:count.optional(),total_number:count.optional()}).parse(item.data);
   const commentId=aliases(c,['id','idstr']),parentCommentId=aliases(c,['rootid','rootidstr']),author=c.user?user(c.user):undefined;
   const record={...c,text:stripTags(c.text),...(author?{user:author}:{})};
   add('social_comment',{title:record.text,role:'comment',identityRole:'comment-author',commentId,parentCommentId,record,requestedScope:query,receivedScope:null,missing:['研究快照，不导入或绑定；响应未返回作品范围']});
  }summary.filteredItems=filtered;
  const params=object(object(body.moreInfo)?.params);if(params)summary.pagination=z.object({max_id:count.optional()}).parse(params);
 }else if(route===weiboFollowingRoute){
  if(body.ok!==1||body.http_code!==200)throw new AgentKeyPayloadError('Weibo following business rejection');
  const d=z.object({uid:id,total_cnt:count.optional(),since_id:z.string().optional(),users:z.array(z.object({user:userSchema})).max(2000)}).parse(body.data);scope(d.uid,query.uid);
  for(const row of d.users){const u=user(row.user);if(!u.uid&&!u.screen_name&&!u.description)throw new AgentKeyPayloadError('Weibo followee has no meaningful fields');add('social_followee',{title:u.screen_name??u.uid,role:'followee',identityRole:'followee',identity:u.uid?{uid:u.uid}:{},record:{user:u},requestedScope:query,receivedScope:{uid:d.uid},missing:['关注关系研究，不绑定账号']});}
  summary.pagination={...(d.since_id!==undefined?{since_id:d.since_id}:{}),...(d.total_cnt!==undefined?{total_cnt:d.total_cnt}:{})};summary.receivedScope={uid:d.uid};
 }else if(route===weiboTrendingRoute){
  let filtered=0;for(const group of rows.parse(body.items)){
   if(group.category==='cell'){filtered++;continue;}
   if(group.category!=='group')throw new AgentKeyPayloadError('Unknown Weibo trending category');
   for(const item of rows.parse(group.items)){const card=object(item.data);if(!card||typeof card.card_type!=='number')throw new AgentKeyPayloadError('Unknown Weibo trend card');if([6,101].includes(card.card_type)){filtered++;continue;}
    if(card.card_type!==4)throw new AgentKeyPayloadError('Unknown Weibo trend card type');
    const c=z.object({card_type:z.literal(4),desc:z.string().min(1),desc_extr:count.optional(),scheme:z.string().optional(),openurl:z.string().optional()}).parse(card);
    add('hotspot_research',{title:c.desc,record:c,missing:['研究词条，不是新闻原文；未返回排名']});
   }
  }summary.filteredItems=filtered;
 }else{
  for(const item of z.array(z.object({suggestion:z.string().min(1),count:count.optional(),discuss:count.optional(),discuss_num:count.optional(),type:count.optional(),top_flag:count.optional(),topic_flag:count.optional()})).max(2000).parse(body.hotquery))add('search_suggestion',{title:item.suggestion,record:item,missing:['相关词研究，不导入材料']});
 }
 return {candidates,summary:{...summary,count:candidates.length}};
}

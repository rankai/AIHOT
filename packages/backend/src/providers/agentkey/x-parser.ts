import {z} from 'zod';
import {object,explicitAgentKeyError} from './response.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {agentKeyXOperations,xSearchRoute,xPostsRoute,xDetailRoute,xCommentsRoute,xProfileRoute,xTrendingRoute,xFollowersRoute,xFollowingRoute,xListMembersRoute,xCommunityMembersRoute,type AgentKeyXRoute} from './x-contract.ts';
const id=z.union([z.string().regex(/^\d+$/).max(100),z.number().int().nonnegative().safe().transform(String)]);
const text=z.string().nullish(),identity=id.nullish(),count=z.number().int().nonnegative().safe().nullish(),flag=z.boolean().nullish();
const authorSchema=z.object({rest_id:identity,screen_name:text,name:text,created_at:text,description:text,followers_count:count,followers:count,favorites_count:count,friends_count:count,avatar:text,image:text,blue_verified:flag,verified:flag,sub_count:count});
const profileSchema=z.object({status:text,profile:text,rest_id:identity,id:identity,name:text,desc:text,avatar:text,header_image:text,protected:flag,blue_verified:flag,location:text,friends:count,sub_count:count,statuses_count:count,media_count:count,created_at:text,pinned_tweet_ids_str:z.array(id).nullish()});
const memberSchema=z.object({user_id:identity,screen_name:text,name:text,description:text,profile_image:text,statuses_count:count,followers_count:count,friends_count:count,media_count:count,created_at:text,location:text,blue_verified:flag,verified:flag,website:text});
const workSchema=z.object({tweet_id:identity,id:identity,type:text,status:text,text,display_text:text,created_at:text,screen_name:text,conversation_id:identity,bookmarks:count,favorites:count,likes:count,quotes:count,replies:count,retweets:count,views:z.union([z.string(),z.number().nonnegative().safe()]).nullish(),lang:text,sensitive:flag,author:authorSchema.nullish(),user_info:authorSchema.nullish()});
const rows=z.array(z.record(z.string(),z.unknown())).max(2000);
function mismatch(actual:unknown,expected:unknown){if(actual!=null&&expected!=null&&actual!==expected)throw new AgentKeyPayloadError('X received identity differs from frozen scope or aliases');}
function handleMatch(actual:unknown,expected:unknown){if(typeof actual==='string'&&typeof expected==='string')mismatch(actual.toLowerCase(),expected.toLowerCase());}
function aliases(a:unknown,b:unknown){mismatch(a,b);return a??b;}
function active(status:unknown){if(status!=null&&!['ok','active'].includes(String(status)))throw new AgentKeyPayloadError('X unavailable or unrecognized status');}
function profile(value:unknown,query:Record<string,unknown>){
 const p=profileSchema.parse(value);active(p.status);aliases(p.rest_id,p.id);handleMatch(p.profile,query.screen_name);if(query.rest_id!==undefined)mismatch(p.rest_id??p.id,String(query.rest_id));
 if(!p.rest_id&&!p.id&&!p.profile&&!p.name&&!p.desc)throw new AgentKeyPayloadError('X profile has no meaningful received fields');return p;
}
export interface XCandidate {itemKey:string;kind:string;data:Record<string,unknown>}
export function parseAgentKeyX(response:unknown,route:AgentKeyXRoute,raw:unknown):{candidates:XCandidate[];summary:Record<string,unknown>}{
 const op=agentKeyXOperations.find(o=>o.route===route);if(!op)throw new AgentKeyPayloadError('Unsupported X route');
 const query=op.schema.parse(raw) as Record<string,unknown>,r=object(response),envelope=object(r?.envelope),payload=object(envelope?.data),body=object(payload?.data);
 if(r?.httpStatus!==200||explicitAgentKeyError(r?.mcp,envelope)||envelope?.provider!=='TikHub'||payload?.code!==200||!body)throw new AgentKeyPayloadError('Unrecognized X success envelope');
 for(const k of ['error','errors','error_code','errcode','errno','code','status_code'])if(body[k]!==undefined&&body[k]!==null&&body[k]!==0)throw new AgentKeyPayloadError('X business rejection');
 active(body.status);
 const common={platform:'x-research',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool,importable:false};
 const candidates:XCandidate[]=[],summary:Record<string,unknown>={query,requestedScope:query,receivedScope:null,stopReason:'single-request',scope:'homepage-or-single-object',snapshot:true,nextParameters:null};
 const add=(kind:string,data:Record<string,unknown>)=>candidates.push({kind,itemKey:`item:${candidates.length}`,data:{...common,...data}});
 // These are research records: no material author inference or Article/fulltext assertion.
 const work=(value:unknown,variant:'search'|'timeline'|'detail'|'thread'|'nested',context?:ReturnType<typeof profile>,depth=0):Record<string,unknown>=>{
  const source=object(value),w=workSchema.parse(value);active(w.status);
  if(variant==='search'&&w.type!=null&&w.type!=='tweet')throw new AgentKeyPayloadError('Unknown X search item type');
  aliases(w.id,w.tweet_id);
  const tweetId=variant==='detail'||variant==='thread'?w.id:w.tweet_id;
  if(!tweetId&&!w.text&&!w.display_text)throw new AgentKeyPayloadError('X post has no meaningful received fields');
  const author=variant==='search'?w.user_info:w.author;
  handleMatch(w.screen_name,author?.screen_name);
  if(context&&author?.rest_id!=null)mismatch(author.rest_id,context.rest_id??context.id);
  const contextHandle=context&&author?.rest_id!=null&&author.rest_id===(context.rest_id??context.id)&&typeof context.profile==='string'?context.profile:undefined;
  const handle=author?.screen_name??contextHandle;
  const url=typeof tweetId==='string'&&typeof handle==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(handle)?`https://x.com/${handle}/status/${tweetId}`:undefined;
  const record:Record<string,unknown>={...w,...(tweetId?{tweetId}:{}),...(contextHandle?{authorContext:{rest_id:author!.rest_id,screen_name:contextHandle,source:'received-account-context'}}:{}),...(url?{url,urlSource:'derived-canonical-permalink'}:{})};
  // Only witnessed variants are decoded. Unknown nested roles remain visibly limited research.
  const limitations:string[]=[];
  if(depth===0&&(variant==='search'||route===xPostsRoute)&&source?.quoted!=null){
   record.quoted=work(source.quoted,'nested',undefined,depth+1);
  }
  if(depth===0&&route===xPostsRoute&&variant==='timeline'&&(source?.retweeted!=null||source?.retweeted_tweet!=null)){
   const ref=z.object({id:identity}).parse(source?.retweeted??{}),nested=source?.retweeted_tweet==null?undefined:work(source.retweeted_tweet,'nested',undefined,depth+1);
   mismatch(ref.id,nested?.tweetId);record.retweeted=ref;if(nested)record.retweeted_tweet=nested;record.role='retweet-wrapper';
  }else record.role=variant==='thread'?'conversation-item':'post';
  if(source?.quoted!=null&&record.quoted===undefined&&limitations.length===0)limitations.push('引用角色未核验');
  if((source?.retweeted!=null&&record.retweeted===undefined)||(source?.retweeted_tweet!=null&&record.retweeted_tweet===undefined))limitations.push('转发角色未核验');
  if(limitations.length)record.roleLimitations=limitations;
  return record;
 };
 const addWork=(rawWork:unknown,pinned=false,context?:ReturnType<typeof profile>)=>{const record=work(rawWork,route===xSearchRoute?'search':'timeline',context);add('x_research_work',{record,title:record.text??record.display_text??record.tweetId,tweetId:record.tweetId,url:record.url,role:record.role,pinned,identityRole:'post-author',requestedScope:query,missing:['仅研究；未证明完整长文、直接回复关系或后续分页']});};
 if(route===xProfileRoute){const p=profile(body,query);summary.receivedScope={rest_id:p.rest_id??p.id,screen_name:p.profile};add('account',{record:p,title:p.name??p.profile??p.rest_id,identityRole:'queried-account',requestedScope:query,missing:['仅账号资料研究，不绑定信源']});}
 else if(route===xDetailRoute||route===xCommentsRoute){
  const root=work(body,'detail');mismatch(root.tweetId,query.tweet_id);
  if(route===xDetailRoute)for(const key of ['in_reply_to_screen_name','in_reply_to_status_id_str','in_reply_to_user_id_str'])if(body[key]===null)root[key]=null;
  if(route===xDetailRoute)add('x_detail_work',{record:root,title:root.text??root.display_text??root.tweetId,tweetId:root.tweetId,url:root.url,identityRole:'post-author',missing:['text 与 display_text 均为实收字段；不声称完整长文或 Article 正文']});
  else {summary.root=root;for(const item of rows.parse(body.thread)){const record=work(item,'thread');if(record.tweetId!==undefined&&record.tweetId===root.tweetId)continue;add('x_comment',{record,title:record.text??record.display_text??record.tweetId,role:'conversation-item',identityRole:'conversation-author',requestedScope:query,missing:['conversation_id 是会话上下文，不证明直接回复给根帖']});}}
 }else if(route===xTrendingRoute){for(const item of z.array(z.object({name:z.string().min(1),description:text,context:text})).max(2000).parse(body.trends))add('hotspot_research',{title:item.name,record:item,identityRole:'trend-term',missing:['研究词条；未返回排名、热度或新闻原文']});}
 else if([xFollowersRoute,xFollowingRoute,xListMembersRoute,xCommunityMembersRoute].some(x=>x===route)){
  const role=route===xFollowersRoute?'follower':route===xFollowingRoute?'followee':route===xListMembersRoute?'list-member':'community-member';
  const key=route===xFollowersRoute?'followers':route===xFollowingRoute?'following':'members';
  for(const item of rows.parse(body[key])){const record=memberSchema.parse(item);if(!record.user_id&&!record.screen_name&&!record.name&&!record.description)throw new AgentKeyPayloadError('X member has no meaningful fields');add('x_followee',{record,title:record.name??record.screen_name??record.user_id,identityRole:role,role,requestedScope:query,missing:['关系研究，不分配信源或绑定账号']});}
  if(route===xCommunityMembersRoute)summary.limitation='官方仅返回首页约 19 位成员；next_cursor 不可用于分页，不保证完整名单';
 }else{
  const context=route===xPostsRoute&&body.user!=null?profile(body.user,query):undefined;
  if(context)summary.receivedScope={rest_id:context.rest_id??context.id,screen_name:context.profile};
  if(route===xPostsRoute&&body.pinned!=null)addWork(body.pinned,true,context);
  for(const item of rows.parse(body.timeline))addWork(item,false,context);
 }
 if(route!==xCommunityMembersRoute)summary.pagination=z.object({next_cursor:text,prev_cursor:text,cursor:text,more_users:flag}).parse(body);
 return {candidates,summary:{...summary,count:candidates.length}};
}

import {z} from 'zod';
import {object,explicitAgentKeyError} from './response.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {agentKeyBilibiliOperations,bilibiliSearchRoute,bilibiliTypedSearchRoute,bilibiliPostsRoute,bilibiliDetailRoute,bilibiliCommentsRoute,bilibiliRepliesRoute,bilibiliProfileRoute,bilibiliRelationRoute,bilibiliDynamicsRoute,bilibiliTrendingRoute,bilibiliHotSearchRoute,type AgentKeyBilibiliRoute} from './bilibili-contract.ts';
const id=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe().transform(String)]),bv=z.string().regex(/^BV[A-Za-z0-9]{10}$/),count=z.number().finite().nonnegative();
const rawTime=z.union([z.string(),z.number().finite()]);
const pagination=z.object({next:z.string().optional(),page:z.string().optional(),pages:count.optional()});
const cursor=z.object({is_begin:z.boolean().optional(),is_end:z.boolean().optional(),next:count.optional(),prev:count.optional(),pagination_reply:z.object({next_offset:z.string().optional()}).optional(),mode:count.optional()});
export interface BilibiliCandidate {itemKey:string;kind:string;data:Record<string,unknown>}
function same(actual:string,expected:unknown,label:string){if(actual!==expected)throw new AgentKeyPayloadError(`Bilibili ${label} differs from requested scope`);}
function nativeAV(uri:string,av:string){const m=/^bilibili:\/\/video\/(\d+)(?:\?[^#]*)?$/.exec(uri);if(!m||m[1]!==av)throw new AgentKeyPayloadError('Bilibili native URI differs from AV');}
// Prefer string IDs while rejecting contradictory aliases and rounded numeric input.
function commentId(row:Record<string,unknown>,name:string){const value=id.parse(row[`${name}_str`]??row[name]);if(row[name]!==undefined)same(id.parse(row[name]),value,`${name} aliases`);return value;}
export function parseAgentKeyBilibili(response:unknown,route:AgentKeyBilibiliRoute,raw:unknown):{candidates:BilibiliCandidate[];summary:Record<string,unknown>}{
 const op=agentKeyBilibiliOperations.find(o=>o.route===route);if(!op)throw new AgentKeyPayloadError('Unsupported Bilibili route');
 const query=op.schema.parse(raw) as Record<string,unknown>,r=object(response),e=object(r?.envelope),p=object(e?.data),b=object(p?.data);
 if(r?.httpStatus!==200||explicitAgentKeyError(r?.mcp,e)||e?.provider!=='TikHub'||p?.code!==200||!b||(route!==bilibiliRelationRoute&&b.code!==0))throw new AgentKeyPayloadError('Unrecognized Bilibili success envelope');
 const common={platform:'bilibili',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool,importable:false};
 const summary:Record<string,unknown>={count:0,query,snapshot:true,stopReason:'single-request'};
 const candidates:BilibiliCandidate[]=[];
 const add=(kind:string,data:Record<string,unknown>)=>candidates.push({kind,itemKey:`item:${candidates.length}`,data:{...common,...data}});
 const work=(av:string,bvid:string|undefined,title:string,mid:string|undefined,record:Record<string,unknown>,role='native_video')=>add('bilibili_work',{title,workId:bvid??null,avId:av,url:bvid?`https://www.bilibili.com/video/${bvid}`:null,identity:mid?{mid}:{},role,record,publishedAt:null,importable:route===bilibiliDetailRoute&&!!bvid,missing:[...(route===bilibiliDetailRoute?[]:['仅研究，不导入材料']),...(!bvid?['未返回 BV']:[]),'发布时间单位未证实']});
 const d=object(b.data);
 if(route===bilibiliSearchRoute||route===bilibiliTypedSearchRoute){
  const list=z.array(z.object({goto:z.string()}).passthrough()).max(1000).parse(d?.[route===bilibiliSearchRoute?'item':'items']);
  const excluded:Record<string,number>={};
  for(const item of list){
   if(item.goto!=='av'){if(route===bilibiliTypedSearchRoute)throw new AgentKeyPayloadError('Unrecognized video search type');excluded[item.goto]=(excluded[item.goto]??0)+1;continue;}
   const v=z.object({param:id,uri:z.string(),av:z.object({title:z.string().min(1),mid:id.optional(),author:z.string().optional(),play:count.optional(),danmaku:count.optional(),duration:z.string().optional(),ptime:rawTime.optional()})}).parse(item);nativeAV(v.uri,v.param);
   work(v.param,undefined,v.av.title,v.av.mid,{avId:v.param,title:v.av.title,author:v.av.author,mid:v.av.mid,play:v.av.play,danmaku:v.av.danmaku,duration:v.av.duration,rawTimes:{ptime:v.av.ptime}});
  }
  summary.mixedCount=list.length;summary.videoCount=candidates.length;summary.excludedTypeCounts=excluded;
  if(d?.pagination!==undefined)summary.pagination=pagination.parse(d.pagination);
 }else if(route===bilibiliPostsRoute||route===bilibiliTrendingRoute){
  const list=z.array(z.object({goto:z.literal('av'),param:id,bvid:bv,title:z.string().min(1),uri:z.string(),author:z.string().optional(),ctime:rawTime.optional(),duration:count.optional(),idx:count.optional()})).max(1000).parse(route===bilibiliPostsRoute?d?.item:b.data);
  for(const v of list){nativeAV(v.uri,v.param);work(v.param,v.bvid,v.title,undefined,{avId:v.param,bvId:v.bvid,title:v.title,author:v.author,rawTimes:{ctime:v.ctime},duration:v.duration,idx:v.idx},route===bilibiliTrendingRoute?'provider_recommendation':'native_video');}
  if(route===bilibiliPostsRoute&&d?.count!==undefined)summary.accountTotal=count.parse(d.count);
  if(route===bilibiliTrendingRoute)summary.pagination={lastReceivedIdx:list.at(-1)?.idx??null};
 }else if(route===bilibiliDetailRoute){
  const v=z.object({aid:id,bvid:bv,title:z.string().min(1),desc:z.string().optional(),pubdate:rawTime.optional(),ctime:rawTime.optional(),owner:z.object({mid:id.optional(),name:z.string().optional()}).optional(),short_link:z.string().optional(),short_link_v2:z.string().optional()}).parse(d);
  if(query.av_id)same(v.aid,query.av_id,'detail AV');if(query.bv_id)same(v.bvid,query.bv_id,'detail BV');
  for(const value of [v.short_link,v.short_link_v2])if(value){let u:URL;try{u=new URL(value);}catch{throw new AgentKeyPayloadError('Invalid received short link');}if(!['http:','https:'].includes(u.protocol)||u.hostname!=='b23.tv'||u.username||u.password||u.port||u.pathname.replace(/\/$/,'')!==`/${v.bvid}`)throw new AgentKeyPayloadError('Received short link differs from BV');}
  work(v.aid,v.bvid,v.title,v.owner?.mid,{avId:v.aid,bvId:v.bvid,title:v.title,description:v.desc,descriptionRole:'video_description',mid:v.owner?.mid,author:v.owner?.name,rawTimes:{pubdate:v.pubdate,ctime:v.ctime},short_link:v.short_link,short_link_v2:v.short_link_v2});
 }else if(route===bilibiliCommentsRoute||route===bilibiliRepliesRoute){
  const root=route===bilibiliRepliesRoute?object(d?.root):null;
  if(route===bilibiliRepliesRoute&&!root)throw new AgentKeyPayloadError('Missing reply root');
  const rootId=root?commentId(root,'rpid'):null,rootOID=root?commentId(root,'oid'):null;
  if(rootId)same(rootId,query.root,'reply root');if(rootOID&&query.av_id)same(rootOID,query.av_id,'reply AV');
  const list=z.array(z.record(z.string(),z.unknown())).max(1000).parse(root?root.replies:d?.replies);
  let receivedOID=rootOID;
  for(const row of list){
   const cid=commentId(row,'rpid'),oid=commentId(row,'oid'),mid=commentId(row,'mid'),parent=commentId(row,'parent'),rid=commentId(row,'root');
   if(query.av_id)same(oid,query.av_id,'comment AV');if(receivedOID)same(oid,receivedOID,'comment OID');receivedOID=oid;
   if(rootId)same(rid,rootId,'child root');else {same(rid,'0','top-level root');same(parent,'0','top-level parent');}
   const v=z.object({content:z.object({message:z.string()}),member:z.object({mid:id,uname:z.string()}),ctime:rawTime.optional(),like:count.optional(),rcount:count.optional()}).parse(row);same(v.member.mid,mid,'comment author');
   add('social_comment',{title:v.content.message,commentId:cid,role:'comment',identityRole:'comment-author',identity:{mid},requestedScope:query,receivedScope:{av_id:oid,root:rid},scopeVerified:!!query.av_id,record:{rpid:cid,oid,mid,root:rid,parent,content:v.content,member:v.member,ctime:v.ctime,like:v.like,rcount:v.rcount},timeUnits:{ctime:'unspecified'},missing:['评论研究，不提供导入或绑定',...(!query.av_id?['BV 对应 AV 未在本响应证实']:[])]});
  }
  if(d?.cursor!==undefined)summary.pagination=cursor.parse(d.cursor);
  summary.scopeVerified=!!query.av_id;summary.receivedAV=receivedOID;
 }else if(route===bilibiliProfileRoute){
  const card=z.object({mid:id,name:z.string(),handle:z.string().optional(),sign:z.string().optional(),description:z.string().optional(),fans:count.optional(),friend:count.optional(),attention:count.optional(),is_deleted:count.optional()}).parse(d?.card);same(card.mid,query.user_id,'profile MID');
  add('bilibili_account',{title:card.name,identity:{mid:card.mid},record:card,importable:true,missing:[]});
 }else if(route===bilibiliRelationRoute){
  const stats=z.object({mid:id,following:count.optional(),follower:count.optional()}).parse(b);same(stats.mid,query.uid,'relation MID');summary.record=stats;
 }else if(route===bilibiliDynamicsRoute){
  const list=z.array(z.object({id_str:id,type:z.enum(['DYNAMIC_TYPE_AV','DYNAMIC_TYPE_FORWARD']),modules:z.object({module_author:z.object({mid:id,name:z.string(),pub_ts:rawTime.optional()}),module_dynamic:z.object({major:z.object({archive:z.object({bvid:bv,aid:id,title:z.string(),desc:z.string()})}).nullable().optional(),desc:z.object({text:z.string()}).nullable().optional()})}),orig:z.object({type:z.string()}).nullable().optional()})).max(1000).parse(d?.items);
  for(const v of list){const author=v.modules.module_author,body=v.modules.module_dynamic;same(author.mid,query.uid,'dynamic author');const archive=v.type==='DYNAMIC_TYPE_AV'?body.major?.archive:undefined;
   if(v.type==='DYNAMIC_TYPE_AV'&&!archive||v.type==='DYNAMIC_TYPE_FORWARD'&&!body.desc)throw new AgentKeyPayloadError('Missing current dynamic content');
   add('bilibili_dynamic',{title:archive?.title??body.desc!.text,dynamicId:v.id_str,role:'dynamic_research',identity:{mid:author.mid},record:{id_str:v.id_str,type:v.type,author,archive,description:archive?.desc??body.desc!.text,originalType:v.orig?.type??null},publishedAt:null,missing:['动态研究，不作为视频导入','发布时间单位未证实']});
  }
  summary.pagination=z.object({offset:z.string().optional(),has_more:z.boolean().optional(),total:z.string().optional()}).parse(d);
 }else if(route===bilibiliHotSearchRoute){
  const list=z.array(z.object({keyword:z.string().min(1),show_name:z.string(),heat_score:count.optional(),goto:z.string().optional()})).max(1000).parse(object(d?.trending)?.list);
  for(const item of list)add('hotspot_research',{title:item.show_name||item.keyword,role:'hot_search',record:item,missing:['热搜研究；未收到真实排名']});
 }
 return {candidates,summary:{...summary,count:candidates.length}};
}

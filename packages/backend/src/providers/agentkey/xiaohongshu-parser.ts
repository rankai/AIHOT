import {z} from 'zod';
import {object,explicitAgentKeyError} from './response.ts';
import {AgentKeyPayloadError} from './douyin-parser.ts';
import {xiaohongshuNoteId} from '../../lib/url.ts';
import {agentKeyXiaohongshuOperations,xiaohongshuSearchRoute,xiaohongshuPostsRoute,xiaohongshuDetailRoute,xiaohongshuCommentsRoute,xiaohongshuAccountSearchRoute,xiaohongshuProfileRoute,xiaohongshuTopicRoute,xiaohongshuSuggestRoute,xiaohongshuRecommendationsRoute,type AgentKeyXiaohongshuRoute} from './xiaohongshu-contract.ts';
const id=z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),count=z.number().finite().nonnegative();
const user=z.object({userid:id.optional(),id:id.optional(),user_id:id.optional(),nickname:z.string().optional()});
const note=z.object({id,type:z.enum(['normal','video']),title:z.string().optional(),desc:z.string().optional(),user:user.optional(),share_info:z.object({link:z.string()}).optional(),cursor:z.string().optional(),cursor_score:z.string().optional(),create_time:z.number().finite().optional(),last_update_time:z.number().finite().optional(),time:z.number().finite().optional()});
export interface XiaohongshuCandidate {itemKey:string;kind:string;data:Record<string,unknown>}
export function parseAgentKeyXiaohongshu(response:unknown,route:AgentKeyXiaohongshuRoute,raw:unknown):{candidates:XiaohongshuCandidate[];summary:Record<string,unknown>}{
 const op=agentKeyXiaohongshuOperations.find(o=>o.route===route);if(!op)throw new AgentKeyPayloadError('Unsupported Xiaohongshu route');
 const query=op.schema.parse(raw) as Record<string,unknown>,r=object(response),e=object(r?.envelope),p=object(e?.data),b=object(p?.data);
 if(r?.httpStatus!==200||explicitAgentKeyError(r?.mcp,e)||e?.provider!=='TikHub'||p?.code!==200||b?.success!==true||b.code!==(route===xiaohongshuSuggestRoute?1000:0))throw new AgentKeyPayloadError('Unrecognized Xiaohongshu success envelope');
 if([xiaohongshuSuggestRoute,xiaohongshuRecommendationsRoute].some(x=>x===route)&&(b.ok!==true||b.status!==200))throw new AgentKeyPayloadError('Unrecognized Xiaohongshu web success');
 const common={platform:'xiaohongshu',provider:'agentkey',upstream:'TikHub',operationId:op.operationId,tool:route.tool};
 const summary:Record<string,unknown>={count:0,query,stopReason:'single-request',snapshot:true};
 const candidates:XiaohongshuCandidate[]=[];
 const work=(rawNote:unknown,rootUser?:unknown)=>{
  const n=note.parse(rawNote),u=n.user,uid=route===xiaohongshuTopicRoute?u?.user_id:u?.userid;
  if(route===xiaohongshuPostsRoute&&uid&&uid!==query.user_id)throw new AgentKeyPayloadError('Returned note author differs from requested account');
  if(route===xiaohongshuDetailRoute&&(n.id!==query.note_id||(u?.id&&uid&&u.id!==uid)||(object(rootUser)?.userid&&uid&&object(rootUser)!.userid!==uid)))throw new AgentKeyPayloadError('Detail identity differs from original scope');
  const url=[xiaohongshuDetailRoute,xiaohongshuTopicRoute].some(x=>x===route)?n.share_info?.link:undefined;
  if(url&&xiaohongshuNoteId(url)!==n.id)throw new AgentKeyPayloadError('Received native URL differs from note identity');
  if(!n.title&&!n.desc)throw new AgentKeyPayloadError('Note has no meaningful written text');
  const rawTimes=Object.fromEntries(['create_time','last_update_time','time'].filter(k=>typeof n[k as keyof typeof n]==='number').map(k=>[k,n[k as keyof typeof n]]));
  candidates.push({itemKey:`work:${candidates.length}`,kind:'xiaohongshu_work',data:{...common,title:n.title||n.desc,workId:n.id,url:url??null,identity:uid?{userId:uid}:{},role:'native_note',publishedAt:null,record:{workId:n.id,workTitle:n.title??'',description:n.desc??'',workType:n.type,...(uid?{userId:uid}:{}),...(u?.nickname?{authorName:u.nickname}:{}),...(url?{workUrl:url}:{}),rawTimes},timeUnits:Object.fromEntries(Object.keys(rawTimes).map(k=>[k,'unspecified'])),missing:[...(!uid?['缺稳定作者身份']:[]),...(!url?['缺供应商返回的原文链接']:[]),...(!n.desc?['缺笔记文字正文']:[]),'发布时间单位未证实'],importable:!!(uid&&url)}});
 };
 const d=object(b.data);
 if(route===xiaohongshuDetailRoute){
  const groups=z.array(z.object({model_type:z.literal('note'),note_list:z.array(z.unknown()).max(1000),user:user.optional()})).max(1000).parse(b.data);
  for(const g of groups)for(const n of g.note_list)work(n,g.user);
 }else if(route===xiaohongshuSearchRoute){
  const data=z.object({items:z.array(z.discriminatedUnion('model_type',[z.object({model_type:z.literal('note'),note:z.unknown()}),z.object({model_type:z.literal('ads')})])).max(1000)}).parse(d);
  let ads=0;for(const item of data.items){if(item.model_type==='ads')ads++;else work(item.note);}
  summary.excludedAds=ads;summary.pagination=z.object({search_id:z.string().optional(),search_session_id:z.string().optional(),page:z.number().int().optional(),next_page:z.number().int().optional()}).parse(b);
 }else if(route===xiaohongshuPostsRoute){
  const data=z.object({notes:z.array(note).max(1000),has_more:z.boolean()}).parse(d);for(const n of data.notes)work(n);
  summary.pagination={has_more:data.has_more,lastCursor:data.notes.at(-1)?.cursor??null};
 }else if(route===xiaohongshuTopicRoute){
  const data=z.object({items:z.array(note).max(1000),has_more:z.boolean()}).parse(d);for(const n of data.items)work(n);
  const last=data.items.at(-1);summary.pagination={has_more:data.has_more,lastNoteId:last?.id??null,cursor_score:last?.cursor_score??null,create_time:last?.create_time??null};
 }else if(route===xiaohongshuCommentsRoute){
  const data=z.object({comments:z.array(z.object({id,content:z.string(),note_id:id,time:z.number().finite().optional(),like_count:count.optional(),sub_comment_count:count.optional(),user:z.object({userid:id,nickname:z.string()}).optional()})).max(1000),cursor:z.string(),has_more:z.boolean(),page_context:z.string()}).parse(d);
  for(const c of data.comments){if(c.note_id!==query.note_id)throw new AgentKeyPayloadError('Comment note differs from requested scope');candidates.push({kind:'social_comment',itemKey:`item:${candidates.length}`,data:{...common,title:c.content,commentId:c.id,role:'comment',identityRole:'comment-author',identity:c.user?{userId:c.user.userid}:{},record:c,requestedScope:query,receivedScope:{note_id:c.note_id},timeUnits:{time:'unspecified'},missing:['仅用于评论研究，不提供材料导入和账号绑定']}});}
  summary.pagination={cursor:data.cursor,has_more:data.has_more,page_context:data.page_context};
 }else if(route===xiaohongshuAccountSearchRoute||route===xiaohongshuProfileRoute){
  let accounts:{id:string;name:string;desc?:string;red_id?:string;stats?:unknown}[];
  if(route===xiaohongshuAccountSearchRoute){accounts=z.object({users:z.array(z.object({id,name:z.string(),desc:z.string().optional(),red_id:z.string().optional()})).max(1000)}).parse(d).users;summary.pagination=z.object({search_id:z.string().optional(),page:z.number().int().optional(),next_page:z.number().int().optional()}).parse(b);}
  else {const a=z.object({result:z.object({success:z.literal(true),code:z.literal(0)}),userid:id,nickname:z.string(),desc:z.string().optional(),red_id:z.string().optional(),fans:count.optional(),follows:count.optional(),liked:count.optional(),collected:count.optional(),note_num_stat:z.object({liked:count,collected:count,posted:count}).optional()}).parse(d);if(a.userid!==query.user_id)throw new AgentKeyPayloadError('Profile identity differs');accounts=[{id:a.userid,name:a.nickname,desc:a.desc,red_id:a.red_id,stats:{fans:a.fans,follows:a.follows,liked:a.liked,collected:a.collected,note_num_stat:a.note_num_stat}}];}
  for(const a of accounts)candidates.push({kind:'xiaohongshu_account',itemKey:`account:${candidates.length}`,data:{...common,title:a.name,identity:{userId:a.id},record:a,missing:['账号研究，绑定需核验原始回执'],importable:true}});
 }else if(route===xiaohongshuSuggestRoute){
  const data=z.object({sug_items:z.array(z.object({text:z.string().min(1)})).max(1000)}).parse(d);for(const s of data.sug_items)candidates.push({kind:'search_suggestion',itemKey:`item:${candidates.length}`,data:{...common,title:s.text,role:'search_suggestion',record:s}});
 }else if(route===xiaohongshuRecommendationsRoute){
  const data=z.object({items:z.array(z.object({id,model_type:z.literal('note'),note_card:z.object({type:z.enum(['normal','video']),display_title:z.string()})})).max(1000),cursor_score:z.string()}).parse(d);
  for(const n of data.items)candidates.push({kind:'xiaohongshu_work',itemKey:`item:${candidates.length}`,data:{...common,title:n.note_card.display_title,workId:n.id,role:'provider_recommendation',identity:{},record:{workId:n.id,workTitle:n.note_card.display_title,workType:n.note_card.type},missing:['供应商推荐，仅研究；不导入材料或绑定来源'],importable:false}});summary.pagination={cursor_score:data.cursor_score};
 }
 return {candidates,summary:{...summary,count:candidates.length}};
}

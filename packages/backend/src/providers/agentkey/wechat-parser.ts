import {z} from "zod";
import {object} from "./response.ts";
import {AgentKeyPayloadError} from "./douyin-parser.ts";
import {wechatArticleUrl,type WechatIdentity} from "../redfox/wechat.ts";
import {agentKeyWechatOperations,wechatArticlesRoute,wechatDetailRoute,wechatProfileRoute,wechatCommentsRoute,wechatRepliesRoute,type AgentKeyWechatRoute} from "./wechat-contract.ts";
const id=z.union([z.string().regex(/^\d+$/),z.number().int().nonnegative().safe().transform(String)]);
const text=z.string().nullable().optional();
const count=z.number().int().nonnegative().safe();
const identity=(username:unknown,url?:unknown):WechatIdentity=>{
  const address=wechatArticleUrl(url);
  return {...(typeof username==='string'&&/^gh_[A-Za-z0-9]+(?:@app)?$/.test(username)?{wxId:username}:{}),...(address?.bizInfo?{bizInfo:address.bizInfo}:{})};
};
function seconds(value:unknown){const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;if(typeof n!=='number'||!Number.isSafeInteger(n)||n<=0)return null;const d=new Date(n*1000);return Number.isFinite(d.getTime())?d.toISOString():null;}
const article=z.object({app_msg_id:id,title:z.string(),digest:text,url:z.string().refine(v=>!!wechatArticleUrl(v)),idx:id}).passthrough();
const comment=z.object({content_id:id,content:z.string(),nick_name:text}).passthrough();
const reply=z.object({reply_id:id,content:z.string(),nick_name:text}).passthrough();
export interface WechatCandidate {itemKey:string;kind:string;data:Record<string,unknown>}
/** Only documented raw=false fields; an absent data object is never a legal empty page. */
export function parseAgentKeyWechat(response:unknown,route:AgentKeyWechatRoute,raw:unknown):{candidates:WechatCandidate[];summary:Record<string,unknown>} {
  const op=agentKeyWechatOperations.find(o=>o.route===route);if(!op)throw new AgentKeyPayloadError('Unregistered WeChat route');
  const input=op.schema.parse(raw) as Record<string,unknown>,envelope=object(object(response)?.envelope),payload=object(envelope?.data),body=object(payload?.data);
  if(envelope?.provider!=='TikHub'||payload?.code!==200||!body)throw new AgentKeyPayloadError('Unrecognized WeChat success envelope');
  for(const field of ['ret','errcode','status_code'])if(body[field]!==undefined&&body[field]!==0)throw new AgentKeyPayloadError('WeChat business rejection');
  const common={platform:'wechat',operationId:op.operationId,provider:'agentkey',upstream:'TikHub',tool:route.tool};
  const candidate=(kind:string,itemKey:string,data:Record<string,unknown>):WechatCandidate=>({kind,itemKey,data:{...common,...data}});
  let candidates:WechatCandidate[]=[],pagination:Record<string,unknown>|undefined;
  if(route===wechatArticlesRoute){
    const page=z.object({biz_username:z.string().min(1),is_end:z.union([z.literal(0),z.literal(1)]),count, next_offset:z.string().nullable(),articles:z.array(article).max(1000)}).parse(body);
    if(/^gh_/.test(String(input.username))&&page.biz_username!==input.username)throw new AgentKeyPayloadError('Returned account differs from requested account');
    if(page.count!==page.articles.length||(!page.is_end&&!page.next_offset))throw new AgentKeyPayloadError('Invalid WeChat article page');
    pagination={hasMore:page.is_end===0,cursor:page.next_offset};
    candidates=page.articles.map((r,i)=>candidate('wechat_work',`work:${i}`,{title:r.title,url:wechatArticleUrl(r.url)!.url,identity:identity(page.biz_username,r.url),publishedAt:null,
      record:{app_msg_id:r.app_msg_id,idx:r.idx,title:r.title,url:r.url,account:page.biz_username,articleSummary:r.digest,coverUrl:typeof r.cover==='string'?r.cover:null},missing:['create_time_unit','fulltext']}));
  }else if(route===wechatDetailRoute){
    const page=z.object({url:z.string().refine(v=>!!wechatArticleUrl(v)),content:z.object({title:z.string(),user_name:z.string().min(1),nick_name:text,link:z.string().refine(v=>!!wechatArticleUrl(v)).optional(),mid:id.optional(),idx:id.optional(),_content_type:z.enum(['article','immersive','video','unknown']),content_noencode:text,content_text:text}).passthrough()}).parse(body);
    const requested=wechatArticleUrl(input.url)!,returned=wechatArticleUrl(page.url)!,link=wechatArticleUrl(page.content.link);
    if(!!requested.bizInfo===!!returned.bizInfo&&requested.url!==returned.url)throw new AgentKeyPayloadError('H5 response article differs from request');
    if(link&&!link.bizInfo&&link.url!==returned.url)throw new AgentKeyPayloadError('H5 content short URL disagrees');
    if(link?.bizInfo){if(returned.bizInfo&&returned.url!==link.url)throw new AgentKeyPayloadError('H5 returned long URLs disagree');const u=new URL(link.url);if((page.content.mid&&u.searchParams.get('mid')!==page.content.mid)||(page.content.idx&&u.searchParams.get('idx')!==page.content.idx)||(requested.bizInfo&&requested.url!==link.url))throw new AgentKeyPayloadError('H5 content and URL identity disagree');}
    const address=link??returned,aliasConfirmed=!!(link?.bizInfo&&page.content.mid&&page.content.idx&&returned.url===requested.url);
    const publishedAt=seconds(page.content.create_timestamp)??seconds(page.content.ori_create_time);
    candidates=[candidate('wechat_work','work:0',{title:page.content.title,url:address.url,requestedUrl:requested.url,aliasConfirmed,identity:identity(page.content.user_name,address.url),publishedAt,
      record:{title:page.content.title,mid:page.content.mid,idx:page.content.idx,_content_type:page.content._content_type,author:typeof page.content.author==='string'?page.content.author:null,coverUrl:typeof page.content.cdn_url==='string'?page.content.cdn_url:null,account:page.content.user_name,articleContent:page.content._content_type==='article'?page.content.content_noencode:null,articleSummary:page.content.desc??null,publishDate:publishedAt},
      missing:page.content._content_type==='article'&&page.content.content_noencode?[]:['fulltext']})];
  }else if(route===wechatProfileRoute){
    const r=z.object({user_name:z.string().min(1),nick_name:text,signature:z.null().optional(),head_url:z.null().optional()}).passthrough().parse(body);
    if(/^gh_/.test(String(input.username))&&r.user_name!==input.username)throw new AgentKeyPayloadError('Returned profile differs from requested account');
    candidates=[candidate('wechat_account','account:0',{title:r.nick_name??r.user_name,identity:identity(r.user_name),record:{...r,account:r.user_name},missing:['signature','head_url']})];
  }else if(route===wechatCommentsRoute){
    const p=z.object({appmsgid:id,comment_id:id,buffer:z.string(),has_more:z.boolean(),comments:z.array(comment).max(1000)}).parse(body);
    if(input.comment_id&&p.comment_id!==input.comment_id)throw new AgentKeyPayloadError('Article comment context differs');
    const u=new URL(String(input.url));if(u.searchParams.has('mid')&&u.searchParams.get('mid')!==p.appmsgid)throw new AgentKeyPayloadError('Article message context differs');
    if(p.has_more&&!p.buffer)throw new AgentKeyPayloadError('Missing comments continuation');
    pagination={hasMore:p.has_more,cursor:p.buffer};
    candidates=p.comments.map((r,i)=>candidate('wechat_comment',`comment:${i}`,{title:r.content,url:input.url,record:r,commentId:r.content_id,articleCommentId:p.comment_id}));
  }else if(route===wechatRepliesRoute){
    const p=z.object({content_id:id,count,replies:z.array(reply).max(1000),offset:count,next_offset:count,has_more:z.boolean()}).parse(body);
    if(p.content_id!==input.content_id||p.offset!==input.offset||p.count!==p.replies.length||(p.has_more&&p.next_offset<=p.offset))throw new AgentKeyPayloadError('Reply parent or pagination differs');
    pagination={hasMore:p.has_more,cursor:p.next_offset};
    candidates=p.replies.map((r,i)=>candidate('wechat_reply',`reply:${i}`,{title:r.content,url:input.url,record:r,parentCommentId:p.content_id,replyId:r.reply_id}));
  }else{
    const p=z.object({comment_count:count,elected_comment_count:count}).parse(body);
    const unavailable=['read_num','like_count','old_like_count','share_count','collect_count','star_num'];
    if(unavailable.some(k=>body[k]!==undefined&&body[k]!==null))throw new AgentKeyPayloadError('Unsupported statistics supplied');
    candidates=[candidate('wechat_stats','stats:0',{title:'公众号文章评论统计',url:input.url,record:{...p,...Object.fromEntries(unavailable.map(k=>[k,null])),unavailable}})];
  }
  return {candidates,summary:{count:candidates.length,query:input,...(pagination?{pagination}:{}),stopReason:'single-request'}};
}

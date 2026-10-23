import {z} from 'zod';
import type {PlatformField} from '@aihot/contracts/redfox';
const id=z.string().regex(/^\d+$/).max(100),keyword=z.string().trim().min(1).max(200);
export const weiboSearchInput=z.strictObject({query:keyword,page:z.literal(1).default(1),search_type:z.union([z.literal(1),z.literal(61)]).default(1)});
export const weiboPostsInput=z.strictObject({uid:id,page:z.literal(1).default(1),filter_type:z.literal('all').default('all')});
export const weiboDetailInput=z.strictObject({status_id:id});
export const weiboCommentsInput=z.strictObject({status_id:id,sort_type:z.literal('0').default('0')});
export const weiboProfileInput=z.strictObject({uid:id});
export const weiboFollowingInput=z.strictObject({uid:id,sort_type:z.literal(2).default(2)});
export const weiboTrendingInput=z.strictObject({category:z.literal('realtimehot').default('realtimehot'),page:z.literal(1).default(1),count:z.number().int().min(1).max(50).default(20)});
export const weiboRelatedInput=z.strictObject({keyword});
const common={contractVersion:1,provider:'agentkey',upstream:'TikHub',recovery:'readOnly',estimatedCredits:.2} as const;
export const weiboSearchRoute={...common,operationKey:'agentkey.weibo.search',stepKey:'agentkey.weibo.search.query',tool:'TikHub/fetch_search_all_api_v1_weibo_app_fetch_search_all_get'} as const;
export const weiboPostsRoute={...common,operationKey:'agentkey.weibo.account_posts',stepKey:'agentkey.weibo.account_posts.query',tool:'TikHub/fetch_user_timeline_api_v1_weibo_app_fetch_user_timeline_get'} as const;
export const weiboDetailRoute={...common,operationKey:'agentkey.weibo.detail',stepKey:'agentkey.weibo.detail.query',tool:'TikHub/fetch_status_detail_api_v1_weibo_app_fetch_status_detail_get'} as const;
export const weiboCommentsRoute={...common,operationKey:'agentkey.weibo.comments',stepKey:'agentkey.weibo.comments.query',tool:'TikHub/fetch_status_comments_api_v1_weibo_app_fetch_status_comments_get'} as const;
export const weiboProfileRoute={...common,operationKey:'agentkey.weibo.account_profile',stepKey:'agentkey.weibo.account_profile.query',tool:'TikHub/fetch_user_info_api_v1_weibo_app_fetch_user_info_get'} as const;
export const weiboFollowingRoute={...common,operationKey:'agentkey.weibo.following',stepKey:'agentkey.weibo.following.query',tool:'TikHub/fetch_user_following_api_v1_weibo_app_fetch_user_following_get'} as const;
export const weiboTrendingRoute={...common,operationKey:'agentkey.weibo.trending',stepKey:'agentkey.weibo.trending.query',tool:'TikHub/fetch_hot_search_api_v1_weibo_app_fetch_hot_search_get'} as const;
export const weiboRelatedRoute={...common,operationKey:'agentkey.weibo.related_search',stepKey:'agentkey.weibo.related_search.query',tool:'TikHub/fetch_similar_search_api_v1_weibo_web_v2_fetch_similar_search_get'} as const;
export const agentKeyWeiboOperations=[
 {operationId:'TXQPVGJG',route:weiboSearchRoute,schema:weiboSearchInput,querySchema:weiboSearchInput},
 {operationId:'weibo.account_posts',route:weiboPostsRoute,schema:weiboPostsInput,querySchema:weiboPostsInput},
 {operationId:'API_1789098514899',route:weiboDetailRoute,schema:weiboDetailInput,querySchema:weiboDetailInput},
 {operationId:'weibo.comments',route:weiboCommentsRoute,schema:weiboCommentsInput,querySchema:weiboCommentsInput},
 {operationId:'API_1789098515117',route:weiboProfileRoute,schema:weiboProfileInput,querySchema:weiboProfileInput},
 {operationId:'weibo.following',route:weiboFollowingRoute,schema:weiboFollowingInput,querySchema:weiboFollowingInput},
 {operationId:'UAQ90A1F',route:weiboTrendingRoute,schema:weiboTrendingInput,querySchema:weiboTrendingInput},
 {operationId:'weibo.related_search',route:weiboRelatedRoute,schema:weiboRelatedInput,querySchema:weiboRelatedInput},
] as const;
export const weiboCollectionIds=['TXQPVGJG','weibo.account_posts','weibo.comments','weibo.following','UAQ90A1F','weibo.related_search'] as const;
export const weiboEnrichmentIds=['TXQPVGJG','weibo.account_posts'] as const;
export type AgentKeyWeiboRoute=typeof agentKeyWeiboOperations[number]['route'];
const textField=(name:string,label:string):PlatformField=>({name,label,type:'string',required:true,constraints:{maxLength:200}});
const fixed=(name:string,label:string,value:string|number):PlatformField=>typeof value==='number'?{name,label,type:'integer',required:true,default:value,constraints:{min:value,max:value}}:{name,label,type:'select',required:true,default:value,options:[{value,label:String(value)}]};
const fields:PlatformField[][]=[
 [textField('query','关键词'),fixed('page','首页',1),{name:'search_type',label:'搜索类别',type:'integer',required:true,default:1,hint:'1 综合；61 实时',constraints:{min:1,max:61}}],
 [textField('uid','用户 UID'),fixed('page','首页',1),fixed('filter_type','内容范围','all')],
 [textField('status_id','作品数字 ID')],
 [textField('status_id','作品数字 ID'),fixed('sort_type','默认排序','0')],
 [textField('uid','用户 UID')],
 [textField('uid','用户 UID'),fixed('sort_type','按关注时间',2)],
 [fixed('category','实时热搜','realtimehot'),fixed('page','首页',1),{name:'count',label:'请求数量',type:'integer',required:true,default:20,constraints:{min:1,max:50}}],
 [textField('keyword','关键词')],
];
const labels=['微博作品搜索','微博账号作品','微博作品详情','微博评论','微博用户资料','微博关注列表','微博热搜','微博相关搜索词'];
const price={amount:.2,currency:'credits',basis:'estimated'} as const;
export const weiboProviderVariants=agentKeyWeiboOperations.map((o,i)=>({id:'agentkey' as const,label:'AgentKey · TikHub',operationId:o.operationId,operationLabel:labels[i]!,fields:fields[i]!,purpose:[weiboSearchRoute,weiboPostsRoute,weiboDetailRoute].some(r=>r===o.route)?'实收作者 UID 与作品数字 ID 齐全时可本地导入；长微博正文待补；不自动追加付费详情':o.route===weiboProfileRoute?'核验原始回执中的实收 UID 后可绑定账号':'每轮仅首页研究快照，不导入材料或绑定账号；不自动翻页',collectionPrice:price,collectionCapabilities:{detailEnrichment:(weiboEnrichmentIds as readonly string[]).includes(o.operationId),detailOperations:(weiboEnrichmentIds as readonly string[]).includes(o.operationId)?[{operationId:'API_1789098514899',label:'微博详情（实收数字 ID，有界补全）',fields:[],price}]:[]}}));
export const weiboResearchDescriptors=weiboProviderVariants.filter(v=>v.operationId.startsWith('weibo.')).map(v=>({id:v.operationId,platform:'weibo',label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:(weiboCollectionIds as readonly string[]).includes(v.operationId)?'list' as const:null,collectionProviders:[v],collectionPrice:price,collectionCapabilities:v.collectionCapabilities}));

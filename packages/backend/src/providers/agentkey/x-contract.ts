import {z} from 'zod';
import type {PlatformField} from '@aihot/contracts/redfox';
const id=z.string().regex(/^\d+$/).max(100),handle=z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
export const xSearchInput=z.strictObject({keyword:z.string().min(1).max(2000).refine(v=>v.trim().length>0),search_type:z.enum(['Top','Latest']).default('Top')});
// Only plain keyword semantics are evidenced for recurring snapshots; Q stays broader.
export const xCollectionSearchInput=xSearchInput.refine(p=>/^[\p{L}\p{N}\s]+$/u.test(p.keyword)&&!p.keyword.split(/\s+/u).some(word=>/^(?:OR|AND|NOT)$/.test(word)),'X subscriptions support plain keywords only; advanced expressions remain query-only');
export const xAccountInput=z.strictObject({screen_name:handle.optional(),rest_id:z.number().int().positive().safe().optional()}).refine(v=>(v.screen_name!==undefined)!==(v.rest_id!==undefined),'Provide exactly one screen_name or safe integer rest_id');
export const xTweetInput=z.strictObject({tweet_id:id}),xRelationshipInput=z.strictObject({screen_name:handle}),xListInput=z.strictObject({list_id:id}),xCommunityInput=z.strictObject({community_id:id});
export const xCommunityPostsInput=z.strictObject({community_id:id,ranking:z.enum(['Relevance','Recency']).optional()});
export const xCountries=['UnitedStates','China','India','Japan','Russia','Germany','Indonesia','Brazil','France','UnitedKingdom','Turkey','Italy','Mexico','SouthKorea','Canada','Spain','SaudiArabia','Egypt','Australia','Poland','Iran','Pakistan','Vietnam','Nigeria','Bangladesh','Netherlands','Argentina','Philippines','Malaysia','Colombia','UniteArabEmirates','Romania','Belgium','Switzerland','Singapore','Sweden','Norway','Austria','Kazakhstan','Algeria','Chile','Czechia','Peru','Iraq','Israel','Ukraine','Denmark','Portugal','Hungary','Greece','Finland','NewZealand','Belarus','Slovakia','Serbia','Lithuania','Luxembourg','Estonia'] as const;
export const xTrendingInput=z.strictObject({country:z.enum(xCountries).default('UnitedStates')});
const common={contractVersion:1,provider:'agentkey',upstream:'TikHub',recovery:'readOnly',estimatedCredits:.2} as const;
function route<K extends string,T extends string>(key:K,tool:T){return {...common,operationKey:`agentkey.x.${key}` as const,stepKey:`agentkey.x.${key}.query` as const,tool};}
export const xSearchRoute=route('search','TikHub/fetch_search_timeline_api_v1_twitter_web_fetch_search_timeline_get');
export const xPostsRoute=route('account_posts','TikHub/fetch_user_post_tweet_api_v1_twitter_web_fetch_user_post_tweet_get');
export const xDetailRoute=route('detail','TikHub/fetch_tweet_detail_api_v1_twitter_web_fetch_tweet_detail_get');
export const xCommentsRoute=route('comments','TikHub/fetch_post_comments_api_v1_twitter_web_fetch_post_comments_get');
export const xProfileRoute=route('account_profile','TikHub/fetch_user_profile_api_v1_twitter_web_fetch_user_profile_get');
export const xFollowersRoute=route('followers','TikHub/fetch_user_followers_api_v1_twitter_web_fetch_user_followers_get');
export const xFollowingRoute=route('following','TikHub/fetch_user_followings_api_v1_twitter_web_fetch_user_followings_get');
export const xListPostsRoute=route('list_posts','TikHub/fetch_list_timeline_api_v1_twitter_web_fetch_list_timeline_get');
export const xCommunityPostsRoute=route('community_posts','TikHub/fetch_community_timeline_api_v1_twitter_web_fetch_community_timeline_get');
export const xTrendingRoute=route('trending','TikHub/fetch_trending_api_v1_twitter_web_fetch_trending_get');
export const xListMembersRoute=route('list_members','TikHub/fetch_list_members_api_v1_twitter_web_fetch_list_members_get');
export const xCommunityMembersRoute=route('community_members','TikHub/fetch_community_members_api_v1_twitter_web_fetch_community_members_get');
export const agentKeyXOperations=[
 {operationId:'5K5EG87P',route:xSearchRoute,schema:xSearchInput,querySchema:xSearchInput},
 {operationId:'x.account_posts',route:xPostsRoute,schema:xAccountInput,querySchema:xAccountInput},
 {operationId:'x.detail',route:xDetailRoute,schema:xTweetInput,querySchema:xTweetInput},
 {operationId:'ABJQXHUE',route:xCommentsRoute,schema:xTweetInput,querySchema:xTweetInput},
 {operationId:'x.account_profile',route:xProfileRoute,schema:xAccountInput,querySchema:xAccountInput},
 {operationId:'x.followers',route:xFollowersRoute,schema:xRelationshipInput,querySchema:xRelationshipInput},
 {operationId:'5QY3G5TY',route:xFollowingRoute,schema:xRelationshipInput,querySchema:xRelationshipInput},
 {operationId:'x.list_posts',route:xListPostsRoute,schema:xListInput,querySchema:xListInput},
 {operationId:'x.community_posts',route:xCommunityPostsRoute,schema:xCommunityPostsInput,querySchema:xCommunityPostsInput},
 {operationId:'x.trending',route:xTrendingRoute,schema:xTrendingInput,querySchema:xTrendingInput},
 {operationId:'x.list_members',route:xListMembersRoute,schema:xListInput,querySchema:xListInput},
 {operationId:'x.community_members',route:xCommunityMembersRoute,schema:xCommunityInput,querySchema:xCommunityInput},
] as const;
export const xCollectionIds=['5K5EG87P','x.account_posts','ABJQXHUE','x.followers','5QY3G5TY','x.list_posts','x.community_posts','x.trending','x.list_members','x.community_members'] as const;
export type AgentKeyXRoute=typeof agentKeyXOperations[number]['route'];
const field=(name:string,label:string,required=true):PlatformField=>({name,label,type:'string',required});
const select=(name:string,label:string,values:readonly string[],defaultValue?:string):PlatformField=>({name,label,type:'select',required:defaultValue!==undefined,...(defaultValue?{default:defaultValue}:{}),options:values.map(value=>({value,label:value}))});
const accountFields:PlatformField[]=[{...field('screen_name','账号名',false),hint:'与用户 ID 二选一，不含 @',constraints:{maxLength:15}},{name:'rest_id',label:'用户 ID（安全整数）',type:'integer',required:false,hint:'与账号名二选一；较大 ID 请改用账号名',constraints:{min:1,max:Number.MAX_SAFE_INTEGER}}];
const fields:PlatformField[][]=[[field('keyword','关键词'),select('search_type','排序',['Top','Latest'],'Top')],accountFields,[field('tweet_id','帖子 ID')],[field('tweet_id','会话根帖 ID')],accountFields,[field('screen_name','账号名')],[field('screen_name','账号名')],[field('list_id','列表 ID')],[field('community_id','社区 ID'),select('ranking','排序',['Relevance','Recency'])],[select('country','国家',xCountries,'UnitedStates')],[field('list_id','列表 ID')],[field('community_id','社区 ID')]];
const labels=['X 帖子搜索','X 账号帖子','X 帖子详情','X 会话评论','X 账号资料','X 粉丝列表','X 关注列表','X 列表帖子','X 社区帖子','X 趋势词','X 列表成员','X 社区成员'];
const price={amount:.2,currency:'credits',basis:'estimated'} as const;
export const xProviderVariants=agentKeyXOperations.map((o,i)=>({id:'agentkey' as const,label:'AgentKey · TikHub',operationId:o.operationId,operationLabel:labels[i]!,fields:fields[i]!,purpose:(o.route===xProfileRoute?'单次账号资料查询；可显式绑定已有匹配的单账号 X 主信源，不自动创建信源或绑定':[xSearchRoute,xPostsRoute,xDetailRoute,xListPostsRoute,xCommunityPostsRoute].some(route=>route===o.route)?'单次首页或单对象查询；作品身份与原文齐全的普通帖可按所属信源显式本地导入，正文保持待确认，不声称完整长文或 Article；不自动导入或翻页':o.route===xCommunityMembersRoute?'官方仅返回首页约 19 位成员，游标不可用，不保证完整名单；仅研究':o.route===xCommentsRoute?'首页会话研究；会话根不代表直接回复对象；不自动翻页、导入或绑定':'单次首页或单对象研究；不自动翻页、导入材料或绑定账号')+((xCollectionIds as readonly string[]).includes(o.operationId)?'；订阅每轮仅首页快照，零详情，不代表原生 X 主采集；普通作品按实收证据入库，其余只作研究':''),collectionPrice:price,collectionCapabilities:{detailEnrichment:false,detailOperations:[]}}));
export const xResearchDescriptors=xProviderVariants.filter(v=>v.operationId.startsWith('x.')).map(v=>({id:v.operationId,platform:'x-research',label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:(xCollectionIds as readonly string[]).includes(v.operationId)?(v.operationId==='x.trending'?'trend' as const:'list' as const):null,collectionProviders:[v],collectionPrice:price,collectionCapabilities:v.collectionCapabilities}));

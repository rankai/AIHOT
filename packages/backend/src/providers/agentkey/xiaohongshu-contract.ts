import {z} from 'zod';
import type {PlatformField,PlatformOperationDescriptor} from '@aihot/contracts/redfox';
// Homepage contracts only. Native IDs keep request/response scope verifiable; short-link resolution is not exposed.
const id=z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),keyword=z.string().trim().min(1).max(500),empty=z.literal('').default('');
export const xiaohongshuSearchInput=z.strictObject({keyword,page:z.literal(1).default(1),sort_type:z.literal('general').default('general'),note_type:z.enum(['不限','视频笔记','普通笔记','直播笔记']).default('不限'),time_filter:z.enum(['不限','一天内','一周内','半年内']).default('不限'),search_id:empty,search_session_id:empty,source:z.literal('explore_feed').default('explore_feed'),ai_mode:z.literal(0).default(0)});
export const xiaohongshuPostsInput=z.strictObject({user_id:id,cursor:empty});
export const xiaohongshuDetailInput=z.strictObject({note_id:id});
export const xiaohongshuCommentsInput=z.strictObject({note_id:id,cursor:empty,index:z.literal(0).default(0),pageArea:z.enum(['UNFOLDED','FOLDED']).default('UNFOLDED'),sort_strategy:z.enum(['default','latest_v2','like_count']).default('latest_v2')});
export const xiaohongshuAccountSearchInput=z.strictObject({keyword,page:z.literal(1).default(1),search_id:empty,source:z.literal('explore_feed').default('explore_feed')});
export const xiaohongshuProfileInput=z.strictObject({user_id:id});
export const xiaohongshuTopicInput=z.strictObject({page_id:id,sort:z.enum(['trend','time']).default('trend'),cursor_score:empty,first_load_time:empty,last_note_ct:empty,last_note_id:empty,session_id:empty,source:z.literal('normal').default('normal')});
export const xiaohongshuSuggestInput=z.strictObject({keyword:z.string().max(500).default('')});
export const xiaohongshuRecommendationsInput=z.strictObject({num:z.number().int().min(1).max(40).default(20),category:z.string().min(1).max(200).default('homefeed_recommend'),cursor_score:empty,need_filter_image:z.boolean().default(false)});
const common={contractVersion:1,provider:'agentkey',upstream:'TikHub',recovery:'readOnly',estimatedCredits:2} as const;
function route<K extends string,T extends string>(key:K,tool:T){return {...common,operationKey:`agentkey.xiaohongshu.${key}` as const,stepKey:`agentkey.xiaohongshu.${key}.query` as const,tool};}
export const xiaohongshuSearchRoute=route('search','TikHub/search_notes_api_v1_xiaohongshu_app_v2_search_notes_get');
export const xiaohongshuPostsRoute=route('account_posts','TikHub/get_user_posted_notes_api_v1_xiaohongshu_app_v2_get_user_posted_notes_get');
export const xiaohongshuDetailRoute=route('detail','TikHub/get_image_note_detail_api_v1_xiaohongshu_app_v2_get_image_note_detail_get');
export const xiaohongshuCommentsRoute=route('comments','TikHub/get_note_comments_api_v1_xiaohongshu_app_v2_get_note_comments_get');
export const xiaohongshuAccountSearchRoute=route('account_search','TikHub/search_users_api_v1_xiaohongshu_app_v2_search_users_get');
export const xiaohongshuProfileRoute=route('account_profile','TikHub/get_user_info_api_v1_xiaohongshu_app_v2_get_user_info_get');
export const xiaohongshuTopicRoute=route('topic_posts','TikHub/get_topic_feed_api_v1_xiaohongshu_app_v2_get_topic_feed_get');
export const xiaohongshuSuggestRoute=route('suggest','TikHub/fetch_search_suggest_api_v1_xiaohongshu_web_v3_fetch_search_suggest_get');
export const xiaohongshuRecommendationsRoute=route('recommendations','TikHub/fetch_homefeed_api_v1_xiaohongshu_web_v3_fetch_homefeed_get');
export const agentKeyXiaohongshuOperations=[
 {operationId:'384C6W6B',route:xiaohongshuSearchRoute,schema:xiaohongshuSearchInput,querySchema:xiaohongshuSearchInput,label:'小红书笔记搜索',field:'keyword'},
 {operationId:'XN3ULENA',route:xiaohongshuPostsRoute,schema:xiaohongshuPostsInput,querySchema:xiaohongshuPostsInput,label:'小红书账号笔记',field:'user_id'},
 {operationId:'KR1LPTBF',route:xiaohongshuDetailRoute,schema:xiaohongshuDetailInput,querySchema:xiaohongshuDetailInput,label:'小红书笔记详情（含视频文字）',field:'note_id'},
 {operationId:'xiaohongshu.comments',route:xiaohongshuCommentsRoute,schema:xiaohongshuCommentsInput,querySchema:xiaohongshuCommentsInput,label:'小红书评论首页',field:'note_id'},
 {operationId:'439NFLBD',route:xiaohongshuAccountSearchRoute,schema:xiaohongshuAccountSearchInput,querySchema:xiaohongshuAccountSearchInput,label:'小红书账号搜索',field:'keyword'},
 {operationId:'xiaohongshu.account_profile',route:xiaohongshuProfileRoute,schema:xiaohongshuProfileInput,querySchema:xiaohongshuProfileInput,label:'小红书账号资料',field:'user_id'},
 {operationId:'xiaohongshu.topic_posts',route:xiaohongshuTopicRoute,schema:xiaohongshuTopicInput,querySchema:xiaohongshuTopicInput,label:'小红书话题笔记首页',field:'page_id'},
 {operationId:'xiaohongshu.suggest',route:xiaohongshuSuggestRoute,schema:xiaohongshuSuggestInput,querySchema:xiaohongshuSuggestInput,label:'小红书搜索建议',field:'keyword'},
 {operationId:'xiaohongshu.recommendations',route:xiaohongshuRecommendationsRoute,schema:xiaohongshuRecommendationsInput,querySchema:xiaohongshuRecommendationsInput,label:'小红书推荐研究',field:null},
] as const;
export type AgentKeyXiaohongshuRoute=typeof agentKeyXiaohongshuOperations[number]['route'];
export const xiaohongshuCollectionIds=['384C6W6B','XN3ULENA','xiaohongshu.topic_posts','xiaohongshu.comments','xiaohongshu.recommendations'] as const;
const price={amount:2,currency:'credits',basis:'estimated'} as const;
export const xiaohongshuProviderVariants=agentKeyXiaohongshuOperations.map(o=>({id:'agentkey' as const,label:'AgentKey · TikHub',operationId:o.operationId,operationLabel:o.label,fields:o.field?[{name:o.field,label:({keyword:'关键词',user_id:'稳定用户 ID',note_id:'笔记 ID',page_id:'话题 ID'})[o.field],type:'string',required:o.route!==xiaohongshuSuggestRoute} as PlatformField]:[],purpose:['384C6W6B','XN3ULENA'].includes(o.operationId)?'每轮首页；缺原文链接的笔记保留待核，可显式选择有界详情补全':o.route===xiaohongshuRecommendationsRoute?'供应商推荐首页快照，仅研究，不导入材料或绑定来源':'单次查询；定时仅支持已实现的首页快照，材料导入重验原始回执',collectionPrice:price,collectionCapabilities:{detailEnrichment:['384C6W6B','XN3ULENA'].includes(o.operationId),detailOperations:['384C6W6B','XN3ULENA'].includes(o.operationId)?[{operationId:'KR1LPTBF',label:'小红书统一笔记详情',fields:[],price}]:[]}}));
export const xiaohongshuResearchDescriptors:PlatformOperationDescriptor[]=xiaohongshuProviderVariants.filter(v=>v.operationId.startsWith('xiaohongshu.')).map(v=>({id:v.operationId,platform:'xiaohongshu',label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:(xiaohongshuCollectionIds as readonly string[]).includes(v.operationId)?'list':null,collectionProviders:[v],collectionPrice:price,collectionCapabilities:v.collectionCapabilities}));

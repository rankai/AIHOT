import {z} from 'zod';
import type {PlatformField,PlatformOperationDescriptor} from '@aihot/contracts/redfox';
const id=z.string().regex(/^[0-9]+$/).max(100),bv=z.string().regex(/^BV[A-Za-z0-9]{10}$/),empty=z.literal('').default('');
const video={av_id:id.optional(),bv_id:bv.optional()};
const oneVideo=(v:{av_id?:string;bv_id?:string})=>!!v.av_id!==!!v.bv_id;
const search={keyword:z.string().trim().min(1).max(500),cursor:empty,order:z.literal(0).default(0),page_size:z.literal(20).default(20)};
export const bilibiliSearchInput=z.strictObject(search);
export const bilibiliTypedSearchInput=z.strictObject({...search,search_type:z.literal('video').default('video'),order:z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3)]).default(0)});
export const bilibiliPostsInput=z.strictObject({user_id:id,page:z.literal(1).default(1),post_filter:z.literal('archive').default('archive'),ps:z.literal(20).default(20)});
export const bilibiliDetailInput=z.strictObject(video).refine(oneVideo,'Provide exactly one AV or BV ID');
export const bilibiliCommentsInput=z.strictObject({...video,mode:z.union([z.literal(2),z.literal(3)]).default(3),next_offset:z.literal(1).default(1)}).refine(oneVideo,'Provide exactly one AV or BV ID');
export const bilibiliRepliesInput=z.strictObject({...video,root:id,next_offset:z.literal(0).default(0),ps:z.literal(20).default(20)}).refine(oneVideo,'Provide exactly one AV or BV ID');
const common={contractVersion:1,provider:'agentkey',upstream:'TikHub',recovery:'readOnly',estimatedCredits:.2} as const;
function route<K extends string,T extends string>(key:K,tool:T){return {...common,operationKey:`agentkey.bilibili.${key}`,stepKey:`agentkey.bilibili.${key}.query`,tool} as const;}
export const bilibiliSearchRoute=route('search','TikHub/fetch_search_all_api_v1_bilibili_app_fetch_search_all_get');
export const bilibiliTypedSearchRoute=route('typed_search','TikHub/fetch_search_by_type_api_v1_bilibili_app_fetch_search_by_type_get');
export const bilibiliPostsRoute=route('account_posts','TikHub/fetch_user_videos_api_v1_bilibili_app_fetch_user_videos_get');
export const bilibiliDetailRoute=route('detail','TikHub/fetch_one_video_api_v1_bilibili_app_fetch_one_video_get');
export const bilibiliCommentsRoute=route('comments','TikHub/fetch_video_comments_api_v1_bilibili_app_fetch_video_comments_get');
export const bilibiliRepliesRoute=route('comment_replies','TikHub/fetch_reply_detail_api_v1_bilibili_app_fetch_reply_detail_get');
export const bilibiliProfileRoute=route('account_profile','TikHub/fetch_user_info_api_v1_bilibili_app_fetch_user_info_get');
export const bilibiliRelationRoute=route('relation_stats','TikHub/fetch_user_relation_stat_api_v1_bilibili_web_fetch_user_relation_stat_get');
export const bilibiliDynamicsRoute=route('dynamics','TikHub/fetch_collect_folders_api_v1_bilibili_web_fetch_user_dynamic_get');
export const bilibiliTrendingRoute=route('trending','TikHub/fetch_popular_feed_api_v1_bilibili_app_fetch_popular_feed_get');
export const bilibiliHotSearchRoute=route('hot_search','TikHub/fetch_hot_search_api_v1_bilibili_web_fetch_hot_search_get');
const definitions=[
 {operationId:'LEN9QXR3',route:bilibiliSearchRoute,schema:bilibiliSearchInput,label:'B站综合搜索（视频首页）',inputs:['keyword']},
 {operationId:'bilibili.typed_search',route:bilibiliTypedSearchRoute,schema:bilibiliTypedSearchInput,label:'B站分类型搜索（仅 video）',inputs:['keyword']},
 {operationId:'VPA67I98',route:bilibiliPostsRoute,schema:bilibiliPostsInput,label:'B站账号视频首页',inputs:['user_id']},
 {operationId:'TIN1NMTZ',route:bilibiliDetailRoute,schema:bilibiliDetailInput,label:'B站视频详情',inputs:['av_id','bv_id']},
 {operationId:'bilibili.comments',route:bilibiliCommentsRoute,schema:bilibiliCommentsInput,label:'B站视频评论首页',inputs:['av_id','bv_id']},
 {operationId:'bilibili.comment_replies',route:bilibiliRepliesRoute,schema:bilibiliRepliesInput,label:'B站评论回复首页',inputs:['av_id','bv_id','root']},
 {operationId:'EH53TOT7',route:bilibiliProfileRoute,schema:z.strictObject({user_id:id}),label:'B站账号资料',inputs:['user_id']},
 {operationId:'bilibili.relation_stats',route:bilibiliRelationRoute,schema:z.strictObject({uid:id}),label:'B站关注与粉丝统计',inputs:['uid']},
 {operationId:'bilibili.dynamics',route:bilibiliDynamicsRoute,schema:z.strictObject({uid:id,offset:empty}),label:'B站账号动态首页（研究）',inputs:['uid']},
 {operationId:'bilibili.trending',route:bilibiliTrendingRoute,schema:z.strictObject({idx:z.literal(1).default(1),last_param:z.literal('').optional()}),label:'B站推荐视频（研究）',inputs:[]},
 {operationId:'bilibili.hot_search',route:bilibiliHotSearchRoute,schema:z.strictObject({limit:z.number().int().min(1).max(50)}),label:'B站热搜词',inputs:['limit']},
] as const;
export const agentKeyBilibiliOperations=definitions.map(o=>({...o,querySchema:o.schema}));
export type AgentKeyBilibiliRoute=typeof definitions[number]['route'];
export const bilibiliCollectionIds=['LEN9QXR3','bilibili.typed_search','VPA67I98','bilibili.comments','bilibili.comment_replies','bilibili.relation_stats','bilibili.dynamics','bilibili.trending','bilibili.hot_search'] as const;
export const bilibiliEnrichmentIds=['LEN9QXR3','bilibili.typed_search','VPA67I98'] as const;
const price={amount:.2,currency:'credits',basis:'estimated'} as const;
const labels:Record<string,string>={keyword:'关键词',user_id:'账号 MID',uid:'账号 MID',av_id:'AV号',bv_id:'BV号',root:'一级评论 ID',limit:'返回数量'};
export const bilibiliProviderVariants=definitions.map(o=>({id:'agentkey' as const,label:'AgentKey · TikHub',operationId:o.operationId,operationLabel:o.label,fields:o.inputs.map(name=>({name,label:labels[name]!,type:name==='limit'?'integer':'string',required:!['av_id','bv_id'].includes(name),...(['av_id','bv_id'].includes(name)?{hint:'AV / BV 必须且只能填一项，不转换编号'}:{}),...(name==='limit'?{default:10,constraints:{min:1,max:50}}:{})} as PlatformField)),purpose:o.route===bilibiliDetailRoute?'单对象查询；收到 BV 与作者 MID 后可显式导入视频说明':o.route===bilibiliProfileRoute?'单账号查询；核验原始回执中的 MID 后可显式绑定':'单次首页查询；仅研究，不导入、绑定或自动翻页',collectionPrice:price,collectionCapabilities:{detailEnrichment:(bilibiliEnrichmentIds as readonly string[]).includes(o.operationId),detailOperations:(bilibiliEnrichmentIds as readonly string[]).includes(o.operationId)?[{operationId:'TIN1NMTZ',label:'B站详情（仅实收 AV/BV，有界补全）',fields:[],price}]:[]}}));
export const bilibiliResearchDescriptors:PlatformOperationDescriptor[]=bilibiliProviderVariants.filter(v=>v.operationId.startsWith('bilibili.')).map(v=>({id:v.operationId,platform:'bilibili',label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:(bilibiliCollectionIds as readonly string[]).includes(v.operationId)?'list':null,collectionProviders:[v],collectionPrice:price,collectionCapabilities:v.collectionCapabilities}));

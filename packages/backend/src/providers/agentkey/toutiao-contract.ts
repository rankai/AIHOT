import {z} from 'zod';
const id=z.string().regex(/^\d+$/);
export const toutiaoArticleInput=z.strictObject({group_id:id});
export const toutiaoCommentsInput=z.strictObject({group_id:id,offset:z.literal('0').default('0')});
export const toutiaoProfileInput=z.strictObject({user_id:id});
const common={contractVersion:1,provider:'agentkey',upstream:'TikHub',recovery:'readOnly',estimatedCredits:.2} as const;
export const toutiaoArticleRoute={...common,operationKey:'agentkey.toutiao.article_detail',stepKey:'agentkey.toutiao.article_detail.query',tool:'TikHub/get_article_info_api_v1_toutiao_app_get_article_info_get'} as const;
export const toutiaoCommentsRoute={...common,operationKey:'agentkey.toutiao.comments',stepKey:'agentkey.toutiao.comments.query',tool:'TikHub/get_comments_api_v1_toutiao_app_get_comments_get'} as const;
export const toutiaoProfileRoute={...common,operationKey:'agentkey.toutiao.account_profile',stepKey:'agentkey.toutiao.account_profile.query',tool:'TikHub/get_user_info_api_v1_toutiao_app_get_user_info_get'} as const;
export const agentKeyToutiaoOperations=[
 {operationId:'PAB6Z75Y',route:toutiaoArticleRoute,schema:toutiaoArticleInput,querySchema:toutiaoArticleInput},
 {operationId:'toutiao.comments',route:toutiaoCommentsRoute,schema:toutiaoCommentsInput,querySchema:toutiaoCommentsInput},
 {operationId:'toutiao.account_profile',route:toutiaoProfileRoute,schema:toutiaoProfileInput,querySchema:toutiaoProfileInput},
] as const;
export type AgentKeyToutiaoRoute=typeof agentKeyToutiaoOperations[number]['route'];
const price={amount:.2,currency:'credits',basis:'estimated'} as const;
export const toutiaoProviderVariants=agentKeyToutiaoOperations.map(o=>({id:'agentkey' as const,label:'AgentKey · TikHub',operationId:o.operationId,
 operationLabel:o.route===toutiaoArticleRoute?'头条文章详情（分享标题）':o.route===toutiaoCommentsRoute?'头条评论首页快照':'头条账号资料（仅查询）',
 fields:[{name:o.route===toutiaoProfileRoute?'user_id':'group_id',label:o.route===toutiaoProfileRoute?'用户 ID':'文章 group_id',type:'string' as const,required:true}],
 purpose:o.route===toutiaoArticleRoute?'正文和发布时间不可用；按已验证作者与原文显式导入':o.route===toutiaoCommentsRoute?'每轮仅评论首页；研究快照，不导入材料或绑定来源':'按实收字段查询，不据此判断账号状态或绑定来源；空白响应不推断注销或私密',
 collectionPrice:price,collectionCapabilities:{detailEnrichment:false,detailOperations:[]},
}));
export const toutiaoResearchDescriptors=toutiaoProviderVariants.filter(v=>v.operationId!=='PAB6Z75Y').map(v=>({id:v.operationId,platform:'toutiao',label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:v.operationId==='toutiao.comments'?'list' as const:null,collectionProviders:[v],collectionPrice:price,collectionCapabilities:v.collectionCapabilities}));

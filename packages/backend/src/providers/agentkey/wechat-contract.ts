import {z} from "zod";
import {wechatArticleUrl} from "../redfox/wechat.ts";
const username=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.@-]+$/);
const url=z.string().refine(v=>!!wechatArticleUrl(v),"Valid WeChat article URL required");
const raw=z.literal(false).default(false),id=z.string().regex(/^\d+$/),cursor=z.string().max(10000);
export const wechatArticlesInput=z.strictObject({username,offset:cursor.default(""),page_size:z.number().int().min(1).max(100).default(20),item_show_type:z.literal(0).default(0),raw});
export const wechatDetailInput=z.strictObject({url,raw});
export const wechatProfileInput=z.strictObject({username,raw});
export const wechatCommentsInput=z.strictObject({url,comment_id:id.optional(),buffer:cursor.default(""),raw});
export const wechatRepliesInput=z.strictObject({url,comment_id:id.optional(),content_id:id,offset:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),raw});
export const wechatStatsInput=z.strictObject({url,comment_id:id.optional(),raw});
const common={contractVersion:1,provider:"agentkey",upstream:"TikHub",recovery:"readOnly",estimatedCredits:2,evidence:"docs/reviews/2026-10-21-agentkey-output-evidence.md"} as const;
export const wechatArticlesRoute={...common,operationKey:"agentkey.wechat_mp.account_articles",stepKey:"agentkey.wechat_mp.account_articles.query",tool:"TikHub/fetch_account_articles_api_v1_wechat_mp_v2_fetch_account_articles_post"} as const;
export const wechatDetailRoute={...common,operationKey:"agentkey.wechat_mp.detail",stepKey:"agentkey.wechat_mp.detail.query",tool:"TikHub/fetch_article_detail_h5_api_v1_wechat_mp_v2_fetch_article_detail_h5_post"} as const;
export const wechatProfileRoute={...common,operationKey:"agentkey.wechat_mp.account_profile",stepKey:"agentkey.wechat_mp.account_profile.query",tool:"TikHub/fetch_account_profile_api_v1_wechat_mp_v2_fetch_account_profile_post"} as const;
export const wechatCommentsRoute={...common,operationKey:"agentkey.wechat_mp.comments",stepKey:"agentkey.wechat_mp.comments.query",tool:"TikHub/fetch_article_comments_api_v1_wechat_mp_v2_fetch_article_comments_post"} as const;
export const wechatRepliesRoute={...common,operationKey:"agentkey.wechat_mp.comment_replies",stepKey:"agentkey.wechat_mp.comment_replies.query",tool:"TikHub/fetch_comment_replies_api_v1_wechat_mp_v2_fetch_comment_replies_post"} as const;
export const wechatStatsRoute={...common,operationKey:"agentkey.wechat_mp.article_stats",stepKey:"agentkey.wechat_mp.article_stats.query",tool:"TikHub/fetch_article_stats_h5_api_v1_wechat_mp_v2_fetch_article_stats_h5_post"} as const;
export const agentKeyWechatOperations=[
  {operationId:"8IQD0BJC",route:wechatArticlesRoute,schema:wechatArticlesInput,querySchema:wechatArticlesInput},
  {operationId:"I3CIBRI2",route:wechatDetailRoute,schema:wechatDetailInput,querySchema:wechatDetailInput},
  {operationId:"KUQYSQNX",route:wechatProfileRoute,schema:wechatProfileInput,querySchema:wechatProfileInput},
  {operationId:"wechat.comments",route:wechatCommentsRoute,schema:wechatCommentsInput,querySchema:wechatCommentsInput},
  {operationId:"wechat.comment_replies",route:wechatRepliesRoute,schema:wechatRepliesInput,querySchema:wechatRepliesInput},
  {operationId:"wechat.article_stats",route:wechatStatsRoute,schema:wechatStatsInput,querySchema:wechatStatsInput},
] as const;
export type AgentKeyWechatRoute=typeof agentKeyWechatOperations[number]['route'];

const creditPrice={amount:2,currency:'credits',basis:'estimated'} as const;
const field=(name:string,label:string,required=true)=>({name,label,type:'string' as const,required});
export const wechatProviderVariants=agentKeyWechatOperations.map(o=>({id:'agentkey' as const,label:'AgentKey · TikHub',operationId:o.operationId,
  operationLabel:({'8IQD0BJC':'公众号文章列表','I3CIBRI2':'公众号 H5 文章详情','KUQYSQNX':'公众号资料','wechat.comments':'公众号文章评论','wechat.comment_replies':'公众号评论回复','wechat.article_stats':'公众号评论统计'} as Record<string,string>)[o.operationId]+'（TikHub）',
  fields:o.route===wechatArticlesRoute?[field('username','公众号 username'),field('offset','翻页游标（原样传入）',false)]:o.route===wechatProfileRoute?[field('username','公众号 username')]:[field('url','公众号文章 URL'),...(o.route===wechatRepliesRoute?[field('content_id','父评论 content_id'),{name:'offset',label:'回复偏移',type:'integer' as const,required:false,default:0,constraints:{min:0}}]:[]),...([wechatCommentsRoute,wechatRepliesRoute,wechatStatsRoute].includes(o.route as never)?[field('comment_id','文章评论 ID（可选捷径）',false)]:[]),...(o.route===wechatCommentsRoute?[field('buffer','翻页游标（原样传入）',false)]:[])],
  purpose:o.route===wechatArticlesRoute?'仅文章栏目；page_size 上游忽略；列表摘要不是全文；主订阅另按信源执行':o.route===wechatStatsRoute?'仅评论总数与精选评论数，其余指标不可用；仅研究，不导入文章或订阅':o.route===wechatCommentsRoute||o.route===wechatRepliesRoute?'仅评论研究查询，不导入文章或订阅':o.route===wechatProfileRoute?'账号研究；头像与简介不可用，不自动补购详情':'单次研究查询；按已收稳定身份显式导入文章',
  collectionPrice:creditPrice,collectionCapabilities:{detailEnrichment:false,detailOperations:[]},
}));
export function wechatAgentKeyVariant(id:string){return wechatProviderVariants.find(v=>v.operationId===id);}
export const wechatResearchDescriptors=wechatProviderVariants.filter(v=>v.operationId.startsWith('wechat.')).map(v=>({id:v.operationId,platform:'wechat',label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:null,collectionProviders:[v],collectionPrice:creditPrice,collectionCapabilities:v.collectionCapabilities}));

import { z } from "zod";
import type {PlatformOperationDescriptor} from "@aihot/contracts/redfox";

/** Catalog snapshot, official V4 docs and a verified read-only response; no date/sort/transcript guarantees. */
export const douyinSearchRoute = {
  operationKey: "agentkey.douyin.search", stepKey: "agentkey.douyin.search.query", contractVersion: 1,
  provider: "agentkey", upstream: "TikHub", recovery: "readOnly", estimatedCredits: 0.2,
  tool: "TikHub/fetch_video_search_v4_api_v1_douyin_search_fetch_video_search_v4_post",
  evidence: "docs/reviews/2026-10-21-agentkey-output-evidence.md#t1-抖音搜索",
} as const;

export const douyinSearchInput = z.strictObject({
  keyword: z.string().trim().min(1),
  cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});
export type DouyinSearchInput = z.input<typeof douyinSearchInput>;

export const douyinAccountPostsInput = z.strictObject({
  sec_user_id: z.string().trim().min(1).regex(/^[^\s\u0000-\u001f]+$/),
  max_cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  count: z.number().int().min(1).max(20).default(20),
  sort_type: z.union([z.literal(0), z.literal(1)]).default(0),
  channel: z.literal("normal").default("normal"),
});
/** New requests start at zero; only persisted upstream continuation may advance max_cursor. */
export const douyinAccountPostsQueryInput=douyinAccountPostsInput.extend({max_cursor:z.literal(0).default(0)});
export const douyinDetailInput = z.strictObject({aweme_id:z.string().regex(/^\d+$/)});
export const douyinAccountPostsRoute = {
  ...douyinSearchRoute, operationKey:"agentkey.douyin.account_posts", stepKey:"agentkey.douyin.account_posts.query",
  evidence:"docs/agentkey-integration-plan.md#127-当前实施批次2026-10-22",
  tool:"TikHub/fetch_user_post_videos_api_v1_douyin_app_v3_fetch_user_post_videos_get",
} as const;
export const douyinDetailRoute = {
  ...douyinSearchRoute, operationKey:"agentkey.douyin.detail", stepKey:"agentkey.douyin.detail.query",
  evidence:"docs/agentkey-integration-plan.md#127-当前实施批次2026-10-22",
  tool:"TikHub/fetch_one_video_v2_api_v1_douyin_app_v3_fetch_one_video_v2_get",
} as const;
export const douyinSuggestInput=z.strictObject({keyword:z.string().trim().min(1)});
export const douyinAccountSearchInput=z.strictObject({keyword:z.string().trim().min(1),cursor:z.literal(0).default(0),
  douyin_user_fans:z.literal("").default(""),douyin_user_type:z.literal("").default(""),search_id:z.literal("").default("")});
export const douyinSuggestRoute={...douyinSearchRoute,
  operationKey:"agentkey.douyin.suggest",stepKey:"agentkey.douyin.suggest.query",
  tool:"TikHub/fetch_search_suggest_api_v1_douyin_search_fetch_search_suggest_post",
  evidence:"docs/agentkey-integration-plan.md#129-下一小批账号搜索与搜索建议实现中",
} as const;
export const douyinAccountSearchRoute={...douyinSearchRoute,
  operationKey:"agentkey.douyin.account_search",stepKey:"agentkey.douyin.account_search.query",
  tool:"TikHub/fetch_user_search_api_v1_douyin_search_fetch_user_search_post",
  evidence:"docs/agentkey-integration-plan.md#129-下一小批账号搜索与搜索建议实现中",
} as const;
const NativeId=z.string().regex(/^\d+$/);
const SecureId=z.string().trim().min(1).regex(/^[^\s\u0000-\u001f]+$/);
export const douyinTrendingInput=z.strictObject({board_type:z.literal("0").default("0"),board_sub_type:z.literal("").default("")});
export const douyinCommentsInput=z.strictObject({aweme_id:NativeId,cursor:z.literal(0).default(0),count:z.literal(20).default(20)});
export const douyinRepliesInput=z.strictObject({item_id:NativeId,comment_id:NativeId,cursor:z.literal(0).default(0),count:z.literal(20).default(20)});
export const douyinTopicInput=z.strictObject({ch_id:NativeId,cursor:z.literal(0).default(0),count:z.literal(10).default(10),sort_type:z.union([z.literal(0),z.literal(1),z.literal(2)]).default(0)});
export const douyinFollowingInput=z.strictObject({sec_user_id:SecureId,max_time:z.literal("0").default("0"),source_type:z.literal(2).default(2),count:z.literal(20).default(20)});
export const douyinProfileInput=z.strictObject({sec_user_id:SecureId});
export const douyinTrendingRoute={...douyinSearchRoute,operationKey:"agentkey.douyin.trending",stepKey:"agentkey.douyin.trending.query",operationId:"douyin.trending",tool:"TikHub/fetch_hot_search_list_api_v1_douyin_app_v3_fetch_hot_search_list_get"} as const;
export const douyinCommentsRoute={...douyinSearchRoute,operationKey:"agentkey.douyin.comments",stepKey:"agentkey.douyin.comments.query",operationId:"douyin.comments",tool:"TikHub/fetch_video_comments_api_v1_douyin_app_v3_fetch_video_comments_get"} as const;
export const douyinRepliesRoute={...douyinSearchRoute,operationKey:"agentkey.douyin.comment_replies",stepKey:"agentkey.douyin.comment_replies.query",operationId:"douyin.comment_replies",tool:"TikHub/fetch_video_comments_reply_api_v1_douyin_app_v3_fetch_video_comment_replies_get"} as const;
export const douyinTopicRoute={...douyinSearchRoute,operationKey:"agentkey.douyin.topic_posts",stepKey:"agentkey.douyin.topic_posts.query",operationId:"douyin.topic_posts",tool:"TikHub/fetch_hashtag_video_list_api_v1_douyin_app_v3_fetch_hashtag_video_list_get"} as const;
export const douyinFollowingRoute={...douyinSearchRoute,operationKey:"agentkey.douyin.following",stepKey:"agentkey.douyin.following.query",operationId:"douyin.following",tool:"TikHub/fetch_user_following_list_api_v1_douyin_web_fetch_user_following_list_get"} as const;
export const douyinProfileRoute={...douyinSearchRoute,operationKey:"agentkey.douyin.account_profile",stepKey:"agentkey.douyin.account_profile.query",operationId:"XUT4CECZ",tool:"TikHub/handler_user_profile_api_v1_douyin_app_v3_handler_user_profile_get"} as const;
export const douyinSnapshotOperations=[
  {route:douyinTrendingRoute,schema:douyinTrendingInput,operationId:douyinTrendingRoute.operationId},
  {route:douyinCommentsRoute,schema:douyinCommentsInput,operationId:douyinCommentsRoute.operationId},
  {route:douyinRepliesRoute,schema:douyinRepliesInput,operationId:douyinRepliesRoute.operationId},
  {route:douyinTopicRoute,schema:douyinTopicInput,operationId:douyinTopicRoute.operationId},
  {route:douyinFollowingRoute,schema:douyinFollowingInput,operationId:douyinFollowingRoute.operationId},
  {route:douyinProfileRoute,schema:douyinProfileInput,operationId:douyinProfileRoute.operationId},
] as const;
export const douyinSnapshotCollectionIds=["douyin.trending","douyin.comments","douyin.comment_replies","douyin.topic_posts","douyin.following"] as const;
export const agentKeyDouyinRoutes = [douyinSearchRoute,douyinAccountPostsRoute,douyinDetailRoute,douyinSuggestRoute,douyinAccountSearchRoute,...douyinSnapshotOperations.map(o=>o.route)] as const;
export type AgentKeyDouyinRoute = typeof agentKeyDouyinRoutes[number];
export function agentKeyOperation(operationId:unknown) {
  if(operationId==="OWIBYU1V")return {route:douyinSearchRoute,schema:douyinSearchInput,querySchema:douyinKeywordInput,operationId};
  if(operationId==="QEQLCKD6")return {route:douyinAccountPostsRoute,schema:douyinAccountPostsInput,querySchema:douyinAccountPostsQueryInput,operationId};
  if(operationId==="FK67XDVQ")return {route:douyinDetailRoute,schema:douyinDetailInput,querySchema:douyinDetailInput,operationId};
  if(operationId==="douyin.suggest")return {route:douyinSuggestRoute,schema:douyinSuggestInput,querySchema:douyinSuggestInput,operationId};
  if(operationId==="P5CHB3BZ")return {route:douyinAccountSearchRoute,schema:douyinAccountSearchInput,querySchema:douyinAccountSearchInput,operationId};
  const snapshot=douyinSnapshotOperations.find(o=>o.operationId===operationId);
  return snapshot?{...snapshot,querySchema:snapshot.schema}:undefined;
}
export function agentKeyRouteInput(route:AgentKeyDouyinRoute,input:unknown):Record<string,unknown>{
  if(route===douyinSearchRoute)return douyinSearchInput.parse(input);
  if(route===douyinAccountPostsRoute)return douyinAccountPostsInput.parse(input);
  if(route===douyinDetailRoute)return douyinDetailInput.parse(input);
  if(route===douyinSuggestRoute)return douyinSuggestInput.parse(input);
  if(route===douyinAccountSearchRoute)return douyinAccountSearchInput.parse(input);
  const snapshot=douyinSnapshotOperations.find(o=>o.route===route);
  if(snapshot)return snapshot.schema.parse(input);
  throw new Error("Unregistered AgentKey route");
}
/** Exact operation/step/version pairs, including the one frozen account-list enrichment target. */
export function agentKeyRouteFor(run: { provider:string;operation_key?:string;step_key:string;contract_version?:number;input?:Record<string,unknown> }) {
  if(run.provider!=="agentkey"||run.contract_version!==1)return undefined;
  const direct=agentKeyDouyinRoutes.find(route=>route.operationKey===run.operation_key&&route.stepKey===run.step_key);
  if(direct&&douyinSnapshotOperations.some(o=>o.route===direct)&&!["query","collection"].includes(String(run.input?.mode)))return undefined;
  if(direct)return (direct===douyinSuggestRoute||direct===douyinAccountSearchRoute||direct===douyinProfileRoute)&&run.input?.mode!=="query"?undefined:direct;
  if(run.operation_key===douyinAccountPostsRoute.operationKey&&run.step_key===douyinDetailRoute.stepKey
    &&run.input?.mode==="collection"&&run.input.enrichDetails===true&&run.input.detailOperationId==="FK67XDVQ")return douyinDetailRoute;
  return undefined;
}
export function agentKeyOutboundAllowed(run: Parameters<typeof agentKeyRouteFor>[0] & { input: Record<string, unknown> }, env: NodeJS.ProcessEnv = process.env) {
  return !!agentKeyRouteFor(run) && env.AGENTKEY_CALLS_ENABLED === "true"
    && (run.input.mode !== "collection" || env.COLLECT_ENABLED !== "false");
}

export const douyinKeywordInput = z.strictObject({keyword: z.string().trim().min(1)});
export const douyinProviderVariant = {
  id: "agentkey", label: "AgentKey · TikHub", operationLabel:"抖音作品搜索 V4（TikHub）",
  fields: [{name:"keyword",label:"关键词",type:"string",required:true}],
  purpose: "TikHub 抖音 V4 搜索；仅关键词，不支持日期、排序、精确匹配、转写或详情补全",
  collectionPrice: {amount:0.2,currency:"credits",basis:"estimated"},
  collectionCapabilities: {detailEnrichment:false,detailOperations:[]},
} as const;

const detailFields=[{name:"aweme_id",label:"原生作品 ID（aweme_id）",type:"string",required:true}] as const;
const creditPrice={amount:0.2,currency:"credits",basis:"estimated"} as const;
export const douyinAccountPostsVariant={
  id:"agentkey",label:"AgentKey · TikHub",operationLabel:"抖音账号作品（TikHub）",
  fields:[{name:"sec_user_id",label:"已确认安全 ID",type:"string",required:true},
    {name:"count",label:"每页条数",type:"integer",required:false,default:20,constraints:{min:1,max:20}},
    {name:"sort_type",label:"排序（0 最新 / 1 最热）",type:"integer",required:false,default:0,constraints:{min:0,max:1}}],
  purpose:"TikHub 账号作品；固定 normal 通道，仅使用返回游标，描述不等于转写全文",
  collectionPrice:creditPrice,
  collectionCapabilities:{detailEnrichment:true,detailOperations:[{operationId:"FK67XDVQ",label:"抖音作品详情 V2（TikHub）",fields:[],price:creditPrice}]},
} as const;
export const douyinDetailVariant={id:"agentkey",label:"AgentKey · TikHub",operationLabel:"抖音作品详情 V2（TikHub）",
  fields:detailFields,purpose:"TikHub 作品详情 V2；描述不等于转写全文，不获取播放流",collectionPrice:creditPrice,
  collectionCapabilities:{detailEnrichment:false,detailOperations:[]}} as const;

export const douyinAccountSearchVariant={id:"agentkey",label:"AgentKey · TikHub",operationLabel:"抖音账号搜索（TikHub）",
  fields:[{name:"keyword",label:"关键词",type:"string",required:true}],
  purpose:"账号研究查询；仅无筛选首页，不支持筛选或续页。稳定身份须显式绑定，不自动创建材料",collectionPrice:creditPrice,
  collectionCapabilities:{detailEnrichment:false,detailOperations:[]}} as const;
const douyinSuggestVariant={id:"agentkey",label:"AgentKey · TikHub",operationLabel:"抖音搜索建议（TikHub）",
  fields:[{name:"keyword",label:"关键词",type:"string",required:true}],purpose:"单次关键词建议查询；研究词条，不导入新闻材料",collectionPrice:creditPrice,
  collectionCapabilities:{detailEnrichment:false,detailOperations:[]}} as const;
export const douyinSuggestDescriptor:PlatformOperationDescriptor={id:"douyin.suggest",platform:"douyin",label:douyinSuggestVariant.operationLabel,
  fields:douyinSuggestVariant.fields,purpose:douyinSuggestVariant.purpose,schedulableType:null,
  collectionPrice:creditPrice,collectionProviders:[douyinSuggestVariant],collectionCapabilities:douyinSuggestVariant.collectionCapabilities};

export function douyinOperationId(route:AgentKeyDouyinRoute):string{
  const snapshot=douyinSnapshotOperations.find(o=>o.route===route);
  if(snapshot)return snapshot.operationId;
  return route===douyinSearchRoute?"OWIBYU1V":route===douyinAccountPostsRoute?"QEQLCKD6":route===douyinDetailRoute?"FK67XDVQ":route===douyinAccountSearchRoute?"P5CHB3BZ":"douyin.suggest";
}
const idField=(name:string,label:string)=>({name,label,type:"string" as const,required:true});
export const douyinSnapshotVariants=[
  {operationId:"douyin.trending",operationLabel:"抖音热点榜单页快照（TikHub）",fields:[],purpose:"仅默认热点榜，每轮一次；保留上游顺序，不推断排名，不导入新闻"},
  {operationId:"douyin.comments",operationLabel:"抖音作品评论首页快照（TikHub）",fields:[idField("aweme_id","原生作品 ID")],purpose:"固定首页 20 条；评论研究，不导入新闻或绑定作者，不连续翻页"},
  {operationId:"douyin.comment_replies",operationLabel:"抖音评论回复首页快照（TikHub）",fields:[idField("item_id","原生作品 ID"),idField("comment_id","父评论 ID")],purpose:"固定首页 20 条；回复研究，不导入新闻或绑定作者"},
  {operationId:"douyin.topic_posts",operationLabel:"抖音话题作品首页快照（TikHub）",fields:[idField("ch_id","话题 ID"),{name:"sort_type",label:"排序（0 综合 / 1 点赞 / 2 最新）",type:"integer" as const,required:false,default:0,constraints:{min:0,max:2}}],purpose:"固定首页 10 条；有稳定作品及作者身份才导入，时间单位未核实，不追加详情或翻页"},
  {operationId:"douyin.following",operationLabel:"抖音关注首页快照（TikHub）",fields:[idField("sec_user_id","安全用户 ID")],purpose:"固定 source_type=2 首页 20 条；空页仅表示本次未返回成员，不自动请求第二页或绑定成员"},
  {operationId:"XUT4CECZ",operationLabel:"抖音账号资料（TikHub · 仅注销态）",fields:[idField("sec_user_id","安全用户 ID")],purpose:"仅已核实的注销账号特殊态；活跃资料待核，不支持订阅或来源绑定"},
].map(v=>({...v,id:"agentkey" as const,label:"AgentKey · TikHub",collectionPrice:creditPrice,collectionCapabilities:{detailEnrichment:false,detailOperations:[]}}));
export function douyinSnapshotVariant(operationId:string){return douyinSnapshotVariants.find(v=>v.operationId===operationId);}
export const douyinSnapshotDescriptors:PlatformOperationDescriptor[]=douyinSnapshotVariants.filter(v=>v.operationId!=="XUT4CECZ").map(v=>({
  id:v.operationId,platform:"douyin",label:v.operationLabel,fields:v.fields,purpose:v.purpose,schedulableType:v.operationId==="douyin.trending"?"trend":"list",
  collectionPrice:creditPrice,collectionProviders:[v],collectionCapabilities:v.collectionCapabilities,
}));

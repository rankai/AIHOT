import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { OperationResult } from "../app/features/admin/operation-types.ts";
import { detailQueryOperation } from "../app/features/admin/detail-query-data.ts";

test("real work and six account result cards show local options lookup without paid controls; research and old details remain separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-detail-query-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: { query: new URL("../app/features/admin/platform-query.tsx", import.meta.url).pathname, result: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, fields: new URL("../app/features/admin/platform-fields.tsx", import.meta.url).pathname }, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ dir: directory, entryFileNames: "[name].mjs", format: "esm" });
    const { OperationResultView } = await import(pathToFileURL(join(directory, "result.mjs")).href), { PlatformFields } = await import(pathToFileURL(join(directory, "fields.mjs")).href);
    const renderElement = (element: ReactElement) => { const router = createMemoryRouter([{ path: "/admin/operations/200", element }], { initialEntries: ["/admin/operations/200"] }); try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); } };
    const render = (platform: string, kind: string, data: Record<string, unknown> = {}) => { const result: OperationResult = { id: 42, kind, data: { platform, title: "已收作品", record: {}, ...data }, receiptId: 7, sourceId: null, articleId: null, file: null, fileKey: null, imported: false }; return renderElement(createElement(OperationResultView, { result })); };
    for (const platform of ["douyin", "xiaohongshu", "wechat", "tiktok", "bilibili", "weibo", "qichezhijia", "dongchedi", "yiche"]) {
      const html = render(platform, `${platform}_work`);
      assert.equal((html.match(/查看可用详情接口/g) ?? []).length, 1, platform);
      assert(!html.includes("查询补充详情并查看任务"), platform);
      assert.equal(render(platform, `${platform}_account`).includes("查看可用详情接口"), ["douyin", "xiaohongshu", "wechat", "bilibili", "weibo"].includes(platform), `${platform} account`);
    }
    for (const [platform, kind] of [["xiaohongshu", "xiaohongshu_research"], ["xiaohongshu", "xiaohongshu_account_rank"], ["wechat", "wechat_account_rank"], ["weibo", "weibo_trend"], ["tiktok", "tiktok_topic"], ["youtube", "youtube_work"], ["instagram", "instagram_work"], ["toutiao", "toutiao_work"], ["shipinhao", "shipinhao_work"], ["kuaishou", "kuaishou_work"], ["zhihu", "zhihu_work"]]) assert(!render(platform!, kind!).includes("查看可用详情接口"), kind);
    for (const kind of ["baijiahao_work", "baijiahao_account"]) assert.equal((render("baijiahao", kind).match(/查看可用详情接口/g) ?? []).length, 1, kind);
    for (const data of [{identity: {}, workId: "123", url: "https://www.douyin.com/video/123"}, {identity: {uid: "456"}, workId: null, url: "https://www.douyin.com/video/123"}]) {
      const html = render("douyin", "douyin_work", {...data, provider: "agentkey"});
      assert.match(html, /AgentKey.*稳定/);
      assert.match(html, /<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/);
      assert(!html.includes("本原生链接含作品 ID，可由服务端据此核实"));
      const redfox = render("douyin", "douyin_work", {...data, provider: "redfox"});
      assert(!/<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/.test(redfox));
    }
    const agentAccount = render("douyin", "douyin_account", {provider:"agentkey",operationId:"P5CHB3BZ",identity:{uid:"9007199254740993123",secUserId:"received-sec"},record:{nickname:"<b>实收账号</b>",follower_count:0}});
    assert(agentAccount.includes("绑定账号信源")); assert(agentAccount.includes("响应粉丝数")); assert(agentAccount.includes("&lt;b&gt;实收账号&lt;/b&gt;"));
    assert(!agentAccount.includes("查看可用详情接口")); assert(!agentAccount.includes("本地导入作品"));
    const researchSummary = render("douyin","query_summary",{provider:"agentkey",count:1,selectedCount:1,returnedPage:{},stopReason:"single-request"});
    assert(researchSummary.includes("抖音查询摘要")); assert(!researchSummary.includes("采集页摘要")); assert(!researchSummary.includes("作品候选"));
    const suggestion = render("douyin", "search_suggestion", {provider:"agentkey",operationId:"douyin.suggest",title:"<script>联想词</script>"});
    assert(suggestion.includes("搜索建议")); assert(suggestion.includes("仅供研究")); assert(suggestion.includes("&lt;script&gt;联想词&lt;/script&gt;"));
    assert(!suggestion.includes("绑定账号")); assert(!suggestion.includes("本地导入作品"));
    for (const kind of ["wechat_comment", "wechat_reply", "wechat_stats"]) {
      const html = render("wechat", kind, {provider:"agentkey",record:{content:"<b>实收评论</b>",nick_name:"评论者",comment_count:0,elected_comment_count:0}});
      assert(html.includes("仅供研究")); assert(!html.includes("本地导入作品")); assert(!html.includes("绑定账号信源")); assert(!html.includes("查看可用详情接口"));
      if (kind === "wechat_stats") { assert(html.includes("评论总数")); assert(html.includes("不能将缺失值当作 0")); }
      else { assert(html.includes("&lt;b&gt;实收评论&lt;/b&gt;")); assert(!html.includes("<b>实收评论</b>")); }
    }
    const mpIncomplete = render("wechat", "wechat_work", {provider:"agentkey",identity:{},url:"https://mp.weixin.qq.com/s/short"});
    assert.match(mpIncomplete, /<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/);
    assert(!mpIncomplete.includes("查看可用详情接口"));
    for (const [operationId, kind, tool] of [
      ["douyin.comments", "social_comment", "TikHub/fetch_video_comments_api_v1_douyin_app_v3_fetch_video_comments_get"],
      ["douyin.comment_replies", "social_comment", "TikHub/fetch_video_comments_reply_api_v1_douyin_app_v3_fetch_video_comment_replies_get"],
      ["douyin.following", "social_followee", "TikHub/fetch_user_following_list_api_v1_douyin_web_fetch_user_following_list_get"],
    ]) {
      const html = render("douyin", kind!, {provider:"agentkey",operationId,tool,role:kind==="social_followee"?"followee":"comment",record:{text:"<b>评论</b>",create_time:123,nickname:"关注用户",follower_count:0},timeUnits:{create_time:"unspecified"}});
      assert(html.includes("定时单页快照")); assert(!html.includes("本地导入作品")); assert(!html.includes("绑定账号信源"));
      if (kind === "social_comment") { assert(html.includes("&lt;b&gt;评论&lt;/b&gt;")); assert(html.includes("单位 / 时区未说明")); }
      else assert(html.includes("关注列表中的账号"));
    }
    const hotspot = render("douyin", "hotspot_research", {provider:"agentkey",operationId:"douyin.trending",tool:"TikHub/fetch_hot_search_list_api_v1_douyin_app_v3_fetch_hot_search_list_get",record:{word:"实收热点",sentence_id:"123",hot_value:0}});
    assert(hotspot.includes("实收热点")); assert(hotspot.includes("不把列表位置当作榜单名次")); assert(!hotspot.includes("本地导入作品"));
    const deleted = render("douyin", "query_summary", {provider:"agentkey",operationId:"XUT4CECZ",accountState:"deleted",displayName:"<b>注销用户</b>",count:0});
    assert(deleted.includes("抖音账号注销状态")); assert(deleted.includes("&lt;b&gt;注销用户&lt;/b&gt;")); assert(!deleted.includes("此页没有结果")); assert(!deleted.includes("绑定账号信源"));
    const bootstrap = render("douyin", "query_summary", {provider:"agentkey",operationId:"douyin.following",bootstrap:true,count:0,stopReason:"single-request",snapshot:true});
    assert(bootstrap.includes("关注初始化空页")); assert(!bootstrap.includes("此页没有结果"));
    const snapshot = render("douyin", "query_summary", {provider:"agentkey",operationId:"douyin.following",snapshot:true,count:19,selectedCount:10,unprocessedDueToLimit:9,returnedPage:{has_more:true},nextParameters:null,stopReason:"single-request"});
    assert(snapshot.includes("采集页摘要")); assert(snapshot.includes("本页选取快照")); assert(snapshot.includes("因限额未选快照")); assert(!snapshot.includes("本页选入作品候选"));
    const ttArticle = render("toutiao", "toutiao_work", {provider:"agentkey",operationId:"PAB6Z75Y",title:"<b>分享标题</b>",workId:"123",requestedWorkId:"123",url:"https://m.toutiao.com/article/123/?share=local",identity:{uid:"456"},record:{workId:"123",workUrl:"https://m.toutiao.com/article/123/?share=local",authorName:"已收作者"}});
    assert(ttArticle.includes("标题来自上游分享标题")); assert(ttArticle.includes("正文待补")); assert(ttArticle.includes("&lt;b&gt;分享标题&lt;/b&gt;")); assert(!/<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/.test(ttArticle));
    const ttMissing = render("toutiao", "toutiao_work", {provider:"agentkey",operationId:"PAB6Z75Y",identity:{},workId:"123",url:"https://m.toutiao.com/article/123/"});
    assert.match(ttMissing, /<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/); assert(ttMissing.includes("不能用手工输入代替响应证据"));
    const ttComment = render("toutiao", "social_comment", {provider:"agentkey",operationId:"toutiao.comments",tool:"TikHub/get_comments_api_v1_toutiao_app_get_comments_get",role:"comment",record:{id:"9007199254740993123",id_str:"9007199254740993123",text:"<b>评论研究</b>",create_time:123,user:{uid:"456",nickname:"评论者"}},timeUnits:{create_time:"unspecified"}});
    assert(ttComment.includes("&lt;b&gt;评论研究&lt;/b&gt;")); assert(ttComment.includes("评论 ID · id")); assert(ttComment.includes("定时单页快照")); assert(!ttComment.includes("本地导入作品")); assert(!/<button[^>]*>[^<]*绑定账号/.test(ttComment));
    const ttProfile = render("toutiao", "query_summary", {provider:"agentkey",operationId:"toutiao.account_profile",count:0,profileIsBlank:true,statusText:"本次返回空白账号资料；不能据此推断注销或私密",record:{user_id:"456",publish_count:0,digg_count:0,followers_count:0,followings_count:0}});
    assert(ttProfile.includes("账号资料（本次为空白）")); assert(ttProfile.includes("不能据此推断注销或私密")); assert(!ttProfile.includes("此页没有结果")); assert(!ttProfile.includes("绑定账号信源"));
    const ttPopulated = render("toutiao", "query_summary", {provider:"agentkey",operationId:"toutiao.account_profile",count:0,profileIsBlank:false,statusText:"仅展示本次实收账号字段，不据此推断账号状态或绑定权限",record:{user_id:"456",name:"<b>同结构资料</b>",description:"实际简介",publish_count:1,digg_count:2,followers_count:3,followings_count:4}});
    assert(ttPopulated.includes("&lt;b&gt;同结构资料&lt;/b&gt;")); assert(ttPopulated.includes("实际简介")); assert(!ttPopulated.includes("本次为空白")); assert(!ttPopulated.includes("此页没有结果")); assert(!ttPopulated.includes("绑定账号信源"));
    const xhsComplete={provider:"agentkey",operationId:"KR1LPTBF",identity:{userId:"received-author"},workId:"local-note",url:"https://www.xiaohongshu.com/discovery/item/local-note?xsec_token=fake%2Bvalue",record:{description:"<b>笔记说明</b>",authorName:"作者",rawTimes:{time:123}}};
    const xhsDetail=render("xiaohongshu","xiaohongshu_work",xhsComplete);
    assert(xhsDetail.includes("&lt;b&gt;笔记说明&lt;/b&gt;")); assert(xhsDetail.includes("不是视频转写或字幕")); assert(xhsDetail.includes("单位未确认")); assert(!xhsDetail.includes("查看可用详情接口")); assert(!/<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/.test(xhsDetail));
    const xhsPending=render("xiaohongshu","xiaohongshu_work",{...xhsComplete,url:null});
    assert.match(xhsPending,/<button[^>]*disabled=""[^>]*>本地导入作品<\/button>/); assert(xhsPending.includes("不能用手工输入代替响应证据"));
    const xhsRecommended=render("xiaohongshu","xiaohongshu_work",{...xhsComplete,role:"provider_recommendation"});
    assert(!xhsRecommended.includes("本地导入作品")); assert(!xhsRecommended.includes("查看可用详情接口")); assert(xhsRecommended.includes("上游推荐仅供研究"));
    const xhsAccount=render("xiaohongshu","xiaohongshu_account",{provider:"agentkey",identity:{userId:"received-author"},record:{name:"<b>已收作者</b>",red_id:"display-only",desc:"简介",stats:{fans:0,follows:1,note_num_stat:{liked:0,collected:2,posted:3}}}});
    assert(xhsAccount.includes("&lt;b&gt;已收作者&lt;/b&gt;")); assert(xhsAccount.includes("粉丝数")); assert(xhsAccount.includes("点赞过的笔记数")); assert(xhsAccount.includes("收藏过的笔记数")); assert(xhsAccount.includes("发布笔记数")); assert(xhsAccount.includes("绑定账号信源")); assert(!xhsAccount.includes("查看可用详情接口"));
    const xhsComment=render("xiaohongshu","social_comment",{provider:"agentkey",operationId:"xiaohongshu.comments",tool:"TikHub/get_note_comments_api_v1_xiaohongshu_app_v2_get_note_comments_get",record:{id:"comment-local",content:"<b>评论文字</b>",time:123,note_id:"local-note",like_count:0,user:{userid:"comment-author",nickname:"评论者"}},timeUnits:{time:"unspecified"}});
    assert(xhsComment.includes("&lt;b&gt;评论文字&lt;/b&gt;")); assert(xhsComment.includes("comment-author")); assert(xhsComment.includes("评论 ID · id")); assert(xhsComment.includes("原始 time")); assert(xhsComment.includes("定时单页快照")); assert(!xhsComment.includes("本地导入作品"));
    const { PlatformQuery } = await import(pathToFileURL(join(directory, "query.mjs")).href);
    const seedRouter=createMemoryRouter([{path:"/admin/redfox",element:createElement(PlatformQuery,{operations:[{id:"TIN1NMTZ",platform:"bilibili",label:"旧详情",purpose:"query",fields:[],collectionProviders:[{id:"redfox",label:"Redfox"},{id:"agentkey",label:"AgentKey",operationLabel:"实时详情",fields:[{name:"av_id",label:"AV",type:"string",required:false},{name:"bv_id",label:"BV",type:"string",required:false}]}]}]})}],{initialEntries:[{pathname:"/admin/redfox",state:{bilibiliDetailSeed:{platform:"bilibili",provider:"agentkey",operationId:"TIN1NMTZ",parameters:{av_id:"321"}}}}]});
    try { const html=renderToStaticMarkup(createElement(RouterProvider,{router:seedRouter})); assert(html.includes('value="321"')); assert(html.includes('<option value="agentkey" selected="">')); assert(html.includes("查询并查看任务")); } finally {seedRouter.dispose();}
    for (const operationId of ["LEN9QXR3", "bilibili.typed_search"]) {
      const html=render("bilibili","query_summary",{provider:"agentkey",operationId,count:2,pagination:{page:"1",pages:7,next:"opaque-next"}});
      assert(html.includes("上游页码 · pagination.page")); assert(html.includes("上游总页数 · pagination.pages")); assert(html.includes("收到的下一页值 · pagination.next")); assert(!html.includes("上游页码：未提供"));
    }
    const biliPostsSummary=render("bilibili","query_summary",{provider:"agentkey",operationId:"VPA67I98",count:2,accountTotal:30});
    assert(biliPostsSummary.includes("账号作品总数 · accountTotal（非本次返回数）")); assert(!biliPostsSummary.includes("上游总条数：未提供"));
    const biliCursor=render("bilibili","query_summary",{provider:"agentkey",operationId:"bilibili.comments",count:1,pagination:{next:0,is_end:false,pagination_reply:{next_offset:"opaque-comment"}}});
    assert(biliCursor.includes("收到的下一页值 · pagination.next")); assert(biliCursor.includes("评论下一偏移 · pagination.pagination_reply.next_offset"));
    const biliOldSummary=render("bilibili","query_summary",{provider:"redfox",count:2,page:1,pageSize:20,total:30});
    assert(biliOldSummary.includes("上游页码：1")); assert(biliOldSummary.includes("上游每页条数：20")); assert(!biliOldSummary.includes("pagination.page"));
    const biliFull = {provider:"agentkey",operationId:"TIN1NMTZ",workId:"BV1234567890",avId:"321",identity:{mid:"123"},url:"https://www.bilibili.com/video/BV1234567890",record:{author:"实收作者",description:"<b>视频说明</b>",rawTimes:{pubdate:123}}};
    const biliDetail=render("bilibili","bilibili_work",biliFull);
    assert(biliDetail.includes("视频说明：")); assert(biliDetail.includes("&lt;b&gt;视频说明&lt;/b&gt;")); assert(biliDetail.includes("原始 pubdate")); assert(biliDetail.includes("本地导入作品")); assert(!biliDetail.includes("查看可用详情接口"));
    for (const operationId of ["LEN9QXR3","VPA67I98","bilibili.typed_search"]) {
      const html=render("bilibili","bilibili_work",{...biliFull,operationId});
      assert(!html.includes("本地导入作品")); assert(html.includes("需显式查询详情")); assert(html.includes("/admin/redfox?view=platforms")); assert(!html.includes("查看可用详情接口"));
    }
    const recommended=render("bilibili","bilibili_work",{...biliFull,operationId:"bilibili.trending",role:"provider_recommendation"});
    assert(recommended.includes("推荐研究（非排名）")); assert(!recommended.includes("本地导入作品"));
    const biliProfile=render("bilibili","bilibili_account",{provider:"agentkey",operationId:"EH53TOT7",identity:{mid:"123"},record:{name:"实际名称",sign:"实际简介"}});
    assert(biliProfile.includes("实际名称")); assert(biliProfile.includes("实际简介")); assert(biliProfile.includes("绑定账号信源"));
    for (const [operationId,tool] of [["bilibili.comments","TikHub/fetch_video_comments_api_v1_bilibili_app_fetch_video_comments_get"],["bilibili.comment_replies","TikHub/fetch_reply_detail_api_v1_bilibili_app_fetch_reply_detail_get"]]) {
      const html=render("bilibili","social_comment",{provider:"agentkey",operationId,tool,record:{rpid:"901",oid:"321",root:"900",parent:"900",ctime:123,content:{message:"<b>嵌套评论</b>"},member:{mid:"456",uname:"实收评论者"}}});
      assert(html.includes("&lt;b&gt;嵌套评论&lt;/b&gt;")); assert(html.includes("实收评论者")); assert(html.includes("响应作品 OID")); assert(html.includes("原始 ctime")); assert(!html.includes("本地导入作品"));
    }
    const stats=render("bilibili","query_summary",{provider:"agentkey",operationId:"bilibili.relation_stats",count:0,returnedPage:{},record:{mid:"123",following:0,follower:7}});
    assert(stats.includes("关系统计快照")); assert(stats.includes("关注数 following")); assert(!stats.includes("此页没有结果"));
    const dynamic=render("bilibili","bilibili_dynamic",{provider:"agentkey",operationId:"bilibili.dynamics",record:{id_str:"888",type:"DYNAMIC_TYPE_FORWARD",author:{mid:"123",name:"当前作者"},description:"当前说明",originalType:"DYNAMIC_TYPE_AV"}});
    assert(dynamic.includes("当前作者")); assert(dynamic.includes("当前说明")); assert(dynamic.includes("DYNAMIC_TYPE_AV")); assert(!dynamic.includes("本地导入作品"));
    const biliHot=render("bilibili","hotspot_research",{provider:"agentkey",operationId:"bilibili.hot_search",tool:"TikHub/fetch_hot_search_api_v1_bilibili_web_fetch_hot_search_get",record:{keyword:"已收关键词",show_name:"热搜展示词",heat_score:0}});
    assert(biliHot.includes("热搜展示词")); assert(biliHot.includes("已收关键词")); assert(biliHot.includes("不把列表位置当作榜单名次"));
    const xRecord = { tweetId: "9007199254740993123", author: { userId: "123", username: null }, text: "<script>plain</script>🦊", createdAt: "2026-10-20T00:00:00Z", url: "https://x.com/received/status/9007199254740993123" };
    const xData = { operationId: "QCP75W33", workId: xRecord.tweetId, identity: { userId: "123" }, context: { username: "context_handle" }, originResultId: 8, record: xRecord };
    const xHtml = render("x", "x_detail_work", xData);
    assert(xHtml.includes("X 推文详情")); assert(xHtml.includes("后台核实的作者上下文")); assert(xHtml.includes("context_handle")); assert(xHtml.includes("null"));
    assert(xHtml.includes("&lt;script&gt;plain&lt;/script&gt;")); assert(!xHtml.includes("<script>plain</script>")); assert(xHtml.includes("本地导入作品")); assert(xHtml.includes("本次实收原文地址"));
    assert(!render("x", "article", xData).includes("本地导入作品"));
    const linked: OperationResult = { id: 43, kind: "x_detail_work", data: { platform: "x", ...xData, pendingReason: "stale-pending-reason" }, sourceId: "owner", articleId: "legacy", articleTitle: "原文章", receiptId: 1, fileKey: null, file: null, imported: true };
    const linkedHtml = renderElement(createElement(OperationResultView, { result: linked }));
    assert(!linkedHtml.includes("本地导入作品")); assert(!linkedHtml.includes("本地处理待核实原因")); assert(linkedHtml.includes('/admin/content/legacy')); assert(linkedHtml.includes('/admin/sources/owner'));
    const searchHtml = render("x-research", "x_research_work", { operationId: "5K5EG87P", record: { tweetId: xRecord.tweetId, user: { userId: "123" } } });
    assert(searchHtml.includes("查询该作品详情")); assert(!/disabled=""[^>]*>查询该作品详情/.test(searchHtml));
    assert(!render("x-research", "x_comment", { operationId: "ABJQXHUE" }).includes("查询该作品详情"));
    const collection = render("youtube", "query_summary", { returnedPage: { continuationToken: "opaque" }, selectedResearchCount: 0 });
    assert(collection.includes("采集页摘要")); assert(!collection.includes("查看可用详情接口"));
    const operation = detailQueryOperation({ operationId: "LLCI8QTE", label: "车家号详情", parameters: { workId: "frozen" }, fields: [{ name: "page", label: "页码", type: "integer", required: true }], price: { amount: "0.06", currency: "CNY", basis: "estimated" }, purpose: "query" });
    const fields = renderElement(createElement(PlatformFields, { operation, values: {}, onChange: () => {} }));
    assert(fields.includes('aria-label="页码"')); assert(fields.includes('required=""')); assert(fields.includes('value=""')); assert(!fields.includes('value="1"'));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

test("AgentKey X research routes all kinds before generic account actions and preserves received roles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-agentkey-x-")), require = createRequire(import.meta.url);
  const bundle = await rolldown({ input: new URL("../app/features/admin/operation-result.tsx", import.meta.url).pathname, plugins: [{ name: "existing-react-runtime", resolveId(id) { if (["react", "react/jsx-runtime", "react-router", "motion/react"].includes(id)) return { id: require.resolve(id), external: true }; } }] });
  try {
    await bundle.write({ file: join(directory, "result.mjs"), format: "esm" });
    const { OperationResultView } = await import(pathToFileURL(join(directory, "result.mjs")).href);
    const { operationLabel } = await import("../app/features/admin/operation-types.ts");
    const common = { platform: "x-research", provider: "agentkey", importable: false };
    const render = (kind: string, data: Record<string, unknown>, bindingSources?: Array<{ id: string; name: string; participation_mode: string }>) => {
      const result: OperationResult = { id: 42, kind, data: { ...common, ...data }, receiptId: 7, sourceId: null, articleId: null, file: null, fileKey: null, imported: false };
      const router = createMemoryRouter([{ path: "/admin/operations/200", element: createElement(OperationResultView, { result, bindingSources }) }], { initialEntries: ["/admin/operations/200"] });
      try { return renderToStaticMarkup(createElement(RouterProvider, { router })); } finally { router.dispose(); }
    };
    const pairs = [["search", "帖子搜索"], ["account_posts", "账号帖子"], ["detail", "帖子详情"], ["comments", "会话评论"], ["account_profile", "账号资料"], ["followers", "粉丝列表"], ["following", "关注列表"], ["list_posts", "列表帖子"], ["community_posts", "社区帖子"], ["trending", "趋势词"], ["list_members", "列表成员"], ["community_members", "社区成员"]];
    for (const [key, label] of pairs) assert.equal(operationLabel[`agentkey.x.${key}`], `AgentKey X ${label}`);
    const author = { rest_id: "9007199254740993123", screen_name: null, name: "外层作者", verified: false };
    const record = { tweetId: "101", text: "外层文本<script>plain</script>", display_text: "外层展示文本", created_at: "Thu Oct 22 08:00:00 +0800 2026", author, authorContext: { rest_id: author.rest_id, screen_name: "actual_context", source: "received-account-context" }, role: "retweet-wrapper", favorites: 0, retweeted: { id: "202" }, retweeted_tweet: { tweetId: "202", text: "内层原帖文本", author: { rest_id: "303", screen_name: "original_author" } }, quoted: { tweetId: "404", display_text: "引用文本", user_info: { rest_id: "505", screen_name: "quoted_author" } } };
    const work = render("x_research_work", { operationId: "x.account_posts", title: "收到的帖子", record, role: "retweet-wrapper", pinned: true, requestedScope: { screen_name: "requested_scope" } });
    for (const value of ["转发外层帖子", "外层文本&lt;script&gt;plain&lt;/script&gt;", "外层展示文本", "内层原帖文本", "original_author", "引用文本", "quoted_author", "同一 rest_id 的实收账号上下文", "actual_context", "置顶是独立标记", "null（上游为空）", "favorites", "+0800"]) assert(work.includes(value), value);
    assert(!work.includes("<script>plain</script>")); assert(!work.includes("<img"));
    const kinds = [
      ["x_research_work", { operationId: "5K5EG87P", record: { ...record, user: { userId: "123", username: "legacy" }, createdAt: "2026-10-20T00:00:00Z" } }],
      ["x_detail_work", { operationId: "x.detail", record }],
      ["account", { operationId: "x.account_profile", record: { profile: "actual_profile", rest_id: author.rest_id, friends: 0, protected: false } }],
      ["x_comment", { operationId: "ABJQXHUE", role: "conversation-item", record: { tweetId: "606", text: "实收会话文本", conversation_id: "101", author: null } }],
      ["x_followee", { operationId: "x.list_members", identityRole: "list-member", record: { user_id: author.rest_id, screen_name: "actual_member" } }],
      ["hotspot_research", { operationId: "x.trending", record: { name: "实收趋势", description: null, context: "实收语境" } }],
      ["query_summary", { operationId: "x.community_members", count: 0 }],
    ] as const;
    for (const [kind, data] of kinds) {
      const html = render(kind, data);
      assert(html.includes("不自动执行"), kind);
      if (kind === "x_research_work" || kind === "x_detail_work") assert.match(html, /<button[^>]*\sdisabled=""[^>]*>本地导入作品<\/button>/);
      else assert(!/<button[^>]*>[^<]*(?:导入|绑定|查询该作品详情|详情接口)/.test(html), kind);
      assert(!html.includes("不得绑定")); assert(!html.includes('href="/admin/sources/'));
    }
    const detail = render("x_detail_work", { operationId: "x.detail", record: { ...record, author: null, authorContext: { rest_id: author.rest_id, screen_name: "wrong-context", source: "received-account-context" } } });
    assert(!detail.includes("同一 rest_id 的实收账号上下文")); assert(detail.includes("本帖实收 author 作者字段"));
    const profile = render("account", kinds[2][1]);
    assert(profile.includes("actual_profile")); assert(profile.includes("protected")); assert(profile.includes("false（布尔值）"));
    const pinnedProfile = render("account", { operationId: "x.account_profile", title: "actual_profile", record: { profile: "actual_profile", pinned_tweet_ids_str: ["000123456789012345678901", "9007199254740993987"] }, requestedScope: { pinned_tweet_ids_str: ["request-only-pin"] } });
    assert(pinnedProfile.includes("pinned_tweet_ids_str")); assert(pinnedProfile.includes('[&quot;000123456789012345678901&quot;,&quot;9007199254740993987&quot;]')); assert(!pinnedProfile.includes("未提供")); assert(!pinnedProfile.includes("request-only-pin"));
    const emptyPins = render("account", { operationId: "x.account_profile", title: "actual_profile", record: { profile: "actual_profile", pinned_tweet_ids_str: [] } });
    assert(emptyPins.includes("pinned_tweet_ids_str")); assert(emptyPins.includes("[]（空列表，0 项）")); assert(!emptyPins.includes("未提供"));
    assert(!render("account", { operationId: "x.account_profile", record: { profile: "actual_profile" } }).includes("pinned_tweet_ids_str"));
    const nullPins = render("account", { operationId: "x.account_profile", title: "actual_profile", record: { profile: "actual_profile", pinned_tweet_ids_str: null } });
    assert(nullPins.includes("pinned_tweet_ids_str")); assert(nullPins.includes("null（上游为空）"));
    for (const [identityRole, label] of [["follower", "粉丝账号"], ["followee", "关注账号"], ["list-member", "列表成员账号"], ["community-member", "社区成员账号"]]) assert(render("x_followee", { identityRole, record: { user_id: "111", screen_name: "member" } }).includes(label!));
    const comments = render("query_summary", { operationId: "ABJQXHUE", count: 0, root: { tweetId: "101", text: "独立根帖文本", author: null }, pagination: { next_cursor: null, more_users: false } });
    assert(comments.includes("本次返回 0 项")); assert(comments.includes("独立根帖文本")); assert(comments.includes("会话根帖（不计入 count）")); assert(comments.includes("count 仅统计本次实收会话项")); assert(!comments.includes("count 包含 1 条线程根推文")); assert(comments.includes("实收 pagination.next_cursor")); assert(comments.includes("false（布尔值）"));
    const collection = render("query_summary", { operationId: "x.account_posts", count: 7, selectedCount: 3, unprocessedDueToLimit: 4, returnedPage: { next_cursor: " opaque ", more_users: false }, nextParameters: null });
    for (const fact of ["本页实际返回条目", "本页选取条目（含置顶、转发与研究）", "因限额未选条目", "returnedPage", "next_cursor", " opaque ", "false（布尔值）", "null（本页不续页）", "不等于入库文章数"]) assert(collection.includes(fact), fact);
    assert(!collection.includes("本页选入作品候选"));
    const emptyCollection = render("query_summary", { operationId: "x.trending", count: 0, selectedCount: 0, unprocessedDueToLimit: 0, returnedPage: {}, nextParameters: null });
    assert(emptyCollection.includes("本次返回 0 项")); assert(emptyCollection.includes("本页选取条目"));
    const members = render("query_summary", { operationId: "x.community_members", count: 0 });
    assert(members.includes("首页约 19 位")); assert(members.includes("游标不可用于分页")); assert(members.includes("不保证完整名单"));
    const ordinary = { tweetId: "101", role: "post", author: { rest_id: "303", screen_name: "actual_author" }, text: "实收普通帖", url: "https://x.com/actual_author/status/101", urlSource: "derived-canonical-permalink" };
    const imported = render("x_research_work", { operationId: "5K5EG87P", title: "实收普通帖", record: ordinary });
    assert.match(imported, /<button(?![^>]*\sdisabled(?:\s|=|>))[^>]*>本地导入作品<\/button>/);
    assert(imported.includes("按历史回填处理")); assert(imported.includes("正文保持待确认")); assert(!imported.includes("查询该作品详情"));
    const targets = [{ id: "matching", name: "对应主信源", participation_mode: "isolated" }];
    const bindable = { operationId: "x.account_profile", title: "actual_profile", record: { profile: "actual_profile", rest_id: "123" } };
    const bindHtml = render("account", bindable, targets);
    assert(bindHtml.includes('value="matching"')); assert(bindHtml.includes("绑定账号")); assert(!bindHtml.includes("新建隔离"));
    assert(render("account", bindable, []).includes("当前没有匹配的单账号信源"));
    assert(!render("account", { ...bindable, record: { profile: "actual_profile" } }, targets).includes("绑定账号</button>"));
    assert(!render("x_followee", { ...bindable, operationId: "x.list_members" }, targets).includes("绑定账号</button>"));
    const redfox = render("query_summary", { provider: "redfox", operationId: "ABJQXHUE", count: 3, replyCount: 2 });
    assert(redfox.includes("count 包含 1 条线程根推文")); assert(!redfox.includes("count 仅统计本次实收会话项"));
  } finally { await bundle.close(); await rm(directory, { recursive: true, force: true }); }
});

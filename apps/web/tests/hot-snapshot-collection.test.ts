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
import { collectionConfig, collectionDraft, collectionPreviewBody, collectionSeedFromState, collectionSeedNavigation } from "../app/features/admin/collection-subscription-data.ts";
import { platformQueryParameters } from "../app/features/admin/platform-query-data.ts";
import type { PlatformOperation, PlatformField } from "../app/features/admin/platform-types.ts";

const dates: PlatformField[] = [{ name:"startDate",label:"开始日期/时间",type:"string",required:true },{ name:"endDate",label:"结束日期/时间",type:"string",required:true }];
const operations: PlatformOperation[] = [
  { id:"9Y4EX7RW",platform:"hot-research",label:"全网TOP10",purpose:"研究快照",schedulableType:"trend",fields:dates },
  { id:"W94P1QH1",platform:"hot-research",label:"关键词热点",purpose:"研究快照",schedulableType:"trend",fields:[{ name:"keywords",label:"关键词列表",type:"string-array",required:true },{ name:"platforms",label:"平台列表",type:"integer-array",required:false,options:[{value:"1",label:"快手"},{value:"5",label:"微博"}] },...dates] },
  { id:"S28Q6HUD",platform:"hot-research",label:"平台热点榜",purpose:"研究快照",schedulableType:"trend",fields:[{ name:"platform",label:"平台",type:"integer",required:true },...dates] },
];
const filters = (id:string):Record<string,string> => id==="W94P1QH1"?{keywords:" 原词 \none,two",platforms:"1\n5"}:id==="S28Q6HUD"?{platform:"6"}:{};

test("hot subscriptions carry only static filters, default disabled/hourly, and previews synthesize Shanghai day while manual dates stay exact",()=>{
  for(const operation of operations){
    const suffix=operation.id==="9Y4EX7RW"?" 00:00:00":"",values={...filters(operation.id),startDate:"2026-01-01"+suffix,endDate:"2026-01-02"+suffix};
    const target=collectionSeedNavigation(operation.id,values),seed=collectionSeedFromState(target.state)!;
    assert.equal(target.to,"/admin/sources?view=collections");assert.deepEqual(seed.values,filters(operation.id));
    const draft={...collectionDraft(operation,null,seed),name:"热点研究"},config=collectionConfig(operation,draft);
    assert.equal(config.enabled,false);assert.equal(config.intervalMinutes,60);assert.deepEqual(config.limits,{pages:1,items:100,details:0});assert.equal(config.enrichDetails,false);
    assert(!Object.hasOwn(config.parameters,"startDate"));assert(!Object.hasOwn(config.parameters,"endDate"));
    if(operation.id==="W94P1QH1")assert.deepEqual(config.parameters,{keywords:[" 原词 ","one,two"],platforms:[1,5]});
    const preview=collectionPreviewBody(operation,draft.values,new Date("2026-12-31T16:00:01Z"));
    assert.deepEqual(preview.parameters,{...config.parameters,startDate:"2027-01-01"+suffix,endDate:"2027-01-02"+suffix});
    assert.deepEqual(platformQueryParameters(operation,values),{...config.parameters,startDate:values.startDate,endDate:values.endDate});
  }
});

test("real hot editor has no date/page/detail controls, query keeps historical fields, and saved summary shows frozen snapshot counts/window",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"aihot-hot-snapshot-")),require=createRequire(import.meta.url);
  const bundle=await rolldown({input:{editor:new URL("../app/features/admin/collection-subscriptions.tsx",import.meta.url).pathname,query:new URL("../app/features/admin/platform-query.tsx",import.meta.url).pathname,result:new URL("../app/features/admin/operation-result.tsx",import.meta.url).pathname},plugins:[{name:"existing-react-runtime",resolveId(id){if(["react","react/jsx-runtime","react-router","motion/react"].includes(id))return {id:require.resolve(id),external:true};}}]});
  const render=(element:ReactElement)=>{const router=createMemoryRouter([{path:"*",element}],{initialEntries:["/admin/sources?view=collections"]});try{return renderToStaticMarkup(createElement(RouterProvider,{router}));}finally{router.dispose();}};
  try{
    await bundle.write({dir:directory,entryFileNames:"[name].mjs",format:"esm"});
    const {CollectionSubscriptions}=await import(pathToFileURL(join(directory,"editor.mjs")).href),{PlatformQuery}=await import(pathToFileURL(join(directory,"query.mjs")).href),{OperationResultView}=await import(pathToFileURL(join(directory,"result.mjs")).href);
    for(const operation of operations){
      const seed=collectionSeedFromState(collectionSeedNavigation(operation.id,filters(operation.id)).state);
      const editor=render(createElement(CollectionSubscriptions,{operations:[operation],subscriptions:[],requestedId:null,seed}));
      assert(editor.includes("每轮自动查询当天"));assert(editor.includes("Asia/Shanghai"));assert(editor.includes("最新可查询前 1 小时"));assert.match(editor,/aria-label="周期（分钟）"[^>]*value="60"/);
      assert(editor.includes('aria-label="每轮最多研究记录"'));assert(!editor.includes('aria-label="开始日期/时间"'));assert(!editor.includes('aria-label="结束日期/时间"'));assert(!editor.includes('aria-label="每轮最多页数"'));assert(!editor.includes('aria-label="开启必要详情补全"'));assert(!/aria-label="启用定时采集"[^>]*checked/.test(editor));
      const query=render(createElement(PlatformQuery,{operations:[operation]}));assert(query.includes('aria-label="开始日期/时间"'));assert(query.includes('aria-label="结束日期/时间"'));assert(query.includes("不沿用这里的日期"));assert(query.includes("带入新采集订阅"));
      const result={id:42,kind:"query_summary",data:{platform:"hot-research",operationId:operation.id,page:1,count:3,workCount:0,selectedCount:2,processedCount:2,researchCount:3,selectedResearchCount:2,unprocessedDueToLimit:1,unprocessedResearchDueToLimit:1,truncated:true,queryWindow:{startDate:"2026-12-31",endDate:"2027-01-01",timeZone:"Asia/Shanghai"},returnedPage:{},nextParameters:null,stopReason:"item-limit"},receiptId:7,sourceId:null,articleId:null,file:null,fileKey:null,imported:false};
      const html=render(createElement(OperationResultView,{result}));assert(html.includes("本轮冻结查询窗口"));assert(html.includes("2026-12-31"));assert(html.includes("2027-01-01"));assert(html.includes("Asia/Shanghai"));assert(html.includes("本页选取快照"));assert(html.includes("本页已处理快照"));assert(html.includes("因限额未选快照"));assert(!html.includes("本页已处理作品候选"));
    }
  }finally{await bundle.close();await rm(directory,{recursive:true,force:true});}
});

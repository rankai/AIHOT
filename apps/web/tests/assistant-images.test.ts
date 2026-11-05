import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {rolldown} from "rolldown";
test("image artifact renders responsive local image, prompt, alt and download without editing controls",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"assistant-image-render-")),require=createRequire(import.meta.url);
 const bundle=await rolldown({input:new URL("../app/features/assistant/artifacts.tsx",import.meta.url).pathname,plugins:[{name:"runtime",resolveId(id){if(["react","react-dom","react/jsx-runtime","react-router","motion/react","@assistant-ui/react"].includes(id))return {id:require.resolve(id),external:true};}}]});
 try{
  await bundle.write({dir:directory,format:"esm",entryFileNames:"artifact.mjs"});
  const {AssistantArtifactCard}=await import(pathToFileURL(join(directory,"artifact.mjs")).href);
  const html=renderToStaticMarkup(createElement(AssistantArtifactCard,{artifact:{artifactId:"image",kind:"image",version:1,schemaVersion:1,sources:[],content:{title:"窗边的猫",prompt:"柔和晨光，写实摄影",fileKey:"safe-image-key",width:1024,height:1024}},sessionId:"session",csrf:"",active:false,options:{assistants:[]},refresh:async()=>{}}));
  assert.match(html,/alt="窗边的猫"/);assert.match(html,/src="\/api\/tools\/assets\/safe-image-key\/content"/);assert.match(html,/柔和晨光，写实摄影/);assert.match(html,/<a href="\/api\/tools\/assets\/safe-image-key\/content" download="窗边的猫 · 第 1 版"/);assert.match(html,/h-auto w-full/);assert(!html.includes("编辑稿件"));assert(!html.includes("用这版继续修改"));assert(!html.includes("Redfox"));
  const content={title:"公众号文章",body:"正文",intent:"draft" as const,titles:[],tags:[],sources:[],partial:false,scope:"合成验收"};
  const text=renderToStaticMarkup(createElement(AssistantArtifactCard,{artifact:{artifactId:"text",kind:"text-draft",version:1,schemaVersion:1,sources:[],content},sessionId:"session",csrf:"",active:false,options:{assistants:[]},refresh:async()=>{}}));
  assert.match(text,/>文章草稿</);assert(!text.includes("通用稿件"));
  const xhs=renderToStaticMarkup(createElement(AssistantArtifactCard,{artifact:{artifactId:"xhs",kind:"xhs-note",version:1,schemaVersion:1,sources:[],content:{...content,tags:["AI"]}},sessionId:"session",csrf:"",active:false,options:{assistants:[]},refresh:async()=>{}}));
  assert.match(xhs,/>小红书笔记</);
 }finally{await bundle.close();await rm(directory,{recursive:true,force:true});}
});

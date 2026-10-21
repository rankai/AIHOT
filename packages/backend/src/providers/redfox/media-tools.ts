import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import type { PaidRequestOptions } from "../receipts.ts";
import { redfoxRequest } from "./client.ts";
import { mediaToolOperations, type MediaToolOperation } from "./media-tools-contract.ts";
const Text=z.string().nullable().optional();
const Seconds=z.union([z.number().int().safe(),z.string().regex(/^-?\d+$/)]).nullable().optional();
const Resource=z.object({type:z.string().min(1),downloadUrl:z.string().min(1),coverUrl:Text,durationSeconds:Seconds}).passthrough();
const Download=z.object({title:Text,cover:Text,videoUrl:Text,desc:Text,resources:z.array(Resource)}).passthrough();
const Track=z.object({languageName:z.string(),languageTag:z.string(),urls:z.array(z.object({format:z.string().min(1),url:z.string().min(1)}).passthrough())}).passthrough();
const Subtitles=z.object({createdAt:Text,duration:Seconds,id:Text,site:Text,text:Text,thumbnailUrl:Text,title:Text,subtitles:z.array(Track)}).passthrough();
export interface MediaToolResult {kind:"media_resource"|"subtitle_track"|"text_check"|"query_summary";itemKey:string;data:Record<string,unknown>}
function safeUrl(value:unknown){if(typeof value!=="string")return null;try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}}
function fields(record:Record<string,unknown>,names:string[]){return Object.fromEntries(names.filter(k=>Object.hasOwn(record,k)).map(k=>[k,record[k]]));}
export function parseMediaTool(op:MediaToolOperation,raw:unknown,parameters:Record<string,unknown>):MediaToolResult[]{
 const spec=mediaToolOperations[op],base={platform:spec.platform,operationId:op,group:spec.group,requestedInput:parameters};
 const results:MediaToolResult[]=[];
 const resource=(record:Record<string,unknown>,index:number)=>results.push({kind:"media_resource",itemKey:`resource:${index}`,data:{...base,record,reportedType:record.type,resourceUrl:safeUrl(record.downloadUrl),...(Object.hasOwn(record,"durationSeconds")?{durationSeconds:record.durationSeconds}:{}),missing:safeUrl(record.downloadUrl)?[]:["资源地址不是可展示的HTTP(S)地址；原值仅作诊断"]}});
 let metadata:Record<string,unknown>={},diagnostics:string[]=[];
 if(op==="API_1791881343238"){
  const record=z.object({content:z.string(),originalContent:z.string(),prohibitedWordsType:z.array(z.string())}).passthrough().parse(raw);
  const sanitizedHighlightHtml=sanitizeHtml(record.content,{allowedTags:["span"],allowedAttributes:{span:["class"]},allowedClasses:{span:["banned-word","industry-banned-word"]},allowedSchemes:[],disallowedTagsMode:"discard"});
  return [{kind:"text_check",itemKey:"check",data:{...base,record,originalContent:record.originalContent,prohibitedWordsType:record.prohibitedWordsType,sanitizedHighlightHtml}}];
 }
 if(spec.group==="subtitle"){
  const page=Subtitles.parse(raw);metadata=fields(page,["createdAt","duration","id","site","thumbnailUrl","title"]);
  // Upstream text is the video's description, never subtitle contents.
  if(Object.hasOwn(page,"text"))metadata.description=page.text;
  page.subtitles.forEach((record,index)=>results.push({kind:"subtitle_track",itemKey:`track:${index}`,data:{...base,record,languageName:record.languageName,languageTag:record.languageTag,formats:record.urls.map(entry=>({format:entry.format,reportedUrl:entry.url,resourceUrl:safeUrl(entry.url)})),reportedMetadata:metadata}}));
 }else if(op==="9Q2PQBKU"){
  const page=z.object({audioExt:Text,audioUrl:Text,cover:Text,desc:Text,title:Text}).passthrough().refine(p=>["audioExt","audioUrl","cover","desc","title"].some(k=>Object.hasOwn(p,k)),"No recognizable audio metadata").parse(raw);
  metadata={...page};if(page.audioUrl)resource({type:"audio",downloadUrl:page.audioUrl,...fields(page,["audioExt","cover"])},0);
 }else if(op==="AWUTFI4V"){
  const page=z.object({awemeType:Text,videoUrl:Text,imageUrls:z.union([z.string(),z.array(z.string())]).nullable().optional(),cover:Text,title:Text,platform:Text}).passthrough().refine(p=>["awemeType","videoUrl","imageUrls","cover","title"].some(k=>Object.hasOwn(p,k)),"No recognizable parser metadata").parse(raw);
  metadata={...page};let images:string[]=[];
  if(typeof page.imageUrls==="string"){
   try{images=z.array(z.string()).parse(JSON.parse(page.imageUrls));}catch{diagnostics.push("imageUrls 未能按严格JSON字符串数组识别；保留原值，未修复或声明图集为空");}
  }else if(Array.isArray(page.imageUrls))images=page.imageUrls;
  if(page.videoUrl)resource({type:"video",downloadUrl:page.videoUrl},results.length);
  for(const url of images)resource({type:"image",downloadUrl:url},results.length);
 }else{
  const page=Download.parse(raw);metadata=fields(page,["title","cover","videoUrl","desc"]);page.resources.forEach(resource);
 }
 results.push({kind:"query_summary",itemKey:"metadata",data:{...base,count:results.length,reportedMetadata:metadata,...(diagnostics.length?{diagnostics}:{}),...(spec.group==="subtitle"?{durationUnit:"seconds",textMeaning:"video-description",subtitleFilesFetched:false}:{resourceFilesFetched:false})}});
 return results;
}
export async function queryMediaTool(op:MediaToolOperation,parameters:Record<string,unknown>,window:string,options:PaidRequestOptions){
 const spec=mediaToolOperations[op],input=spec.schema.parse(parameters),response=await redfoxRequest(op,input,window,spec.purpose,options);
 return {...response,results:parseMediaTool(op,response.data,input)};
}

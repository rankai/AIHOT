import { z } from 'zod';
import { load } from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { sha256 } from '../../lib/ids.ts';
export const XHS_WORD_OPERATION='API_1791881343238';
export const XHS_WORD_SOURCE='小红书违禁词查询-xhs';
export interface WordHit {id:string;start:number;end:number;word:string;types:string[];suspected:boolean}
const classes=['banned-word','sensitive-word','industry-banned-word'];
export function parseXhsWords(raw:unknown,original:string){
 const record=z.object({content:z.string(),originalContent:z.string(),prohibitedWordsType:z.array(z.string())}).parse(raw);
 if(record.originalContent!==original)throw new Error('检测返回原文不一致');
 const safe=sanitizeHtml(record.content,{allowedTags:['span'],allowedAttributes:{span:['class']},allowedClasses:{span:classes},allowedSchemes:[],disallowedTagsMode:'discard'});
 const $=load(safe,null,false);let text='';const hits:WordHit[]=[];
 function visit(node:any){
  if(node.type==='text'){text+=node.data;return;}
  const start=text.length;for(const child of node.children??[])visit(child);
  const types=String(node.attribs?.class??'').split(/\s+/).filter(c=>classes.includes(c));
  if(types.length&&text.length>start){const end=text.length,word=text.slice(start,end),suspected=/^[a-z]+$/i.test(word)&&(/[a-z]/i.test(original[start-1]??'')||/[a-z]/i.test(original[end]??''));hits.push({id:sha256(`${start}:${end}:${word}`).slice(0,24),start,end,word,types:[...new Set(types)],suspected});}
 }
 for(const node of $.root().contents().toArray())visit(node);
 if(text!==original)throw new Error('检测标记正文与请求原文不一致');
 const unique=new Map<string,WordHit>();for(const hit of hits){const prior=unique.get(hit.id);if(prior)prior.types=[...new Set([...prior.types,...hit.types])];else unique.set(hit.id,hit);}
 return {originalContent:original,hits:[...unique.values()].sort((a,b)=>a.start-b.start||a.end-b.end),prohibitedWordsType:record.prohibitedWordsType};
}

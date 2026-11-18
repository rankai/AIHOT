import { sha256 } from '../lib/ids.ts';
import { conflict } from './store.ts';
import { WordCheckScope } from './word-check-contract.ts';
import { wordSourceText } from './word-check-input.ts';
import type { WordHit } from '../providers/redfox/xhs-words.ts';
export function wordCheckResults(rows:{kind:string;data:any}[],snapshot:Record<string,any>,batchIndex:number){
 const scope=WordCheckScope.parse(snapshot.taskScope.wordCheck),batch=scope.batches[batchIndex];
 if(!batch)throw conflict('检测批次不属于本次范围');
 const result=rows.find(r=>r.kind==='text_check'&&r.data.platform==='xiaohongshu')?.data;
 const {text}=wordSourceText(snapshot,scope.source);
 if(!result||result.originalContent!==text.slice(batch.start,batch.end)||!Array.isArray(result.hits))throw conflict('检测结果尚未核清');
 const hits:WordHit[]=result.hits.map((hit:WordHit)=>{
  const start=hit.start+batch.start,end=hit.end+batch.start;
  if(text.slice(start,end)!==hit.word||start<batch.start||end>batch.end)throw conflict('命中位置与原文不一致');
  return {...hit,start,end,suspected:/^[a-z]+$/i.test(hit.word)&&(/[a-z]/i.test(text[start-1]??'')||/[a-z]/i.test(text[end]??'')),id:`hit:${sha256(`${start}:${end}:${hit.word}`).slice(0,24)}`};
 });
 return {batch:batchIndex,complete:true,characters:batch.end-batch.start,hits:hits.map(hit=>({...hit,context:text.slice(Math.max(0,hit.start-50),Math.min(text.length,hit.end+50))})),nextBatch:batchIndex+1<scope.batches.length?batchIndex+1:null};
}

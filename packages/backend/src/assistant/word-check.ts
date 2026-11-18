import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Tx } from '../db.ts';
import { wordCheckResults } from './word-check-results.ts';
import { conflict,event } from './store.ts';
import { WordCheckScope,SaveWordCheck } from './word-check-contract.ts';
import { wordSourceText } from './word-check-input.ts';
import { assertKnownResearchQuery } from './research-window.ts';
import type { WordHit } from '../providers/redfox/xhs-words.ts';
export function wordCheckInputProjection(row:Record<string,any>){
 const text=row.content?.wordCheck?.modifiedText;
 if(typeof text!=='string')throw conflict('检测报告没有可引用文案');
 return {...row,source_snapshot:[],content:{title:'',body:text,modifiedText:text}};
}
export function applyWordSuggestions(text:string,hits:WordHit[],suggestions:z.infer<typeof SaveWordCheck>['suggestions']){
 const ids=new Set<string>();const applied:Array<{hitId:string;replacement:string;reason:string;applied:boolean}>=[];
 let modifiedText=text,previousStart=text.length;
 for(const suggestion of [...suggestions].sort((a,b)=>(hits.find(h=>h.id===b.hitId)?.start??-1)-(hits.find(h=>h.id===a.hitId)?.start??-1))){
  const hit=hits.find(h=>h.id===suggestion.hitId);
  if(!hit||ids.has(hit.id))throw conflict('建议引用不存在或重复的命中');ids.add(hit.id);
  const valid=!hit.suspected&&hit.end<=previousStart&&text.slice(hit.start,hit.end)===hit.word;
  if(valid){modifiedText=modifiedText.slice(0,hit.start)+suggestion.replacement+modifiedText.slice(hit.end);previousStart=hit.start;}
  applied.push({...suggestion,applied:valid});
 }
 if(hits.some(hit=>!hit.suspected&&!ids.has(hit.id)))throw conflict('请为每项实际命中提供替换建议，不重写全文');
 return {modifiedText,suggestions:applied.reverse(),modificationsComplete:applied.every(s=>s.applied||hits.find(h=>h.id===s.hitId)?.suspected)};
}
export async function persistWordCheck(tx:Tx,turn:Record<string,any>,input:z.infer<typeof SaveWordCheck>){
 const scope=WordCheckScope.parse(turn.snapshot.taskScope?.wordCheck),{text}=wordSourceText(turn.snapshot,scope.source);
 const hits=new Map<string,WordHit>();const batches=[];
 for(const batch of scope.batches){
  const [call]=await tx`SELECT c.* FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id WHERE c.turn_id=${turn.id} AND c.name='check_xhs_words' AND (c.input->>'batch')::int=${batch.index} AND c.input->>'activationId'=${input.activationId} AND c.state='completed' AND r.actor=${`user:${turn.owner_user_id}`} AND r.status='completed' ORDER BY c.ordinal LIMIT 1`;
  if(!call)throw conflict('选定原文尚未全部检测，不能交付完整报告');
  await assertKnownResearchQuery(tx,call.child_run_id);
  const result=wordCheckResults(await tx`SELECT kind,data FROM operation_results WHERE run_id=${call.child_run_id}`,turn.snapshot,batch.index);
  batches.push({index:batch.index,start:batch.start,coreStart:batch.coreStart,end:batch.end,hitCount:result.hits.length});
  for(const hit of result.hits){const existing=hits.get(hit.id);if(existing)existing.types=[...new Set([...existing.types,...hit.types])];else{const {context,...fact}=hit;hits.set(hit.id,fact);}}
 }
 const ordered=[...hits.values()].sort((a,b)=>a.start-b.start||a.end-b.end),changes=applyWordSuggestions(text,ordered,input.suggestions);
 if(!changes.modificationsComplete)throw conflict('替换存在重叠或未应用，不能保存完整修改报告');
 const wordCheck={source:scope.source,sourceLabel:scope.label,characters:scope.characters,textHash:scope.textHash,scope:'检查所选原文全文',checkedAt:new Date().toISOString(),batches,hits:ordered,originalText:text,...changes,notice:'本次检测结果不保证平台审核通过；建议稿未经再次检测。'};
 await tx`SELECT id FROM assistant_sessions WHERE id=${turn.session_id} FOR UPDATE`;
 const artifactId=randomUUID(),content={title:input.title,body:'检测已完成',intent:'draft',titles:[],tags:[],sources:[],partial:false,scope:wordCheck.scope,wordCheck};
 await tx`INSERT INTO assistant_artifact_versions(session_id,artifact_id,version,base_version,kind,turn_id,activation_id,content,source_snapshot) VALUES (${turn.session_id},${artifactId},1,0,'xhs-word-check',${turn.id},${input.activationId},${tx.json(content as never)},'[]')`;
 await event(tx,turn.session_id,'artifact',artifactId);
 return {artifactId,version:1,kind:'xhs-word-check'};
}

import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Tx } from '../db.ts';
import { conflict,event } from './store.ts';
import { SaveTitleReport,titleGrade } from './title-report-contract.ts';
import { xhsTitleResults } from '../providers/redfox/xhs-titles.ts';
import { assertKnownResearchQuery } from './research-window.ts';
/** Reusing reports exposes actual title text, never the research appendix or computed grades. */
export function titleReportInputProjection(row:Record<string,any>){
 const report=row.content?.titleReport;
 if(!report||!['generate','score'].includes(report.mode))throw conflict('标题报告格式不可引用');
 const titles=report.mode==='generate'?report.candidates.map((c:any)=>c.title):report.evaluations.map((e:any)=>e.title);
 return {...row,source_snapshot:[],content:{title:"",body:titles.join('\n'),titles}};
}
export const normalizedTitle=(value:string)=>value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'');
export async function persistTitleReport(tx:Tx,turn:Record<string,any>,input:z.infer<typeof SaveTitleReport>){
 const policy=turn.snapshot.taskScope?.research?.policy;
 if(policy!==(input.mode==='generate'?'xhs-title-generate@1':'xhs-title-score@1'))throw conflict('报告模式与已授权范围不一致');
 const calls=await tx`SELECT c.* FROM assistant_tool_calls c JOIN operation_runs r ON r.id=c.child_run_id
 WHERE c.turn_id=${turn.id} AND c.name='search_xhs_titles' AND c.state='completed' AND c.input->>'activationId'=${input.activationId} AND r.actor=${`user:${turn.owner_user_id}`} AND r.status='completed' ORDER BY c.ordinal`;
 if(!calls.length)throw conflict('没有已完成的标题研究');
 const samples=new Map<string,Record<string,any>>(),queries=[];
 for(const call of calls){
  await assertKnownResearchQuery(tx,call.child_run_id);
  const rows=await tx`SELECT id,kind,data FROM operation_results WHERE run_id=${call.child_run_id} ORDER BY id`;
  const projected=xhsTitleResults(rows as any);
  if(!projected.metadata.rawCounts)throw conflict('研究结果尚未核清');
  queries.push({keyword:projected.metadata.keyword,startDate:projected.metadata.startDate,rawCounts:projected.metadata.rawCounts,deduplicatedCount:projected.metadata.deduplicatedCount,candidateCount:projected.metadata.candidateCount,projectedCount:projected.metadata.projectedCount});
  for(const row of projected.results)samples.set(row.sourceId,{sourceId:row.sourceId,resultId:row.id,title:row.title,url:row.url,categories:row.categories,authorName:row.authorName,publicTime:row.publicTime,likes:row.useLikeCount??null});
 }
 const used=new Set(input.sampleIds);
 if(!used.size||[...used].some(id=>!samples.has(id)))throw conflict('需要实际入模的有效参考标题，不得编造样本');
 const references=[...used].map(id=>samples.get(id)!);
 for(const entry of [...input.candidates,...input.evaluations])if(entry.sourceIds.some(id=>!used.has(id)))throw conflict('引用必须属于本次实际分析样本');
 const originals=[turn.snapshot.message,...(turn.snapshot.selected??[]).flatMap((s:any)=>[s.content?.title,s.content?.body,...(s.content?.titles??[]),s.text])].filter((v:any)=>typeof v==='string');
 const evaluations=input.evaluations.map(e=>{
  if(!originals.some((text:string)=>text.includes(e.title)))throw conflict('原标题必须逐字来自本次用户输入或明确选定的稿件版本');
  const score=titleGrade(e.dimensions);
  if(score.grade!=='S'&&e.revisions.length<2)throw conflict('非S级标题需2至3个修改版本及适用场景');
  return {...e,...score,duplicate:references.some(s=>normalizedTitle(s.title)===normalizedTitle(e.title))};
 });
 const candidates=input.candidates.map(c=>({...c,duplicate:references.some(s=>normalizedTitle(s.title)===normalizedTitle(c.title))}));
 const titleReport={mode:input.mode,summary:input.summary,candidates,evaluations,evidence:{queries,analyzedCount:references.length,samples:references},notice:'编辑参考，不预测点击率或流量；合规安全性评分不代表词库检测。'};
 await tx`SELECT id FROM assistant_sessions WHERE id=${turn.session_id} FOR UPDATE`;
 const artifactId=randomUUID(),sources=references.map(s=>({id:`search:${s.resultId}`,kind:'research',label:s.title,url:s.url}));
 const content={title:input.title,body:input.summary,intent:'draft',titles:[],tags:[],sources:sources.map(s=>s.id),partial:false,scope:`实际分析${references.length}条参考标题`,titleReport};
 await tx`INSERT INTO assistant_artifact_versions(session_id,artifact_id,version,base_version,kind,turn_id,activation_id,content,source_snapshot)
 VALUES (${turn.session_id},${artifactId},1,0,'xhs-title-report',${turn.id},${input.activationId},${tx.json(content as never)},${tx.json(sources)})`;
 await event(tx,turn.session_id,'artifact',artifactId);
 return {artifactId,version:1,kind:'xhs-title-report'};
}

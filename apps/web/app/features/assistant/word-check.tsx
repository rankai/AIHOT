import type { AssistantArtifact } from '@aihot/contracts/assistant';
function Marked({text,ranges}:{text:string;ranges:Array<{start:number;end:number}>}){
 const merged:Array<{start:number;end:number}>=[];
 for(const range of [...ranges].sort((a,b)=>a.start-b.start)){const last=merged.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});}
 let start=0;const nodes=merged.flatMap((range,index)=>{const before=text.slice(start,range.start);start=range.end;return [before,<strong key={index}>{text.slice(range.start,range.end)}</strong>];});
 return <p className="whitespace-pre-wrap break-words">{nodes}{text.slice(start)}</p>;
}
export function WordCheckBody({artifact}:{artifact:AssistantArtifact}){
 const report=artifact.content.wordCheck!;let delta=0;
 const modifiedRanges=report.suggestions.filter(s=>s.applied).map(s=>({s,hit:report.hits.find(h=>h.id===s.hitId)!})).sort((a,b)=>a.hit.start-b.hit.start).map(({s,hit})=>{const start=hit.start+delta;delta+=s.replacement.length-(hit.end-hit.start);return {start,end:start+s.replacement.length};});
 return <div className="min-w-0 space-y-4 break-words"><h3 className="font-medium">{artifact.content.title}</h3><p>{report.sourceLabel} · {report.characters} 字 · {report.batches.length} 段已检查</p><p className="text-[12px] text-ink-3">{report.scope} · {report.notice}</p>
 <h4>{report.hits.length?`发现 ${report.hits.length} 处标记`:'本次未检出'}</h4><details><summary>原文与命中</summary><Marked text={report.originalText} ranges={report.hits}/></details>
 {report.hits.map(hit=><div key={hit.id} className="text-[13px]"><strong>{hit.word}</strong> · {hit.suspected?'可能匹配到了英文单词的一部分，暂不替换':hit.types.map(type=>({'banned-word':'违禁词','sensitive-word':'敏感词','industry-banned-word':'行业违禁词'}[type]??type)).join('、')}</div>)}
 {!report.hits.length&&<section><h4>修改建议</h4><p>本次未检出，无需修改。</p></section>}
 {!!report.suggestions.length&&<section><h4>修改建议</h4>{report.suggestions.map(s=><p key={s.hitId} className="text-[13px]">{report.hits.find(h=>h.id===s.hitId)?.word} → {s.replacement||'删除'} · {s.reason}{s.applied?'':'（未应用，原文保留）'}</p>)}</section>}
 <section><h4>{report.hits.length?'建议修改稿':'原文'}</h4><Marked text={report.modifiedText} ranges={modifiedRanges}/></section></div>;
}
export function WordCheckQueryResult({value}:{value:unknown}){
 if(!value||typeof value!=='object'||!('hits' in value)||!Array.isArray(value.hits))return null;
 const result=value as {batch:number;hits:Array<{id:string;word:string;context:string;suspected:boolean}>;reportUnavailable?:boolean};
 return <details className="text-[13px]"><summary>查看第 {result.batch+1} 段检测结果 · {result.hits.length} 处标记</summary>{result.hits.length?result.hits.map(hit=><p key={hit.id} className="break-words"><strong>{hit.word}</strong>{hit.suspected?'（疑似误报）':''} · {hit.context}</p>):<p>本段未检出。</p>}{result.reportUnavailable&&<p>修改建议未完成，以上仅为已查询的检测结果。</p>}</details>;
}

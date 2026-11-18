import { z } from 'zod';
import { sha256 } from '../lib/ids.ts';
import { AccountError } from '../users/accounts.ts';
import { WordSource,WordCheckScope } from './word-check-contract.ts';
const clarify=(message:string)=>new AccountError(409,'invalid_request',message);
const boundary=(text:string,n:number)=>n>0&&n<text.length&&/[\uD800-\uDBFF]/.test(text[n-1]!)&&/[\uDC00-\uDFFF]/.test(text[n]!);
export function splitWordCheck(text:string){
 if(!text.trim()||text.length>10000)throw clarify('请选择一份1至10000字以内的待检测文案。');
 const requestLimit=2000,coreMaximum=1800,coreMinimum=1700,overlap=200;
 const batches=[];let coreStart=0;
 while(coreStart<text.length){
  let start=Math.max(0,coreStart-overlap);if(boundary(text,start))start++;
  let end=text.length;
  if(end-start>requestLimit){
   end=coreStart+coreMaximum;
   const section=text.slice(coreStart+coreMinimum-1,end),matches=[...section.matchAll(/[。！？!?；;\n]/g)];
   if(matches.length)end=coreStart+coreMinimum+matches.at(-1)!.index!;
  }
  if(boundary(text,end))end--;
  batches.push({index:batches.length,start,coreStart,end,hash:sha256(text.slice(start,end))});coreStart=end;
 }
 if(batches.length>6)throw clarify('文案分段超过检测范围，请缩小本次文字。');
 return batches;
}
export function wordArtifactText(item:Record<string,any>){
 const c=item.content??{};
 if(item.kind==='xhs-title-report')return typeof c.body==='string'?c.body:'';
 if(item.kind==='xhs-word-check')return typeof c.modifiedText==='string'?c.modifiedText:c.wordCheck?.modifiedText??'';
 if(!['text-draft','xhs-note'].includes(item.kind))throw clarify('请选择文字稿件或标题文案。');
 return [c.title,c.body,Array.isArray(c.tags)?c.tags.map((tag:string)=>tag.startsWith('#')?tag:'#'+tag).join(' '):''].filter(Boolean).join('\n\n');
}
export function wordSourceText(snapshot:Record<string,any>,raw:unknown){
 const source=WordSource.parse(raw);
 if(source.kind==='message'){
  const message=String(snapshot.message);
  if(source.end>message.length||source.start>=source.end||boundary(message,source.start)||boundary(message,source.end))throw clarify('原文位置已变化，请重新选择文案。');
  return {source,text:message.slice(source.start,source.end),label:source.start===0&&source.end===message.length?'本次粘贴文案':'本次粘贴的所选文案'};
 }
 const explicitlySelected=source.kind==='input'?snapshot.materialSelection?.inputs!==false&&snapshot.inputIds?.includes(source.inputId):snapshot.materialSelection?.artifacts!==false&&snapshot.artifactVersions?.some((s:any)=>s.artifactId===source.artifactId&&s.version===source.version);
 if(!explicitlySelected)throw clarify('请明确选择本次要检测的一份材料。');
 const item=(snapshot.selected??[]).find((item:any)=>source.kind==='input'?item.id===source.inputId:item.artifact_id===source.artifactId&&item.version===source.version);
 if(!item)throw clarify('选定原文不可访问，请重新选择。');
 return {source,text:source.kind==='input'?item.text:wordArtifactText(item),label:String(item.source?.filename??item.content?.title??'选定文案').slice(0,300)||'选定文案'};
}
/** Model anchors are literal data, never offsets or rewritten copy. */
export function locateWordText(message:string,raw:{wordText?:unknown;wordStart?:unknown;wordEnd?:unknown}){
 let start:number,end:number;
 if(typeof raw.wordText==='string'&&raw.wordText.length<=1500){start=message.indexOf(raw.wordText);end=start+raw.wordText.length;if(start<0||message.indexOf(raw.wordText,start+1)>=0)throw clarify('无法唯一确认待检测原文，请分隔正文或选择一份材料。');}
 else if(typeof raw.wordStart==='string'&&typeof raw.wordEnd==='string'&&raw.wordStart.length>=8&&raw.wordStart.length<=100&&raw.wordEnd.length>=8&&raw.wordEnd.length<=100){
  start=message.indexOf(raw.wordStart);const last=message.indexOf(raw.wordEnd,start+raw.wordStart.length);end=last+raw.wordEnd.length;
  if(start<0||last<0||message.indexOf(raw.wordStart,start+1)>=0||message.indexOf(raw.wordEnd,last+1)>=0)throw clarify('原文边界不唯一，请明确正文范围。');
 }else throw clarify('请明确本次待检测的原文。');
 return WordSource.parse({kind:'message',start,end});
}
export function defaultWordSource(snapshot:Record<string,any>){
 const sources=[...(snapshot.materialSelection?.inputs===false?[]:snapshot.inputIds??[]).map((inputId:string)=>({kind:'input',inputId})),...(snapshot.materialSelection?.artifacts===false?[]:snapshot.artifactVersions??[]).map((v:any)=>({kind:'artifact',...v}))];
 if(sources.length===1)return WordSource.parse(sources[0]);
 if(sources.length>1)throw clarify('一次检查一份文案，请在材料选择中只选本次要检查的文件或稿件。');
 const message=String(snapshot.message);
 const marked=/^(?:请)?(?:帮我)?(?:检查|检测|查一下)(?:小红书)?(?:违禁词|敏感词|文案)?[：:]\s*/.exec(message);
 if(marked)return WordSource.parse({kind:'message',start:marked[0].length,end:message.length});
 const fence=/```(?:text|txt|markdown|md)?\n([\s\S]*?)\n```/.exec(message);
 if(fence&&message.indexOf('```',fence.index+fence[0].length)<0)return WordSource.parse({kind:'message',start:fence.index+fence[0].indexOf('\n')+1,end:fence.index+fence[0].lastIndexOf('\n')});
 throw clarify('请用“检查：”后粘贴正文，或明确选择一份文件、稿件；混合说明需要明确原文范围。');
}
export function freezeWordCheck(snapshot:Record<string,any>,frozen?:unknown){
 const prior=frozen?WordCheckScope.parse(frozen):undefined;
 const {source,text,label}=wordSourceText(snapshot,prior?.source??snapshot.taskScope.wordSource??defaultWordSource(snapshot));
 if(/^\s*https?:\/\/\S+\s*$/i.test(text))throw clarify('不能检测链接页面，请粘贴网页正文。');
 if(/(?:不要|禁止|不同意|拒绝)[^。\n]{0,12}(?:外传|发送.{0,5}(?:服务|第三方))/.test(snapshot.message))throw clarify('本次未授权将原文发送检测服务，未进行检测。');
 if(prior){
  if(prior.characters!==text.length||prior.textHash!==sha256(text))throw clarify('原文或所选版本已变化，请重新报价。');
  let end=0;if(prior.batches[0]!.start!==0)throw clarify('检测首段必须从原文开头开始。');
  for(const batch of prior.batches){if(batch.index!==prior.batches.indexOf(batch)||batch.coreStart!==end||batch.start>batch.coreStart||batch.coreStart-batch.start>200||batch.end<=batch.coreStart||batch.end>text.length||batch.end-batch.start>2000||boundary(text,batch.start)||boundary(text,batch.end)||sha256(text.slice(batch.start,batch.end))!==batch.hash)throw clarify('冻结检测分段不可验证，请重新报价。');end=batch.end;}
  if(end!==text.length)throw clarify('冻结检测范围不完整。');
  return prior;
 }
 const scope=WordCheckScope.parse({version:1,source,textHash:sha256(text),characters:text.length,label,batches:splitWordCheck(text)});
 return scope;
}
export function wordCheckModelInput(snapshot:Record<string,any>){
 const scope=snapshot.taskScope?.wordCheck;
 if(!scope)return snapshot;
 return {...snapshot,message:`检查已冻结的${scope.label}，共${scope.characters}字，${scope.batches.length}段。使用check_xhs_words逐段检查，完成后保存报告。`,history:[],brief:{},selected:[{kind:'word-check-source',label:scope.label,characters:scope.characters}],taskScope:snapshot.taskScope};
}
/** An explicit delimiter already identifies data; quote routing needs the surrounding instruction, not that whole body. */
export function wordPreparationMessage(snapshot:Record<string,any>){
 try{
  const source=defaultWordSource(snapshot);
  if(source.kind==='message')return snapshot.message.slice(0,source.start)+`[已明确提供${source.end-source.start}字原文，原文已保存]`+snapshot.message.slice(source.end);
 }catch{/* Ambiguous mixed input stays intact for the existing one-time recognition. */}
 return snapshot.message;
}

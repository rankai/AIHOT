import {readFile,stat} from 'node:fs/promises';
import sanitizeHtml from 'sanitize-html';
export const ATTACHMENT_TEXT_BYTES=2*1024*1024;
export const attachmentTextTypes={txt:'text/plain',srt:'application/x-subrip',vtt:'text/vtt',json:'application/json',json3:'application/json'} as const;
export type AttachmentTextFormat=keyof typeof attachmentTextTypes;
export function parseAttachmentText(bytes:Uint8Array,format:AttachmentTextFormat){
 if(bytes.byteLength>ATTACHMENT_TEXT_BYTES)throw new Error('Text attachment exceeds 2 MiB');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(!text.trim()||text.includes('\0'))throw new Error('Text attachment must contain nonempty UTF-8 text');
 if(format==='json'||format==='json3'){JSON.parse(text);return {text,bodyText:null};}
 if(format==='txt')return {text,bodyText:text};
 const normalized=text.replace(/\r\n?/g,'\n').replace(/^\uFEFF/,'');
 if(format==='vtt'&&!/^WEBVTT(?:[ \t].*)?\n/.test(normalized))throw new Error('Invalid WebVTT header');
 const blocks=(format==='vtt'?normalized.replace(/^WEBVTT[^\n]*\n/,''):normalized).trim().split(/\n[ \t]*\n/);
 const body:string[]=[];
 const timestamp=format==='srt'?/^\d{2,}:([0-5]\d):([0-5]\d),\d{3}$/:/^(?:\d{2,}:)?[0-5]\d:[0-5]\d\.\d{3}$/;
 const milliseconds=(s:string)=>{const [clock,fraction]=s.replace(',','.').split('.');return clock!.split(':').map(Number).reduce((n,v)=>n*60+v,0)*1000+Number(fraction);};
 for(const block of blocks){const lines=block.split('\n');if(format==='vtt'&&/^NOTE(?:\s|$)/.test(lines[0]!))continue;
  let time=lines.shift()!;if(!time.includes('-->')){if(format==='srt'&&!/^\d+$/.test(time))throw new Error('Invalid SRT cue number');time=lines.shift()??'';}
  const match=/^(\S+)\s+-->\s+(\S+)(?:[ \t]+[^\n]*)?$/.exec(time);
  if(!match||!timestamp.test(match[1]!)||!timestamp.test(match[2]!)||!Number.isSafeInteger(milliseconds(match[1]!))||!Number.isSafeInteger(milliseconds(match[2]!))||milliseconds(match[2]!)<milliseconds(match[1]!)||!lines.length)throw new Error('Invalid subtitle cue or time range');
  const plain=sanitizeHtml(lines.join('\n'),{allowedTags:[],allowedAttributes:{}}).trim();if(plain)body.push(plain);
 }
 if(!body.length)throw new Error('Subtitle contains no text cues');
 return {text,bodyText:body.join('\n')};
}
export async function inspectTextAttachment(file:string,format:AttachmentTextFormat){
 const info=await stat(file);if(info.size>ATTACHMENT_TEXT_BYTES)throw new Error('Text attachment exceeds 2 MiB');
 parseAttachmentText(await readFile(file),format);
 return {bytes:info.size,mime:attachmentTextTypes[format],metadata:{kind:'text' as const,format,validation:'utf8-and-format'}};
}

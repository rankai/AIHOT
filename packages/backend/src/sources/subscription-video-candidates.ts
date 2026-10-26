import { sha256, stableJson } from "../lib/ids.ts";
import { mediaToolOperations, type MediaToolOperation } from "../providers/redfox/media-tools-contract.ts";
import type { MediaToolResult } from "../providers/redfox/media-tools.ts";

// User-approved independent media resolver: collection provider does not change. Every
// mapped operation uses the existing redfox.media budget, never an automatic fallback provider.
export const videoResolvers = {
  douyin:"0W27H3O6",xiaohongshu:"QPNFJRG1",bilibili:"CWX77QIH",x:"7UW1PT1F",
  shipinhao:"U2NJ13MW",kuaishou:"0ZIWOO8P",tiktok:"MQMDU19Q",instagram:"UUSP1G1P",youtube:"D52IUEIM",
} as const satisfies Record<string,MediaToolOperation>;
export function videoResolver(platform:string) {
  const operationId=videoResolvers[platform as keyof typeof videoResolvers];
  return operationId ? {provider:"redfox",operationId,budget:`redfox.${mediaToolOperations[operationId].purpose}`} : null;
}
export interface VideoCandidate {
  url:string; provider:string; field:string; bitrate?:number; bytes?:number;
  quality:"bitrate"|"unknown"; watermark?:"absent"|"present"|"unknown";
}
export interface VideoTarget {
  /** Only a proven single slot or verified media ID is stable across responses. */
  selection:string; stable:boolean; candidates:VideoCandidate[];
}
export interface VideoManifest {
  receiptId:number; attempt:number; hash:string; targets:VideoTarget[];
}
export function subscriptionVideoFileKey(platform:string,workId:string,selection:string) {
  // The historical redfox directory is a private storage format, not collector identity.
  return `uploads/redfox/${sha256(stableJson(["subscription-video",platform,workId,selection]))}`;
}
export function videoUrl(value:unknown):string|null {
  if(typeof value!=="string")return null;
  try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?value:null;}catch{return null;}
}
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function list(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function unique(candidates:VideoCandidate[]){return candidates.filter((c,i)=>candidates.findIndex(other=>other.url===c.url)===i);}
export function frozenVideoManifest(receiptId:number,attempt:number,records:unknown,groups:Array<{candidates:VideoCandidate[];mediaId?:string}>,singleVideo:boolean):VideoManifest {
  if(!Number.isSafeInteger(receiptId)||receiptId<=0||!Number.isSafeInteger(attempt)||attempt<=0)throw new Error("Video manifest requires the exact receipt attempt");
  const hash=sha256(stableJson(records));
  return {receiptId,attempt,hash,targets:groups.map((group,index)=>({
    selection:group.mediaId?`media:${group.mediaId}`:singleVideo&&groups.length===1?"single-video-main":`manifest:${receiptId}:${attempt}:${hash}:${index}`,
    stable:!!group.mediaId||singleVideo&&groups.length===1,candidates:unique(group.candidates),
  }))};
}
/** Exact documented fields only. Caller must already prove work identity, video type and role;
 * this extractor never searches arbitrary URLs, referenced posts, HTML, or unknown provider shapes. */
export function collectedVideoCandidates(input:{provider:string;platform:string;operationId:string;record:unknown;receiptId:number;attempt:number;singleVideo:boolean}):VideoManifest {
  const r=record(input.record), groups:Array<{candidates:VideoCandidate[]}>=[];
  const candidate=(value:unknown,field:string,extra:Partial<VideoCandidate>={}):VideoCandidate[]=>{
    const url=videoUrl(value);return url?[{url,provider:input.provider,field,quality:"unknown",...extra}]:[];
  };
  if(input.provider==="redfox") {
    if(input.platform==="x"&&["5K5EG87P","QCP75W33"].includes(input.operationId)) {
      for(const raw of list(r.medias)){const media=record(raw);if(media.type!=="video"||media.isGif===true||media.is_gif===true||media.animated_gif===true)continue;
        const variants=list(media.variants).map(record).filter(v=>v.contentType==="video/mp4");
        const candidates=variants.flatMap(v=>candidate(v.url,"medias[].variants[].url",typeof v.bitrate==="number"&&Number.isFinite(v.bitrate)&&v.bitrate>=0?{bitrate:v.bitrate,quality:"bitrate"}:{}));
        candidates.sort((a,b)=>(b.bitrate??-1)-(a.bitrate??-1));groups.push({candidates});
      }
    }else if(input.platform==="tiktok"&&["6SE9WIHJ","R473NUE9","PXZXY8KQ","API_1790149158205","API_1790581450500"].includes(input.operationId)) {
      const video=record(r.videoData);
      groups.push({candidates:[...candidate(video.downloadNoMarkAddress,"videoData.downloadNoMarkAddress",{watermark:"absent"}),...candidate(video.downloadAddress,"videoData.downloadAddress",{watermark:"present"}),...candidate(video.playAddress,"videoData.playAddress")]});
    }else if(input.platform==="yiche"&&input.operationId==="3BXWEB6Y") {
      // Contract says these are versions of this one video, but provides no quality labels or order.
      groups.push({candidates:list(r.resources).flatMap(v=>candidate(record(v).downloadUrl,"resources[].downloadUrl"))});
    }else {
      const fields:Record<string,{platform:string;field:string}>={
        API_1789098514899:{platform:"weibo",field:"videoUrl"},I3CIBRI2:{platform:"wechat",field:"videoLink"},
        E7G00COY:{platform:"shipinhao",field:"videoUrl"},OVUTOTCV:{platform:"shipinhao",field:"videoUrl"},OE4KUEUO:{platform:"shipinhao",field:"videoUrl"},
        "27DQ6SF9":{platform:"kuaishou",field:"videoUrl"},ZWR31P2A:{platform:"kuaishou",field:"videoUrl"},UOM99OQI:{platform:"kuaishou",field:"videoUrl"},
        GM0TISWI:{platform:"instagram",field:"videoUrl"},Z9M88QI8:{platform:"instagram",field:"videoUrl"},
        API_1789097000761:{platform:"baijiahao",field:"playUrl"},TE6AGWAF:{platform:"qichezhijia",field:"videoUrl"},YGYYT0G0:{platform:"yiche",field:"videoUrl"},
      };
      const spec=fields[input.operationId];if(spec?.platform===input.platform)groups.push({candidates:candidate(r[spec.field],spec.field)});
    }
  }
  // AgentKey/SocialData have no currently proven direct download fields. Empty means resolve only.
  if(!groups.length&&input.singleVideo)groups.push({candidates:[]});
  return frozenVideoManifest(input.receiptId,input.attempt,input.record,groups,input.singleVideo);
}
/** Fixed parser resources are not variants. Only an independently proven single slot can map
 * one returned video; unknown multi-resource relationships remain a reviewable missing result. */
export function resolvedVideoCandidates(results:MediaToolResult[],receiptId:number,attempt:number,singleVideo:boolean):{manifest:VideoManifest;reason?:string} {
  const videos=results.filter(r=>r.kind==="media_resource"&&record(r.data.record).type==="video");
  const urls=[...new Set(videos.map(v=>videoUrl(v.data.resourceUrl)).filter((v):v is string=>!!v))];
  const top=videoUrl(record(results.find(r=>r.kind==="query_summary")?.data.reportedMetadata).videoUrl);
  // Image resources may be covers. A declared top-level video is usable with single-video proof.
  if(!videos.length&&top&&singleVideo)urls.push(top);
  const reason=!singleVideo||urls.length>1?"media_identity_insufficient":urls.length===0?"no_video_address":undefined;
  const groups=reason?[]:[{candidates:[{url:urls[0]!,provider:"redfox",field:videos.length?"resources[].downloadUrl":"videoUrl",quality:"unknown" as const}]}];
  return {manifest:frozenVideoManifest(receiptId,attempt,results,groups,singleVideo),...(reason?{reason}:{})};
}
export function candidateOutboundAllowed(provider:string) {
  if(process.env.COLLECT_ENABLED==="false")return false;
  if(provider==="redfox")return process.env.REDFOX_CALLS_ENABLED==="true";
  if(provider==="agentkey")return process.env.AGENTKEY_CALLS_ENABLED==="true";
  // Native collectors have only the existing global collection switch.
  return ["socialdata","dajiala"].includes(provider);
}

/** Operator-facing differences only; this does not admit or dispatch a collection route. */
export function videoDownloadCapability(platform:string,provider:string,operation:string):string {
  const retained="保留自动保存开关。";
  if(provider==="agentkey"&&(["x","x-research","weibo","toutiao"].includes(platform)||platform==="douyin"&&operation!=="OWIBYU1V"))return retained+"目标路线目前没有可核实的视频类型，因此暂不会自动保存；不会为确认类型额外购买或回切供应商。";
  if(platform==="wechat")return retained+(provider==="dajiala"?"从已收正文中有归属证明的视频元素提取地址；":provider==="agentkey"?"仅已收 H5 正文视频元素或明确视频类型可登记；":"仅已核实视频链接或正文视频元素可登记；")+"公众号没有独立解析兜底，缺址记录原因，不自动补购。";
  if(platform==="shipinhao")return retained+"当前定时列表缺少可靠视频类型；独立详情查询不触发自动保存。";
  return retained+(provider==="agentkey"?"仅已核实的视频记录可登记；当前无已核实直接下载字段。":"优先使用已收且已核实的直接视频地址。")+(videoResolver(platform==="x-research"?"x":platform)?"缺址或失败可按限额使用固定 Redfox 解析器，不切换采集商。":"没有独立解析兜底，缺址记录原因。");
}

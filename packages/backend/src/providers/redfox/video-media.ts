import {confirmedVideoMedia,mediaUrl,type MediaItem} from "../../content/media.ts";
import {object} from "../agentkey/response.ts";

/** Call only after the existing route, work identity and author checks have succeeded. */
export function redfoxDouyinHasVideo(operation:string,record:Record<string,unknown>):boolean {
  if(["QSL2ZSXM","OWIBYU1V","FK67XDVQ"].includes(operation))return record.videoType==="0"||record.videoType==="63";
  return ["QEQLCKD6","774OBKK0"].includes(operation)&&record.workType==="视频";
}

export function redfoxToutiaoHasVideo(operation:string,record:Record<string,unknown>):boolean {
  return operation==="PAB6Z75Y"&&(record.workType===true||record.hasVideo===true)&&!(record.workType===true&&record.hasVideo===false);
}
export function redfoxXiaohongshuHasVideo(operation:string,record:Record<string,unknown>):boolean {
  return ["384C6W6B","XN3ULENA","KR1LPTBF"].includes(operation)&&record.workType==="video";
}
export function redfoxTiktokHasVideo(operation:string,record:Record<string,unknown>):boolean {
  return ["6SE9WIHJ","R473NUE9","PXZXY8KQ"].includes(operation)&&record.mediaType==="video";
}
export function redfoxInstagramHasVideo(record:Record<string,unknown>):boolean {
  return record.mediaType===2&&record.isVideo!==false
    &&(record.mediaFormat===undefined||record.mediaFormat===null||record.mediaFormat==="video");
}

export function redfoxXHasVideo(medias:unknown):boolean {
  if(Array.isArray(medias))return medias.some(value=>{const item=object(value);return item?.type==="video"&&item.isGif!==true&&item.is_gif!==true&&item.animated_gif!==true;});
  const media=object(medias);
  // The timeline contract defines the collection, but not its element fields.
  return Array.isArray(media?.videos)&&media.videos.length>0
    &&media.videos.every(value=>!!object(value))
    &&media.videos.some(value=>{const item=object(value)!;return (item.type===undefined||item.type==="video")&&item.isGif!==true&&item.is_gif!==true&&item.animated_gif!==true;})
    &&media.isGif!==true&&media.is_gif!==true;
}

/** Existing image/videoLink mapping is shared by manual imports and MP collection. */
export function wechatMedia(record:Record<string,unknown>,confirmedVideo=false):MediaItem[] {
  const valid=(v:unknown):v is string=>!!mediaUrl(v);
  const images=[...(Array.isArray(record.imageUrls)?record.imageUrls:[]),...(Array.isArray(record.picList)?record.picList.map(p=>object(p)?.picUrl):[]),record.coverImageUrl,record.coverUrl].filter(valid);
  const result:MediaItem[]=[...new Set(images)].map(url=>({kind:"image",url}));
  if(valid(record.videoLink))result.push({kind:"video",url:record.videoLink,poster:valid(record.coverImageUrl)?record.coverImageUrl:null});
  return confirmedVideo?confirmedVideoMedia(result):result;
}

/** Exact V4 item in an already verified success receipt; never the synthesized permalink. */
export function agentKeyDouyinV4HasVideo(response:unknown,itemKey:string,workId:unknown):boolean {
  const index=/^item:(0|[1-9][0-9]*)$/.exec(itemKey)?.[1];
  if(index===undefined||typeof workId!=="string"||!/^\d+$/.test(workId))return false;
  const envelope=object(object(response)?.envelope),payload=object(envelope?.data),body=object(payload?.data),data=object(body?.data);
  if(envelope?.provider!=="TikHub"||payload?.code!==200||body?.code!==0||!Array.isArray(data?.itemList))return false;
  const item=object(object(data.itemList[Number(index)])?.AwemeInfo),video=object(item?.Video);
  const id=video?.ItemID;
  if(!video||!(typeof id==="string"&&/^\d+$/.test(id)||typeof id==="number"&&Number.isSafeInteger(id)&&id>=0)||String(id)!==workId)return false;
  return item?.AwemeId===undefined||item.AwemeId===null||String(item.AwemeId)===workId;
}

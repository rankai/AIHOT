import { Worker } from "node:worker_threads";
import { open, stat } from "node:fs/promises";
import sharp from "sharp";
export const INPUT_IMAGE_BYTES=10_000_000, INPUT_AUDIO_BYTES=20_000_000, INPUT_VIDEO_BYTES=50_000_000;
export class MediaValidationError extends Error { readonly status:number; constructor(status:number,message:string){super(message);this.status=status;} }
const types={
 png:{kind:"image",mime:"image/png",mimes:["image/png"],extensions:["png"]},
 jpg:{kind:"image",mime:"image/jpeg",mimes:["image/jpeg","image/jpg"],extensions:["jpg","jpeg"]},
 webp:{kind:"image",mime:"image/webp",mimes:["image/webp"],extensions:["webp"]},
 gif:{kind:"image",mime:"image/gif",mimes:["image/gif"],extensions:["gif"]},
 bmp:{kind:"image",mime:"image/bmp",mimes:["image/bmp","image/x-ms-bmp"],extensions:["bmp"]},
 mp3:{kind:"audio",mime:"audio/mpeg",mimes:["audio/mpeg","audio/mp3"],extensions:["mp3"]},
 wav:{kind:"audio",mime:"audio/wav",mimes:["audio/wav","audio/x-wav","audio/wave"],extensions:["wav"]},
 aac:{kind:"audio",mime:"audio/aac",mimes:["audio/aac","audio/x-aac"],extensions:["aac"]},
 ogg:{kind:"audio",mime:"audio/ogg",mimes:["audio/ogg","application/ogg"],extensions:["ogg"]},
 flac:{kind:"audio",mime:"audio/flac",mimes:["audio/flac","audio/x-flac"],extensions:["flac"]},
 mp4:{kind:"video",mime:"video/mp4",mimes:["video/mp4"],extensions:["mp4"]},
 avi:{kind:"video",mime:"video/vnd.avi",mimes:["video/vnd.avi","video/x-msvideo","video/avi"],extensions:["avi"]},
 mov:{kind:"video",mime:"video/quicktime",mimes:["video/quicktime"],extensions:["mov"]},
 mkv:{kind:"video",mime:"video/matroska",mimes:["video/matroska","video/x-matroska"],extensions:["mkv"]},
 webm:{kind:"video",mime:"video/webm",mimes:["video/webm"],extensions:["webm"]},
 m4a:{kind:"audio",mime:"audio/x-m4a",mimes:["audio/x-m4a","audio/mp4"],extensions:["m4a"]},
} as const;
export function inputMediaOptions(imagePixels:number){
 return {
  formats:Object.entries(types).filter(([ext])=>ext!=="m4a").map(([format,t])=>({format,kind:t.kind,extensions:[...t.extensions],mime:t.mime})),
  limits:{imageBytes:INPUT_IMAGE_BYTES,audioBytes:INPUT_AUDIO_BYTES,videoBytes:INPUT_VIDEO_BYTES,imagePixels},
  imageValidation:{gif:{totalFramePixels:imagePixels},bmp:{compression:"uncompressed",dibHeaders:[12,40,108,124],validation:"structure"}},
 };
}
export function inputMediaFormat(mime:string,bytes:number){
 const entry=Object.entries(types).find(([ext,t])=>ext!=="m4a"&&t.mime===mime);
 if(!entry||!Number.isSafeInteger(bytes)||bytes<=0||bytes>declaredMediaLimit(mime))throw new MediaValidationError(400,"Asset is not a supported input media format or size.");
 return entry[0] as Exclude<keyof typeof types,"m4a">;
}
export type InputMediaFormat=Exclude<keyof typeof types,"m4a">;
export function declaredMediaLimit(mime:string){
 const item=Object.entries(types).find(([ext,t])=>ext!=="m4a"&&(t.mimes as readonly string[]).includes(mime.toLowerCase()));
 if(!item)throw new MediaValidationError(415,"Unsupported upload MIME type.");
 return item[1].kind==="image"?INPUT_IMAGE_BYTES:item[1].kind==="audio"?INPUT_AUDIO_BYTES:INPUT_VIDEO_BYTES;
}
async function detect(head:Buffer):Promise<{ext:string;mime:string}>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL("./asset-type-worker.ts",import.meta.url),{workerData:head,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
  let done=false;
  const finish=(error?:Error,value?:{ext:string;mime:string})=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value!);};
  const timer=setTimeout(()=>finish(new MediaValidationError(422,"Media type inspection timed out.")),2500);
  worker.once("message",m=>m.detected?finish(undefined,m.detected):finish(new MediaValidationError(422,"Unrecognized media header.")));
  worker.once("error",()=>finish(new MediaValidationError(422,"Media type inspection failed.")));
  worker.once("exit",()=>{if(!done)finish(new MediaValidationError(422,"Media type inspection stopped."));});
 });
}
function bmpSize(h:Buffer,bytes:number){
 if(h.length<26)throw new Error("BMP header");
 const dib=h.readUInt32LE(14),offset=h.readUInt32LE(10),declared=h.readUInt32LE(2);
 if(![12,40,108,124].includes(dib)||h.length<14+dib||declared!==bytes||offset<14+dib||offset>=bytes)throw new Error("BMP structure");
 const width=dib===12?h.readUInt16LE(18):h.readInt32LE(18),signedHeight=dib===12?h.readUInt16LE(20):h.readInt32LE(22),height=Math.abs(signedHeight);
 const planes=h.readUInt16LE(dib===12?22:26),bits=h.readUInt16LE(dib===12?24:28);
 if(width<=0||height<=0||planes!==1||![1,4,8,16,24,32].includes(bits)||(dib!==12&&h.readUInt32LE(30)!==0))throw new Error("Unsupported BMP DIB");
 const palette=bits<=8?(dib===12?2**bits:(h.readUInt32LE(46)||2**bits)):0;
 if(offset<14+dib+palette*(dib===12?3:4)||offset+Math.ceil(width*bits/32)*4*height>bytes)throw new Error("Truncated BMP pixels");
 return {width,height};
}
function structuralHeader(ext:string,h:Buffer,bytes:number){
 // These are bounded truncation checks, not codec decoding or a playability guarantee.
 if(bytes<16||h.length<16)throw new Error("Truncated media header");
 if(["wav","avi"].includes(ext)&&(h.length<12||h.readUInt32LE(4)+8>bytes))throw new Error("Truncated RIFF");
 if(["mp4","mov","m4a"].includes(ext)){
  const size=h.readUInt32BE(0);
  if(size===1){const extended=h.readBigUInt64BE(8);if(extended<16n||extended>BigInt(bytes))throw new Error("Truncated extended ISO box");}
  else if(size!==0&&(size<8||size>bytes))throw new Error("Truncated ISO box");
 }
 if(ext==="ogg"&&bytes<27||ext==="flac"&&bytes<42)throw new Error("Truncated media header");
 if(ext==="aac"){const frame=((h[3]!&3)<<11)|(h[4]!<<3)|(h[5]!>>5);if(frame<7||frame>bytes)throw new Error("Truncated AAC frame");}
 if(ext==="mp3"&&h.toString("ascii",0,3)==="ID3"){const size=10+(h[6]!&127)*2097152+(h[7]!&127)*16384+(h[8]!&127)*128+(h[9]!&127);if(size>=bytes)throw new Error("Truncated ID3/audio");}
}
async function readMediaHeader(file:string){
 const info=await stat(file);if(!info.isFile())throw new MediaValidationError(422,"Expected a regular media file.");
 const handle=await open(file,"r"),head=Buffer.alloc(128*1024);let length:number;
 try{length=(await handle.read(head,0,head.length,0)).bytesRead;}finally{await handle.close();}
 return {info,head:head.subarray(0,length)};
}
/** Detect only a documented video container, never codec playability or duration. */
export async function describeVideoMedia(file:string){
 const {info,head}=await readMediaHeader(file);
 if(info.size>INPUT_VIDEO_BYTES)throw new MediaValidationError(413,"Generated video exceeds the local 50000000 byte limit.");
 const detected=await detect(head),type=types[detected.ext as keyof typeof types];
 if(!type||type.kind!=="video")throw new MediaValidationError(415,"Generated output is not a supported video container.");
 try{structuralHeader(detected.ext,head,info.size);}catch{throw new MediaValidationError(422,"Invalid or truncated video header.");}
 return {bytes:info.size,format:detected.ext,mime:type.mime};
}
/** Existing fixed media types, selected from bytes for explicit saved operation output. */
export async function describeOutputMedia(file:string){
 const {info,head}=await readMediaHeader(file),detected=await detect(head),type=types[detected.ext as keyof typeof types];
 if(!type)throw new MediaValidationError(415,"Unsupported output media type");
 return {bytes:info.size,format:detected.ext,mime:type.mime,kind:type.kind};
}
export async function inspectAsset(file:string,filename:string,mime:string,output:boolean,pixelLimit:number,outputImageBytes:number){
 const {info,head}=await readMediaHeader(file);
 const detected=await detect(head),type=types[detected.ext as keyof typeof types];
 if(!type||detected.ext==="m4a"&&!output)throw new MediaValidationError(415,"This media format is not supported for input upload.");
 const basename=filename.replaceAll("\\","/").split("/").at(-1)!;
 const ext=basename.includes(".")?basename.split(".").at(-1)!.toLowerCase():"";
 if(!(type.extensions as readonly string[]).includes(ext)||!(type.mimes as readonly string[]).includes(mime.toLowerCase()))throw new MediaValidationError(415,"File bytes, MIME and filename extension must agree.");
 const limit=type.kind==="image"?(output?outputImageBytes:INPUT_IMAGE_BYTES):type.kind==="audio"?INPUT_AUDIO_BYTES:INPUT_VIDEO_BYTES;
 if(info.size>limit)throw new MediaValidationError(413,`Media exceeds the local ${limit} byte limit.`);
 let dimensions:{width?:number;height?:number;pages?:number}={};
 try{
  if(type.kind==="image"){
   if(detected.ext==="bmp"){dimensions=bmpSize(head,info.size);if(dimensions.width!*dimensions.height!>pixelLimit)throw new Error("pixels");}
   else {const image=sharp(file,{limitInputPixels:pixelLimit,failOn:"warning",animated:detected.ext==="gif"}),m=await image.metadata();
    const pages=m.pages??1,height=m.pageHeight??m.height;if(m.format!==(detected.ext==="jpg"?"jpeg":detected.ext)||!m.width||!height||m.width*height*pages>pixelLimit||detected.ext!=="gif"&&pages!==1)throw new Error("dimensions");await image.stats();dimensions={width:m.width,height,pages};}
  }else structuralHeader(detected.ext,head,info.size);
 }catch{throw new MediaValidationError(422,"Invalid or unsupported media structure, dimensions, or truncated data.");}
 return {bytes:info.size,mime:type.mime,metadata:{kind:type.kind,validation:detected.ext==="bmp"?"structure":type.kind==="image"?"decoded":"type-and-header",...dimensions}};
}

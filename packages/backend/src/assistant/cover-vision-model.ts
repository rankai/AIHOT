import { credential } from "../config.ts";
import { modelFor } from "../editorial/models.ts";
import { MODELS } from "../providers/llm.ts";
import { VisionModel,VisionExtra,type VisionModelSnapshot } from "./cover-vision-contract.ts";
import { conflict } from "./store.ts";
import { outbound } from "./config.ts";
export async function coverVisionModel():Promise<VisionModelSnapshot> {
 const key=await modelFor("assistantCoverVision"),spec=MODELS[key];
 if(!spec?.vision||!spec.model)throw conflict("封面分析需要明确配置支持视觉的模型");
 const snapshot=VisionModel.parse({version:1,key,service:spec.service,model:spec.model,baseURL:credential("models",spec.baseUrlEnv),apiKeyEnv:spec.apiKeyEnv,extra:VisionExtra.parse(spec.extra??{}),vision:true,jsonMode:spec.jsonMode,
  limits:{images:20,batchImages:5,batches:4,longEdge:1200,imageBytes:1048576,batchBytes:5242880,maxOutputTokens:4096}});
 coverVisionCredential(snapshot);return snapshot;
}
export function coverVisionCredential(raw:unknown) {
 const snapshot=VisionModel.parse(raw),spec=MODELS[snapshot.key],url=new URL(snapshot.baseURL);
 if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||!spec?.vision||spec.service!==snapshot.service||spec.model!==snapshot.model||spec.apiKeyEnv!==snapshot.apiKeyEnv||credential("models",spec.baseUrlEnv)!==snapshot.baseURL)
  throw conflict("封面视觉模型注册规格或端点已变化，请核对原任务");
 const key=credential("models",spec.apiKeyEnv);if(!key)throw conflict("封面视觉模型凭据未配置");
 return key;
}
export function coverVisionOutbound(snapshot:VisionModelSnapshot){outbound();return coverVisionCredential(snapshot);}

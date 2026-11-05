import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { sql,type Tx,type Db } from "../db.ts";
import { conflict,event } from "./store.ts";
import { SaveCoverPlan,CoverPlanReference,COVER_DELIVERY_CONTRACT } from "./cover-plan-contract.ts";
import { normalizeToolInput } from "../users/tool-input.ts";
import { selectToolPrice } from "../users/credits-prices.ts";
import { assertMemberCostEligible } from "../users/member-pricing.ts";
import { checkBudget } from "../providers/receipts.ts";
import { assertRedfoxAvailable } from "../providers/redfox/client.ts";
import { imagePairs } from "../providers/redfox/image-models.ts";
import type { AssistantCoverPlan } from "@aihot/contracts/assistant";
export { COVER_DELIVERY_CONTRACT };
export async function coverPlanImageAvailability(tx:Tx,turn:Record<string,any>,activationId:string){
 const [active]=await tx`SELECT candidate FROM assistant_activations WHERE id=${activationId} AND turn_id=${turn.id}`;
 if(!active)return {available:false,reason:"当前封面方案没有有效模块许可，只能保留方案"};
 const {resolveCandidate}=await import("./catalog.ts");
 const {module}=await resolveCandidate(turn.snapshot.candidates,active.candidate.skillId,active.candidate.moduleId);
 if(module.deliveryContract!==COVER_DELIVERY_CONTRACT||!module.tools.includes("generate_image")||!module.outputKinds.includes("image"))return {available:false,reason:"本次技能仅提供封面方案，未绑定图片生成"};
 return coverImageAvailability();
}
export async function coverImageAvailability(){
 try{
  assertRedfoxAvailable(imagePairs.gptImage2.submit,"image");
  const normalized=await normalizeToolInput("assistant-capability","images",{model:"gptImage2",prompt:"封面图像",size:"3:4",resolution:"1k",n:1,fileKeys:[]});
  await assertMemberCostEligible(normalized.intent);
  await selectToolPrice(sql,normalized.intent);
  for(const service of ["redfox.image","redfox.poll"]){await checkBudget(sql,service);await checkBudget(sql,service,"member");}
  return {available:true,reason:null};
 }catch{return {available:false,reason:"图片生成暂不可用，可先保留方案"};}
}
function selectedCoverPlans(turn:Record<string,any>){return (turn.snapshot.selected??[]).filter((item:any)=>item.kind==="xhs-cover-plan");}
/** Only server-read artifact projections may supply this fact. */
export function hasSavedCoverResearch(selected:readonly Record<string,any>[]=[]){
 return selected.some(item=>item.kind==="xhs-cover-plan"&&item.content?.coverPlan?.researchScope?.observedCount>0);
}
export async function selectedArtifactVersions(db:Db,sessionId:string,versions:readonly {artifactId:string;version:number}[]=[]){
 const selected:Record<string,any>[]=[],seen=new Set<string>();
 for(const a of versions){
  const key=`${a.artifactId}:${a.version}`;if(seen.has(key))continue;
  const [row]=await db`SELECT artifact_id,version,kind,content,source_snapshot FROM assistant_artifact_versions WHERE session_id=${sessionId} AND artifact_id=${a.artifactId} AND version=${a.version} AND kind IN ('text-draft','xhs-note','xhs-cover-plan')`;
  if(!row)throw conflict("选定稿件不存在");
  selected.push(row.kind==="xhs-cover-plan"?coverPlanInputProjection(row):row);seen.add(key);
 }
 return selected;
}
export function coverPlanInputProjection(row:Record<string,any>){
 const plan=row.content?.coverPlan as AssistantCoverPlan;
 const evidence=plan?.evidence;
 if(!evidence||!Number.isSafeInteger(evidence.observedCount)||evidence.observedCount<1||!Array.isArray(evidence.samples)
   ||evidence.samples.length!==evidence.observedCount||!Array.isArray(plan.schemes)||plan.schemes.length!==3
   ||evidence.samples.some(s=>!s.sourceId||!s.sha256||!s.fileKey||s.observation?.status!=="observed"||s.observation.sourceId!==s.sourceId)
   ||plan.schemes.some(s=>!Array.isArray(s.sourceIds)||s.sourceIds.some(id=>!evidence.samples.some(sample=>sample.sourceId===id))))throw conflict("选定方案没有有效冻结研究");
 return {...row,source_snapshot:[],content:{title:row.content.title,body:row.content.body,coverPlan:{summary:plan.summary,schemes:plan.schemes,researchScope:{selectedCount:plan.evidence.selectedCount,observedCount:plan.evidence.observedCount,keyword:plan.evidence.keyword,startDate:plan.evidence.startDate}}}};
}
async function frozenEvidence(tx:Tx,turn:Record<string,any>,activationId:string,input:z.infer<typeof SaveCoverPlan>):Promise<AssistantCoverPlan["evidence"]>{
 const [report]=await tx`SELECT z.id,z.run_id,z.data FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN assistant_tool_calls c ON c.child_run_id=r.id
 WHERE c.turn_id=${turn.id} AND c.name='analyze_xhs_covers' AND c.state='completed' AND r.status='completed' AND r.operation_key='assistant.coverVision' AND r.actor=${`user:${turn.owner_user_id}`} AND z.kind='assistant_vision_report' AND z.data->>'activationId'=${activationId} ORDER BY z.id DESC LIMIT 1`;
 if(report){
  if(report.data.complete!==true||report.data.observedCount<1)throw conflict("封面视觉研究尚未完成");
  const observations=report.data.observations.filter((o:any)=>o.status==="observed");
  const rows=await tx`SELECT z.id,z.kind,z.data FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN assistant_tool_calls c ON c.child_run_id=r.id
   WHERE r.id=${report.data.queryRunId} AND r.status='completed' AND r.actor=${`user:${turn.owner_user_id}`} AND c.turn_id=${turn.id} AND c.name='search_xhs_covers' AND c.state='completed' AND z.kind IN ('xhs_cover_candidate','xhs_cover_research')`;
  const summary=rows.find(r=>r.kind==="xhs_cover_research")?.data;if(!summary)throw conflict("封面查询范围已不可验证");
  const samples=observations.map((observation:any)=>{
   const row=rows.find(r=>r.kind==="xhs_cover_candidate"&&r.data.sourceId===observation.sourceId),reference=report.data.references.find((r:any)=>r.sourceId===observation.sourceId&&r.status==="ready");
   if(!row||!reference?.sha256)throw conflict("封面研究来源或图片冻结记录不完整");
   const d=row.data;return {sourceId:d.sourceId,resultId:row.id,title:d.title,url:d.url,coverUrl:d.coverUrl,authorName:d.authorName,userId:d.userId,publicTime:d.publicTime,
    fans:d.fans??null,collectedCount:d.collectedCount??null,useShareCount:d.useShareCount??null,useCommentCount:d.useCommentCount??null,useLikeCount:d.useLikeCount??null,interactiveCount:d.interactiveCount??null,
    sha256:reference.sha256,fileKey:reference.fileKey,observation};
  });
  return {queryRunId:report.data.queryRunId,visionRunId:report.run_id,reportId:report.id,candidateCount:summary.candidateCount,selectedCount:report.data.selectedCount,downloadedCount:report.data.references.filter((r:any)=>r.status==="ready").length,analyzedCount:report.data.analyzedCount,observedCount:samples.length,failed:report.data.failed,unreadable:report.data.observations.filter((o:any)=>o.status==="unreadable").map((o:any)=>({sourceId:o.sourceId,uncertainties:o.uncertainties})),keyword:summary.keyword,startDate:summary.startDate,scope:summary.limitation,samples};
 }
 const selected=selectedCoverPlans(turn),chosen=selected.find((s:any)=>s.artifact_id===input.artifactId&&s.version===input.baseVersion)??(selected.length===1?selected[0]:null);
 if(!chosen)throw conflict("需要本轮真实视觉研究，或明确选中一个已保存方案版本");
 const [stored]=await tx`SELECT content FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${chosen.artifact_id} AND version=${chosen.version} AND kind='xhs-cover-plan'`;
 if(!stored?.content.coverPlan?.evidence?.observedCount)throw conflict("选定方案没有有效冻结研究");
 return stored.content.coverPlan.evidence;
}
export async function persistCoverPlan(tx:Tx,turn:Record<string,any>,activationId:string,input:z.infer<typeof SaveCoverPlan>){
 const evidence=await frozenEvidence(tx,turn,activationId,input),allowed=new Set(evidence.samples.map(s=>s.sourceId));
 const used=new Set<string>(),reserved=new Set(input.schemes.flatMap(s=>s.schemeId&&/^[a-zA-Z0-9_-]{1,40}$/.test(s.schemeId)?[s.schemeId]:[]));
 const schemes:AssistantCoverPlan["schemes"]=input.schemes.map((scheme,index)=>{
  let schemeId=scheme.schemeId;
  if(!schemeId||!/^[a-zA-Z0-9_-]{1,40}$/.test(schemeId)||used.has(schemeId)){
   schemeId=`scheme-${index+1}`;for(let suffix=2;used.has(schemeId)||reserved.has(schemeId);suffix++)schemeId=`scheme-${index+1}-${suffix}`;
  }
  used.add(schemeId);
  // Empty per-design citations mean only the overall research is a reference; do not
  // invent a claim that a particular observed image inspired this design.
  return {...scheme,schemeId,aspectRatio:"3:4",sourceIds:[...new Set(scheme.sourceIds)].filter(id=>allowed.has(id))};
 });
 const next=turn.snapshot.taskScope?.delivery==="plans-only"?"plans-only":turn.snapshot.taskScope?.delivery==="image"?"choose":input.next==="plans-only"?"plans-only":"choose";
 await tx`SELECT id FROM assistant_sessions WHERE id=${turn.session_id} FOR UPDATE`;
 const artifactId=input.artifactId??randomUUID();
 const [latest]=await tx`SELECT version,kind FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${artifactId} ORDER BY version DESC LIMIT 1`;
 if((latest?.version??0)!==input.baseVersion||input.artifactId&&!latest||latest&&latest.kind!=="xhs-cover-plan")throw conflict("封面方案版本已变化，请刷新");
 const coverPlan:AssistantCoverPlan={summary:input.summary,schemes,evidence},version=input.baseVersion+1;
 const sources=evidence.samples.map(s=>({id:`search:${s.resultId}`,kind:"research",label:s.title??s.sourceId,url:s.url}));
 const content={title:input.title,body:input.summary,intent:"draft",titles:[],tags:[],sources:sources.map(s=>s.id),partial:evidence.observedCount<evidence.selectedCount,scope:`实际观察${evidence.observedCount}/${evidence.selectedCount}张封面`,coverPlan};
 await tx`INSERT INTO assistant_artifact_versions(session_id,artifact_id,version,base_version,kind,turn_id,activation_id,content,source_snapshot)
 VALUES (${turn.session_id},${artifactId},${version},${input.baseVersion},'xhs-cover-plan',${turn.id},${activationId},${tx.json(content as never)},${tx.json(sources)})`;
 await tx`UPDATE assistant_turns SET snapshot=snapshot-'coverChoice' WHERE id=${turn.id}`;
 await event(tx,turn.session_id,"artifact",artifactId);
 const image=await coverPlanImageAvailability(tx,turn,activationId);
 return {artifactId,version,kind:"xhs-cover-plan",next,choice:{artifactId,version,schemes:schemes.map(s=>({schemeId:s.schemeId,name:s.name})),imageAvailable:image.available,imageUnavailableReason:image.reason,feeNotice:turn.snapshot.taskScope?"图片已包含在本次授权上限内；选择后继续制作，不再确认费用":"选择方案不付款；生成单张3:4图片将另行报价并确认"}};
}
export async function resolveCoverImage(tx:Tx,turn:Record<string,any>,raw:unknown){
 const reference=CoverPlanReference.parse(raw),chosen=turn.snapshot.coverChoice;
 if(chosen&&(chosen.artifactId!==reference.artifactId||chosen.version!==reference.version||chosen.schemeId!==reference.schemeId))throw conflict("生成方案与本次明确选择不一致");
 const [row]=await tx`SELECT content,turn_id,activation_id FROM assistant_artifact_versions WHERE session_id=${turn.session_id} AND artifact_id=${reference.artifactId} AND version=${reference.version} AND kind='xhs-cover-plan'`;
 const selected=selectedCoverPlans(turn).some((s:any)=>s.artifact_id===reference.artifactId&&s.version===reference.version);
 if(!row||row.turn_id!==turn.id&&!selected)throw conflict("只能生成本轮方案或明确选中的历史方案版本");
 if(row.turn_id===turn.id){const [latest]=await tx`SELECT max(version)::int version FROM assistant_artifact_versions WHERE artifact_id=${reference.artifactId}`;if(latest!.version!==reference.version)throw conflict("方案版本已变化，请重新选择");}
 const plan=row.content.coverPlan as AssistantCoverPlan,scheme=plan.schemes.find(s=>s.schemeId===reference.schemeId);
 if(!scheme||!plan.evidence.observedCount)throw conflict("所选方案或研究证据不存在");
 return {reference,activationId:row.activation_id,title:row.content.title,prompt:scheme.prompt,size:"3:4" as const};
}
/** A declined optional cover image still leaves the already saved plans as this turn's delivery. */
export async function rejectedCoverPlanDelivery(tx:Tx,turn:Record<string,any>,call:Record<string,any>){
 if(call.name!=="generate_image"||call.state!=="rejected"||!call.input.planReference)return null;
 const [active]=await tx`SELECT candidate FROM assistant_activations WHERE id=${call.input.activationId} AND turn_id=${turn.id}`;
 if(!active)return null;
 const {resolveCandidate}=await import("./catalog.ts");
 const {module}=await resolveCandidate(turn.snapshot.candidates,active.candidate.skillId,active.candidate.moduleId);
 if(module.deliveryContract!==COVER_DELIVERY_CONTRACT)return null;
 const resolved=await resolveCoverImage(tx,turn,call.input.planReference);
 return {artifactId:resolved.reference.artifactId,version:resolved.reference.version};
}

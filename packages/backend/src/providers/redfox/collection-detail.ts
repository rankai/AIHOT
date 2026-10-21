import {z} from "zod";
import type {Db} from "../../db.ts";
import {stableJson} from "../../lib/ids.ts";
import {UnsupportedReplacement} from "../../sources/x-replacement.ts";
import {workDetailOptions} from "./work-detail-options.ts";
import {workDetailOrigin,applyWorkDetailOrigin,WorkDetailTargets} from "./work-detail-origin.ts";
import {weiboCarDetailOrigin,applyWeiboCarDetailOrigin,WeiboCarDetailTargets} from "./weibo-car-detail-origin.ts";
export const CollectionDetailTarget=z.enum([...WorkDetailTargets,...WeiboCarDetailTargets]);
/** Configuration choices, restricted again against each received work before any call. */
export function collectionDetailTargets(source:string,p?:Record<string,unknown>):string[]{
 switch(source){
 case "TXQPVGJG":return ["API_1789098514899"];
 case "QEQLCKD6":case "774OBKK0":case "HUCIASU":return ["0OT1E306"];
 case "QSL2ZSXM":case "OWIBYU1V":return ["FK67XDVQ"];
 case "WD6UT8DQ":case "0ZB9S2FW":case "I8P3HTVH":return ["0OT1E306","FK67XDVQ"];
 case "384C6W6B":case "XN3ULENA":case "3X8FGEEM":case "P3W2W18P":case "LBYLC5AK":case "AEA6YE0J":case "047JJ3UA":return ["KR1LPTBF"];
 case "PW97QFBS":case "XNV30XZ3":return ["XEO0QQNF","I3CIBRI2"];
 case "FVQ8D4W5":case "8IQD0BJC":return ["1LDQ7E1C","I3CIBRI2"];
 case "IE0887SO":case "ZIGAGYYT":case "OFFSPQ0U":case "DL4YNCTQ":return ["I3CIBRI2"];
 case "R473NUE9":case "PXZXY8KQ":case "API_1790149158205":case "API_1790581450500":return ["6SE9WIHJ"];
 case "LEN9QXR3":case "VPA67I98":return ["TIN1NMTZ"];
 case "CI7VW144":return p? p.sourceType==="video"?["TE6AGWAF"]:p.sourceType==="article"?["LLCI8QTE"]:[]:["TE6AGWAF","LLCI8QTE"];
 case "W86F8SSK":case "API_1791793668086":return ["QQ5E3EZ9"];
 case "YIGCY5US":return p?p.sourceType==="shipin"?["3BXWEB6Y"]:p.sourceType==="xinwen"?["VYSP68M2"]:[]:["3BXWEB6Y","VYSP68M2"];
 case "YGYYT0G0":return ["3BXWEB6Y"];
 default:return [];
 }
}
export async function selectedCollectionDetail(db:Db,sourceId:number,target:string,page:unknown){
 const options=await workDetailOptions(sourceId,db),choice=options?.choices.find(c=>c.operationId===target);
 if(!choice)throw new UnsupportedReplacement("Configured detail cannot identify this received work; explicit verification is required");
 const parameters={...choice.parameters,...(target==="LLCI8QTE"?{page:z.number().int().safe().parse(page)}:{})};
 const origin=(WeiboCarDetailTargets as readonly string[]).includes(target)?await weiboCarDetailOrigin(db,sourceId,target,parameters):await workDetailOrigin(db,sourceId,target,parameters);
 return {parameters,origin};
}
export function applyCollectedDetail(target:string,parameters:Record<string,unknown>,result:{kind:string;data:Record<string,unknown>},origin:unknown){
 return (WeiboCarDetailTargets as readonly string[]).includes(target)?applyWeiboCarDetailOrigin(target,parameters,result,origin):applyWorkDetailOrigin(target,parameters,result,origin);
}
/** The only extra importer context: a detail receipt tied to this formal run's exact source-page item. */
export async function collectedDetailContext(db:Db,raw:Record<string,unknown>){
 const provenance=z.record(z.string(),z.unknown()).parse(raw.provenance??{}),sourceId=provenance.detailSourceResultId;if(sourceId===undefined)return undefined;
 const s=z.object({provider:z.string(),operation_key:z.string(),run_id:z.number(),receipt_id:z.number(),receipt_model:z.string(),receipt_status:z.string(),kind:z.string(),data:z.record(z.string(),z.unknown()),input:z.object({mode:z.string(),enrichDetails:z.boolean(),detailOperationId:z.string(),detailPage:z.unknown().optional(),platform:z.string()}).passthrough()}).parse(raw);
 const target=CollectionDetailTarget.parse(s.receipt_model);
 if(s.provider!=="redfox"||!["redfox.platform.collection","redfox.weibo.collection"].includes(s.operation_key)||s.input.mode!=="collection"||!s.input.enrichDetails||s.input.detailOperationId!==target||!Number.isSafeInteger(sourceId)||Number(sourceId)<=0||!["received","completed"].includes(s.receipt_status))throw new UnsupportedReplacement("Invalid collected detail context");
 const [source]=await db`SELECT z.run_id,z.provenance,p.model FROM operation_results z LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${Number(sourceId)}`;
 if(!source||source.run_id!==s.run_id||source.provenance?.detailSourceResultId!==undefined||source.model!==s.input.operationId||source.provenance?.sourcePageResultId!==provenance.sourcePageResultId)throw new UnsupportedReplacement("Detail source belongs to another run/page");
 const selected=await selectedCollectionDetail(db,Number(sourceId),target,s.input.detailPage);
 const [receipt]=await db`SELECT request FROM receipts WHERE id=${s.receipt_id}`;
 if(stableJson(receipt?.request?.input)!==stableJson(selected.parameters)||receipt?.request?.operation!==target||s.kind!==`${s.input.platform}_work`||(s.input.platform!=="weibo"&&s.data.operationId!==target))throw new UnsupportedReplacement("Detail receipt does not match proven source parameters");
 return {input:{...s.input,operationId:target,parameters:selected.parameters,origin:selected.origin},discoveredAt:new Date(selected.origin.discoveredAt)};
}

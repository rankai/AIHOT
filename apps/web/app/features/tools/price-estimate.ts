import type { MemberPriceCatalog } from '@aihot/contracts/membership';
import type { ToolPrice } from '@aihot/contracts/credits';

export interface ToolPriceSelection { kind: string; input?: Record<string, unknown>; provider?: string; model?: string; tier?: string; videoSeconds?: number; free?: boolean }
export type PriceEstimate = { state: 'priced'; amount: number } | { state: 'rate'; base: number; perSecond: number } | { state: 'pending' | 'unavailable' | 'ambiguous' };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function pathValue(input: Record<string, unknown>, path: string): unknown {
 let value: unknown = input;
 for (const key of path.split('.')) { if (!value || typeof value !== 'object' || !Object.hasOwn(value,key)) return undefined; value = (value as Record<string,unknown>)[key]; }
 return value;
}
/** Local display only. The server's subsequent quote still authorizes and freezes the charge. */
export function estimateToolPrice(catalog: MemberPriceCatalog | null, selection: ToolPriceSelection): PriceEstimate {
 if (selection.free || selection.kind.endsWith('/query')) return {state:'priced',amount:0};
 if (!catalog) return {state:'pending'};
 const input=selection.input ?? {}, kind=selection.kind, provider=selection.provider ?? String(input.provider ?? 'redfox');
 const model=selection.model ?? String(kind==='query' ? input.operationId ?? '' : kind==='images' ? input.model ?? 'gptImage2' : kind==='videos' ? provider==='aliyun' ? input.model ?? 'wan2.2-animate-mix' : 'seedance' : kind==='ai-search' ? input.engine ?? '' : kind==='transcriptions' ? input.platform ?? '' : '');
 const tier=selection.tier ?? String(kind==='images' ? input.resolution ?? object(input.metadata).resolution ?? input.size ?? '' : kind==='videos' ? provider==='aliyun' ? input.mode ?? '' : input.resolution ?? '' : '');
 const offer=catalog.offers.find(row=>row.kind===kind && row.provider===provider && row.model===model && row.tier===tier);
 if (!offer) return {state:'unavailable'};
 const refs=Array.isArray(input.imageWithRoles) ? input.imageWithRoles.map(object) : [];
 const references=kind==='videos' ? provider==='aliyun' ? 2 : new Set(refs.map(ref=>ref.fileKey)).size : Array.isArray(input.fileKeys) ? input.fileKeys.length : 0;
 const images=kind==='images' ? Number(input.n ?? 1) : 0;
 const seconds=kind==='videos' ? provider==='aliyun' ? selection.videoSeconds : Number(input.duration) : 0;
 if (kind==='images' && (model!=='gptImage2' || tier!=='1k' || images!==1)) return {state:'unavailable'};
 if (kind==='videos' && provider==='redfox' && (tier!=='480p' || seconds!==8 || input.generateAudio!==true || refs.length!==3 || references!==3 || refs.some(ref=>ref.role!=='reference_image'))) return {state:'unavailable'};
 const possible: ToolPrice[] = [], matched: ToolPrice[] = [];
 for (const price of offer.prices ?? []) {
  if (!price.enabled) continue;
  let missing=false, mismatch=false;
  for (const [path,expected] of Object.entries(price.parameterMatch)) {
   const value=pathValue(input,path);if(value===undefined || value==='' && expected!=='') missing=true;else if(value!==expected) mismatch=true;
  }
  if (!mismatch) (missing ? possible : matched).push(price);
 }
 matched.sort((a,b)=>Object.keys(b.parameterMatch).length-Object.keys(a.parameterMatch).length);
 const price=matched[0];
 if (possible.some(candidate=>!price || Object.keys(candidate.parameterMatch).length>=Object.keys(price.parameterMatch).length)) return {state:'pending'};
 if (!price) return {state:'unavailable'};
 if (matched[1] && Object.keys(matched[1].parameterMatch).length===Object.keys(price.parameterMatch).length) return {state:'ambiguous'};
 const base=price.baseCredits+price.imageCredits*images+price.referenceCredits*references;
 if (price.videoSecondCredits && (seconds===undefined || !Number.isFinite(seconds) || seconds<=0)) return {state:'rate',base,perSecond:price.videoSecondCredits};
 const amount=base+price.videoSecondCredits*Math.ceil(seconds ?? 0);
 return Number.isSafeInteger(amount) && amount>=0 ? {state:'priced',amount} : {state:'pending'};
}
export function toolPriceText(estimate: PriceEstimate, admin=false): string {
 let text=estimate.state==='priced' ? `${admin ? '会员价' : '预计消耗'} ${estimate.amount.toLocaleString('zh-CN')} 积分`
  : estimate.state==='rate' ? `${admin ? '会员价：' : ''}${estimate.base ? `基础 ${estimate.base} 积分 + ` : ''}按 ${estimate.perSecond} 积分 / 输入秒（向上取整）`
  : estimate.state==='pending' ? '填写参数后计算积分' : estimate.state==='ambiguous' ? '价格规则冲突，请联系管理员' : '暂未开放会员付费';
 if(admin) text+='；管理员不扣会员积分';
 return text;
}
/** Preserve typed scalar parameters while allowing empty irrelevant fields in an estimate. */
export function pricingParameters(fields: ReadonlyArray<{name:string;type:string}>, values: Record<string,string>): Record<string,unknown> {
 const result: Record<string,unknown>={};
 for(const field of fields){const value=values[field.name]?.trim();if(value===undefined || value==='') continue;
  result[field.name]=field.type==='integer' ? Number(value) : field.type==='boolean' ? value==='true' : field.type==='integer-array' ? value.split(/[,，\n]/).map(Number) : field.type.endsWith('-array') ? value.split(/[,，\n]/).map(item=>item.trim()).filter(Boolean) : value;
 }
 return result;
}

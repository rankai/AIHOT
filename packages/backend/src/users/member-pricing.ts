import { randomUUID } from 'node:crypto';
import type { MemberPriceCatalog, MemberPriceOffer } from '@aihot/contracts/membership';
import type { ToolCreditIntent } from '@aihot/contracts/credits';
import { listToolPrices } from './credits-prices.ts';
import { sql } from '../db.ts';
import { audit } from '../admin/auth.ts';
import { platformToolCatalog } from '../providers/redfox/catalog.ts';
import { aiSearchEngines } from '../providers/redfox/ai-search-contract.ts';
import { transcriptionPairs } from '../providers/redfox/transcription-contract.ts';
import { WAN_MODEL } from '../providers/aliyun/wan-contract.ts';
import { AccountError } from './accounts.ts';

export const MEMBER_PRICE_VERSION = '2026-10-30-v2';
const approvedQueryIds = new Set(["047JJ3UA", "0OT1E306", "0W27H3O6", "0ZB9S2FW", "0ZIWOO8P", "1LDQ7E1C", "20060016", "20060017", "27DQ6SF9", "28CFGF5I", "384C6W6B", "3BXWEB6Y", "3X8FGEEM", "3YJT69FL", "439NFLBD", "4BOZ9DLE", "4IVIDHEN", "4QS1F8DE", "5K5EG87P", "5QY3G5TY", "5Y84NI1D", "609DF2IR", "6C4A77XR", "6SE9WIHJ", "774OBKK0", "7UW1PT1F", "8IQD0BJC", "9KFOB9M2", "9Q2PQBKU", "9Y4EX7RW", "ABJQXHUE", "AEA6YE0J", "API_1789095347662", "API_1789097000710", "API_1789097000761", "API_1789097000814", "API_1789097000858", "API_1789097000885", "API_1789098514899", "API_1789098515117", "API_1789098515245", "API_1789637464311", "API_1790063277084", "API_1790149158205", "API_1790149281139", "API_1790577699794", "API_1790581450500", "API_1790581645603", "API_1791446025175", "API_1791793668086", "API_1791881343238", "API_1792051516512", "API_1792053861083", "API_1792651427872", "API_1792651427970", "API_1792651512423", "API_1792651658984", "AWUTFI4V", "CI7VW144", "CWX77QIH", "D52IUEIM", "DL4YNCTQ", "DNVPQZEZ", "E7G00COY", "EH53TOT7", "FK67XDVQ", "FVQ8D4W5", "GC5SC5HS", "GM0TISWI", "GU17EVLV", "HUCIASU", "I3CIBRI2", "I8P3HTVH", "IE0887SO", "JBGBKQ4B", "KR1LPTBF", "KUQYSQNX", "L6OUNUN1", "LBYLC5AK", "LEN9QXR3", "LLCI8QTE", "MH5YA9DL", "MQMDU19Q", "NL4I3533", "OE4KUEUO", "OFFSPQ0U", "OVUTOTCV", "OWIBYU1V", "P3W2W18P", "P5CHB3BZ", "PAB6Z75Y", "PW97QFBS", "PXZXY8KQ", "QEQLCKD6", "QPNFJRG1", "QQ5E3EZ9", "QSL2ZSXM", "R1IGR09H", "R473NUE9", "S28Q6HUD", "TE6AGWAF", "TIN1NMTZ", "TXQPVGJG", "U1SGKF2G", "U2NJ13MW", "UAQ90A1F", "UOM99OQI", "UUSP1G1P", "VBBTYLMV", "VPA67I98", "VYSP68M2", "W86F8SSK", "W94P1QH1", "WD6UT8DQ", "WULKP6JP", "X16I71WV", "XEO0QQNF", "XN3ULENA", "XNV30XZ3", "XUT4CECZ", "YGYYT0G0", "YIGCY5US", "Z9M88QI8", "ZIGAGYYT", "ZMFVK589", "ZWR31P2A", "ZXJLJQ21"]);
const unavailable = ['GPT Image 2 多张或高分辨率、GPT Image 2.5、Gemini、Seedream：成本尚未核定，暂不开放付费', 'Seedance 除 8 秒 / 480p / 有声 / 3 张参考图外：成本尚未核定', '小红书异步评论、AgentKey：成本尚未核定，暂不开放付费'];
export async function memberPriceCatalog(admin = false): Promise<MemberPriceCatalog> {
 const offers: MemberPriceOffer[] = [];
 const costs = await sql`SELECT model,per_request,source_url FROM service_prices WHERE service IN ('redfox.query','redfox.media','redfox.transcript') AND currency='CNY' AND per_request IS NOT NULL AND per_request >= 0 AND source_url IS NOT NULL`;
 const add = (kind: string, model: string, label: string, credits: number, costBasis: string, tier = '', restriction = '', provider = 'redfox', unit = '次') => offers.push({kind,provider,model,tier,label,credits,unit,restriction,...(admin ? {costBasis} : {})});
 for (const operation of await platformToolCatalog()) {
  const cost = costs.find(row => row.model === operation.id);
  if (operation.platform === 'redfox-account' || !approvedQueryIds.has(operation.id) || !cost) continue;
  add('query',operation.id,operation.label,operation.id === '9Q2PQBKU' ? 30 : 20,`文档基价 ¥${cost.per_request}/次；${cost.source_url}`);
 }
 add('x-account','','X 账号查询',20,'Redfox 固定平台接口文档基价');
 add('x-tweet','','X 推文查询',20,'Redfox 固定平台接口文档基价');
 for (const [id, engine] of Object.entries(aiSearchEngines)) add('ai-search',id,engine.label,id === 'kimiK3' ? 60 : id.endsWith('Products') ? 50 : 30,`文档基价 ¥${engine.price}/次`);
 for (const [id, platform] of Object.entries(transcriptionPairs)) add('transcriptions',id,`${platform.label}转写`,id === 'videoUrl' ? 30 : 200,id === 'videoUrl' ? '文档基价 ¥0.06/次' : '文档基价 ¥0.60/次');
 add('images','gptImage2','GPT Image 2',300,'2026-10-29 实扣 ¥1.00，限 1k 单张','1k','仅 1k、1 张');
 add('videos','seedance','Seedance',3000,'2026-10-30 实扣 ¥15.00，仅该规格','480p','仅 8 秒、有声、3 张不同参考图');
 add('videos',WAN_MODEL,'万相标准',100,'官方文档 ¥0.60/生成秒；售卖按输入秒取整','wan-std','按输入视频秒数向上取整','aliyun','输入秒');
 add('videos',WAN_MODEL,'万相专业',150,'官方文档 ¥0.90/生成秒；售卖按输入秒取整','wan-pro','按输入视频秒数向上取整','aliyun','输入秒');
 add('media-upload','','素材上传',0,'上传及已有任务正常恢复不追加收费');
 const {prices} = await listToolPrices();
 for (const offer of offers) offer.prices = prices.filter(price => price.enabled && price.kind === offer.kind && price.provider === offer.provider && price.model === offer.model && price.tier === offer.tier);
 return {version:MEMBER_PRICE_VERSION, offers, unavailable};
}
/** Only normalized member entry points call this. Recovery retains its original charge. */
export async function assertMemberCostEligible(intent: ToolCreditIntent): Promise<void> {
 if (intent.recoveryRunId !== undefined && intent.kind.endsWith('/query')) return;
 const catalog = await memberPriceCatalog();
 const offer = catalog.offers.find(o => o.kind === intent.kind && o.provider === intent.provider && o.model === (intent.model ?? '') && o.tier === (intent.tier ?? ''));
 let eligible = !!offer;
 if (intent.kind === 'images') eligible &&= intent.imageCount === 1 && intent.input.n === 1 && intent.input.resolution === '1k';
 if (intent.kind === 'videos' && intent.provider === 'redfox') {
  const refs = intent.input.imageWithRoles;
  eligible &&= intent.videoSeconds === 8 && intent.input.duration === 8 && intent.input.generateAudio === true && intent.referenceCount === 3
   && Array.isArray(refs) && refs.length === 3 && refs.every(ref => ref.role === 'reference_image') && new Set(refs.map(ref => ref.fileKey)).size === 3;
 }
 if (!eligible) throw new AccountError(409,'cost_unverified','该工具规格的供应商成本尚未核定，暂不开放付费；已有任务仍可查看与恢复');
}
/** Explicit, once-per-version application. Never enables providers, budgets or collection. */
export async function applyApprovedMemberPrices(actor: string): Promise<{ applied: boolean; version: string }> {
 const catalog = await memberPriceCatalog(true);
 return sql.begin(async tx => {
  await tx`SELECT pg_advisory_xact_lock(hashtext('member-approved-price-application'))`;
  const [existing] = await tx`SELECT version FROM member_price_applications WHERE version=${catalog.version}`;
  if (existing) return {applied:false,version:catalog.version};
  const before = await tx`SELECT * FROM member_tool_prices WHERE enabled`;
  // Retire broad/custom legacy member rules before applying the approved complete catalog.
  await tx`UPDATE member_tool_prices SET enabled=false,version=version+1,updated_at=now() WHERE enabled`;
  for (const offer of catalog.offers) {
   const match = offer.kind === 'images' ? {n:1} : offer.kind === 'videos' && offer.provider === 'redfox' ? {duration:8,generateAudio:true} : {};
   const second = offer.unit === '输入秒' ? offer.credits : 0, base = second ? 0 : offer.credits;
   await tx`INSERT INTO member_tool_prices(id,kind,provider,model,tier,parameter_match,base_credits,image_credits,video_second_credits,reference_credits,enabled)
    VALUES (${randomUUID()},${offer.kind},${offer.provider},${offer.model},${offer.tier},${tx.json(match)},${base},0,${second},0,true)
    ON CONFLICT(kind,provider,model,tier,parameter_match) DO UPDATE SET base_credits=EXCLUDED.base_credits,image_credits=0,video_second_credits=EXCLUDED.video_second_credits,reference_credits=0,enabled=true,version=member_tool_prices.version+1,updated_at=now()`;
  }
  await tx`INSERT INTO member_price_applications(version,actor) VALUES (${catalog.version},${actor})`;
  await audit(actor,'credits.prices.apply',catalog.version,'明确应用已批准会员工具价目',before,catalog,undefined,tx);
  return {applied:true,version:catalog.version};
 });
}

import {requireLiveResult} from "../../operations/result-retention.ts";
import {collectedDetailContext} from './collection-detail.ts';
import type { PlatformOperationDescriptor } from '@aihot/contracts/redfox';
import { sql,type Db } from '../../db.ts';
import { douyinVideoId } from '../../lib/url.ts';
import { UnsupportedReplacement } from '../../sources/x-replacement.ts';
import { workDetailOrigin } from './work-detail-origin.ts';
import { weiboCarDetailOrigin } from './weibo-car-detail-origin.ts';
import { douyinOperations } from './douyin-contract.ts';
import { xiaohongshuOperations } from './xiaohongshu-contract.ts';
import { wechatOperations } from './wechat-contract.ts';
import { tiktokOperations } from './tiktok-contract.ts';
import { bilibiliOperations } from './bilibili-contract.ts';
import { weiboOperations } from './weibo-contract.ts';
import { qichezhijiaOperations, qichezhijiaDescriptors } from './qichezhijia-contract.ts';
import { dongchediOperations } from './dongchedi-contract.ts';
import { yicheOperations } from './yiche-contract.ts';

const details = {
  '0OT1E306': douyinOperations['0OT1E306'], FK67XDVQ: douyinOperations.FK67XDVQ,
  KR1LPTBF: xiaohongshuOperations.KR1LPTBF, XEO0QQNF: wechatOperations.XEO0QQNF,
  '1LDQ7E1C': wechatOperations['1LDQ7E1C'], I3CIBRI2: wechatOperations.I3CIBRI2,
  '6SE9WIHJ': tiktokOperations['6SE9WIHJ'], TIN1NMTZ: bilibiliOperations.TIN1NMTZ,
  API_1789098514899: weiboOperations.API_1789098514899, TE6AGWAF: qichezhijiaOperations.TE6AGWAF,
  LLCI8QTE: qichezhijiaOperations.LLCI8QTE, QQ5E3EZ9: dongchediOperations.QQ5E3EZ9,
  '3BXWEB6Y': yicheOperations['3BXWEB6Y'], VYSP68M2: yicheOperations.VYSP68M2,
};
type Target = keyof typeof details;
interface Choice {
  operationId: Target; label: string; parameters: Record<string, unknown>; fields: PlatformOperationDescriptor['fields'];
  price: { amount: string | null; currency: string | null; basis: 'estimated' }; purpose: 'query';
}
const text = (value: unknown) => typeof value === 'string' && value.length ? value : null;

/** Local suggestions only; the existing query command rechecks the source proof on submission. */
export async function workDetailOptions(resultId: number,db:Db=sql): Promise<{ resultId: number; choices: Choice[]; reason?: string } | null> {
  const [r] = await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status,p.model AS receipt_model,p.status AS receipt_status
    FROM operation_results z JOIN operation_runs r ON r.id=z.run_id
    LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  if (!r) return null;
  requireLiveResult(r);
  if (r.provenance?.detailSourceResultId !== undefined) {
    await collectedDetailContext(db,r);
    return {resultId,choices:[],reason:'该结果已是补全详情，无需重复查询同一作品'};
  }
  if (r.provider !== 'redfox' || !['received','completed'].includes(r.status) || r.model !== r.input.operationId)
    throw new UnsupportedReplacement('该结果缺少匹配的已收回执，不能提供作品补全接口');
  const platform = r.input.platform, source = r.input.operationId;
  if (r.kind !== `${platform}_work`) return { resultId, choices: [], reason: '该结果不是已确认作品；账号、榜单和研究汇总没有作品补全选项' };
  const data = r.data, record = data.record ?? {}, id = text(data.workId), url = text(data.url);
  const candidates: { operationId: Target; parameters: Record<string, unknown> }[] = [];
  const add = (operationId: Target, parameters: Record<string, unknown>) => candidates.push({ operationId, parameters });
  switch (platform) {
    case 'douyin': {
      if (['QEQLCKD6','774OBKK0','HUCIASU'].includes(source) && id) add('0OT1E306', { workId: id });
      if (['QSL2ZSXM','OWIBYU1V'].includes(source) && id) add('FK67XDVQ', { videoId: id });
      if (['WD6UT8DQ','0ZB9S2FW','I8P3HTVH'].includes(source)) {
        const nativeId = douyinVideoId(url ?? '');
        if (nativeId) { add('0OT1E306', { workId: nativeId }); add('FK67XDVQ', { videoId: nativeId }); }
      }
      break;
    }
    case 'xiaohongshu':
      if (['384C6W6B','XN3ULENA','3X8FGEEM','P3W2W18P'].includes(source) && id) add('KR1LPTBF', { workId: id });
      if (['LBYLC5AK','AEA6YE0J','047JJ3UA'].includes(source) && url) add('KR1LPTBF', { workLink: url });
      break;
    case 'wechat': {
      const uuid = text(record.workUuid);
      if (['PW97QFBS','XNV30XZ3'].includes(source) && uuid) add('XEO0QQNF', { workUuid: uuid });
      if (['FVQ8D4W5','8IQD0BJC'].includes(source) && uuid) add('1LDQ7E1C', { workUuid: uuid });
      if (url) add('I3CIBRI2', { articleUrl: url });
      break;
    }
    case 'tiktok': if (text(record.workId)) add('6SE9WIHJ', { awemeId: record.workId }); break;
    case 'bilibili':
      if (id) add('TIN1NMTZ', { bvId: id });
      else if (text(record.workUrl)) add('TIN1NMTZ', { workUrl: record.workUrl });
      break;
    case 'weibo': if (text(data.opusId)) add('API_1789098514899', { opusId: data.opusId }); break;
    case 'qichezhijia':
      if (source === 'CI7VW144' && id) {
        if (r.input.parameters?.sourceType === 'video' && ['14','3'].includes(record.workType))
          add('TE6AGWAF', { videoId: id, videoType: record.workType === '14' ? 4 : 0 });
        if (r.input.parameters?.sourceType === 'article') add('LLCI8QTE', { workId: id });
      }
      break;
    case 'dongchedi': {
      const workType = record.workType === 1 ? 'article' : record.workType === 2 ? 'video'
        : record.articleType === 7 && record.articleTypeStr === 'ugc_article' ? 'article'
        : record.articleType === 2 && record.articleTypeStr === 'pgc_video' ? 'video'
        : source === 'W86F8SSK' && r.input.parameters?.sourceType === '2' ? 'video' : null;
      if (id && workType) add('QQ5E3EZ9', { workId: id, workType });
      break;
    }
    case 'yiche':
      if (id && (source === 'YIGCY5US' && r.input.parameters?.sourceType === 'shipin' || source === 'YGYYT0G0' && record.workType === 4)) add('3BXWEB6Y', { workId: id });
      if (source === 'YIGCY5US' && r.input.parameters?.sourceType === 'xinwen' && url) add('VYSP68M2', { url });
      break;
  }
  const choices: Choice[] = [];
  for (const candidate of candidates) {
    const { operationId, parameters } = candidate, definition = details[operationId];
    // LLC's page has no documented default. Validate only its frozen workId here;
    // the relationship proof does not need page, and the final command requires it.
    const schema = operationId === 'LLCI8QTE' ? qichezhijiaOperations.LLCI8QTE.schema.omit({ page: true }) : definition.schema;
    if (!schema.safeParse(parameters).success) continue;
    try {
      if (['weibo','qichezhijia','dongchedi','yiche'].includes(platform)) await weiboCarDetailOrigin(db, resultId, operationId, parameters);
      else await workDetailOrigin(db, resultId, operationId, parameters);
    } catch (error) {
      if (error instanceof UnsupportedReplacement) continue;
      throw error;
    }
    const [price] = await db<{ amount: string | null; currency: string | null }[]>`SELECT per_request::text AS amount,currency FROM service_prices WHERE service='redfox.query' AND model=${operationId}`;
    choices.push({ operationId, label: definition.label, parameters,
      fields: operationId === 'LLCI8QTE' ? qichezhijiaDescriptors().find(d => d.id === operationId)!.fields.filter(f => f.name === 'page') : [],
      price: { amount: price?.amount ?? null, currency: price?.currency ?? null, basis: 'estimated' }, purpose: 'query' });
  }
  return { resultId, choices, ...(!choices.length ? { reason: '缺少已确认的作品 ID、原文或同库详情映射，或来源证据未通过校验；不会自动尝试其他接口' } : {}) };
}

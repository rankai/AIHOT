import {requireLiveResult} from "../../operations/result-retention.ts";
import { collectedDetailContext, applyCollectedDetail } from "./collection-detail.ts";
import { z } from 'zod';
import type { Db } from '../../db.ts';
import { stableJson } from '../../lib/ids.ts';
import { UnsupportedReplacement } from '../../sources/x-replacement.ts';
import { RedfoxResponseError } from './client.ts';
import { collectionDiscoveredAt } from './collection-page-proof.ts';
import { weiboOperations, WeiboOperationId } from './weibo-contract.ts';
import { parseWeibo } from './weibo.ts';
import { douyinOperations, DouyinOperationId } from './douyin-contract.ts';
import { parseDouyin } from './douyin.ts';
import { xiaohongshuOperations, XiaohongshuOperationId } from './xiaohongshu-contract.ts';
import { parseXiaohongshu } from './xiaohongshu-parser.ts';
import { wechatOperations, WechatOperationId } from './wechat-contract.ts';
import { parseWechat } from './wechat.ts';
import { bilibiliOperations, BilibiliOperationId } from './bilibili-contract.ts';
import { parseBilibili } from './bilibili.ts';
import { baijiahaoOperations, BaijiahaoOperationId } from './baijiahao-contract.ts';
import { parseBaijiahao } from './baijiahao.ts';

export const accountDetailDefinitions = {
  API_1789098515117: weiboOperations.API_1789098515117, XUT4CECZ: douyinOperations.XUT4CECZ,
  '4IVIDHEN': xiaohongshuOperations['4IVIDHEN'], KUQYSQNX: wechatOperations.KUQYSQNX,
  '6C4A77XR': wechatOperations['6C4A77XR'], EH53TOT7: bilibiliOperations.EH53TOT7,
  API_1789097000814: baijiahaoOperations.API_1789097000814,
};
export type AccountDetailTarget = keyof typeof accountDetailDefinitions;
export const AccountDetailTargets = Object.keys(accountDetailDefinitions);
const Origin = z.object({ kind: z.literal('account'), sourceResultId: z.number().int().positive().safe(),
  platform: z.enum(['weibo','douyin','xiaohongshu','wechat','bilibili','baijiahao']), sourceOperation: z.string(),
  target: z.enum(['API_1789098515117','XUT4CECZ','4IVIDHEN','KUQYSQNX','6C4A77XR','EH53TOT7','API_1789097000814']),
  locator: z.record(z.string(),z.string().min(1)), identity: z.record(z.string(),z.string().min(1)), discoveredAt: z.iso.datetime(),
}).strict();
type AccountOrigin = z.infer<typeof Origin>;
type Result = { kind: string; data: Record<string,unknown> };
type Candidate = { operationId: AccountDetailTarget; parameters: Record<string,string> };
const text = (v: unknown) => typeof v === 'string' && v.length ? v : undefined;
function reject(message: string): never { throw new UnsupportedReplacement(message); }

/** Only received fields named by these concrete source contracts provide account locators. */
export async function accountDetailSource(db: Db, resultId: number) {
  const [r] = await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status,p.model AS receipt_model,p.status AS receipt_status
    FROM operation_results z JOIN operation_runs r ON r.id=z.run_id LEFT JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${resultId}`;
  if (!r) return null;
  requireLiveResult(r);
  const collected = await collectedDetailContext(db,r);
  const executionInput = collected?.input ?? r.input;
  if (r.provider !== 'redfox' || !['redfox.sync.query','redfox.platform.collection','redfox.weibo.collection'].includes(r.operation_key)
    || !['received','completed'].includes(r.status) || r.model !== executionInput.operationId || r.data.platform !== executionInput.platform)
    reject('Source is not a matching received account/work result');
  const platform = executionInput.platform, op = executionInput.operationId;
  if (!['weibo','douyin','xiaohongshu','wechat','bilibili','baijiahao'].includes(platform)
    || ![`${platform}_account`,`${platform}_work`].includes(r.kind)) return { choices: [] as Candidate[] };
  if (platform !== 'weibo' && (r.data.operationId !== op || r.operation_key === 'redfox.weibo.collection')) reject('Source operation does not match the received result');
  const raw = platform === 'weibo' ? r.data : z.record(z.string(),z.unknown()).parse(r.data.record);
  let parsed: Result | undefined;
  const p = executionInput.parameters;
  switch (platform) {
    case 'weibo': {
      if (!['TXQPVGJG','API_1789098515245','API_1789098515117','API_1789098514899'].includes(op)) return { choices: [] as Candidate[] };
      const operation = WeiboOperationId.parse(op), request = weiboOperations[operation].schema.parse(p);
      parsed = parseWeibo(operation, ['TXQPVGJG','API_1789098515245'].includes(op) ? [raw] : raw, request)[0]; break;
    }
    case 'douyin': {
      if (!['P5CHB3BZ','L6OUNUN1','XUT4CECZ','QEQLCKD6','774OBKK0','QSL2ZSXM','OWIBYU1V','FK67XDVQ','WD6UT8DQ','0ZB9S2FW'].includes(op)) return { choices: [] as Candidate[] };
      const operation = DouyinOperationId.parse(op), spec = douyinOperations[operation];
      parsed = parseDouyin(operation, ['accounts','works'].includes(spec.shape) ? {list:[raw]} : spec.shape === 'growth_rank' ? [raw] : raw, spec.schema.parse(p))[0]; break;
    }
    case 'xiaohongshu': {
      if (!['439NFLBD','4IVIDHEN'].includes(op) || r.kind !== 'xiaohongshu_account') return { choices: [] as Candidate[] };
      const operation = XiaohongshuOperationId.parse(op), spec = xiaohongshuOperations[operation];
      parsed = parseXiaohongshu(operation, spec.shape === 'accounts' ? {list:[raw]} : raw, spec.schema.parse(p))[0]; break;
    }
    case 'wechat': {
      // Growth-account context is not the work's own received author locator.
      if (!['DNVPQZEZ','5Y84NI1D','6C4A77XR','KUQYSQNX','PW97QFBS','FVQ8D4W5','XNV30XZ3','8IQD0BJC','XEO0QQNF','1LDQ7E1C','I3CIBRI2','IE0887SO','ZIGAGYYT','OFFSPQ0U'].includes(op)) return { choices: [] as Candidate[] };
      const operation = WechatOperationId.parse(op), spec = wechatOperations[operation];
      parsed = parseWechat(operation, ['accounts','works'].includes(spec.shape) ? {list:[raw]} : spec.shape === 'work_rank' ? [raw] : raw, spec.schema.parse(p))[0]; break;
    }
    case 'bilibili': {
      const operation = BilibiliOperationId.parse(op), spec = bilibiliOperations[operation];
      const payload = spec.shape === 'accounts' ? {accountList:[raw]} : ['works','account_works'].includes(spec.shape) ? {workList:[raw],...(spec.shape === 'account_works' ? {mid:r.data.accountMid} : {})} : raw;
      parsed = parseBilibili(operation, payload, spec.schema.parse(p))[0]; break;
    }
    case 'baijiahao': {
      if (!['API_1789097000885','API_1789097000761'].includes(op)) return { choices: [] as Candidate[] };
      const operation = BaijiahaoOperationId.parse(op);
      parsed = parseBaijiahao(operation, op === 'API_1789097000885' ? {dataList:[raw]} : raw, baijiahaoOperations[operation].schema.parse(p))[0]; break;
    }
  }
  if (!parsed || parsed.kind !== r.kind) reject('Source does not reproduce its received account/work kind');
  // Save only this detail's own parsed identities before source-derived metadata is reapplied.
  const ownIdentity = {...(parsed.data.identity ?? {})} as Record<string,string>;
  if (collected) applyCollectedDetail(op,p,parsed,executionInput.origin);
  if (platform !== 'weibo') for (const field of ['identity','workId','url','accountMid']) {
    if (stableJson(parsed.data[field] ?? null) !== stableJson(r.data[field] ?? null)) reject(`Stored source ${field} differs from received fields`);
  }
  const record = platform === 'weibo' ? parsed.data : parsed.data.record as Record<string,unknown>;
  const identity: Record<string,string> = {};
  const received = (parsed.data.identity ?? {}) as Record<string,string>;
  const choices: Candidate[] = [];
  const add = (operationId: AccountDetailTarget, parameters: Record<string,string>) => {
    if (accountDetailDefinitions[operationId].schema.safeParse(parameters).success) choices.push({ operationId, parameters });
  };
  if (platform === 'weibo' && text(record.uid)) { identity.uid = String(record.uid); add('API_1789098515117',{userId:identity.uid}); }
  if (platform === 'douyin') {
    let locator: string | undefined;
    if (['P5CHB3BZ','XUT4CECZ'].includes(op)) locator = text(record.uid) ?? (op === 'P5CHB3BZ' ? text(record.accountId) : text(record.displayId));
    else if (op === 'L6OUNUN1') locator = text(record.userId) ?? text(record.uniqueName) ?? text(record.shortId);
    else if (['QEQLCKD6','774OBKK0'].includes(op)) locator = text(record.authorId); // Documented display 抖音号, never a UID.
    else if (['QSL2ZSXM','OWIBYU1V','FK67XDVQ'].includes(op)) locator = text(record.authorUid) ?? text(record.authorUniqueId) ?? text(record.authorShortId);
    else locator = text(record.author_user_id);
    if (received.uid) identity.uid = received.uid;
    if (locator) add('XUT4CECZ',{accountId:locator});
  }
  if (platform === 'xiaohongshu' && text(record.accountId)) {
    // Search does not declare userId; detail does. An incidental passthrough field cannot upgrade it.
    if (op === '4IVIDHEN' && text(record.userId)) identity.userId = String(record.userId);
    add('4IVIDHEN',{accountId:String(record.accountId),...(identity.userId ? {userId:identity.userId} : {})});
  }
  if (platform === 'wechat') {
    for (const key of ['wxId','bizInfo']) if (received[key]) identity[key] = received[key]!;
    const account = r.kind === 'wechat_account' ? text(record.account) : undefined;
    if (ownIdentity.wxId) add('KUQYSQNX',{wxId:ownIdentity.wxId});
    else if (ownIdentity.bizInfo) add('KUQYSQNX',{bizInfo:ownIdentity.bizInfo});
    else if (account) add('KUQYSQNX',{account});
    if (account) add('6C4A77XR',{account});
  }
  if (platform === 'bilibili' && received.mid) identity.mid = received.mid;
  if (platform === 'bilibili' && ownIdentity.mid) add('EH53TOT7',{mid:ownIdentity.mid});
  if (platform === 'baijiahao' && text(record.uk)) { identity.uk = String(record.uk); add('API_1789097000814',{uk:identity.uk}); }
  let discoveredAt: Date;
  if (collected) discoveredAt = collected.discoveredAt;
  else if (r.operation_key === 'redfox.weibo.collection') {
    const pageId = r.provenance?.sourcePageResultId;
    if (!Number.isSafeInteger(pageId) || pageId <= 0) reject('Missing Weibo source page proof');
    const [page] = await db`SELECT z.created_at FROM operation_results z JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${pageId}
      AND z.run_id=${r.run_id} AND z.receipt_id=${r.receipt_id} AND z.kind='query_summary'
      AND z.data->>'platform'='weibo' AND z.data->>'operationId'=${op} AND z.item_key='page:'||(z.data->>'page')
      AND p.model=${op} AND p.status IN ('received','completed')`;
    if (!page) reject('Invalid Weibo source page proof'); discoveredAt = new Date(page.created_at);
  } else discoveredAt = await collectionDiscoveredAt(db,r,platform,op);
  return { choices, platform, sourceOperation: op as string, identity, discoveredAt: discoveredAt.toISOString() };
}

export async function accountDetailOrigin(db: Db, sourceResultId: number, target: string, parameters: Record<string,unknown>) {
  const source = await accountDetailSource(db,sourceResultId);
  const choice = source?.choices.find(c => c.operationId === target && stableJson(c.parameters) === stableJson(parameters));
  if (!source || !choice || !('platform' in source)) reject('Account query does not match a received account locator');
  return Origin.parse({kind:'account',sourceResultId,platform:source.platform,sourceOperation:source.sourceOperation,target,
    locator:choice.parameters,identity:source.identity,discoveredAt:source.discoveredAt});
}

/** Compare actual same-type identities only. Never copy a source locator into returned stable IDs. */
export function applyAccountDetailOrigin(target: string, parameters: Record<string,unknown>, result: Result, raw: unknown) {
  if (raw === undefined) return;
  const origin: AccountOrigin = Origin.parse(raw);
  if (origin.target !== target || stableJson(origin.locator) !== stableJson(parameters) || result.kind !== `${origin.platform}_account`
    || result.data.platform !== origin.platform || origin.platform !== 'weibo' && result.data.operationId !== target)
    reject('Account detail differs from frozen source relation');
  const record = origin.platform === 'weibo' ? result.data : z.record(z.string(),z.unknown()).parse(result.data.record);
  const actual: Record<string,string | undefined> = origin.platform === 'weibo' ? {uid:text(record.uid)} : (result.data.identity ?? {}) as Record<string,string | undefined>;
  for (const [kind,value] of Object.entries(origin.identity)) {
    const returned = kind === 'uk' ? text(record.uk) : actual[kind];
    if (returned && returned !== value) throw new RedfoxResponseError('Account detail conflicts with received same-type source identity');
  }
  result.data = {...result.data,originResultId:origin.sourceResultId};
}

import type { PlatformOperationDescriptor } from '@aihot/contracts/redfox';
import { sql } from '../../db.ts';
import { workDetailOptions } from './work-detail-options.ts';
import { accountDetailDefinitions, accountDetailSource, accountDetailOrigin } from './account-detail-origin.ts';

/** Both explicit actions consume the same single saved result; neither starts a provider call. */
export async function resultDetailOptions(resultId: number) {
  const works = await workDetailOptions(resultId);
  if (!works) return null;
  const source = await accountDetailSource(sql,resultId);
  const accountChoices = [];
  for (const choice of source?.choices ?? []) {
    await accountDetailOrigin(sql,resultId,choice.operationId,choice.parameters);
    const [price] = await sql<{ amount: string | null; currency: string | null }[]>`SELECT per_request::text AS amount,currency FROM service_prices WHERE service='redfox.query' AND model=${choice.operationId}`;
    accountChoices.push({...choice,label:accountDetailDefinitions[choice.operationId].label,fields:[] as PlatformOperationDescriptor['fields'],
      price:{amount:price?.amount ?? null,currency:price?.currency ?? null,basis:'estimated' as const},purpose:'query' as const});
  }
  const choices = [...works.choices,...accountChoices];
  return {resultId,choices,...(!choices.length ? {reason:'缺少可证明的作品或账号定位字段，或没有已确认的详情映射；不会按昵称查询或自动换库'} : {})};
}

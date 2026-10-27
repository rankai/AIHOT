import {agentKeyXOperations,xCollectionIds,type AgentKeyXRoute} from './x-contract.ts';
import {agentKeyWeiboOperations,weiboCollectionIds,weiboEnrichmentIds,weiboDetailRoute,type AgentKeyWeiboRoute} from './weibo-contract.ts';
import {agentKeyBilibiliOperations,bilibiliCollectionIds,bilibiliEnrichmentIds,bilibiliDetailRoute,type AgentKeyBilibiliRoute} from './bilibili-contract.ts';
import {agentKeyXiaohongshuOperations,xiaohongshuCollectionIds,xiaohongshuDetailRoute,type AgentKeyXiaohongshuRoute} from './xiaohongshu-contract.ts';
import {agentKeyToutiaoOperations,toutiaoCommentsRoute,type AgentKeyToutiaoRoute} from './toutiao-contract.ts';
import {agentKeyOperation as douyinOperation,agentKeyRouteFor as douyinRouteFor,agentKeyRouteInput as douyinInput,type AgentKeyDouyinRoute} from './douyin-contract.ts';
import {agentKeyWechatOperations,wechatArticlesRoute,wechatDetailRoute,type AgentKeyWechatRoute} from './wechat-contract.ts';
export type AgentKeyRoute=AgentKeyXRoute|AgentKeyWeiboRoute|AgentKeyBilibiliRoute|AgentKeyDouyinRoute|AgentKeyWechatRoute|AgentKeyToutiaoRoute|AgentKeyXiaohongshuRoute;
export function agentKeyOperation(id:unknown){return agentKeyXOperations.find(o=>o.operationId===id)??agentKeyWeiboOperations.find(o=>o.operationId===id)??agentKeyBilibiliOperations.find(o=>o.operationId===id)??agentKeyXiaohongshuOperations.find(o=>o.operationId===id)??douyinOperation(id)??agentKeyToutiaoOperations.find(o=>o.operationId===id)??agentKeyWechatOperations.find(o=>o.operationId===id);}
export function agentKeyRouteInput(route:AgentKeyRoute,input:unknown):Record<string,unknown>{const op=[...agentKeyXOperations,...agentKeyWeiboOperations,...agentKeyBilibiliOperations,...agentKeyWechatOperations,...agentKeyToutiaoOperations,...agentKeyXiaohongshuOperations].find(o=>o.route===route);return op?op.schema.parse(input):douyinInput(route as AgentKeyDouyinRoute,input);}
export function agentKeyRouteFor(run:Parameters<typeof douyinRouteFor>[0]):AgentKeyRoute|undefined{
  const old=douyinRouteFor(run);if(old)return old;
  if(run.provider!=='agentkey'||run.contract_version!==1)return undefined;
  const x=agentKeyXOperations.find(o=>o.route.operationKey===run.operation_key&&o.route.stepKey===run.step_key&&o.operationId===run.input?.operationId);
  if(x&&(run.input?.mode==='query'||run.input?.mode==='collection'&&(xCollectionIds as readonly string[]).includes(x.operationId))&&run.input?.platform==='x-research'&&run.input?.tool===x.route.tool&&run.input?.upstream==='TikHub')return x.route;
  const weibo=agentKeyWeiboOperations.find(o=>o.route.operationKey===run.operation_key&&o.route.stepKey===run.step_key&&o.operationId===run.input?.operationId);
  if(weibo&&(run.input?.mode==='query'||run.input?.mode==='collection'&&(weiboCollectionIds as readonly string[]).includes(weibo.operationId))&&run.input?.platform==='weibo'&&run.input?.tool===weibo.route.tool&&run.input?.upstream==='TikHub')return weibo.route;
  const weiboBase=agentKeyWeiboOperations.find(o=>o.route.operationKey===run.operation_key&&o.operationId===run.input?.operationId);
  if(weiboBase&&(weiboEnrichmentIds as readonly string[]).includes(weiboBase.operationId)&&run.input?.mode==='collection'&&run.input?.platform==='weibo'&&run.input?.upstream==='TikHub'&&run.input?.tool===weiboBase.route.tool&&run.input?.enrichDetails===true&&run.input?.detailOperationId==='API_1789098514899'&&run.step_key===weiboDetailRoute.stepKey)return weiboDetailRoute;
  const bili=agentKeyBilibiliOperations.find(o=>o.route.operationKey===run.operation_key&&o.route.stepKey===run.step_key&&o.operationId===run.input?.operationId);
  if(bili&&(run.input?.mode==='query'||run.input?.mode==='collection'&&(bilibiliCollectionIds as readonly string[]).includes(bili.operationId))&&run.input?.platform==='bilibili'&&run.input?.tool===bili.route.tool&&run.input?.upstream==='TikHub')return bili.route;
  const biliBase=agentKeyBilibiliOperations.find(o=>o.route.operationKey===run.operation_key&&o.operationId===run.input?.operationId);
  if(biliBase&&(bilibiliEnrichmentIds as readonly string[]).includes(biliBase.operationId)&&run.input?.mode==='collection'&&run.input?.platform==='bilibili'&&run.input?.upstream==='TikHub'&&run.input?.tool===biliBase.route.tool&&run.input?.enrichDetails===true&&run.input?.detailOperationId==='TIN1NMTZ'&&run.step_key===bilibiliDetailRoute.stepKey)return bilibiliDetailRoute;
  const xhs=agentKeyXiaohongshuOperations.find(o=>o.route.operationKey===run.operation_key&&o.route.stepKey===run.step_key&&o.operationId===run.input?.operationId);
  if(xhs&&(run.input?.mode==='query'||run.input?.mode==='collection'&&(xiaohongshuCollectionIds as readonly string[]).includes(xhs.operationId)))return xhs.route;
  const xhsBase=agentKeyXiaohongshuOperations.find(o=>o.route.operationKey===run.operation_key&&o.operationId===run.input?.operationId);
  if(xhsBase&&['384C6W6B','XN3ULENA'].includes(xhsBase.operationId)&&run.input?.mode==='collection'&&run.input?.enrichDetails===true&&run.input?.detailOperationId==='KR1LPTBF'&&run.step_key===xiaohongshuDetailRoute.stepKey)return xiaohongshuDetailRoute;
  const toutiao=agentKeyToutiaoOperations.find(o=>o.route.operationKey===run.operation_key&&o.route.stepKey===run.step_key&&o.operationId===run.input?.operationId);
  if(toutiao&&(run.input?.mode==='query'||(run.input?.mode==='collection'&&toutiao.route===toutiaoCommentsRoute)))return toutiao.route;
  const direct=agentKeyWechatOperations.find(o=>o.route.operationKey===run.operation_key&&o.route.stepKey===run.step_key);
  if(direct&&(run.input?.mode==='query'||direct.route===wechatArticlesRoute))return direct.route;
  if(run.operation_key===wechatArticlesRoute.operationKey&&run.step_key===wechatDetailRoute.stepKey&&['collection','preview'].includes(String(run.input?.mode))&&run.input?.source)return wechatDetailRoute;
  return undefined;
}
export function agentKeyOutboundAllowed(run:Parameters<typeof agentKeyRouteFor>[0]&{input:Record<string,unknown>},env:NodeJS.ProcessEnv=process.env){return !!agentKeyRouteFor(run)&&env.AGENTKEY_CALLS_ENABLED==='true'&&(!['collection','preview'].includes(String(run.input.mode))||env.COLLECT_ENABLED!=='false');}

import { sql, type Db, type Tx } from "../db.ts";
import { credential } from "../config.ts";
import { unsupportedConfig } from "./config-keys.ts";
import { needsXArticleExtraction } from "./x.ts";
import { redfoxBaseUrl, parseRedfoxJson } from "../providers/redfox/client.ts";
import { StaleOperationError } from "../providers/operations/store.ts";
import { z } from "zod";

export const X_MAPPING_VERSION = 1;
export class UnsupportedReplacement extends Error { readonly code = "unsupported_configuration"; }
/** Recognize the entire logical account scope; never discard an unrecognized query suffix. */
export function singleXAccount(query: unknown) {
  if (typeof query !== "string") return null;
  const match = /^from:([A-Za-z0-9_]{1,15})(?:\s+(-filter:replies))?$/i.exec(query.trim());
  return match ? {handle:match[1]!.toLowerCase(),excludeReplies:!!match[2]} : null;
}
export interface ReplacementCheck { key: string; source: string; conclusion: "supported" | "unsupported" | "unverified" | "unavailable"; evidence: string }
export function logicalXConfig(config: Record<string,unknown>) {const {restId:_rest,...logical}=config;return logical;}
export async function preflightXReplacement(sourceId: string, target: "redfox" | "socialdata", db: Db = sql, proposed?: Record<string,unknown>) {
  const [source] = await db`SELECT s.*, c.id AS subscription_id,c.edit_version,c.provider,c.config AS effective_config,c.progress AS effective_progress
    FROM sources s LEFT JOIN collection_subscriptions c ON c.control_source_id=s.id WHERE s.id=${sourceId}`;
  if (!source) return null;
  const currentConfig = proposed !== undefined ? proposed : source.subscription_id != null ? source.effective_config : source.config;
  const validConfig = currentConfig !== null && typeof currentConfig === "object" && !Array.isArray(currentConfig);
  const config = validConfig ? currentConfig : {};
  const logical=logicalXConfig(config),account=singleXAccount(logical.query);
  const bindings=await db`SELECT id_value FROM source_account_bindings WHERE platform='x' AND id_kind='user_id' AND source_id=${sourceId}`;
  const checks:ReplacementCheck[]=[];
  const check=(key:string,ok:boolean,evidence:string,origin="source.config",failure:ReplacementCheck["conclusion"]="unsupported")=>checks.push({key,source:origin,conclusion:ok?"supported":failure,evidence});
  const hasSubscription=source.kind==="x_search" && !!source.subscription_id;
  check("subscription",hasSubscription,hasSubscription?"沿用现有 X 信源及其主订阅":"请先完成现有 X 信源的主订阅迁移","database");
  const unsupported=unsupportedConfig("x_search",logical);
  check("configuration",validConfig && unsupported.length===0,!validConfig?"配置不是有效对象，请先修正":unsupported.length?`当前配置含不支持的字段：${unsupported.join("、")}`:"保留原查询及材料策略，Redfox 稳定账号 ID 单独绑定");
  const hasCredential=!!credential("collectors",target==="redfox"?"REDFOX_API_KEY":"SOCIALDATA_API_KEY");
  check("credentials",hasCredential,hasCredential?"服务端已配置凭证；此检查不请求供应商":`请先在服务端配置 ${target} 凭证`,"server configuration","unavailable");
  if(target==="redfox") {
    check("execution",true,"已接通有界时间线与详情采集，每页处理完成后才推进位置","implementation");
    const sameAccount=!!account && (!proposed || account.handle===singleXAccount(source.effective_config?.query)?.handle);
    check("query",sameAccount,sameAccount?"保留完整的单账号查询范围":account?"此次修改改变了已绑定账号范围，不能沿用原绑定":"当前仅能映射完整 from:账号 查询；关键词、多作者或其他条件须由对应能力承接");
    check("ordering",logical.searchType===undefined || logical.searchType==="Latest",logical.searchType===undefined || logical.searchType==="Latest"?"保留按时间倒序采集":"时间线不能承接当前 Top 搜索排序");
    const hasBinding=bindings.length===1 && (config.restId===undefined || config.restId===bindings[0]?.id_value);
    check("account",hasBinding,hasBinding?"已有唯一且一致的稳定账号 ID":"请先查询并绑定对应账号；提交的账号 ID 须与已有绑定一致","source_account_bindings");
    check("replyFilter",true,account?.excludeReplies?"按推文详情中的明确回复字段过滤，每项补全受次数上限约束":"当前任务不排除回复，无需增加回复详情请求","QCP75W33");
    const requiresArticle=needsXArticleExtraction(source.kind,source.participation_mode,false);
    check("article",!requiresArticle,requiresArticle?"当前参与方式需要补全 X Article，Redfox 暂无对应能力，不能切换":"当前任务不需要补全 X Article","jobs/content shared condition");
    const hasBacklog=!!source.effective_progress?.xBacklog?.length;
    check("incremental",!hasBacklog,hasBacklog?"请先完成原采集器尚未读取的积压，再切换":"可映射稳定推文水位；不同供应商的分页游标不会照搬","subscription.progress");
    for(const operation of ["API_1790148502632","QCP75W33"]) {
      const [latest]=await db`SELECT response FROM receipts WHERE service LIKE 'redfox.%' AND model=${operation}
        AND request->>'base'=${redfoxBaseUrl()} AND response IS NOT NULL ORDER BY received_at DESC NULLS LAST,id DESC LIMIT 1`;
      let code:unknown;
      try {code=(parseRedfoxJson(latest?.response?.body??"null") as {code?:unknown}|null)?.code;}catch {code=undefined;}
      const denied=[401,403].includes(latest?.response?.status);
      const success=latest?.response?.status===200 && code===2000;
      checks.push({key:`permission:${operation}`,source:"current endpoint latest receipt",conclusion:denied?"unavailable":success?"supported":"unverified",evidence:denied?"此接口最近一次响应明确拒绝访问，请先解决权限问题":success?"此接口最近一次已收响应成功":"尚无此接口的当前成功记录；不额外付费探测，首次有界执行可能需要核对"});
    }
  } else {
    check("query",typeof logical.query==="string" && !!logical.query.trim(),"保留原生采集器的完整查询条件");
    check("ordering",logical.searchType===undefined || ["Latest","Top"].includes(String(logical.searchType)),"按原生采集器支持的搜索排序执行");
    check("incremental",!source.effective_progress?.continuation,source.effective_progress?.continuation?"请先完成 Redfox 尚未读取的分页，再切换":"没有待完成的 Redfox 分页，可切换供应商","subscription.progress");
  }
  return {sourceId,target,mappingVersion:X_MAPPING_VERSION,sourceVersion:new Date(source.updated_at).toISOString(),subscriptionVersion:source.edit_version??null,
    supported:checks.every(c=>c.conclusion==="supported" || c.conclusion==="unverified"),checks,
    mapping:target==="redfox"?{operation:"redfox.x.timeline",restId:bindings.length===1?bindings[0]!.id_value:null}: {operation:"x.search",query:logical.query,searchType:logical.searchType??"Latest"}};
}

const Switch = z.object({target:z.enum(["redfox","socialdata"]),sourceVersion:z.string().datetime(),subscriptionVersion:z.number().int(),mappingVersion:z.number().int(),reason:z.string().min(1).max(500)}).strict();
export async function switchXCollection(sourceId:string,raw:unknown,actor:string) {
  const input=Switch.parse(raw);
  return sql.begin(async(tx)=>{
    const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE control_source_id=${sourceId} FOR UPDATE`;
    const [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source)return null;
    if(!sub)throw new UnsupportedReplacement("Migrate the primary subscription first");
    if(new Date(source.updated_at).toISOString()!==input.sourceVersion || sub.edit_version!==input.subscriptionVersion || input.mappingVersion!==X_MAPPING_VERSION)throw new StaleOperationError("Replacement preview changed; refresh preflight");
    const check=await preflightXReplacement(sourceId,input.target,tx);
    if(!check!.supported)throw new UnsupportedReplacement(check!.checks.filter(c=>c.conclusion==="unsupported" || c.conclusion==="unavailable").map(c=>c.evidence).join("; "));
    if(sub.provider===input.target)return {sourceId,subscriptionId:sub.id,provider:sub.provider};
    const config=logicalXConfig(sub.config);
    if(input.target==="redfox")config.restId=check!.mapping.restId;
    // Preserve provider-specific historical progress without treating a cursor as portable.
    const {providerProgress={},...previous}=sub.progress;
    const archived={...providerProgress,[sub.provider]:previous};
    const targetProgress={...(providerProgress[input.target]??{})};
    if(previous.lastTweetId && (!targetProgress.lastTweetId || BigInt(previous.lastTweetId)>BigInt(targetProgress.lastTweetId)))targetProgress.lastTweetId=previous.lastTweetId;
    if(previous.initializedAt)targetProgress.initializedAt=previous.initializedAt;
    await tx`UPDATE collection_subscriptions SET provider=${input.target},operation_key=${input.target==="redfox"?"redfox.x.timeline":"x.search"},config=${tx.json(config as never)},
      progress=${tx.json({...targetProgress,providerProgress:archived} as never)},execution_version=execution_version+1,edit_version=edit_version+1,active_run_id=NULL,next_run_at=now(),updated_at=now() WHERE id=${sub.id}`;
    await tx`UPDATE sources SET execution_version=execution_version+1,updated_at=now() WHERE id=${sourceId}`;
    await tx`INSERT INTO audit_log(actor,action,subject,reason,before,after) VALUES (${actor},'source.switch_collection',${`source:${sourceId}`},${input.reason},${tx.json({provider:sub.provider})},${tx.json({provider:input.target,mappingVersion:X_MAPPING_VERSION})})`;
    return {sourceId,subscriptionId:sub.id,provider:input.target};
  });
}
/** Used by ordinary config PATCH inside the same subscription/source locking transaction. */
export async function validateXSubscriptionConfig(tx:Tx,sourceId:string,provider:string,config:Record<string,unknown>) {
  if(provider!=="redfox")return config;
  const check=await preflightXReplacement(sourceId,"redfox",tx,config);
  if(!check?.supported)throw new UnsupportedReplacement(check?.checks.filter(c=>!["supported","unverified"].includes(c.conclusion)).map(c=>c.evidence).join("; ")??"Source unavailable");
  return {...logicalXConfig(config),restId:check.mapping.restId};
}

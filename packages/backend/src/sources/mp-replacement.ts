import { z } from "zod";
import { sql,type Db,type Tx } from "../db.ts";
import { credential } from "../config.ts";
import { audit } from "../admin/auth.ts";
import { unsupportedConfig } from "./config-keys.ts";
import { UnsupportedReplacement,type ReplacementCheck } from "./x-replacement.ts";
import { StaleOperationError } from "../providers/operations/store.ts";
import { redfoxBaseUrl,parseRedfoxJson } from "../providers/redfox/client.ts";
import { WechatOperationId,wechatOperations } from "../providers/redfox/wechat-contract.ts";
import { parseWechat } from "../providers/redfox/wechat.ts";
export const MP_MAPPING_VERSION=1;
export const MpLibrary=z.enum(["wide","premium"]);
export const mpOperations={wide:{list:"8IQD0BJC",detail:"1LDQ7E1C",sortType:"2"},premium:{list:"XNV30XZ3",detail:"XEO0QQNF",sortType:"_2"}} as const;
export function logicalMpConfig(config:Record<string,unknown>){const {redfoxLibrary:_,...logical}=config;return logical;}
/** Resolve only previously imported account evidence; no supplier request or new binding. */
async function accountMapping(db:Db,sourceId:string,config:Record<string,unknown>){
  const bindings=await db`SELECT id_kind,id_value,evidence FROM source_account_bindings WHERE platform='wechat' AND source_id=${sourceId}`;
  const wxId=bindings.find(b=>b.id_kind==='wxId')?.id_value as string|undefined;
  const bizInfo=bindings.find(b=>b.id_kind==='bizInfo')?.id_value as string|undefined;
  let account:string|undefined;
  const verified=new Set<string>();
  for(const binding of bindings){
    if(binding.evidence?.kind!=="result")continue;
    const reference=String(binding.evidence.reference);
    if(!/^[1-9][0-9]{0,18}$/.test(reference)||BigInt(reference)>9223372036854775807n)continue;
    const [r]=await db`SELECT z.*,r.provider,r.operation_key,r.input,p.model,p.status FROM operation_results z JOIN operation_runs r ON r.id=z.run_id JOIN receipts p ON p.id=z.receipt_id WHERE z.id=${reference} AND z.source_id=${sourceId}`;
    const op=WechatOperationId.safeParse(r?.input.operationId);
    if(!r||!op.success||!["wechat_account","wechat_work"].includes(r.kind)||r.provider!=="redfox"||r.operation_key!=="redfox.sync.query"||r.model!==op.data||r.data.platform!=="wechat"||r.data.operationId!==op.data||!["received","completed"].includes(r.status))continue;
    try{
      const shape=wechatOperations[op.data].shape;
      if(!["account","accounts","work","works"].includes(shape))continue;
      const payload=["accounts","works"].includes(shape)?{list:[r.data.record]}:r.data.record;
      const parsed=parseWechat(op.data,payload,r.input.parameters)[0];
      const identity=parsed?.data.identity as {wxId?:string;bizInfo?:string}|undefined;
      if(!identity||identity[binding.id_kind as "wxId"|"bizInfo"]!==binding.id_value||(identity.wxId&&identity.wxId!==wxId)||(identity.bizInfo&&identity.bizInfo!==bizInfo))continue;
      verified.add(binding.id_kind);
      const record=parsed!.data.record as {account?:string};
      if(parsed!.kind==="wechat_account"&&record.account){if(account&&account!==record.account)throw new UnsupportedReplacement("Imported account evidence has conflicting display accounts");account=record.account;}
    }catch(error){if(error instanceof UnsupportedReplacement)throw error;}
  }
  const confirmedWx=verified.has("wxId")?wxId:undefined,confirmedBiz=verified.has("bizInfo")?bizInfo:undefined;
  const matches=config.ghid?config.ghid===confirmedWx:!!config.wxid&&config.wxid===account;
  return {wxId:confirmedWx,bizInfo:confirmedBiz,account,matches};
}
export async function preflightMpReplacement(sourceId:string,target:"redfox"|"dajiala",library:unknown="wide",db:Db=sql,proposed?:Record<string,unknown>){
  const selected=MpLibrary.parse(library);
  const [s]=await db`SELECT s.*,c.id AS subscription_id,c.provider,c.edit_version,c.config AS effective_config,c.progress AS effective_progress,c.interval_minutes AS effective_interval,c.active_run_id FROM sources s LEFT JOIN collection_subscriptions c ON c.control_source_id=s.id WHERE s.id=${sourceId}`;
  if(!s)return null;
  const currentConfig=proposed!==undefined?proposed:s.subscription_id!=null?s.effective_config:s.config;
  const validConfig=currentConfig!==null&&typeof currentConfig==="object"&&!Array.isArray(currentConfig);
  const config=validConfig?logicalMpConfig(currentConfig):{},checks:ReplacementCheck[]=[];
  const check=(key:string,ok:boolean,evidence:string,source="database",failure:ReplacementCheck["conclusion"]="unsupported")=>checks.push({key,source,conclusion:ok?"supported":failure,evidence});
  check("subscription",s.kind==="mp_account"&&!!s.subscription_id,"仅支持现有公众号主订阅，保留信源与订阅 ID");
  const bad=unsupportedConfig("mp_account",config);
  check("configuration",validConfig&&!bad.length&&[config.ghid,config.wxid].some(v=>typeof v==="string"&&v.length>0),!validConfig?"配置不是有效对象，请先修正":bad.length?`不支持的配置：${bad.join("、")}`:"保留 ghid/wxid/nickname，不改变原周期");
  check("credentials",!!credential("collectors",target==="redfox"?"REDFOX_API_KEY":"DAJIALA_KEY"),"需服务端凭证；预检不向供应商发请求","server configuration","unavailable");
  const identity=target==="redfox"?await accountMapping(db,sourceId,config):{wxId:undefined,bizInfo:undefined,account:undefined,matches:false};
  if(target==="redfox"){
    check("identity",identity.matches&&!!(identity.wxId||identity.bizInfo),"需已有同源稳定账号绑定；有 ghid 时必须匹配 wxId，无 ghid 时须由已收账号记录核实 wxid","source_account_bindings");
    if(selected==="premium")check("account",!!identity.account,"优质库仅接受已收并绑定同源的展示 account；不能用 ghid 或昵称替代","operation_results");
    for(const op of Object.values(mpOperations[selected]).slice(0,2)){
      const [r]=await db`SELECT response FROM receipts WHERE service LIKE 'redfox.%' AND model=${op} AND request->>'base'=${redfoxBaseUrl()} AND response IS NOT NULL ORDER BY received_at DESC NULLS LAST,id DESC LIMIT 1`;
      let code:unknown;try{code=(parseRedfoxJson(r?.response?.body??"null") as {code?:unknown}|null)?.code;}catch{code=undefined;}
      const denied=[401,403].includes(r?.response?.status),success=r?.response?.status===200&&code===2000;
      checks.push({key:`permission:${op}`,source:"current endpoint latest receipt",conclusion:denied?"unavailable":success?"supported":"unverified",evidence:denied?"此接口最近已收响应拒绝访问":success?"此接口最近已收响应成功":"尚未核实此接口权限；不会额外付费探测"});
    }
  }
  const parameters=selected==="premium"?{account:identity.account??null}:identity.wxId?{wxId:identity.wxId}:{bizInfo:identity.bizInfo??null};
  return {sourceId,target,library:selected,mappingVersion:MP_MAPPING_VERSION,sourceVersion:new Date(s.updated_at).toISOString(),subscriptionVersion:s.edit_version??null,supported:checks.every(c=>["supported","unverified"].includes(c.conclusion)),checks,
    mapping:target==="redfox"?{operation:"redfox.wechat.collection",...mpOperations[selected],parameters,identity:{wxId:identity.wxId??null,bizInfo:identity.bizInfo??null}}:{operation:"mp.history",parameters:{ghid:config.ghid??config.wxid}},
    impact:{...(target==="redfox"?{firstImport:!s.effective_progress?.lastCheckedAt,firstImportNote:!s.effective_progress?.lastCheckedAt?"最多8条，全部标记历史回填；不按无时区日期筛选7天范围":null}:{}),delay:target==="redfox"?"T+1":null,intervalMinutes:s.effective_interval??s.interval_minutes,activeRunId:s.active_run_id??null,sourceId,subscriptionId:s.subscription_id??null,note:"保留原材料与权限；切换使旧轮失去提交资格，供应商/库的分页与 UUID 不跨库复用"}};
}
const Switch=z.object({target:z.enum(["redfox","dajiala"]),library:MpLibrary.default("wide"),sourceVersion:z.string().datetime(),subscriptionVersion:z.number().int(),mappingVersion:z.number().int(),reason:z.string().min(1).max(500)}).strict();
export async function switchMpCollection(sourceId:string,raw:unknown,actor:string){
  const input=Switch.parse(raw);
  return sql.begin(async tx=>{
    const [sub]=await tx`SELECT * FROM collection_subscriptions WHERE control_source_id=${sourceId} FOR UPDATE`;
    const [source]=await tx`SELECT * FROM sources WHERE id=${sourceId} FOR UPDATE`;
    if(!source)return null;
    if(!sub||source.kind!=="mp_account")throw new UnsupportedReplacement("Existing MP primary subscription required");
    if(new Date(source.updated_at).toISOString()!==input.sourceVersion||sub.edit_version!==input.subscriptionVersion||input.mappingVersion!==MP_MAPPING_VERSION)throw new StaleOperationError("Replacement preview changed; refresh preflight");
    const preflight=await preflightMpReplacement(sourceId,input.target,input.library,tx);
    if(!preflight!.supported)throw new UnsupportedReplacement(preflight!.checks.filter(c=>!["supported","unverified"].includes(c.conclusion)).map(c=>c.evidence).join("; "));
    if(sub.provider===input.target&&(input.target!=="redfox"||sub.config.redfoxLibrary===input.library))return {sourceId,subscriptionId:sub.id,provider:sub.provider};
    const config=logicalMpConfig(sub.config);if(input.target==="redfox")config.redfoxLibrary=input.library;
    const {providerProgress={},...previous}=sub.progress;
    const from=sub.provider==="redfox"?`redfox:${sub.config.redfoxLibrary}`:sub.provider;
    const progress={lastCheckedAt:previous.lastCheckedAt??null,providerProgress:{...providerProgress,[from]:previous}};
    await tx`UPDATE collection_subscriptions SET provider=${input.target},operation_key=${input.target==="redfox"?"redfox.wechat.collection":"mp.history"},config=${tx.json(config as never)},progress=${tx.json(progress as never)},execution_version=execution_version+1,edit_version=edit_version+1,active_run_id=NULL,next_run_at=now(),updated_at=now() WHERE id=${sub.id}`;
    await tx`UPDATE sources SET execution_version=execution_version+1,updated_at=now() WHERE id=${sourceId}`;
    await audit(actor,"source.switch_collection",`source:${sourceId}`,input.reason,{provider:sub.provider,library:sub.config.redfoxLibrary??null},{provider:input.target,library:input.target==="redfox"?input.library:null,mappingVersion:MP_MAPPING_VERSION},undefined,tx);
    return {sourceId,subscriptionId:sub.id,provider:input.target};
  });
}
export async function validateMpSubscriptionConfig(tx:Tx,sourceId:string,current:Record<string,unknown>,config:Record<string,unknown>){
  if(config.redfoxLibrary!==undefined&&config.redfoxLibrary!==current.redfoxLibrary)throw new UnsupportedReplacement("换库须先预检并使用采集切换命令");
  const library=MpLibrary.parse(current.redfoxLibrary),next={...config,redfoxLibrary:library};
  const check=await preflightMpReplacement(sourceId,"redfox",library,tx,next);
  const bad=check?.checks.filter(c=>c.key!=="credentials"&&c.conclusion==="unsupported");
  if(!check||bad?.length)throw new UnsupportedReplacement(bad?.map(c=>c.evidence).join("; ")??"Source unavailable");
  return next;
}

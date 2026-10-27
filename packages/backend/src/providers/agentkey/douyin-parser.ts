import {object,parseLosslessJson} from "./response.ts";
import {douyinSnapshotOperations,douyinTrendingRoute,douyinCommentsRoute,douyinRepliesRoute,douyinTopicRoute,douyinFollowingRoute,douyinProfileRoute,douyinOperationId,douyinSearchInput,douyinSearchRoute,douyinAccountPostsRoute,douyinAccountPostsInput,douyinDetailRoute,douyinSuggestRoute,douyinAccountSearchRoute,agentKeyRouteInput,type AgentKeyDouyinRoute,type DouyinSearchInput} from "./douyin-contract.ts";
export class AgentKeyPayloadError extends Error {
  readonly receiptId?: number;
  constructor(message: string, receiptId?: number) { super(message); this.receiptId = receiptId; }
}

const stableId = (value: unknown, opaque = false): string | undefined => {
  if (typeof value === "string" && (opaque ? !!value.trim() && !/[\s\u0000-\u001f]/.test(value) : /^\d+$/.test(value))) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined; // In particular, never String() an already rounded unsafe number.
};

const firstUrl = (value: unknown): string | undefined => {
  const urls = object(value)?.UrlList;
  return Array.isArray(urls) ? urls.find((url): url is string => typeof url === "string" && !!url.trim())?.trim() : undefined;
};

const epochSeconds = (value: unknown): number | undefined => {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return undefined;
  return raw.length >= 13 ? Math.trunc(numeric / 1000) : numeric;
};

export function parseDouyinSearch(response: unknown, input: DouyinSearchInput) {
  const envelope = object(object(response)?.envelope);
  if (envelope?.provider !== "TikHub") throw new AgentKeyPayloadError("AgentKey returned an unrecognized upstream; review retained response");
  const payload = object(envelope.data), responseBody = object(payload?.data), data = object(responseBody?.data);
  if (payload?.code !== 200 || responseBody?.code !== 0) throw new AgentKeyPayloadError("Unrecognized Douyin V4 non-success business status; review retained response");
  if (!data || !Array.isArray(data.itemList)) throw new AgentKeyPayloadError("Unrecognized Douyin V4 itemList; review retained response");
  const candidates = data.itemList.map((value, index) => {
    const item = object(object(value)?.AwemeInfo);
    if (!item) throw new AgentKeyPayloadError("Invalid Douyin V4 AwemeInfo item; review retained response");
    const video = object(item.Video), author = object(item.Author);
    const workId = stableId(item.AwemeId) ?? stableId(video?.ItemID);
    const uid = stableId(author?.Uid), secUid = stableId(author?.SecUid, true);
    if (item.AwemeId && video?.ItemID && String(item.AwemeId) !== String(video.ItemID)) {
      throw new AgentKeyPayloadError("Douyin V4 work IDs disagree; review retained response");
    }
    const description = typeof item.Desc === "string" ? item.Desc
      : typeof video?.Title === "string" ? video.Title : undefined;
    const createTime = item.CreateTime ?? video?.CreateTime;
    const shareUrl = workId ? `https://www.douyin.com/video/${workId}` : undefined;
    const authorName = typeof author?.Nickname === "string" ? author.Nickname : undefined;
    const coverUrl = firstUrl(video?.Cover) ?? firstUrl(item.Cover);
    const record = {
      ...(description !== undefined ? {desc: description, aweme_desc: description} : {}),
      ...(authorName !== undefined ? {authorName} : {}),
      ...(coverUrl !== undefined ? {coverUrl} : {}),
    };
    const seconds = epochSeconds(createTime);
    const missingFields: string[] = [];
    if (!workId) missingFields.push("aweme_id");
    if (!uid) missingFields.push("author.uid");
    if (!secUid) missingFields.push("author.sec_uid");
    if (description === undefined) missingFields.push("desc");
    if (seconds === undefined) missingFields.push("create_time");
    const importBlockers: string[] = [];
    if (!workId) importBlockers.push("lossless_work_id_required");
    const time = seconds === undefined ? null : new Date(seconds * 1000);
    const publishedAt = time && Number.isFinite(time.getTime()) ? time.toISOString() : null;
    return { itemKey: `item:${index}`, kind: "douyin_work", data: {
      platform:"douyin", operationId:"OWIBYU1V", provider:"agentkey", upstream:"TikHub",tool:douyinSearchRoute.tool,
      title:description ?? "抖音作品", identity:{...(uid?{uid}:{}),...(secUid?{secUserId:secUid}:{})},
      workId:workId??null,url:shareUrl??null,missing:missingFields,record,publishedAt,
      ...(workId ? { aweme_id: workId } : {}),
      ...(description !== undefined ? { desc: description } : {}),
      ...(seconds !== undefined ? { create_time: seconds } : {}),
      author: { ...(uid ? { uid } : {}), ...(secUid ? { sec_uid: secUid } : {}), ...(authorName ? { name: authorName } : {}) },
      ...(shareUrl ? { share_url: shareUrl } : {}), missingFields, importBlockers,
    } };
  });
  const pagination: Record<string, unknown> = {};
  if (Object.hasOwn(data, "hasMore")) pagination.hasMore = data.hasMore;
  if (Object.hasOwn(data, "cursor")) pagination.cursor = data.cursor;
  const effective = douyinSearchInput.parse(input);
  const stopReason = data.hasMore === false ? "upstream_no_more" : undefined;
  return { candidates, summary: { count: candidates.length, query: effective,
    ...(Object.keys(pagination).length ? { pagination } : {}), ...(stopReason ? { stopReason } : {}),
    missingFields: Object.keys(pagination).length ? [] : ["pagination"],
  } };
}

/** Exact pre-projection V4 record, for validating already retained results against their receipt. */
export function legacyDouyinV4Record(response: unknown, itemKey: string, record: Record<string, unknown>): Record<string, unknown> | null {
  const index = /^item:(0|[1-9][0-9]*)$/.exec(itemKey)?.[1];
  if (index === undefined) return null;
  const envelope = object(object(response)?.envelope), payload = object(envelope?.data), body = object(payload?.data), data = object(body?.data);
  const items = data?.itemList;
  const item = Array.isArray(items) ? object(object(items[Number(index)])?.AwemeInfo) : null;
  return item ? {...item, ...record} : null;
}

/** Verified APP v3 responses use lower-case work fields, unlike V4 search. */
export function parseDouyinApp(response:unknown, route:AgentKeyDouyinRoute, raw:unknown) {
  const input=agentKeyRouteInput(route,raw), envelope=object(object(response)?.envelope), payload=object(envelope?.data), body=object(payload?.data);
  if(envelope?.provider!=="TikHub"||payload?.code!==200||!body)throw new AgentKeyPayloadError("Unrecognized Douyin APP success envelope");
  const account=route===douyinAccountPostsRoute;
  if(!account&&route!==douyinDetailRoute)throw new AgentKeyPayloadError("Unsupported Douyin APP route");
  if(account&&(body.status_code!==0||!Array.isArray(body.aweme_list)))throw new AgentKeyPayloadError("Missing successful account work list");
  if(!account&&(!object(body.aweme_detail)||(body.status_code!==undefined&&body.status_code!==0)))throw new AgentKeyPayloadError("Missing successful work detail; retain unavailable evidence for review");
  const outerUid=stableId(body.uid),outerSec=stableId(body.sec_uid,true);
  if(account&&((body.uid!==undefined&&!outerUid)||(body.sec_uid!==undefined&&!outerSec)||(outerSec&&outerSec!==input.sec_user_id)))throw new AgentKeyPayloadError("Returned account identity disagrees or is unsafe");
  const values=account?body.aweme_list as unknown[]:[body.aweme_detail];
  const candidates=values.map((value,index)=>{
    const item=object(value);if(!item)throw new AgentKeyPayloadError("Invalid work object");
    const author=object(item.author),workId=stableId(item.aweme_id),uid=stableId(author?.uid),secUid=stableId(author?.sec_uid,true);
    if(!account&&workId!==input.aweme_id)throw new AgentKeyPayloadError("Returned work ID does not match requested detail");
    if(account&&((secUid&&secUid!==input.sec_user_id)||(outerUid&&uid&&outerUid!==uid)||(outerSec&&secUid&&outerSec!==secUid)))throw new AgentKeyPayloadError("Returned work author disagrees with account");
    return projectAppWork(item,index,route,true);
  });
  const pagination:Record<string,unknown>=account?{hasMore:body.has_more===0||body.has_more===false?false:body.has_more===1||body.has_more===true?true:undefined,cursor:body.max_cursor}:{};
  return {candidates,summary:{count:candidates.length,query:input,pagination,missingFields:[]}};
}
/** Each route validates its own container and request identity before sharing this safe projection. */
function projectAppWork(item:Record<string,unknown>,index:number,route:AgentKeyDouyinRoute,knownSeconds:boolean){
  const author=object(item.author),workId=stableId(item.aweme_id),uid=stableId(author?.uid),secUid=stableId(author?.sec_uid,true);
    const description=typeof item.desc==="string"?item.desc:undefined;
    const seconds=knownSeconds&&typeof item.create_time==="number"&&Number.isSafeInteger(item.create_time)&&item.create_time>=0?item.create_time:undefined;
    const date=seconds===undefined?null:new Date(seconds*1000),publishedAt=date&&Number.isFinite(date.getTime())?date.toISOString():null;
    const authorName=typeof author?.nickname==="string"?author.nickname:undefined;
    const urls=object(object(item.video)?.cover)?.url_list;
    const coverUrl=Array.isArray(urls)?urls.find((v):v is string=>{
      if(typeof v!=="string")return false;try{const u=new URL(v);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
    }):undefined;
    const missingFields=[...(!workId?["aweme_id"]:[]),...(!uid?["author.uid"]:[]),...(!secUid?["author.sec_uid"]:[]),...(description===undefined?["desc"]:[]),...(!publishedAt?["create_time"]:[])];
    const url=workId?`https://www.douyin.com/video/${workId}`:null;
    return {itemKey:`item:${index}`,kind:"douyin_work",data:{platform:"douyin",operationId:douyinOperationId(route),provider:"agentkey",upstream:"TikHub",tool:route.tool,
      title:description??"抖音作品",identity:{...(uid?{uid}:{}),...(secUid?{secUserId:secUid}:{})},workId:workId??null,url,
      missing:missingFields,missingFields,importBlockers:[...(!workId?["lossless_work_id_required"]:[])],publishedAt,
      record:{...(description!==undefined?{desc:description,aweme_desc:description}:{}),...(authorName!==undefined?{authorName}:{}),...(coverUrl?{coverUrl}:{}),...(seconds!==undefined?{create_time:seconds}:{}),...(!knownSeconds&&typeof item.create_time==="number"&&Number.isFinite(item.create_time)?{create_time:item.create_time}:{}),...(!knownSeconds&&typeof item.share_url==="string"?{share_url:item.share_url}:{})},
      ...(workId?{aweme_id:workId}:{}),...(description!==undefined?{desc:description}:{}),...(seconds!==undefined?{create_time:seconds}:{}),
      author:{...(uid?{uid}:{}),...(secUid?{sec_uid:secUid}:{}),...(authorName?{name:authorName}:{})},...(url?{share_url:url}:{}),...(!knownSeconds?{timeUnits:{create_time:"unspecified"}}:{})}};
}
export interface ParsedAgentKeyDouyin {
  candidates:Array<{itemKey:string;kind:string;data:Record<string,unknown>}>;
  summary:{count:number;query:Record<string,unknown>;pagination?:Record<string,unknown>;missingFields:string[];stopReason?:string;accountState?:"deleted";displayName?:string;statusText?:string;record?:Record<string,unknown>;bootstrap?:boolean;snapshot?:boolean};
}
export function parseAgentKeyDouyin(response:unknown,route:AgentKeyDouyinRoute,input:unknown):ParsedAgentKeyDouyin{
  if(douyinSnapshotOperations.some(o=>o.route===route))return parseDouyinSnapshot(response,route,input);
  if(route===douyinSuggestRoute||route===douyinAccountSearchRoute)return parseDouyinResearch(response,route,input);
  return route===douyinSearchRoute?parseDouyinSearch(response,douyinSearchInput.parse(input)):parseDouyinApp(response,route,input);
}

/** Check received detail authors against the original account page; never synthesize an author. */
export function verifyDouyinDetailAuthor(detail:Record<string,unknown>,source:Record<string,unknown>,sourceResponse:unknown,accountParameters:unknown){
  if(detail.workId!==source.workId)throw new AgentKeyPayloadError("Detail differs from discovered work");
  const before=object(source.identity)??{},after=object(detail.identity)??{};
  const page=object(object(object(object(sourceResponse)?.envelope)?.data)?.data);
  const input=douyinAccountPostsInput.parse(accountParameters);
  const expected={...before,...(stableId(page?.uid)?{uid:stableId(page?.uid)}:{}),secUserId:input.sec_user_id};
  for(const [kind,value] of Object.entries(expected))if(after[kind]!==undefined&&after[kind]!==value)throw new AgentKeyPayloadError("Detail author contradicts original account page");
}


/** Single-page research results; dynamic patches are data, never executable templates or URLs. */
export function parseDouyinResearch(response:unknown,route:AgentKeyDouyinRoute,raw:unknown):ParsedAgentKeyDouyin{
  const query=agentKeyRouteInput(route,raw),envelope=object(object(response)?.envelope),payload=object(envelope?.data),body=object(payload?.data);
  if(envelope?.provider!=="TikHub"||payload?.code!==200||body?.status_code!==0)throw new AgentKeyPayloadError("Unrecognized Douyin research success envelope");
  if(route===douyinSuggestRoute){
    if(!Array.isArray(body.sug_list))throw new AgentKeyPayloadError("Missing suggestion list");
    const candidates=body.sug_list.map((value,index)=>{
      const content=object(value)?.content;
      if(typeof content!=="string")throw new AgentKeyPayloadError("Invalid suggestion content");
      return {itemKey:`item:${index}`,kind:"search_suggestion",data:{platform:"douyin",operationId:"douyin.suggest",provider:"agentkey",upstream:"TikHub",tool:route.tool,
        title:content,record:{content}}};
    });
    return {candidates,summary:{count:candidates.length,query,missingFields:[]}};
  }
  if(route!==douyinAccountSearchRoute||!Array.isArray(body.user_list))throw new AgentKeyPayloadError("Missing account search list");
  const candidates=body.user_list.map((value,index)=>{
    const row=object(value);if(!row)throw new AgentKeyPayloadError("Invalid account search item");
    const direct=row.user_info===undefined?undefined:accountProjection(row.user_info);
    let patch:ReturnType<typeof accountProjection>|undefined;
    if(row.dynamic_patch!==undefined){
      const dynamic=object(row.dynamic_patch);
      if(typeof dynamic?.raw_data!=="string")throw new AgentKeyPayloadError("Invalid account dynamic patch data");
      let decoded:unknown;
      try{decoded=parseLosslessJson(dynamic.raw_data);}catch{throw new AgentKeyPayloadError("Malformed account dynamic patch JSON");}
      patch=accountProjection(object(decoded)?.user_info);
    }
    if(!direct&&!patch)throw new AgentKeyPayloadError("Missing recognizable account user_info");
    for(const field of ["uid","sec_uid"] as const)if(direct?.[field]&&patch?.[field]&&direct[field]!==patch[field])throw new AgentKeyPayloadError("Account representations have conflicting identities");
    const record={...patch,...direct},uid=record.uid,sec=record.sec_uid;
    const missingFields=[...(!uid?["uid"]:[]),...(!sec?["sec_uid"]:[])];
    return {itemKey:`item:${index}`,kind:"douyin_account",data:{platform:"douyin",operationId:"P5CHB3BZ",provider:"agentkey",upstream:"TikHub",tool:route.tool,
      title:record.nickname??"抖音账号",identity:{...(uid?{uid}:{}),...(sec?{secUserId:sec}:{})},record,
      missing:missingFields,missingFields,importBlockers:uid||sec?[]:["lossless_account_id_required"]}};
  });
  return {candidates,summary:{count:candidates.length,query,missingFields:[],stopReason:"single-request"}};
}
function accountProjection(value:unknown){
  const user=object(value);
  if(!user||!["uid","sec_uid","nickname"].some(field=>Object.hasOwn(user,field)))throw new AgentKeyPayloadError("Unrecognized account user_info");
  const uid=stableId(user.uid),sec=stableId(user.sec_uid,true);
  if(!uid&&!sec&&typeof user.nickname!=="string")throw new AgentKeyPayloadError("Account has no recognizable identity or display name");
  return {...(uid?{uid}:{}),...(sec?{sec_uid:sec}:{}),...(typeof user.nickname==="string"?{nickname:user.nickname}:{}),
    ...(typeof user.signature==="string"?{signature:user.signature}:{}),
    ...(typeof user.follower_count==="number"&&Number.isSafeInteger(user.follower_count)&&user.follower_count>=0?{follower_count:user.follower_count}:{})};
}

function safeFields(value:Record<string,unknown>,strings:readonly string[],numbers:readonly string[]=[]):Record<string,unknown>{
  return Object.fromEntries([...strings.filter(k=>typeof value[k]==="string"),...numbers.filter(k=>typeof value[k]==="number"&&Number.isFinite(value[k]))].map(k=>[k,value[k]]));
}
/** Only the observed single-request forms are supported; upstream paging never schedules another call. */
function parseDouyinSnapshot(response:unknown,route:AgentKeyDouyinRoute,raw:unknown):ParsedAgentKeyDouyin{
  const query=agentKeyRouteInput(route,raw),envelope=object(object(response)?.envelope),payload=object(envelope?.data),body=object(payload?.data);
  if(envelope?.provider!=="TikHub"||payload?.code!==200||body?.status_code!==0)throw new AgentKeyPayloadError("Unrecognized Douyin snapshot success envelope");
  const common={platform:"douyin",provider:"agentkey",upstream:"TikHub",operationId:douyinOperationId(route),tool:route.tool};
  const summary:ParsedAgentKeyDouyin["summary"]={count:0,query,missingFields:[],snapshot:true,stopReason:"single-request"};
  if(route===douyinProfileRoute){
    const user=object(body.user);
    if(user?.user_deleted!==true||typeof user.nickname!=="string"||!stableId(user.uid))throw new AgentKeyPayloadError("Active or unknown account profile remains unverified");
    const special=object(user.special_state_info);
    return {candidates:[],summary:{...summary,accountState:"deleted",displayName:user.nickname,statusText:"账号已注销 / 删除；不可绑定来源",record:{uid:stableId(user.uid),nickname:user.nickname,user_deleted:true,
      ...safeFields(user,[],["total_favorited"]),...(special?{special_state_info:safeFields(special,["title","content"],["special_state"])}:{})}}};
  }
  const rows=route===douyinTrendingRoute?object(body.data)?.word_list:route===douyinTopicRoute?body.mix_list:route===douyinFollowingRoute?body.followings:body.comments;
  if(!Array.isArray(rows))throw new AgentKeyPayloadError("Missing recognized snapshot array");
  if(route===douyinFollowingRoute&&rows.length===0&&(!Number.isSafeInteger(body.max_time)||Number(body.max_time)<0))throw new AgentKeyPayloadError("Empty following bootstrap lacks safe max_time");
  const candidates=rows.map((value,index)=>{
    const item=object(value);if(!item)throw new AgentKeyPayloadError("Invalid snapshot item");
    const itemKey=`item:${index}`;
    if(route===douyinTopicRoute){
      const work=object(item.aweme_info);
      if(item.type!==1||!work)throw new AgentKeyPayloadError("Unknown topic mixed item; review received response");
      return projectAppWork(work,index,route,false);
    }
    if(route===douyinTrendingRoute){
      if(typeof item.word!=="string"||typeof item.sentence_id!=="string")throw new AgentKeyPayloadError("Invalid hotspot word identity");
      return {itemKey,kind:"hotspot_research",data:{...common,title:item.word,record:safeFields(item,["word","sentence_id"],["hot_value","word_type","label","view_count","discuss_video_count"])}};
    }
    if(route===douyinFollowingRoute){
      const record=accountProjection(item),uid=record.uid,sec=record.sec_uid;
      return {itemKey,kind:"social_followee",data:{...common,role:"followee",identityRole:"followee",title:record.nickname??"关注成员",identity:{...(uid?{uid}:{}),...(sec?{secUserId:sec}:{})},record:{...record,...safeFields(item,[],["following_count"])},requestedScope:query,missing:["仅用于关系研究，不提供材料导入和账号绑定"]}};
    }
    const reply=route===douyinRepliesRoute;
    if(route!==douyinCommentsRoute&&!reply)throw new AgentKeyPayloadError("Unsupported snapshot route");
    if(typeof item.cid!=="string"||!item.cid||typeof item.text!=="string"||item.aweme_id!==(reply?query.item_id:query.aweme_id)||(reply&&item.reply_id!==query.comment_id))throw new AgentKeyPayloadError("Comment identity or requested parent/work scope mismatch");
    const user=object(item.user),uid=stableId(user?.uid),sec=stableId(user?.sec_uid,true);
    const record={...safeFields(item,["cid","text","aweme_id","reply_id","reply_to_reply_id","reply_to_userid","reply_to_user_sec_id"],["create_time","digg_count","reply_comment_total","comment_reply_total"]),
      ...(user?{user:{...(uid?{uid}:{}),...(sec?{sec_uid:sec}:{}),...safeFields(user,["nickname"])}}:{})};
    return {itemKey,kind:"social_comment",data:{...common,role:reply?"comment-reply":"comment",identityRole:"comment-author",title:item.text,commentId:item.cid,identity:{...(uid?{uid}:{}),...(sec?{secUserId:sec}:{})},record,requestedScope:query,receivedScope:{aweme_id:item.aweme_id,...(reply?{reply_id:item.reply_id}:{})},timeUnits:{create_time:"unspecified"},missing:["仅用于评论研究，不提供材料导入和账号绑定"]}};
  });
  const paging=route===douyinFollowingRoute?{...safeFields(body,[],["max_time","min_time","total","offset"]),...(typeof body.has_more==="boolean"?{has_more:body.has_more}:{})}:safeFields(body,[],["cursor","has_more","total"]);
  return {candidates,summary:{...summary,count:candidates.length,pagination:paging,...(route===douyinFollowingRoute?{bootstrap:candidates.length===0}:{} )}};
}

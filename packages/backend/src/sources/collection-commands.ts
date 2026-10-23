import { UnsupportedReplacement } from "./x-replacement.ts";
import { createRedfoxMpCollection,createAgentKeyMpCollection } from "./mp-commands.ts";
import { sql } from "../db.ts";
import { createNativeCollection } from "./native-commands.ts";
import { createRedfoxCollection } from "./redfox-commands.ts";

export async function createCollection(sourceId:string,command:{actor:string;key:string;reason:"manual"|"schedule";force?:boolean}) {
  const [sub]=await sql`SELECT provider,platform FROM collection_subscriptions WHERE control_source_id=${sourceId}`;
  if(!sub)return createNativeCollection(sourceId,command);
  if(sub.provider==="redfox")return (sub.platform==="wechat"?createRedfoxMpCollection:createRedfoxCollection)(sourceId,command);
  if(sub.provider==="agentkey"&&sub.platform==="wechat")return createAgentKeyMpCollection(sourceId,command);
  if(sub.provider==="socialdata"||sub.provider==="dajiala")return createNativeCollection(sourceId,command);
  throw new UnsupportedReplacement(sub.provider==="agentkey"?"AgentKey source-backed collection is not implemented; use the Douyin platform subscription":"Unsupported collection provider");
}

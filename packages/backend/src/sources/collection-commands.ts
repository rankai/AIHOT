import { createRedfoxMpCollection } from "./mp-commands.ts";
import { sql } from "../db.ts";
import { createNativeCollection } from "./native-commands.ts";
import { createRedfoxCollection } from "./redfox-commands.ts";

export async function createCollection(sourceId:string,command:{actor:string;key:string;reason:"manual"|"schedule";force?:boolean}) {
  const [sub]=await sql`SELECT provider,platform FROM collection_subscriptions WHERE control_source_id=${sourceId}`;
  return sub?.provider==="redfox"?(sub.platform==="wechat"?createRedfoxMpCollection:createRedfoxCollection)(sourceId,command):createNativeCollection(sourceId,command);
}

import { sql } from "../db.ts";
import { z } from "zod";
import { preflightXReplacement,switchXCollection,UnsupportedReplacement } from "./x-replacement.ts";
import { preflightMpReplacement,switchMpCollection } from "./mp-replacement.ts";
export async function preflightCollection(sourceId:string,target:unknown,library?:unknown){
  const [source]=await sql`SELECT kind FROM sources WHERE id=${sourceId}`;if(!source)return null;
  if(source.kind==="mp_account")return preflightMpReplacement(sourceId,z.enum(["redfox","dajiala"]).parse(target),library);
  if(source.kind==="x_search")return preflightXReplacement(sourceId,z.enum(["redfox","socialdata"]).parse(target));
  throw new UnsupportedReplacement("This source kind has no collection replacement");
}
export async function switchCollection(sourceId:string,input:unknown,actor:string){
  const [source]=await sql`SELECT kind FROM sources WHERE id=${sourceId}`;if(!source)return null;
  if(source.kind==="mp_account")return switchMpCollection(sourceId,input,actor);
  if(source.kind==="x_search")return switchXCollection(sourceId,input,actor);
  throw new UnsupportedReplacement("This source kind has no collection replacement");
}

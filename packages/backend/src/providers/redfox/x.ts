import { z } from "zod";
import { redfoxRequest, RedfoxResponseError } from "./client.ts";
import type { PaidRequestOptions } from "../receipts.ts";
const Id = z.string().regex(/^\d+$/).max(30);
export const AccountInput = z.object({ screenName: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).optional(), restId: Id.optional() }).strict()
  .refine((x) => Number(!!x.screenName) + Number(!!x.restId) === 1, "Provide screenName or restId, exclusively");
export const XAccount = z.object({ userId: Id, username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/), displayName: z.string().optional(), avatar: z.string().optional() }).passthrough();
export type RedfoxAccount = z.infer<typeof XAccount>;
export async function xAccount(input: z.infer<typeof AccountInput>, window: string, options: PaidRequestOptions) {
  const receipt = await redfoxRequest("AKFHJMXQ", AccountInput.parse(input), window, "query", options);
  const parsed = XAccount.safeParse(receipt.data);
  if (!parsed.success) throw new RedfoxResponseError("Redfox account response has invalid fields");
  if (input.screenName && parsed.data.username.toLowerCase() !== input.screenName.toLowerCase()) throw new RedfoxResponseError("Redfox username does not match request");
  if (input.restId && parsed.data.userId !== input.restId) throw new RedfoxResponseError("Redfox account ID does not match request");
  return { ...receipt, account: parsed.data };
}

const Author=z.object({userId:Id,username:z.string().nullable().optional(),displayName:z.string().nullable().optional(),avatar:z.string().nullable().optional()}).passthrough();
const Tweet=z.object({tweetId:Id,author:Author,createdAt:z.string(),text:z.string().nullable().optional(),content:z.string().nullable().optional(),retweetedTweet:z.unknown().optional()}).passthrough();
const Timeline=z.object({user:Author,pinned:Tweet.nullable().optional(),timeline:z.array(Tweet).max(200),nextCursor:z.string().nullable()}).passthrough();
export type RedfoxTweet=z.infer<typeof Tweet>;
export type RedfoxTimeline=z.infer<typeof Timeline>;
export function parseTimeline(raw: unknown,restId:string):RedfoxTimeline {
  const parsed=Timeline.safeParse(raw);
  if(!parsed.success || parsed.data.user.userId!==restId)throw new RedfoxResponseError("Redfox timeline fields or account identity are invalid");
  return parsed.data;
}
export async function xTimeline(input:{restId:string;cursor?:string},window:string,options:PaidRequestOptions) {
  const receipt=await redfoxRequest("API_1790148502632",input,window,"collect",options);
  return {...receipt,page:parseTimeline(receipt.data,input.restId)};
}
export async function xDetail(tweetId:string,window:string,purpose:"query"|"collect",options:PaidRequestOptions) {
  const receipt=await redfoxRequest("QCP75W33",{tweetId:Id.parse(tweetId)},window,purpose,options);
  return {...receipt,tweet:parseTweet(receipt.data,tweetId)};
}

export function parseTweet(raw:unknown,tweetId:string):RedfoxTweet {
 const parsed=Tweet.safeParse(raw);
 if(!parsed.success||parsed.data.tweetId!==tweetId)throw new RedfoxResponseError("Redfox tweet detail identity or fields are invalid");
 return parsed.data;
}

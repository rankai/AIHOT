import { z } from "zod";
// Supplier abbreviations are display text, not exact counts (e.g. "97w+").
const metric = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite()), z.string().max(32).regex(/^\d+(?:\.\d+)?w\+$/i)]).nullable().optional();
export const metrics = { fans: metric, collectedCount: metric, useShareCount: metric, useCommentCount: metric, useLikeCount: metric, interactiveCount: metric };
const incrementMetric = z.union([metric, z.number().finite(), z.string().regex(/^-\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite())]);
// The supplier's increment names contain spelling errors; preserve their actual meaning and spelling.
export const increments = z.object({ addInteractiveount: incrementMetric, addCollectedCunt: incrementMetric, addShareCount: incrementMetric, addCommentCount: incrementMetric, addLikeCount: incrementMetric }).passthrough();
const rowSchema = z.object({ photoId: z.union([z.string(),z.number().int().safe()]).nullish(), userId: z.union([z.string(),z.number().int().safe()]).nullish(),
 title:z.string().nullish(),desc:z.string().nullish(),authorName:z.string().nullish(),userName:z.string().nullish(),coverUrl:z.string().nullish(),publicTime:z.string().nullish(),
 ...metrics,anaAdd:increments.nullish() }).passthrough();
export const responseSchema = z.object({ lowPowderExplosiveArticle:z.array(rowSchema).max(10000), likeTheTop500:z.array(rowSchema).max(10000), singleDayIncrements:z.array(rowSchema).max(10000), sevenDaysOfIncrements:z.array(rowSchema).max(10000) });

import { z } from "zod";
export const COVER_DELIVERY_CONTRACT="xhs-cover-delivery@1";
export const CoverPlanReference=z.object({artifactId:z.string().uuid(),version:z.number().int().positive(),schemeId:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/)}).strict();
export const CoverScheme=z.object({schemeId:z.string().max(200).optional(),name:z.string().trim().min(1).max(100),layout:z.string().trim().max(1500).default(""),palette:z.string().trim().max(600).default(""),prompt:z.string().trim().min(1).max(4000),aspectRatio:z.string().max(40).optional(),sourceIds:z.array(z.string().min(1).max(200)).max(20).default([])}).strict();
export const SaveCoverPlan=z.object({activationId:z.string().uuid(),artifactId:z.string().uuid().optional(),baseVersion:z.number().int().nonnegative().default(0),title:z.string().trim().min(1).max(300),summary:z.string().trim().min(1).max(2000),schemes:z.array(CoverScheme).length(3),next:z.string().max(40).optional()}).strict();
export const CoverChoice=z.discriminatedUnion("action",[z.object({artifactId:z.string().uuid(),version:z.number().int().positive(),action:z.literal("keep-plans")}).strict(),CoverPlanReference.extend({action:z.literal("generate")}).strict()]);

import { z } from 'zod';
export const WORD_CHECK_OPERATION='API_1791881343238';
export const WORD_CHECK_DELIVERY='xhs-word-check@1';
export const WordSource=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('message'),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict(),
 z.object({kind:z.literal('input'),inputId:z.string().uuid()}).strict(),
 z.object({kind:z.literal('artifact'),artifactId:z.string().uuid(),version:z.number().int().positive()}).strict(),
]);
const Batch=z.object({index:z.number().int().min(0).max(5),start:z.number().int().nonnegative(),coreStart:z.number().int().nonnegative(),end:z.number().int().positive(),hash:z.string().length(64)}).strict();
export const WordCheckScope=z.object({version:z.literal(1),source:WordSource,textHash:z.string().length(64),characters:z.number().int().min(1).max(10000),label:z.string().max(300),batches:z.array(Batch).min(1).max(6)}).strict();
export const CheckWords=z.object({activationId:z.string().uuid(),batch:z.number().int().min(0).max(5)}).strict();
export const SaveWordCheck=z.object({activationId:z.string().uuid(),title:z.string().trim().min(1).max(300),suggestions:z.array(z.object({hitId:z.string().max(100),replacement:z.string().max(1000),reason:z.string().trim().min(1).max(1000)}).strict()).max(200)}).strict();

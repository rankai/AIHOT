import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {actorOf} from '@aihot/backend/admin/auth';
import {saveResultAttachment,listResultAttachments,useOperationResult} from '@aihot/backend/operations/result-attachments';
import {AssetError} from '@aihot/backend/operations/assets';
import {sendProblem} from '../http/respond.ts';
import {adminHandler} from './admin-auth.ts';
const id=(params:unknown)=>z.object({id:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).parse(params).id;
async function assetCommand<T>(req:Parameters<typeof sendProblem>[0],reply:Parameters<typeof sendProblem>[1],run:()=>Promise<T>){try{return await run();}catch(error){if(error instanceof AssetError)return sendProblem(req,reply,{status:error.statusCode,code:error.statusCode===409?'conflict':'invalid_request',detail:error.message});throw error;}}
export function registerAdminOperationResults(app:FastifyInstance){
 app.post('/api/admin/operations/results/:id/save-attachment',adminHandler(async(req,reply,admin)=>assetCommand(req,reply,async()=>reply.code(201).send(await saveResultAttachment(id(req.params),req.body,actorOf(admin),req.headers['idempotency-key'])))));
 app.post('/api/admin/operations/results/:id/use',adminHandler(async(req,reply,admin)=>assetCommand(req,reply,()=>useOperationResult(id(req.params),req.body,actorOf(admin),req.headers['idempotency-key']))));
 app.get('/api/admin/operations/results/:id/attachments',adminHandler(async(req,reply)=>assetCommand(req,reply,async()=>({items:await listResultAttachments(id(req.params))}))));
}

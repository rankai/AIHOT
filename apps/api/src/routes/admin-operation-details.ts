import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resultDetailOptions } from '@aihot/backend/providers/redfox/account-detail-options';
import { adminHandler } from './admin-auth.ts';
import { sendProblem } from '../http/respond.ts';

export function registerAdminOperationDetails(app: FastifyInstance) {
  app.get('/api/admin/operations/results/:id/detail-options', adminHandler(async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().safe().positive() }).parse(req.params);
    const result = await resultDetailOptions(id);
    return result ?? sendProblem(req, reply, { status: 404, code: 'not_found', detail: 'Not found.' });
  }));
}

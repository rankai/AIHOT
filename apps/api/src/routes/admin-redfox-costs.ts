import type { FastifyInstance } from 'fastify';
import { RedfoxCostsQuery, redfoxCosts } from '@aihot/backend/admin/redfox-costs';
import { adminHandler } from './admin-auth.ts';
import { costReadProblem } from './admin-costs.ts';

export function registerAdminRedfoxCosts(app: FastifyInstance) {
  app.get('/api/admin/redfox/costs', adminHandler(async (req, reply) => {
    try {
      // Keep the query schema's string input intact; the backend validates the same boundary.
      RedfoxCostsQuery.parse(req.query);
      return await redfoxCosts(req.query as { start: string; end: string; billRunId?: string });
    } catch (error) {
      return costReadProblem(error, req, reply);
    }
  }));
}

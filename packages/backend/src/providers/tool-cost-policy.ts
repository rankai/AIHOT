/** Shared approved non-video generation specs, independent of retail prices and budgets. */
export function knownNonVideoCost(kind: string, parameters: Record<string, unknown>): boolean {
 if (kind === 'xhs-comments') return false;
 if (kind === 'images') return (parameters.model ?? 'gptImage2') === 'gptImage2' && parameters.resolution === '1k' && parameters.n === 1;
 return true;
}
export class UnverifiedToolCostError extends Error {
 readonly code = 'cost_unverified';
 readonly statusCode = 409;
 constructor() { super('该工具规格的供应商成本尚未核定，暂不开放新提交；已有任务仍可查询与恢复'); }
}
export function assertKnownNonVideoCost(kind: string, parameters: Record<string, unknown>): void {
 if (!knownNonVideoCost(kind,parameters)) throw new UnverifiedToolCostError();
}
export const isAdminToolActor = (actor: string) => /^(admin|dev):.+$/.test(actor);

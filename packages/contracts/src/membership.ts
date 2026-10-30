import type { ToolPrice } from './credits.ts';
export interface MembershipPlan { id: 'basic' | 'creator' | 'studio'; name: string; amountFen: number; credits: number }
export interface MembershipPayment { id: string; planId: MembershipPlan['id']; amountFen: number; credits: number; receiptReference?: string; reason?: string; periodStart: string; periodEnd: string; createdAt: string }
export interface MembershipPage {
 plans: MembershipPlan[];
 membership: { planId: MembershipPlan['id']; startsAt: string; expiresAt: string; status: 'active' | 'expired' } | null;
 payments: MembershipPayment[];
}
export interface MemberPriceOffer { kind: string; provider: string; model: string; tier: string; label: string; credits: number; unit: string; restriction: string; costBasis?: string; prices?: ToolPrice[] }
export interface MemberPriceCatalog { version: string; offers: MemberPriceOffer[]; unavailable: string[] }

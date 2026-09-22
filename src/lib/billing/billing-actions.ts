import { isBlockedFromNewCheckout } from "./duplicate-subscription-guard.ts";
import type { WorkspaceSubscription } from "../../types/billing.ts";

/**
 * Billing-action visibility is a DIFFERENT concept from product
 * entitlement (see entitlements.ts's WorkspaceEntitlements/isEntitledToPro)
 * — a paused or canceled workspace is Free for product-feature purposes,
 * but may still have a real Paddle billing relationship worth showing:
 * invoices, payment history, a resumable subscription (paused), or the
 * ability to subscribe again (canceled). Product entitlement answers "can
 * this workspace use Pro features"; this answers "which billing buttons
 * should App Home show."
 */
export interface BillingActions {
  canUpgrade: boolean;
  canManageBilling: boolean;
}

/**
 * canUpgrade is deliberately defined as the exact negation of
 * isBlockedFromNewCheckout — the same rule /billing/checkout itself
 * enforces — so this can never drift out of sync with what a checkout
 * attempt would actually do. canManageBilling is true whenever any
 * subscription row exists at all, regardless of status: even a canceled
 * subscription has real billing history worth surfacing via the Paddle
 * Customer Portal, and Paddle's own portal explicitly keeps canceled
 * subscriptions visible for exactly this reason.
 */
export function getBillingActions(subscription: WorkspaceSubscription | null): BillingActions {
  return {
    canUpgrade: !isBlockedFromNewCheckout(subscription),
    canManageBilling: subscription !== null,
  };
}

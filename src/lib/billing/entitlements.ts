import type { WorkspaceEntitlements, WorkspacePlan, WorkspaceSubscription } from "@/types/billing";

const PRO_ENTITLED_STATUSES = new Set<WorkspaceSubscription["status"]>(["active", "trialing", "past_due"]);

/**
 * Pure predicate mirroring the DB-level defense-in-depth check added to
 * `configure_approval_policy` (see
 * supabase/migrations/20260918020000_add_billing_entitlements.sql) — kept
 * in its own module, with no `server-only`/database dependency, so it's
 * directly unit testable (same pattern as isBotAdminCandidate.ts).
 *
 * Never inspects `scheduled_change_effective_at`: Paddle keeps `status`
 * itself accurate through a scheduled cancellation (it stays 'active'
 * until the actual period boundary), so a subscription with a scheduled-
 * but-not-yet-effective cancellation is still entitled.
 */
export function isEntitledToPro(subscription: WorkspaceSubscription | null): boolean {
  if (!subscription) {
    return false;
  }
  return subscription.plan === "PRO" && PRO_ENTITLED_STATUSES.has(subscription.status);
}

/**
 * Pure FREE/PRO capability mapping. Every capability maps 1:1 to Pro
 * entitlement today — there is no intermediate tier — and deliberately
 * carries no request-limit/quota fields (see WorkspaceEntitlements).
 */
export function computeWorkspaceCapabilities(entitledToPro: boolean): WorkspaceEntitlements {
  const plan: WorkspacePlan = entitledToPro ? "PRO" : "FREE";
  return {
    plan,
    canManageApprovalPolicies: entitledToPro,
    canUsePolicyRouting: entitledToPro,
    canUseMultiApproverPolicies: entitledToPro,
    canUseApprovalThresholds: entitledToPro,
  };
}

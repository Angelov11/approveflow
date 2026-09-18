export type WorkspaceSubscriptionPlan = "PRO";

export type WorkspaceSubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled";

/**
 * Row shape of the `workspace_subscriptions` table (see supabase/migrations,
 * M10.1). Absence of a row means the workspace is on Free — there is no
 * explicit FREE row. See the migration for why each nullable column is
 * nullable (fields no entitlement logic reads, or that Paddle can
 * legitimately omit for a given subscription state).
 */
export interface WorkspaceSubscription {
  id: string;
  workspace_id: string;
  provider: string;
  provider_customer_id: string;
  provider_subscription_id: string;
  provider_price_id: string | null;
  plan: WorkspaceSubscriptionPlan;
  status: WorkspaceSubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  scheduled_change_action: string | null;
  scheduled_change_effective_at: string | null;
  last_event_occurred_at: string;
  created_at: string;
  updated_at: string;
}

export type WorkspacePlan = "FREE" | "PRO";

/**
 * Capability model for a workspace's current plan. Deliberately no
 * request-limit/quota fields — Free is technically unmetered today, but
 * that is not a guaranteed entitlement and must never be advertised or
 * relied on as "unlimited" (see the M10 design notes); quotas are a
 * separate, not-yet-designed concern.
 */
export interface WorkspaceEntitlements {
  plan: WorkspacePlan;
  canManageApprovalPolicies: boolean;
  canUsePolicyRouting: boolean;
  canUseMultiApproverPolicies: boolean;
  canUseApprovalThresholds: boolean;
}

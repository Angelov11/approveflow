import "server-only";

import { getBillingActions, type BillingActions } from "./billing-actions.ts";
import { computeWorkspaceCapabilities, isEntitledToPro } from "./entitlements.ts";
import { findWorkspaceSubscription } from "./workspace-subscriptions.ts";
import { getSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceEntitlements } from "../../types/billing.ts";

export interface WorkspaceBillingState {
  entitlements: WorkspaceEntitlements;
  billingActions: BillingActions;
  /** POST-M11-B2 (corrected): null when no owner is recorded (legacy row, or never validated) — callers must treat null as "NO admin may manage" (fail-closed), the same predicate handleManageBilling enforces server-side. There is no "any admin" fallback. */
  billingOwnerUserId: string | null;
  /** POST-M11-B2: the owner's Slack user id, for "Managed by <@X>" display only — null whenever billingOwnerUserId is null. */
  billingOwnerSlackUserId: string | null;
}

/**
 * The single, centralized resolver — the one place application code
 * should call to find out both what a workspace can currently do
 * (product entitlement) and which billing actions it should be offered
 * (billing relationship state). One DB read; two deliberately distinct
 * results — see billing-actions.ts for why these aren't the same
 * concept. Combines that read with the pure isEntitledToPro/
 * computeWorkspaceCapabilities/getBillingActions predicates, the same
 * "DB read wrapper around a pure decision" split used by
 * isWorkspaceAdmin() and friends.
 */
export async function getWorkspaceBillingState(workspaceId: string): Promise<WorkspaceBillingState> {
  const subscription = await findWorkspaceSubscription(workspaceId);
  const billingOwnerUserId = subscription?.billing_owner_user_id ?? null;

  let billingOwnerSlackUserId: string | null = null;
  if (billingOwnerUserId) {
    const supabase = getSupabaseAdmin();
    const { data: owner } = await supabase.from("users").select("slack_user_id").eq("id", billingOwnerUserId).maybeSingle();
    billingOwnerSlackUserId = owner?.slack_user_id ?? null;
  }

  return {
    entitlements: computeWorkspaceCapabilities(isEntitledToPro(subscription)),
    billingActions: getBillingActions(subscription),
    billingOwnerUserId,
    billingOwnerSlackUserId,
  };
}

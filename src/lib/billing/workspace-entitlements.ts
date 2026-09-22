import "server-only";

import { getBillingActions, type BillingActions } from "./billing-actions.ts";
import { computeWorkspaceCapabilities, isEntitledToPro } from "./entitlements.ts";
import { findWorkspaceSubscription } from "./workspace-subscriptions.ts";
import type { WorkspaceEntitlements } from "../../types/billing.ts";

export interface WorkspaceBillingState {
  entitlements: WorkspaceEntitlements;
  billingActions: BillingActions;
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
  return {
    entitlements: computeWorkspaceCapabilities(isEntitledToPro(subscription)),
    billingActions: getBillingActions(subscription),
  };
}

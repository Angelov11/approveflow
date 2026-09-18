import "server-only";

import { computeWorkspaceCapabilities, isEntitledToPro } from "@/lib/billing/entitlements";
import { findWorkspaceSubscription } from "@/lib/billing/workspace-subscriptions";
import type { WorkspaceEntitlements } from "@/types/billing";

/**
 * The single, centralized entitlement resolver — the one place application
 * code should call to find out what a workspace can currently do. Combines
 * a fresh DB read with the pure isEntitledToPro/computeWorkspaceCapabilities
 * predicates in entitlements.ts, the same "DB read wrapper around a pure
 * decision" split used by isWorkspaceAdmin() and friends.
 */
export async function getWorkspaceEntitlements(workspaceId: string): Promise<WorkspaceEntitlements> {
  const subscription = await findWorkspaceSubscription(workspaceId);
  return computeWorkspaceCapabilities(isEntitledToPro(subscription));
}

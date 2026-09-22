import "server-only";

import { computeEffectivePolicy } from "./compute-effective-policy.ts";
import { findActivePolicyForRequestType, type ActivePolicy } from "./approval-policies.ts";
import { computeWorkspaceCapabilities, isEntitledToPro } from "../billing/entitlements.ts";
import { findWorkspaceSubscription } from "../billing/workspace-subscriptions.ts";

/**
 * THE single server-side place that resolves whether a request type's
 * configured active policy is currently EFFECTIVE for new request routing.
 * Every caller that used to ask "is there an active policy for this type"
 * and treat the answer as routing truth (the create-request submission
 * path, the request-type-changed modal rebuild) now asks this instead —
 * same return shape (ActivePolicy | null) as the function it replaces, so
 * callers need no other change.
 *
 * Combines a configured-policy lookup with a fresh entitlement check via
 * the existing billing capability model (see compute-effective-policy.ts
 * for the actual decision) — never scatters `subscription.status`
 * comparisons here or in any caller.
 */
export async function resolveEffectivePolicy(workspaceId: string, requestTypeId: string): Promise<ActivePolicy | null> {
  const [configuredPolicy, subscription] = await Promise.all([
    findActivePolicyForRequestType(workspaceId, requestTypeId),
    findWorkspaceSubscription(workspaceId),
  ]);
  const { canUsePolicyRouting } = computeWorkspaceCapabilities(isEntitledToPro(subscription));
  return computeEffectivePolicy(configuredPolicy, canUsePolicyRouting);
}

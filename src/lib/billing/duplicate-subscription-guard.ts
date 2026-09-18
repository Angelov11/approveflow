import type { WorkspaceSubscription } from "../../types/billing.ts";

/**
 * Blocks a NEW Paddle checkout whenever the workspace already has a
 * billing relationship that should be managed rather than replaced (the
 * M10 design-review correction: a duplicate paid subscription is never
 * "just a support problem"). Deliberately broader than isEntitledToPro's
 * active/trialing/past_due set: `paused` is also blocked here, since a
 * paused subscription still exists in Paddle pointing at the same
 * customer — the correct action is to resume/manage it, not create a
 * second one. `canceled` is NOT blocked: Paddle subscriptions can never be
 * reinstated once canceled (confirmed in the M10 audit against official
 * Paddle docs), so a brand new checkout is the only legitimate path
 * forward for a workspace that previously canceled.
 *
 * There is no Customer Portal / Manage Billing UI yet (deferred to a
 * later milestone) — every caller shows the same placeholder message for
 * every blocked case; this function only decides whether checkout should
 * proceed, and must be called independently on both the Slack-side
 * Upgrade action and the checkout page itself (never trust one check to
 * cover the other).
 */
export function isBlockedFromNewCheckout(subscription: WorkspaceSubscription | null): boolean {
  if (!subscription) {
    return false;
  }
  return subscription.status === "active" || subscription.status === "trialing" || subscription.status === "past_due" || subscription.status === "paused";
}

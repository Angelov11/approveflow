/**
 * POST-M11-B1: Paddle's Customer Portal session response includes a
 * `urls.subscriptions` array with one entry PER subscription id the
 * session was scoped to create (we always scope to exactly one — see
 * create-customer-portal-session.ts). Each entry carries its own `id`,
 * which must be matched exactly against the subscription we actually
 * asked about — never assumed to be array position `[0]`. This matters
 * specifically because a single Paddle Sandbox customer can legitimately
 * own more than one ApproveGo workspace's subscription (confirmed during
 * M11.5), so trusting array order rather than the id field would risk
 * silently returning another workspace's management URLs.
 *
 * Fails closed: returns null (never partial/guessed data) if no entry
 * matches, or if the matching entry is missing either required URL.
 * Callers must never fall back to `urls.general.overview` — that's
 * exactly the ambiguous, customer-level page this exists to avoid.
 */
export interface SubscriptionManagementUrls {
  updatePaymentMethod: string;
  cancelSubscription: string;
}

export interface PortalSubscriptionUrlEntry {
  id: string;
  cancelSubscription: string;
  updateSubscriptionPaymentMethod: string;
}

export function selectSubscriptionManagementUrls(
  subscriptionUrls: readonly PortalSubscriptionUrlEntry[],
  targetSubscriptionId: string,
): SubscriptionManagementUrls | null {
  const match = subscriptionUrls.find((entry) => entry.id === targetSubscriptionId);
  if (!match || !match.cancelSubscription || !match.updateSubscriptionPaymentMethod) {
    return null;
  }
  return { updatePaymentMethod: match.updateSubscriptionPaymentMethod, cancelSubscription: match.cancelSubscription };
}

import "server-only";

import { getPaddleClient } from "./paddle-client.ts";
import { resolveSubscriptionManagementUrls } from "./resolve-subscription-management-urls.ts";
import type { SubscriptionManagementUrls } from "./select-subscription-management-urls.ts";

export type { SubscriptionManagementUrls };

/**
 * Creates a Paddle Customer Portal session scoped to exactly this
 * subscription id, and returns its two subscription-specific action URLs
 * (cancel, update payment method) — never `urls.general.overview`, the
 * ambiguous all-subscriptions page for this Paddle customer. A single
 * Sandbox customer can legitimately own more than one ApproveGo
 * workspace's subscription (confirmed during M11.5, where this ambiguity
 * caused the wrong subscription to be selected during a real
 * cancellation attempt) — the general page has no way to tell them apart,
 * so it must never be used as a fallback.
 *
 * Returns null (fails closed) if Paddle doesn't return a matching,
 * fully-populated entry for this exact subscription id — callers must
 * show a controlled error, never fall back to another subscription's URL
 * or the general overview page.
 *
 * All the actual logic (argument construction, exact-id selection,
 * fail-closed behavior) lives in resolve-subscription-management-urls.ts /
 * select-subscription-management-urls.ts, both directly unit tested. This
 * file stays a thin, untested wrapper purely because it's the only piece
 * that touches `server-only`/the real Paddle client, matching every other
 * DB/API-touching wrapper in this codebase.
 */
export async function createSubscriptionManagementUrls(customerId: string, subscriptionId: string): Promise<SubscriptionManagementUrls | null> {
  return resolveSubscriptionManagementUrls(customerId, subscriptionId, (cid, ids) => getPaddleClient().customerPortalSessions.create(cid, ids));
}

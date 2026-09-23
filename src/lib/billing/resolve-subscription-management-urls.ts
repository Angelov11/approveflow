import { selectSubscriptionManagementUrls, type PortalSubscriptionUrlEntry, type SubscriptionManagementUrls } from "./select-subscription-management-urls.ts";

export interface PortalSessionResult {
  urls: { subscriptions: PortalSubscriptionUrlEntry[] };
}

/**
 * The orchestration step of createSubscriptionManagementUrls, split into
 * its own file with no `server-only`/Paddle-client import so it can be
 * unit tested directly — this codebase's test runner (plain `node --test`,
 * no path-alias resolution) can't load any file that transitively reaches
 * `server-only` or an `@/...` import, which is exactly why DB/API-touching
 * wrapper files here never carry their own test file. `createPortalSession`
 * is required (not defaulted) here specifically so tests can assert the
 * exact arguments passed to it, without a mocking framework.
 */
export async function resolveSubscriptionManagementUrls(
  customerId: string,
  subscriptionId: string,
  createPortalSession: (customerId: string, subscriptionIds: string[]) => Promise<PortalSessionResult>,
): Promise<SubscriptionManagementUrls | null> {
  const session = await createPortalSession(customerId, [subscriptionId]);
  return selectSubscriptionManagementUrls(session.urls.subscriptions, subscriptionId);
}

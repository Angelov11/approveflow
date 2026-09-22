import "server-only";

import { getPaddleClient } from "./paddle-client.ts";

/**
 * Creates a Paddle Customer Portal session and returns the general
 * overview URL — a secure, Paddle-hosted page where the customer can view
 * invoices, update their payment method, and cancel their subscription
 * themselves, with no custom billing UI needed on our side. Sessions are
 * single-use and short-lived and must never be cached — callers should
 * redirect immediately, not store this URL.
 */
export async function createCustomerPortalSession(customerId: string, subscriptionId: string): Promise<string> {
  const paddle = getPaddleClient();
  const session = await paddle.customerPortalSessions.create(customerId, [subscriptionId]);
  return session.urls.general.overview;
}

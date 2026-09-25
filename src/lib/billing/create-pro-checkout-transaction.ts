import "server-only";

import { serverEnv } from "../env.server.ts";
import { getPaddleClient } from "./paddle-client.ts";

/**
 * Creates a Paddle Transaction for ApproveGo Pro, server-side, using the
 * secret PADDLE_API_KEY. The browser never supplies price, quantity,
 * workspace identity, or the initiating admin's identity — all four are
 * set here, authoritatively, from server-only configuration and the
 * verified billing-session token the checkout route already resolved.
 * The browser is handed back only the resulting transaction id (see
 * /billing/checkout/page.tsx), never anything from this function's inputs.
 *
 * Quantity is always 1 — this app sells one Pro subscription per
 * workspace, never per-seat (the Sandbox price itself also enforces this
 * with quantity.minimum = quantity.maximum = 1, so a tampered client
 * couldn't request more even if it tried to).
 *
 * Idempotency: Paddle's transaction-create API has no documented
 * idempotency key/header (confirmed against the current API reference —
 * there is no such parameter on this endpoint). No dedicated handling is
 * needed regardless: an unpaid `draft`/`ready` transaction has no
 * real-world effect (no money moves, no subscription is created) until a
 * customer actually completes payment on it, and Paddle's own hosted
 * checkout already creates a fresh draft transaction on every open by
 * design. A checkout-page refresh simply creates another harmless,
 * unpaid transaction — deliberately not solved with a database
 * checkout-session table, which would be complexity with no concrete
 * safety benefit here.
 */
export async function createProCheckoutTransaction(workspaceId: string, initiatingUserId: string): Promise<string> {
  const priceId = serverEnv.PADDLE_PRO_PRICE_ID;
  if (!priceId) {
    throw new Error("PADDLE_PRO_PRICE_ID is not set");
  }

  const paddle = getPaddleClient();
  const transaction = await paddle.transactions.create({
    items: [{ priceId, quantity: 1 }],
    // POST-M11-B2: initiating_user_id carries the server-authorized
    // acting admin's internal id (never client-supplied — see
    // /billing/checkout/page.tsx and billing-session-token.ts) through
    // to the resulting subscription.created webhook, which is the ONLY
    // place billing ownership is ever established. Starting or
    // abandoning this checkout establishes nothing by itself.
    customData: { workspace_id: workspaceId, initiating_user_id: initiatingUserId },
  });
  return transaction.id;
}

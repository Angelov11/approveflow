import { serverEnv } from "@/lib/env.server";
import { normalizePaddleSubscriptionEvent } from "@/lib/billing/paddle-webhook-normalization";
import { processPaddleSubscriptionEvent } from "@/lib/billing/process-paddle-subscription-event";
import { verifyAndParsePaddleWebhook } from "@/lib/billing/paddle-webhook-signature";

/**
 * Public by necessity — this is Paddle's delivery endpoint, not a Slack or
 * ApproveGo-session-authenticated route. Trust comes exclusively from the
 * Paddle webhook signature (see paddle-webhook-signature.ts); there is no
 * Slack auth, no browser session, no ApproveGo login on this path.
 *
 * HTTP status choices below are deliberate, not incidental — see the
 * M10.3 design report for the full reasoning:
 *   - Every outcome process_paddle_subscription_event can return
 *     (including every ignored_, conflict_, and stale_ case) represents a
 *     PERMANENT decision about a well-formed, already-verified event —
 *     retrying changes nothing, so all of them map to 200.
 *   - Only a genuine processing failure (network/DB error, or the RPC's
 *     own programmer-error validation) is retryable, so that's the only
 *     path that returns 5xx.
 *   - Signature/parse failures (missing header, empty body, unmarshal
 *     throwing) are NOT split into "signature invalid" vs "malformed" —
 *     the SDK's unmarshal() throws indistinguishably for a tampered
 *     request, a wrong/rotated secret, an expired timestamp, and a
 *     malformed payload, so artificially splitting them would be
 *     illusory. One bucket, 400, matching the official Paddle skill's own
 *     guidance.
 *
 * Never logs the raw body, the webhook secret, or any customer/payment
 * data — only event type/id and the resulting outcome.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("paddle-signature");

  if (!rawBody || !signature) {
    return Response.json({ error: "Missing signature or body" }, { status: 400 });
  }

  const webhookSecret = serverEnv.PADDLE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Paddle webhook received but PADDLE_WEBHOOK_SECRET is not configured.");
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  let event;
  try {
    // Never parse/trust anything from rawBody before this succeeds.
    event = await verifyAndParsePaddleWebhook(rawBody, webhookSecret, signature);
  } catch (error) {
    console.error("Paddle webhook signature verification failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const normalized = normalizePaddleSubscriptionEvent(event);
  if (!normalized) {
    // An event type this destination shouldn't even send (or one we
    // deliberately don't act on) — no-op, never touches the DB.
    return Response.json({ received: true, eventType: event.eventType, outcome: "unhandled_event_type" });
  }

  const expectedPriceId = serverEnv.PADDLE_PRO_PRICE_ID;
  if (!expectedPriceId) {
    console.error("Paddle webhook received but PADDLE_PRO_PRICE_ID is not configured.");
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  try {
    const outcome = await processPaddleSubscriptionEvent(normalized, expectedPriceId);
    return Response.json({ received: true, eventType: event.eventType, eventId: event.eventId, outcome });
  } catch (error) {
    console.error("Paddle webhook processing failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

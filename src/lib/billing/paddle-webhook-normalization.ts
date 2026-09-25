import { EventName, type EventEntity, type SubscriptionCreatedEvent, type SubscriptionUpdatedEvent, type SubscriptionCanceledEvent } from "@paddle/paddle-node-sdk";

/**
 * Only these three carry the information process_paddle_subscription_event
 * needs, and every one of them carries FULL current subscription state
 * (never a partial diff) — confirmed from the SDK's own types, all three
 * share the same SubscriptionNotification/SubscriptionCreatedNotification
 * shape. The other subscription.* events Paddle can emit (activated,
 * past_due, paused, resumed, trialing, imported) are redundant companions
 * to subscription.updated, which already fires on every one of those
 * transitions — deliberately not subscribed to on the notification
 * destination, so they are never expected here regardless.
 */
type SupportedSubscriptionEvent = SubscriptionCreatedEvent | SubscriptionUpdatedEvent | SubscriptionCanceledEvent;

function isSupportedSubscriptionEvent(event: EventEntity): event is SupportedSubscriptionEvent {
  return event.eventType === EventName.SubscriptionCreated || event.eventType === EventName.SubscriptionUpdated || event.eventType === EventName.SubscriptionCanceled;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Never infers workspace identity from anything else (customer email,
 * customer name, price, browser state) — only this. Pure, no DB.
 */
export function parseWorkspaceIdFromCustomData(customData: unknown): string | null {
  if (!customData || typeof customData !== "object") {
    return null;
  }
  const value = (customData as Record<string, unknown>).workspace_id;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/**
 * POST-M11-B2: mirrors parseWorkspaceIdFromCustomData exactly — same
 * shape/UUID validation, same "never infer from anything else" rule.
 * This value alone does NOT establish billing ownership: the RPC still
 * independently validates that it resolves to a real user belonging to
 * the exact target workspace before ever writing it (never trust
 * custom_data as authorization by itself, even though it can only ever
 * have been set by our own server code — see create-pro-checkout-transaction.ts).
 */
export function parseInitiatingUserIdFromCustomData(customData: unknown): string | null {
  if (!customData || typeof customData !== "object") {
    return null;
  }
  const value = (customData as Record<string, unknown>).initiating_user_id;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export interface NormalizedSubscriptionEvent {
  providerEventId: string;
  eventType: EventName.SubscriptionCreated | EventName.SubscriptionUpdated | EventName.SubscriptionCanceled;
  occurredAt: string;
  /** null when custom_data.workspace_id is missing/malformed — never guessed. */
  workspaceId: string | null;
  /** POST-M11-B2: null when custom_data.initiating_user_id is missing/malformed — never guessed, and NOT itself proof of ownership (the RPC re-validates workspace membership before ever writing it). */
  initiatingUserId: string | null;
  providerSubscriptionId: string;
  providerCustomerId: string;
  /** null unless the subscription has EXACTLY ONE item — see below. */
  providerPriceId: string | null;
  /** null unless the subscription has EXACTLY ONE item — see below. */
  quantity: number | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  scheduledChangeAction: string | null;
  scheduledChangeEffectiveAt: string | null;
}

/**
 * Returns null for any event type this app doesn't act on — the caller
 * treats that as a 200/no-op, never touching the DB (matches the official
 * skill's own guidance: "subscribed to events you don't handle yet? No-op,
 * better than throwing").
 *
 * Deliberately does NOT read items[0] blindly. A subscription must have
 * EXACTLY ONE item to be normalized as "the configured Pro plan" at all —
 * zero items or more than one both normalize providerPriceId/quantity to
 * null, which process_paddle_subscription_event's price check rejects as
 * ignored_wrong_price without any special-casing. This is the one place
 * a naive "take the first item" reading could otherwise accidentally
 * grant entitlement to a subscription that isn't purely our configured
 * Pro plan.
 */
export function normalizePaddleSubscriptionEvent(event: EventEntity): NormalizedSubscriptionEvent | null {
  if (!isSupportedSubscriptionEvent(event)) {
    return null;
  }

  const subscription = event.data;
  const singleItem = subscription.items.length === 1 ? subscription.items[0] : null;

  return {
    providerEventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    workspaceId: parseWorkspaceIdFromCustomData(subscription.customData),
    initiatingUserId: parseInitiatingUserIdFromCustomData(subscription.customData),
    providerSubscriptionId: subscription.id,
    providerCustomerId: subscription.customerId,
    providerPriceId: singleItem?.price?.id ?? null,
    quantity: singleItem?.quantity ?? null,
    status: subscription.status,
    currentPeriodStart: subscription.currentBillingPeriod?.startsAt ?? null,
    currentPeriodEnd: subscription.currentBillingPeriod?.endsAt ?? null,
    scheduledChangeAction: subscription.scheduledChange?.action ?? null,
    scheduledChangeEffectiveAt: subscription.scheduledChange?.effectiveAt ?? null,
  };
}

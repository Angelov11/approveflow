import assert from "node:assert/strict";
import test from "node:test";

import { normalizePaddleSubscriptionEvent, parseInitiatingUserIdFromCustomData, parseWorkspaceIdFromCustomData } from "./paddle-webhook-normalization.ts";
import { Webhooks, EventName } from "@paddle/paddle-node-sdk";
import type { EventEntity } from "@paddle/paddle-node-sdk";

const WORKSPACE_ID = "c94923d9-cc5b-451c-bffe-8501a36a4eeb";
const USER_ID = "354da2b6-a0d3-4eaa-9084-ebc3e11c16b3";

function buildEvent(overrides: {
  eventType?: string;
  status?: string;
  items?: unknown[];
  customData?: unknown;
  scheduledChange?: unknown;
  currentBillingPeriod?: unknown;
}): EventEntity {
  const raw = {
    event_id: "evt_1",
    notification_id: "ntf_1",
    event_type: overrides.eventType ?? EventName.SubscriptionCreated,
    occurred_at: "2026-09-19T00:00:00.000000Z",
    data: {
      id: "sub_1",
      status: overrides.status ?? "active",
      transaction_id: "txn_1",
      customer_id: "ctm_1",
      address_id: "add_1",
      currency_code: "USD",
      created_at: "2026-09-19T00:00:00.000000Z",
      updated_at: "2026-09-19T00:00:00.000000Z",
      collection_mode: "automatic",
      billing_cycle: { interval: "month", frequency: 1 },
      items: overrides.items ?? [{ status: "active", quantity: 1, recurring: true, created_at: "x", updated_at: "x", price: { id: "pri_pro" } }],
      custom_data: overrides.customData === undefined ? { workspace_id: WORKSPACE_ID } : overrides.customData,
      scheduled_change: overrides.scheduledChange === undefined ? null : overrides.scheduledChange,
      current_billing_period:
        overrides.currentBillingPeriod === undefined
          ? { starts_at: "2026-09-19T00:00:00.000000Z", ends_at: "2026-10-19T00:00:00.000000Z" }
          : overrides.currentBillingPeriod,
    },
  };
  return Webhooks.fromJson(raw as never);
}

// --- parseWorkspaceIdFromCustomData ---

test("parses a well-formed workspace_id", () => {
  assert.equal(parseWorkspaceIdFromCustomData({ workspace_id: WORKSPACE_ID }), WORKSPACE_ID);
});

test("returns null for missing customData", () => {
  assert.equal(parseWorkspaceIdFromCustomData(null), null);
  assert.equal(parseWorkspaceIdFromCustomData(undefined), null);
});

test("returns null for customData without workspace_id", () => {
  assert.equal(parseWorkspaceIdFromCustomData({ other: "x" }), null);
});

test("returns null for a malformed (non-UUID) workspace_id", () => {
  assert.equal(parseWorkspaceIdFromCustomData({ workspace_id: "not-a-uuid" }), null);
});

test("returns null when customData is not an object", () => {
  assert.equal(parseWorkspaceIdFromCustomData("a string"), null);
});

// --- parseInitiatingUserIdFromCustomData (POST-M11-B2) ---

test("parses a well-formed initiating_user_id", () => {
  assert.equal(parseInitiatingUserIdFromCustomData({ initiating_user_id: USER_ID }), USER_ID);
});

test("returns null for missing customData", () => {
  assert.equal(parseInitiatingUserIdFromCustomData(null), null);
  assert.equal(parseInitiatingUserIdFromCustomData(undefined), null);
});

test("returns null for customData without initiating_user_id", () => {
  assert.equal(parseInitiatingUserIdFromCustomData({ workspace_id: WORKSPACE_ID }), null);
});

test("returns null for a malformed (non-UUID) initiating_user_id", () => {
  assert.equal(parseInitiatingUserIdFromCustomData({ initiating_user_id: "not-a-uuid" }), null);
});

test("returns null when customData is not an object", () => {
  assert.equal(parseInitiatingUserIdFromCustomData("a string"), null);
});

// --- normalizePaddleSubscriptionEvent: initiating user identity (POST-M11-B2) ---

test("missing customData normalizes initiatingUserId to null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: null }));
  assert.ok(result);
  assert.equal(result.initiatingUserId, null);
});

test("customData with only workspace_id (no initiating_user_id) normalizes initiatingUserId to null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: { workspace_id: WORKSPACE_ID } }));
  assert.ok(result);
  assert.equal(result.initiatingUserId, null);
});

test("a correct initiating_user_id normalizes through alongside workspace_id", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: { workspace_id: WORKSPACE_ID, initiating_user_id: USER_ID } }));
  assert.ok(result);
  assert.equal(result.workspaceId, WORKSPACE_ID);
  assert.equal(result.initiatingUserId, USER_ID);
});

test("a malformed initiating_user_id normalizes to null without affecting workspaceId", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: { workspace_id: WORKSPACE_ID, initiating_user_id: "not-a-uuid" } }));
  assert.ok(result);
  assert.equal(result.workspaceId, WORKSPACE_ID);
  assert.equal(result.initiatingUserId, null);
});

// --- normalizePaddleSubscriptionEvent: event type filtering ---

test("subscription.created normalizes", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ eventType: EventName.SubscriptionCreated }));
  assert.ok(result);
  assert.equal(result.eventType, EventName.SubscriptionCreated);
});

test("subscription.updated normalizes", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ eventType: EventName.SubscriptionUpdated }));
  assert.ok(result);
  assert.equal(result.eventType, EventName.SubscriptionUpdated);
});

test("subscription.canceled normalizes", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ eventType: EventName.SubscriptionCanceled }));
  assert.ok(result);
  assert.equal(result.eventType, EventName.SubscriptionCanceled);
});

test("an unsupported event type (e.g. subscription.paused) returns null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ eventType: EventName.SubscriptionPaused }));
  assert.equal(result, null);
});

test("a wholly unrelated event type (e.g. customer.created) returns null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ eventType: EventName.CustomerCreated }));
  assert.equal(result, null);
});

// --- workspace identity ---

test("missing customData normalizes workspaceId to null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: null }));
  assert.ok(result);
  assert.equal(result.workspaceId, null);
});

test("a malformed workspace UUID normalizes to null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: { workspace_id: "not-a-uuid" } }));
  assert.ok(result);
  assert.equal(result.workspaceId, null);
});

test("a correct workspace UUID normalizes through", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ customData: { workspace_id: WORKSPACE_ID } }));
  assert.ok(result);
  assert.equal(result.workspaceId, WORKSPACE_ID);
});

// --- statuses (pass-through; RPC does the enum enforcement) ---

for (const status of ["active", "trialing", "past_due", "paused", "canceled"]) {
  test(`status ${status} passes through unchanged`, () => {
    const result = normalizePaddleSubscriptionEvent(buildEvent({ status }));
    assert.ok(result);
    assert.equal(result.status, status);
  });
}

// --- scheduled change ---

test("a scheduled cancel normalizes both fields", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ scheduledChange: { action: "cancel", effective_at: "2026-10-19T00:00:00.000000Z" } }),
  );
  assert.ok(result);
  assert.equal(result.scheduledChangeAction, "cancel");
  assert.equal(result.scheduledChangeEffectiveAt, "2026-10-19T00:00:00.000000Z");
});

test("a scheduled pause normalizes", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ scheduledChange: { action: "pause", effective_at: "2026-10-19T00:00:00.000000Z" } }),
  );
  assert.ok(result);
  assert.equal(result.scheduledChangeAction, "pause");
});

test("a scheduled resume normalizes", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ scheduledChange: { action: "resume", effective_at: "2026-10-19T00:00:00.000000Z" } }),
  );
  assert.ok(result);
  assert.equal(result.scheduledChangeAction, "resume");
});

test("no scheduled change normalizes both fields to null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ scheduledChange: null }));
  assert.ok(result);
  assert.equal(result.scheduledChangeAction, null);
  assert.equal(result.scheduledChangeEffectiveAt, null);
});

// --- item/price/quantity: the "never blindly take items[0]" rule ---

test("exactly one item normalizes its price id and quantity", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ items: [{ status: "active", quantity: 1, recurring: true, created_at: "x", updated_at: "x", price: { id: "pri_pro" } }] }),
  );
  assert.ok(result);
  assert.equal(result.providerPriceId, "pri_pro");
  assert.equal(result.quantity, 1);
});

test("zero items normalizes price/quantity to null, never a false Pro match", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ items: [] }));
  assert.ok(result);
  assert.equal(result.providerPriceId, null);
  assert.equal(result.quantity, null);
});

test("more than one item normalizes price/quantity to null — never blindly takes items[0]", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({
      items: [
        { status: "active", quantity: 1, recurring: true, created_at: "x", updated_at: "x", price: { id: "pri_pro" } },
        { status: "active", quantity: 1, recurring: true, created_at: "x", updated_at: "x", price: { id: "pri_addon" } },
      ],
    }),
  );
  assert.ok(result);
  assert.equal(result.providerPriceId, null);
  assert.equal(result.quantity, null);
});

test("quantity other than 1 still normalizes through (the RPC enforces quantity semantics, not normalization)", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ items: [{ status: "active", quantity: 3, recurring: true, created_at: "x", updated_at: "x", price: { id: "pri_pro" } }] }),
  );
  assert.ok(result);
  assert.equal(result.quantity, 3);
});

test("an item with no price normalizes providerPriceId to null", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ items: [{ status: "active", quantity: 1, recurring: true, created_at: "x", updated_at: "x", price: null }] }),
  );
  assert.ok(result);
  assert.equal(result.providerPriceId, null);
});

// --- billing period ---

test("current billing period normalizes both timestamps", () => {
  const result = normalizePaddleSubscriptionEvent(
    buildEvent({ currentBillingPeriod: { starts_at: "2026-09-19T00:00:00.000000Z", ends_at: "2026-10-19T00:00:00.000000Z" } }),
  );
  assert.ok(result);
  assert.equal(result.currentPeriodStart, "2026-09-19T00:00:00.000000Z");
  assert.equal(result.currentPeriodEnd, "2026-10-19T00:00:00.000000Z");
});

test("a null current billing period normalizes both timestamps to null", () => {
  const result = normalizePaddleSubscriptionEvent(buildEvent({ currentBillingPeriod: null }));
  assert.ok(result);
  assert.equal(result.currentPeriodStart, null);
  assert.equal(result.currentPeriodEnd, null);
});

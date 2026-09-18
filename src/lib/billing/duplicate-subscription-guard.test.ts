import assert from "node:assert/strict";
import test from "node:test";

import { isBlockedFromNewCheckout } from "./duplicate-subscription-guard.ts";
import type { WorkspaceSubscription } from "../../types/billing.ts";

function subscription(status: WorkspaceSubscription["status"]): WorkspaceSubscription {
  return {
    id: "sub-row-1",
    workspace_id: "workspace-1",
    provider: "PADDLE",
    provider_customer_id: "ctm_1",
    provider_subscription_id: "sub_1",
    provider_price_id: "pri_1",
    plan: "PRO",
    status,
    current_period_start: null,
    current_period_end: null,
    scheduled_change_action: null,
    scheduled_change_effective_at: null,
    last_event_occurred_at: "2026-09-18T00:00:00.000Z",
    created_at: "2026-09-18T00:00:00.000Z",
    updated_at: "2026-09-18T00:00:00.000Z",
  };
}

test("no subscription row never blocks checkout", () => {
  assert.equal(isBlockedFromNewCheckout(null), false);
});

test("active blocks a new checkout", () => {
  assert.equal(isBlockedFromNewCheckout(subscription("active")), true);
});

test("trialing blocks a new checkout", () => {
  assert.equal(isBlockedFromNewCheckout(subscription("trialing")), true);
});

test("past_due blocks a new checkout", () => {
  assert.equal(isBlockedFromNewCheckout(subscription("past_due")), true);
});

test("paused blocks a new checkout — must be resumed/managed, not replaced", () => {
  assert.equal(isBlockedFromNewCheckout(subscription("paused")), true);
});

test("canceled does NOT block a new checkout — Paddle subscriptions can never be reinstated", () => {
  assert.equal(isBlockedFromNewCheckout(subscription("canceled")), false);
});

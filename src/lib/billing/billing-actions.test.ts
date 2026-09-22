import assert from "node:assert/strict";
import test from "node:test";

import { getBillingActions } from "./billing-actions.ts";
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
    last_event_occurred_at: "2026-09-22T00:00:00.000Z",
    created_at: "2026-09-22T00:00:00.000Z",
    updated_at: "2026-09-22T00:00:00.000Z",
  };
}

test("no subscription: can upgrade, cannot manage billing", () => {
  assert.deepEqual(getBillingActions(null), { canUpgrade: true, canManageBilling: false });
});

test("active: cannot upgrade, can manage billing", () => {
  assert.deepEqual(getBillingActions(subscription("active")), { canUpgrade: false, canManageBilling: true });
});

test("trialing: cannot upgrade, can manage billing", () => {
  assert.deepEqual(getBillingActions(subscription("trialing")), { canUpgrade: false, canManageBilling: true });
});

test("past_due: cannot upgrade, can manage billing", () => {
  assert.deepEqual(getBillingActions(subscription("past_due")), { canUpgrade: false, canManageBilling: true });
});

test("paused: cannot upgrade (checkout would reject it anyway), can manage billing", () => {
  assert.deepEqual(getBillingActions(subscription("paused")), { canUpgrade: false, canManageBilling: true });
});

test("canceled: can upgrade again, can also manage billing/see history", () => {
  assert.deepEqual(getBillingActions(subscription("canceled")), { canUpgrade: true, canManageBilling: true });
});

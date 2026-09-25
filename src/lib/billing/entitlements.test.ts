import assert from "node:assert/strict";
import test from "node:test";

import { computeWorkspaceCapabilities, isEntitledToPro } from "./entitlements.ts";
import type { WorkspaceSubscription } from "../../types/billing.ts";

function subscription(overrides: Partial<WorkspaceSubscription>): WorkspaceSubscription {
  return {
    id: "sub-row-1",
    workspace_id: "workspace-1",
    provider: "PADDLE",
    provider_customer_id: "ctm_1",
    provider_subscription_id: "sub_1",
    provider_price_id: "pri_1",
    plan: "PRO",
    status: "active",
    current_period_start: "2026-09-01T00:00:00.000Z",
    current_period_end: "2026-10-01T00:00:00.000Z",
    scheduled_change_action: null,
    scheduled_change_effective_at: null,
    last_event_occurred_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    billing_owner_user_id: null,
    ...overrides,
  };
}

test("no subscription row (Free workspace) is never entitled to Pro", () => {
  assert.equal(isEntitledToPro(null), false);
});

test("active is entitled", () => {
  assert.equal(isEntitledToPro(subscription({ status: "active" })), true);
});

test("trialing is entitled", () => {
  assert.equal(isEntitledToPro(subscription({ status: "trialing" })), true);
});

test("past_due is entitled — Paddle's own guidance is to keep full access while a payment retries", () => {
  assert.equal(isEntitledToPro(subscription({ status: "past_due" })), true);
});

test("paused is not entitled", () => {
  assert.equal(isEntitledToPro(subscription({ status: "paused" })), false);
});

test("canceled is not entitled", () => {
  assert.equal(isEntitledToPro(subscription({ status: "canceled" })), false);
});

test("a scheduled cancellation that hasn't taken effect yet stays entitled — status is still active, scheduled_change_effective_at is never read", () => {
  assert.equal(
    isEntitledToPro(
      subscription({
        status: "active",
        scheduled_change_action: "cancel",
        scheduled_change_effective_at: "2026-10-01T00:00:00.000Z",
      }),
    ),
    true,
  );
});

test("computeWorkspaceCapabilities(false) returns the FREE capability set", () => {
  assert.deepEqual(computeWorkspaceCapabilities(false), {
    plan: "FREE",
    canManageApprovalPolicies: false,
    canUsePolicyRouting: false,
    canUseMultiApproverPolicies: false,
    canUseApprovalThresholds: false,
  });
});

test("computeWorkspaceCapabilities(true) returns the PRO capability set", () => {
  assert.deepEqual(computeWorkspaceCapabilities(true), {
    plan: "PRO",
    canManageApprovalPolicies: true,
    canUsePolicyRouting: true,
    canUseMultiApproverPolicies: true,
    canUseApprovalThresholds: true,
  });
});

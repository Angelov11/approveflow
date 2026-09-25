import assert from "node:assert/strict";
import test from "node:test";

import { computeEffectivePolicy } from "./compute-effective-policy.ts";
import { computeWorkspaceCapabilities, isEntitledToPro } from "../billing/entitlements.ts";
import type { WorkspaceSubscription } from "../../types/billing.ts";

const POLICY = { id: "policy-1", required_approvals: 2 };

// --- EFFECTIVE POLICY (M10.4 Phase 13, items 1-5) ---

test("no configured policy + Free -> null", () => {
  assert.equal(computeEffectivePolicy(null, false), null);
});

test("no configured policy + Pro -> null", () => {
  assert.equal(computeEffectivePolicy(null, true), null);
});

test("configured active policy + Free -> null", () => {
  assert.equal(computeEffectivePolicy(POLICY, false), null);
});

test("configured active policy + Pro -> the policy", () => {
  assert.equal(computeEffectivePolicy(POLICY, true), POLICY);
});

test("an inactive (disabled) configured policy is never even passed in — the caller resolves it to null upstream, so Pro doesn't resurrect it", () => {
  // findActivePolicyForRequestType only ever returns active=true rows, so
  // an inactive policy shows up here as configuredPolicy === null. Pro
  // entitlement can never make a disabled policy effective.
  assert.equal(computeEffectivePolicy(null, true), null);
});

// --- BILLING STATUS MATRIX (M10.4 Phase 13, items 6-11) ---
// Combines the already-tested isEntitledToPro billing-status mapping
// (see entitlements.test.ts) with computeEffectivePolicy — proving policy
// effectiveness follows capabilities, not a duplicated status mapping.

function subscription(status: WorkspaceSubscription["status"]): WorkspaceSubscription {
  return {
    id: "sub-1",
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
    billing_owner_user_id: null,
  };
}

function effectivePolicyForStatus(status: WorkspaceSubscription["status"] | null) {
  const { canUsePolicyRouting } = computeWorkspaceCapabilities(isEntitledToPro(status === null ? null : subscription(status)));
  return computeEffectivePolicy(POLICY, canUsePolicyRouting);
}

test("active + configured policy -> POLICY (effective)", () => {
  assert.equal(effectivePolicyForStatus("active"), POLICY);
});

test("trialing + configured policy -> POLICY (effective)", () => {
  assert.equal(effectivePolicyForStatus("trialing"), POLICY);
});

test("past_due + configured policy -> POLICY (effective)", () => {
  assert.equal(effectivePolicyForStatus("past_due"), POLICY);
});

test("paused + configured policy -> DIRECT (not effective)", () => {
  assert.equal(effectivePolicyForStatus("paused"), null);
});

test("canceled + configured policy -> DIRECT (not effective)", () => {
  assert.equal(effectivePolicyForStatus("canceled"), null);
});

test("no subscription + configured policy -> DIRECT (not effective)", () => {
  assert.equal(effectivePolicyForStatus(null), null);
});

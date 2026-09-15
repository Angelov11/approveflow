import assert from "node:assert/strict";
import test from "node:test";
import { computeDecisionOutcome, type DecisionInputs } from "./compute-decision-outcome.ts";

const policyBase: DecisionInputs = {
  requestExists: true,
  requestStatus: "PENDING",
  requiredApprovals: 2,
  routing: { type: "POLICY", policyMemberIds: ["gary", "mike"] },
  existingApprovals: [],
  approverId: "gary",
  decision: "APPROVED",
};

const directBase: DecisionInputs = {
  requestExists: true,
  requestStatus: "PENDING",
  requiredApprovals: 1,
  routing: { type: "DIRECT", directApproverId: "gary" },
  existingApprovals: [],
  approverId: "gary",
  decision: "APPROVED",
};

test("request not found", () => {
  assert.deepEqual(computeDecisionOutcome({ ...policyBase, requestExists: false }), { outcome: "not_found" });
});

// --- Policy routing (M3 behavior, unchanged) ---

test("policy: authorized approval below threshold keeps the request pending", () => {
  assert.deepEqual(computeDecisionOutcome(policyBase), { outcome: "recorded_pending", approvalsCount: 1, requiredApprovals: 2 });
});

test("policy: threshold approval transitions to approved", () => {
  const result = computeDecisionOutcome({
    ...policyBase,
    approverId: "mike",
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(result, { outcome: "approved", approvalsCount: 2, requiredApprovals: 2 });
});

test("policy: rejection transitions immediately regardless of prior approvals", () => {
  const result = computeDecisionOutcome({
    ...policyBase,
    approverId: "mike",
    decision: "REJECTED",
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(result, { outcome: "rejected" });
});

test("policy: a user outside the policy's member list cannot approve", () => {
  assert.deepEqual(computeDecisionOutcome({ ...policyBase, approverId: "eve" }), {
    outcome: "unauthorized",
    requestStatus: "PENDING",
  });
});

test("policy: same approver cannot decide twice", () => {
  const result = computeDecisionOutcome({ ...policyBase, existingApprovals: [{ approverId: "gary", decision: "APPROVED" }] });
  assert.deepEqual(result, { outcome: "already_decided", requestStatus: "PENDING" });
});

test("policy: a selected-but-not-a-policy-member user cannot approve merely for having been chosen in the modal", () => {
  // Models "selected modal approver does not override policy": someone the
  // requester picked in the Approver field, but who isn't a configured
  // policy member for a POLICY-routed request.
  const result = computeDecisionOutcome({ ...policyBase, routing: { type: "POLICY", policyMemberIds: ["gary", "mike"] }, approverId: "requester-picked-someone-else" });
  assert.deepEqual(result, { outcome: "unauthorized", requestStatus: "PENDING" });
});

test("policy: decisions after APPROVED/REJECTED are ignored", () => {
  assert.deepEqual(computeDecisionOutcome({ ...policyBase, approverId: "mike", requestStatus: "APPROVED" }), {
    outcome: "already_final",
    requestStatus: "APPROVED",
  });
  assert.deepEqual(computeDecisionOutcome({ ...policyBase, approverId: "mike", requestStatus: "REJECTED" }), {
    outcome: "already_final",
    requestStatus: "REJECTED",
  });
});

test("policy: a historical/missing policy snapshot leaves the request undecidable (no_policy)", () => {
  const result = computeDecisionOutcome({ ...policyBase, routing: { type: "POLICY_MISSING" } });
  assert.deepEqual(result, { outcome: "no_policy", requestStatus: "PENDING" });
});

test("policy: single-approver policy approves immediately", () => {
  const result = computeDecisionOutcome({
    ...policyBase,
    requiredApprovals: 1,
    routing: { type: "POLICY", policyMemberIds: ["gary"] },
  });
  assert.deepEqual(result, { outcome: "approved", approvalsCount: 1, requiredApprovals: 1 });
});

// --- Direct routing (M4) ---

test("direct: the selected approver can approve, requiring exactly one decision", () => {
  assert.deepEqual(computeDecisionOutcome(directBase), { outcome: "approved", approvalsCount: 1, requiredApprovals: 1 });
});

test("direct: the selected approver can reject", () => {
  const result = computeDecisionOutcome({ ...directBase, decision: "REJECTED" });
  assert.deepEqual(result, { outcome: "rejected" });
});

test("direct: a different user (same or other workspace) cannot approve — only the exact selected approver id matches", () => {
  const result = computeDecisionOutcome({ ...directBase, approverId: "someone-else" });
  assert.deepEqual(result, { outcome: "unauthorized", requestStatus: "PENDING" });
});

test("direct: duplicate decision from the same approver does not create a second approval", () => {
  const result = computeDecisionOutcome({ ...directBase, existingApprovals: [{ approverId: "gary", decision: "APPROVED" }] });
  assert.deepEqual(result, { outcome: "already_decided", requestStatus: "PENDING" });
});

test("direct: decision after the request is already final does not mutate it", () => {
  assert.deepEqual(computeDecisionOutcome({ ...directBase, requestStatus: "APPROVED" }), {
    outcome: "already_final",
    requestStatus: "APPROVED",
  });
  assert.deepEqual(computeDecisionOutcome({ ...directBase, requestStatus: "REJECTED" }), {
    outcome: "already_final",
    requestStatus: "REJECTED",
  });
});

// --- Routing stability ---

test("stability: a DIRECT request's authorization is unaffected by policy member lists — it never consults them", () => {
  // There is no policyMemberIds field at all on a DIRECT routing input —
  // this is enforced by the type itself (RoutingAuthorization is a
  // discriminated union), which is the strongest form of "a direct
  // request remains direct after a policy is later created": the two
  // authorization models are structurally incapable of mixing.
  const result = computeDecisionOutcome({ ...directBase, approverId: "gary" });
  assert.deepEqual(result, { outcome: "approved", approvalsCount: 1, requiredApprovals: 1 });
});

test("stability: a POLICY request's required threshold is whatever was snapshotted, independent of any \"live\" value", () => {
  // requiredApprovals here represents the FROZEN snapshot on the request
  // row, not a live read of approval_policies.required_approvals — the
  // caller (decide_on_request / the route) is responsible for sourcing it
  // from the request row. This test documents that computeDecisionOutcome
  // itself has no notion of "current" policy state at all — only what it's
  // handed — which is exactly the stability property required.
  const snapshotAtCreationTime = 3;
  const result = computeDecisionOutcome({
    ...policyBase,
    requiredApprovals: snapshotAtCreationTime,
    approverId: "mike",
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(result, { outcome: "recorded_pending", approvalsCount: 2, requiredApprovals: 3 });
});

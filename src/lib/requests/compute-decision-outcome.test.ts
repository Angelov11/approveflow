import assert from "node:assert/strict";
import test from "node:test";
import { computeDecisionOutcome, type DecisionInputs } from "./compute-decision-outcome.ts";

const base: DecisionInputs = {
  requestExists: true,
  requestStatus: "PENDING",
  policy: { memberIds: ["gary", "mike"], requiredApprovals: 2 },
  existingApprovals: [],
  approverId: "gary",
  decision: "APPROVED",
};

test("request not found", () => {
  const result = computeDecisionOutcome({ ...base, requestExists: false });
  assert.deepEqual(result, { outcome: "not_found" });
});

test("authorized approval below threshold keeps the request pending", () => {
  const result = computeDecisionOutcome(base);
  assert.deepEqual(result, { outcome: "recorded_pending", approvalsCount: 1, requiredApprovals: 2 });
});

test("threshold approval transitions to approved", () => {
  const result = computeDecisionOutcome({
    ...base,
    approverId: "mike",
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(result, { outcome: "approved", approvalsCount: 2, requiredApprovals: 2 });
});

test("rejection transitions immediately regardless of prior approvals", () => {
  const result = computeDecisionOutcome({
    ...base,
    approverId: "mike",
    decision: "REJECTED",
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(result, { outcome: "rejected" });
});

test("unauthorized user cannot approve", () => {
  const result = computeDecisionOutcome({ ...base, approverId: "eve" });
  assert.deepEqual(result, { outcome: "unauthorized", requestStatus: "PENDING" });
});

test("same approver cannot decide twice", () => {
  const result = computeDecisionOutcome({
    ...base,
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(result, { outcome: "already_decided", requestStatus: "PENDING" });
});

test("approval after the request is already APPROVED is ignored", () => {
  const result = computeDecisionOutcome({ ...base, approverId: "mike", requestStatus: "APPROVED" });
  assert.deepEqual(result, { outcome: "already_final", requestStatus: "APPROVED" });
});

test("rejection after the request is already APPROVED is ignored", () => {
  const result = computeDecisionOutcome({
    ...base,
    approverId: "mike",
    decision: "REJECTED",
    requestStatus: "APPROVED",
  });
  assert.deepEqual(result, { outcome: "already_final", requestStatus: "APPROVED" });
});

test("approval after the request is already REJECTED is ignored", () => {
  const result = computeDecisionOutcome({ ...base, approverId: "mike", requestStatus: "REJECTED" });
  assert.deepEqual(result, { outcome: "already_final", requestStatus: "REJECTED" });
});

test("a user not in the policy's member list cannot approve even with a fabricated/cross-workspace id", () => {
  // Modeling cross-workspace forgery: the approverId simply never appears in
  // this request's policy member list (workspace-scoping upstream already
  // guarantees a genuine cross-workspace user id could never legitimately
  // appear there — see the schema migration comment).
  const result = computeDecisionOutcome({ ...base, approverId: "some-other-workspace-user" });
  assert.deepEqual(result, { outcome: "unauthorized", requestStatus: "PENDING" });
});

test("no active policy leaves the request undecidable", () => {
  const result = computeDecisionOutcome({ ...base, policy: null });
  assert.deepEqual(result, { outcome: "no_policy", requestStatus: "PENDING" });
});

test("concurrent/duplicate decision: a retried identical call sees its own prior state and is idempotent", () => {
  // Models what the DB's row lock guarantees in practice: the second call
  // (whether a genuine retry or a near-simultaneous second click) is
  // evaluated against a state that already reflects the first call's
  // committed effect, never a stale pre-commit snapshot.
  const afterFirstCall = computeDecisionOutcome(base);
  assert.equal(afterFirstCall.outcome, "recorded_pending");

  const retriedSameCall = computeDecisionOutcome({
    ...base,
    existingApprovals: [{ approverId: "gary", decision: "APPROVED" }],
  });
  assert.deepEqual(retriedSameCall, { outcome: "already_decided", requestStatus: "PENDING" });
});

test("single-approver policy approves immediately on the only required decision", () => {
  const result = computeDecisionOutcome({
    ...base,
    policy: { memberIds: ["gary"], requiredApprovals: 1 },
  });
  assert.deepEqual(result, { outcome: "approved", approvalsCount: 1, requiredApprovals: 1 });
});

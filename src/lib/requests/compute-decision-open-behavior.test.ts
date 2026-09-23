import assert from "node:assert/strict";
import test from "node:test";

import { computeDecisionOpenBehavior } from "./compute-decision-open-behavior.ts";

test("PENDING -> the decision modal should open", () => {
  assert.deepEqual(computeDecisionOpenBehavior("PENDING"), { shouldOpenModal: true });
});

test("APPROVED -> the decision modal must NOT open; terminal status is carried for reflection", () => {
  assert.deepEqual(computeDecisionOpenBehavior("APPROVED"), { shouldOpenModal: false, requestStatus: "APPROVED" });
});

test("REJECTED -> the decision modal must NOT open", () => {
  assert.deepEqual(computeDecisionOpenBehavior("REJECTED"), { shouldOpenModal: false, requestStatus: "REJECTED" });
});

test("CANCELLED -> the decision modal must NOT open (no code path sets this today, but the check is generic)", () => {
  assert.deepEqual(computeDecisionOpenBehavior("CANCELLED"), { shouldOpenModal: false, requestStatus: "CANCELLED" });
});

test("EXPIRED -> the decision modal must NOT open", () => {
  assert.deepEqual(computeDecisionOpenBehavior("EXPIRED"), { shouldOpenModal: false, requestStatus: "EXPIRED" });
});

test("a threshold request still PENDING after one approval remains open for the next approver", () => {
  // The overall request status — not how many approvals exist so far — is
  // what this decides. A multi-approver request with 1 of 2 approvals
  // recorded is still status PENDING, so the remaining approver's message
  // must stay fully actionable.
  assert.deepEqual(computeDecisionOpenBehavior("PENDING"), { shouldOpenModal: true });
});

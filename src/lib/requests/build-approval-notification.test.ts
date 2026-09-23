import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_ACTIONS_BLOCK_ID,
  APPROVAL_STATUS_BLOCK_ID,
  buildApprovalNotification,
  describeDecisionOutcome,
  replaceActionsWithStatus,
} from "./build-approval-notification.ts";

// --- describeDecisionOutcome: already_final for every terminal status (POST-M11-A) ---

test("already_final APPROVED produces a generic, third-person status line", () => {
  const text = describeDecisionOutcome({ outcome: "already_final", request_status: "APPROVED", approvals_count: null, required_approvals: null });
  assert.equal(text, "This request has already been APPROVED.");
});

test("already_final REJECTED produces a generic, third-person status line", () => {
  const text = describeDecisionOutcome({ outcome: "already_final", request_status: "REJECTED", approvals_count: null, required_approvals: null });
  assert.equal(text, "This request has already been REJECTED.");
});

test("already_final CANCELLED produces a generic status line (no code path sets this today, but the copy is generic)", () => {
  const text = describeDecisionOutcome({ outcome: "already_final", request_status: "CANCELLED", approvals_count: null, required_approvals: null });
  assert.equal(text, "This request has already been CANCELLED.");
});

test("already_final EXPIRED produces a generic status line", () => {
  const text = describeDecisionOutcome({ outcome: "already_final", request_status: "EXPIRED", approvals_count: null, required_approvals: null });
  assert.equal(text, "This request has already been EXPIRED.");
});

test("already_final with a null request_status falls back to 'decided'", () => {
  const text = describeDecisionOutcome({ outcome: "already_final", request_status: null, approvals_count: null, required_approvals: null });
  assert.equal(text, "This request has already been decided.");
});

// --- replaceActionsWithStatus: produces a terminal, non-actionable representation ---

const sampleNotification = buildApprovalNotification({
  requestId: "req-1",
  requestTypeName: "Vacation / Time Off",
  requester: { display_name: null, slack_user_id: "U0REQ" },
  resource: "Family trip",
  reason: null,
  timing: { startDate: "2026-10-01", startTime: null, endDate: "2026-10-05", endTime: null },
  legacyDurationMinutes: null,
  expense: { amount: null, currency: null },
});

test("replaceActionsWithStatus removes the actions block entirely", () => {
  const result = replaceActionsWithStatus(sampleNotification.blocks, "This request has already been APPROVED.");
  const hasActionsBlock = result.some((block) => (block as { type?: string }).type === "actions");
  assert.equal(hasActionsBlock, false);
});

test("replaceActionsWithStatus removes the original PENDING status block and replaces it with the new text", () => {
  const result = replaceActionsWithStatus(sampleNotification.blocks, "This request has already been APPROVED.");
  const statusBlocks = result.filter((block) => (block as { block_id?: string }).block_id === APPROVAL_STATUS_BLOCK_ID);
  assert.equal(statusBlocks.length, 1);
  assert.deepEqual((statusBlocks[0] as { elements: { text: string }[] }).elements, [{ type: "mrkdwn", text: "This request has already been APPROVED." }]);
});

test("replaceActionsWithStatus preserves unrelated message content (requester/details fields)", () => {
  const result = replaceActionsWithStatus(sampleNotification.blocks, "This request has already been APPROVED.");
  const text = JSON.stringify(result);
  assert.ok(text.includes("Family trip"));
  assert.ok(text.includes("U0REQ"));
});

test("sanity: the original notification does carry an actions block with both buttons, before replacement", () => {
  const text = JSON.stringify(sampleNotification.blocks);
  assert.ok(text.includes(APPROVAL_ACTIONS_BLOCK_ID));
  assert.ok(text.includes("Approve"));
  assert.ok(text.includes("Reject"));
});

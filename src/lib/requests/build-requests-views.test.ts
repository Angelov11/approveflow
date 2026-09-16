import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequestCenterView,
  buildRequestDetailsView,
  buildWaitingListView,
  type RequestDetailsView,
  type RequestSummary,
} from "./build-requests-views.ts";

function blocksToText(view: { blocks?: unknown[] }): string {
  return JSON.stringify(view.blocks);
}

const sampleRequest: RequestSummary = {
  id: "req-1",
  requestTypeName: "Custom Request",
  resource: "AWS Test Resource",
  status: "PENDING",
  whenText: "2 hours",
  amountText: null,
  createdAt: "2026-09-15T20:00:00.000Z",
};

const sampleExpenseRequest: RequestSummary = {
  id: "req-2",
  requestTypeName: "Expense / Purchase",
  resource: "External monitor",
  status: "PENDING",
  whenText: null,
  amountText: "EUR 499.99",
  createdAt: "2026-09-15T20:00:00.000Z",
};

// --- Request Center ---

test("My Requests empty state shows the exact required message", () => {
  const view = buildRequestCenterView({ myRequests: [], myRequestsTotalCount: 0, waitingCount: 0 });
  assert.ok(blocksToText(view).includes("You haven't submitted any requests yet."));
});

test("Waiting for Me empty state shows the exact required message", () => {
  const view = buildRequestCenterView({ myRequests: [], myRequestsTotalCount: 0, waitingCount: 0 });
  assert.ok(blocksToText(view).includes("Nothing is waiting for your approval."));
});

test("shows a 'most recent' notice only when there are more requests than shown", () => {
  const shown = buildRequestCenterView({ myRequests: [sampleRequest], myRequestsTotalCount: 15, waitingCount: 0 });
  assert.ok(blocksToText(shown).includes("Showing your 1 most recent requests."));

  const notShown = buildRequestCenterView({ myRequests: [sampleRequest], myRequestsTotalCount: 1, waitingCount: 0 });
  assert.ok(!blocksToText(notShown).includes("most recent"));
});

test("each request row includes request type, resource, status, duration, and a View button", () => {
  const view = buildRequestCenterView({ myRequests: [sampleRequest], myRequestsTotalCount: 1, waitingCount: 0 });
  const text = blocksToText(view);
  assert.ok(text.includes("Custom Request"));
  assert.ok(text.includes("AWS Test Resource"));
  assert.ok(text.includes("Pending"));
  assert.ok(text.includes("2 hours"));
  assert.ok(text.includes("view_request"));
  assert.ok(text.includes("requestId"));
  assert.ok(text.includes("req-1"));
});

test("an expense row shows the amount/currency instead of a When line", () => {
  const view = buildRequestCenterView({ myRequests: [sampleExpenseRequest], myRequestsTotalCount: 1, waitingCount: 0 });
  const text = blocksToText(view);
  assert.ok(text.includes("EUR 499.99"));
  assert.ok(text.includes("External monitor"));
});

test("waiting count is surfaced with a button when non-zero", () => {
  const view = buildRequestCenterView({ myRequests: [], myRequestsTotalCount: 0, waitingCount: 3 });
  const text = blocksToText(view);
  assert.ok(text.includes("3"));
  assert.ok(text.includes("view_waiting_requests"));
});

// --- Waiting list ---

test("waiting list empty state", () => {
  const view = buildWaitingListView({ waitingRequests: [] });
  assert.ok(blocksToText(view).includes("Nothing is waiting for your approval."));
});

test("waiting list renders rows with View buttons", () => {
  const view = buildWaitingListView({ waitingRequests: [sampleRequest] });
  assert.ok(blocksToText(view).includes("view_request"));
});

// --- Request details ---

const baseDetails: RequestDetailsView = {
  id: "req-1",
  requestTypeName: "Custom Request",
  resource: "AWS Test Resource",
  reason: "Need it for testing",
  when: { label: "When / Duration", value: "2 hours" },
  amountLabel: null,
  status: "PENDING",
  createdAt: "2026-09-15T20:00:00.000Z",
  requesterSlackUserId: "U0REQUESTER",
  routing: { type: "DIRECT", approverSlackUserId: "U0APPROVER" },
  decisions: [],
  canCurrentUserDecide: false,
};

test("DIRECT pending shows the approver as pending", () => {
  const view = buildRequestDetailsView({ details: baseDetails });
  const text = blocksToText(view);
  assert.ok(text.includes("<@U0APPROVER>"));
  assert.ok(text.includes("pending"));
});

test("DIRECT decided shows the recorded decision, not 'pending'", () => {
  const view = buildRequestDetailsView({
    details: { ...baseDetails, status: "APPROVED", decisions: [{ slackUserId: "U0APPROVER", decision: "APPROVED", comment: null }] },
  });
  const text = blocksToText(view);
  assert.ok(text.includes("✅ <@U0APPROVER> approved"));
  assert.ok(!text.includes("pending"));
});

test("DIRECT approval with a comment shows the comment beneath the decision", () => {
  const view = buildRequestDetailsView({
    details: {
      ...baseDetails,
      status: "APPROVED",
      decisions: [{ slackUserId: "U0APPROVER", decision: "APPROVED", comment: "Looks good — temporary access approved." }],
    },
  });
  const text = blocksToText(view);
  assert.ok(text.includes("✅ <@U0APPROVER> approved"));
  assert.ok(text.includes("Looks good — temporary access approved."));
});

test("DIRECT rejection shows the reason, labeled distinctly from an approval comment", () => {
  const view = buildRequestDetailsView({
    details: {
      ...baseDetails,
      status: "REJECTED",
      decisions: [{ slackUserId: "U0APPROVER", decision: "REJECTED", comment: "Please use staging instead." }],
    },
  });
  const text = blocksToText(view);
  assert.ok(text.includes("❌ <@U0APPROVER> rejected"));
  assert.ok(text.includes("Reason:"));
  assert.ok(text.includes("Please use staging instead."));
});

test("a historical decision with no comment renders with no comment line at all — no 'No comment provided' placeholder", () => {
  const view = buildRequestDetailsView({
    details: { ...baseDetails, status: "REJECTED", decisions: [{ slackUserId: "U0APPROVER", decision: "REJECTED", comment: null }] },
  });
  // Scoped to the "Approver" block specifically — the request's own free-text
  // "Reason" field (baseDetails.reason) is unrelated and always renders its
  // own "*Reason:*" label elsewhere in the view.
  const approverBlock = (view.blocks as { text?: { text?: string } }[]).find((b) => b.text?.text?.includes("*Approver*"));
  const approverText = approverBlock?.text?.text ?? "";
  assert.ok(approverText.includes("❌ <@U0APPROVER> rejected"));
  assert.ok(!approverText.includes("Reason:"));
  assert.ok(!approverText.includes("No comment"));
  assert.ok(!approverText.includes("No reason"));
});

test("POLICY shows the policy name, approval count, historical decisions, and current pending members", () => {
  const details: RequestDetailsView = {
    ...baseDetails,
    routing: {
      type: "POLICY",
      policyName: "Production Access Approval",
      requiredApprovals: 2,
      pendingMemberSlackUserIds: ["U0MIKE"],
    },
    decisions: [{ slackUserId: "U0GARY", decision: "APPROVED", comment: null }],
  };
  const text = blocksToText(buildRequestDetailsView({ details }));
  assert.ok(text.includes("Production Access Approval"));
  assert.ok(text.includes("1 of 2"));
  assert.ok(text.includes("✅ <@U0GARY> approved"));
  assert.ok(text.includes("🟡 <@U0MIKE> pending"));
});

test("POLICY renders each approver's own comment against the correct approver", () => {
  const details: RequestDetailsView = {
    ...baseDetails,
    routing: { type: "POLICY", policyName: "Production Access Approval", requiredApprovals: 2, pendingMemberSlackUserIds: [] },
    decisions: [
      { slackUserId: "U0ALICE", decision: "APPROVED", comment: "Looks good." },
      { slackUserId: "U0BOB", decision: "APPROVED", comment: "No issues from security." },
    ],
  };
  const text = blocksToText(buildRequestDetailsView({ details }));
  const aliceIndex = text.indexOf("U0ALICE");
  const aliceCommentIndex = text.indexOf("Looks good.");
  const bobIndex = text.indexOf("U0BOB");
  const bobCommentIndex = text.indexOf("No issues from security.");
  assert.ok(aliceIndex < aliceCommentIndex && aliceCommentIndex < bobIndex);
  assert.ok(bobIndex < bobCommentIndex);
});

test("a decision from someone no longer a policy member still renders (historical, not erased)", () => {
  const details: RequestDetailsView = {
    ...baseDetails,
    routing: { type: "POLICY", policyName: "Production Access Approval", requiredApprovals: 1, pendingMemberSlackUserIds: [] },
    decisions: [{ slackUserId: "U0REMOVED", decision: "APPROVED", comment: null }],
  };
  const text = blocksToText(buildRequestDetailsView({ details }));
  assert.ok(text.includes("✅ <@U0REMOVED> approved"));
});

test("historical null-policy routing renders a safe message, never a fabricated approver", () => {
  const details: RequestDetailsView = { ...baseDetails, routing: { type: "POLICY_UNAVAILABLE" } };
  const text = blocksToText(buildRequestDetailsView({ details }));
  assert.ok(text.includes("Approval routing unavailable for this historical request."));
});

test("Approve/Reject buttons only render when the current user can decide", () => {
  const authorized = buildRequestDetailsView({ details: { ...baseDetails, canCurrentUserDecide: true } });
  const unauthorized = buildRequestDetailsView({ details: { ...baseDetails, canCurrentUserDecide: false } });
  assert.ok(blocksToText(authorized).includes("approve_request"));
  assert.ok(!blocksToText(unauthorized).includes("approve_request"));
});

test("a banner renders when provided (stale-modal outcome messaging)", () => {
  const view = buildRequestDetailsView({ details: baseDetails, banner: "You're not authorized to decide on this request." });
  assert.ok(blocksToText(view).includes("You're not authorized to decide on this request."));
});

// --- M8: workplace terminology ---

test("uses 'Details' and the historical 'When / Duration' label, never bare 'Resource' or 'Duration'", () => {
  const text = blocksToText(buildRequestDetailsView({ details: { ...baseDetails, reason: null } }));
  assert.ok(text.includes("*Details:*"));
  assert.ok(text.includes("*When / Duration:*"));
  assert.ok(!text.includes("*Resource:*"));
  assert.ok(!text.includes("*Duration:*"));
});

test("a new (post-M8-correction) request with real timing uses the 'When' label, not 'When / Duration'", () => {
  const text = blocksToText(
    buildRequestDetailsView({ details: { ...baseDetails, reason: null, when: { label: "When", value: "Sep 19, 2026" } } }),
  );
  assert.ok(text.includes("*When:*"));
  assert.ok(text.includes("Sep 19, 2026"));
  assert.ok(!text.includes("*When / Duration:*"));
});

test("a request with no timing at all shows no When field — no placeholder", () => {
  const text = blocksToText(buildRequestDetailsView({ details: { ...baseDetails, reason: null, when: null } }));
  assert.ok(!text.includes("*When"));
  assert.ok(!text.includes("Not specified"));
});

test("an Expense / Purchase request shows an Amount field instead of When", () => {
  const text = blocksToText(
    buildRequestDetailsView({ details: { ...baseDetails, reason: null, when: null, amountLabel: "EUR 499.99" } }),
  );
  assert.ok(text.includes("*Amount:*"));
  assert.ok(text.includes("EUR 499.99"));
  assert.ok(!text.includes("*When"));
});

test("a pre-M8 historical request with a reason still shows a Reason field", () => {
  const text = blocksToText(buildRequestDetailsView({ details: { ...baseDetails, reason: "Need it for testing" } }));
  assert.ok(text.includes("*Reason:*"));
  assert.ok(text.includes("Need it for testing"));
});

test("a new (post-M8) request with reason = null shows no Reason field at all — no placeholder", () => {
  const text = blocksToText(buildRequestDetailsView({ details: { ...baseDetails, reason: null } }));
  assert.ok(!text.includes("*Reason:*"));
  assert.ok(!text.includes("No reason"));
});

test("details never expose internal UUIDs, routing_type strings, or column names", () => {
  const details: RequestDetailsView = {
    ...baseDetails,
    routing: { type: "POLICY", policyName: "Production Access Approval", requiredApprovals: 1, pendingMemberSlackUserIds: [] },
  };
  const text = blocksToText(buildRequestDetailsView({ details }));
  assert.ok(!text.includes("approval_policy_id"));
  assert.ok(!text.includes("direct_approver_id"));
  assert.ok(!text.includes("routing_type"));
  assert.ok(!text.includes("DIRECT"));
});

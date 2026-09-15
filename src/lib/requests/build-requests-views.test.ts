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
  durationLabel: "2 hours",
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
  durationLabel: "2 hours",
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
    details: { ...baseDetails, status: "APPROVED", decisions: [{ slackUserId: "U0APPROVER", decision: "APPROVED" }] },
  });
  const text = blocksToText(view);
  assert.ok(text.includes("✅ <@U0APPROVER> approved"));
  assert.ok(!text.includes("pending"));
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
    decisions: [{ slackUserId: "U0GARY", decision: "APPROVED" }],
  };
  const text = blocksToText(buildRequestDetailsView({ details }));
  assert.ok(text.includes("Production Access Approval"));
  assert.ok(text.includes("1 of 2"));
  assert.ok(text.includes("✅ <@U0GARY> approved"));
  assert.ok(text.includes("🟡 <@U0MIKE> pending"));
});

test("a decision from someone no longer a policy member still renders (historical, not erased)", () => {
  const details: RequestDetailsView = {
    ...baseDetails,
    routing: { type: "POLICY", policyName: "Production Access Approval", requiredApprovals: 1, pendingMemberSlackUserIds: [] },
    decisions: [{ slackUserId: "U0REMOVED", decision: "APPROVED" }],
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

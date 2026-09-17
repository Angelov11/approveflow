import assert from "node:assert/strict";
import test from "node:test";

import { POLICY_STATUS_ACTIVE, POLICY_STATUS_DISABLED } from "./build-policy-modal.ts";
import { validatePolicySubmission, type PolicySubmissionPayload } from "./validate-policy-submission.ts";

function buildPayload(overrides: {
  requestTypeId?: string | null;
  approverSlackIds?: string[];
  requiredApprovals?: string | null;
  status?: string | null;
} = {}): PolicySubmissionPayload {
  const {
    requestTypeId = "rt-1",
    approverSlackIds = ["U0GARY123", "U0MIKE456"],
    requiredApprovals = "2",
    status = POLICY_STATUS_ACTIVE,
  } = overrides;

  return {
    type: "view_submission",
    team: { id: "T123" },
    user: { id: "U123" },
    view: {
      callback_id: "approveflow_configure_policy",
      private_metadata: requestTypeId ? JSON.stringify({ requestTypeId }) : undefined,
      state: {
        values: {
          policy_approvers_block: { policy_approvers_select: { selected_users: approverSlackIds } },
          policy_required_approvals_block: { policy_required_approvals_select: { selected_option: requiredApprovals ? { value: requiredApprovals } : null } },
          policy_status_block: { policy_status_select: { selected_option: status ? { value: status } : null } },
        },
      },
    },
  };
}

test("a valid active policy submission is accepted", () => {
  const result = validatePolicySubmission(buildPayload());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.approverSlackIds, ["U0GARY123", "U0MIKE456"]);
    assert.equal(result.data.requiredApprovals, 2);
    assert.equal(result.data.active, true);
    assert.equal(result.data.requestTypeId, "rt-1");
  }
});

test("a valid disabled policy submission is accepted with zero approvers", () => {
  const result = validatePolicySubmission(buildPayload({ approverSlackIds: [], status: POLICY_STATUS_DISABLED }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.active, false);
  }
});

test("missing team/user identity is rejected", () => {
  const payload = buildPayload();
  payload.team = undefined;
  const result = validatePolicySubmission(payload);
  assert.equal(result.ok, false);
});

test("missing/malformed private_metadata is rejected — the request type can't be verified", () => {
  const payload = buildPayload();
  payload.view!.private_metadata = "not json";
  const result = validatePolicySubmission(payload);
  assert.equal(result.ok, false);
});

test("a missing required-approvals selection is rejected", () => {
  const result = validatePolicySubmission(buildPayload({ requiredApprovals: null }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.policy_required_approvals_block);
});

test("an active policy needs at least one approver", () => {
  const result = validatePolicySubmission(buildPayload({ approverSlackIds: [] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.policy_approvers_block);
});

test("required approvals cannot exceed the number of selected approvers", () => {
  const result = validatePolicySubmission(buildPayload({ approverSlackIds: ["U0GARY123"], requiredApprovals: "2" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.policy_required_approvals_block);
});

test("duplicate approvers are rejected", () => {
  const result = validatePolicySubmission(buildPayload({ approverSlackIds: ["U0GARY123", "U0GARY123"] }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.policy_approvers_block);
});

test("a disabled policy with a threshold exceeding zero approvers is still accepted — the stored threshold is inert while disabled", () => {
  const result = validatePolicySubmission(buildPayload({ approverSlackIds: [], requiredApprovals: "5", status: POLICY_STATUS_DISABLED }));
  assert.equal(result.ok, true);
});

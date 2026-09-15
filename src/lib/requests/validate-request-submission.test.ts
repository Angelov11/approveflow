import assert from "node:assert/strict";
import test from "node:test";
import type { ViewSubmissionPayload } from "./validate-request-submission.ts";
import { validateRequestSubmission } from "./validate-request-submission.ts";

const validRequestTypeKeys = ["production_access", "deployment_approval", "custom"];

function buildPayload(
  overrides: {
    requestType?: string;
    resource?: string;
    reason?: string;
    duration?: string;
    privateMetadata?: string;
    approver?: string | null;
  } = {},
): ViewSubmissionPayload {
  const {
    requestType = "production_access",
    resource = "AWS Production",
    reason = "Need to debug an incident",
    duration = "60",
    privateMetadata = JSON.stringify({ idempotencyKey: "11111111-1111-1111-1111-111111111111" }),
    approver = "U0GARY123",
  } = overrides;

  return {
    type: "view_submission",
    team: { id: "T123" },
    user: { id: "U123" },
    view: {
      callback_id: "approveflow_new_request",
      private_metadata: privateMetadata,
      state: {
        values: {
          request_type_block: { request_type_select: { selected_option: { value: requestType } } },
          resource_block: { resource_input: { value: resource } },
          reason_block: { reason_input: { value: reason } },
          duration_block: { duration_select: { selected_option: { value: duration } } },
          approver_block: { approver_select: { selected_user: approver ?? undefined } },
        },
      },
    },
  };
}

test("valid submission is accepted", () => {
  const result = validateRequestSubmission(buildPayload(), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.slackTeamId, "T123");
    assert.equal(result.data.slackUserId, "U123");
    assert.equal(result.data.requestTypeKey, "production_access");
    assert.equal(result.data.resource, "AWS Production");
    assert.equal(result.data.requestedDurationMinutes, 60);
    assert.equal(result.data.idempotencyKey, "11111111-1111-1111-1111-111111111111");
    assert.equal(result.data.selectedApproverSlackId, "U0GARY123");
  }
});

test("not applicable duration resolves to null minutes", () => {
  const result = validateRequestSubmission(buildPayload({ duration: "not_applicable" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.requestedDurationMinutes, null);
  }
});

test("unknown request type is rejected with a field error", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "totally_made_up" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.request_type_block);
  }
});

test("malformed/unknown duration is rejected with a field error", () => {
  const result = validateRequestSubmission(buildPayload({ duration: "999" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.duration_block);
  }
});

test("empty resource is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ resource: "   " }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.resource_block);
  }
});

test("empty reason is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ reason: "" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.reason_block);
  }
});

test("oversized resource is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ resource: "x".repeat(201) }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.resource_block);
  }
});

test("missing/malformed private_metadata is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ privateMetadata: "not-json" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
});

test("multiple invalid fields all report their own errors", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "bogus", resource: "", reason: "", duration: "bogus" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(Object.keys(result.errors).length, 4);
  }
});

// --- Approver selection (M4) ---

test("a valid selected approver is accepted", () => {
  const result = validateRequestSubmission(buildPayload({ approver: "U0MIKE456" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.selectedApproverSlackId, "U0MIKE456");
  }
});

test("a missing approver selection is rejected with a field error", () => {
  const result = validateRequestSubmission(buildPayload({ approver: null }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.approver_block);
  }
});

test("a malformed approver value is rejected with a field error", () => {
  const result = validateRequestSubmission(buildPayload({ approver: "not-a-slack-id" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.approver_block);
  }
});

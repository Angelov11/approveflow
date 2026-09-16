import assert from "node:assert/strict";
import test from "node:test";
import type { ViewSubmissionPayload } from "./validate-request-submission.ts";
import { validateRequestSubmission } from "./validate-request-submission.ts";

const validRequestTypeKeys = ["vacation_time_off", "doctor_appointment", "other"];

function buildPayload(
  overrides: {
    requestType?: string;
    resource?: string;
    duration?: string;
    privateMetadata?: string;
    approver?: string | null;
  } = {},
): ViewSubmissionPayload {
  const {
    requestType = "vacation_time_off",
    resource = "Family vacation",
    duration = "1440",
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
    assert.equal(result.data.requestTypeKey, "vacation_time_off");
    assert.equal(result.data.resource, "Family vacation");
    assert.equal(result.data.requestedDurationMinutes, 1440);
    assert.equal(result.data.idempotencyKey, "11111111-1111-1111-1111-111111111111");
    assert.equal(result.data.selectedApproverSlackId, "U0GARY123");
  }
});

test("no separate 'reason' field is collected — Details is the only free-text field", () => {
  const result = validateRequestSubmission(buildPayload(), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(!("reason" in result.data));
  }
});

test("'not applicable' / 'other, not specified' duration resolves to null minutes", () => {
  const result = validateRequestSubmission(buildPayload({ duration: "not_applicable" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.requestedDurationMinutes, null);
  }
});

test("a multi-day duration option (e.g. '2 days') resolves correctly", () => {
  const result = validateRequestSubmission(buildPayload({ duration: "2880" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.requestedDurationMinutes, 2880);
  }
});

test("unknown request type is rejected with a field error", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "totally_made_up" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.request_type_block);
  }
});

test("a legacy/deactivated request type key is rejected the same as any other invalid key", () => {
  // validRequestTypeKeys is resolved fresh from listActiveRequestTypes() by
  // the caller — a legacy key like production_access simply won't be in it
  // once deactivated, so it's rejected through the exact same "unknown
  // request type" path as a fully made-up key. No special-casing needed.
  const result = validateRequestSubmission(buildPayload({ requestType: "production_access" }), { validRequestTypeKeys });
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

test("empty details are rejected", () => {
  const result = validateRequestSubmission(buildPayload({ resource: "   " }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.resource_block);
  }
});

test("oversized details are rejected", () => {
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
  const result = validateRequestSubmission(buildPayload({ requestType: "bogus", resource: "", duration: "bogus" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(Object.keys(result.errors).length, 3);
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

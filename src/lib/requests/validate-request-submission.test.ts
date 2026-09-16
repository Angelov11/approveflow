import assert from "node:assert/strict";
import test from "node:test";
import type { ViewSubmissionPayload } from "./validate-request-submission.ts";
import { validateRequestSubmission } from "./validate-request-submission.ts";

const validRequestTypeKeys = ["vacation_time_off", "doctor_appointment", "other"];

function buildPayload(
  overrides: {
    requestType?: string;
    resource?: string;
    startDate?: string | null;
    startTime?: string | null;
    endDate?: string | null;
    endTime?: string | null;
    privateMetadata?: string;
    approver?: string | null;
  } = {},
): ViewSubmissionPayload {
  const {
    requestType = "vacation_time_off",
    resource = "Family vacation",
    startDate = "2026-09-21",
    startTime = null,
    endDate = "2026-09-25",
    endTime = null,
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
          start_date_block: { start_date_picker: { selected_date: startDate ?? undefined } },
          start_time_block: { start_time_picker: { selected_time: startTime ?? undefined } },
          end_date_block: { end_date_picker: { selected_date: endDate ?? undefined } },
          end_time_block: { end_time_picker: { selected_time: endTime ?? undefined } },
          approver_block: { approver_select: { selected_user: approver ?? undefined } },
        },
      },
    },
  };
}

test("valid submission is accepted, with the timing mapped exactly as supplied", () => {
  const result = validateRequestSubmission(buildPayload(), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.slackTeamId, "T123");
    assert.equal(result.data.slackUserId, "U123");
    assert.equal(result.data.requestTypeKey, "vacation_time_off");
    assert.equal(result.data.resource, "Family vacation");
    assert.deepEqual(result.data.timing, { startDate: "2026-09-21", startTime: null, endDate: "2026-09-25", endTime: null });
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

test("all timing fields omitted maps to an all-null timing object and still succeeds", () => {
  const result = validateRequestSubmission(
    buildPayload({ startDate: null, startTime: null, endDate: null, endTime: null }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.timing, { startDate: null, startTime: null, endDate: null, endTime: null });
  }
});

test("a same-day timed submission maps every field exactly", () => {
  const result = validateRequestSubmission(
    buildPayload({ startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "12:00" }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.timing, { startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "12:00" });
  }
});

test("an invalid timing combination surfaces as a field error and rejects the whole submission", () => {
  // end time without an end date — invalid per request-timing.ts
  const result = validateRequestSubmission(buildPayload({ endDate: null, endTime: "12:00" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.end_time_block);
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
  const result = validateRequestSubmission(
    buildPayload({ requestType: "bogus", resource: "", endDate: null, endTime: "12:00" }),
    { validRequestTypeKeys },
  );
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

import assert from "node:assert/strict";
import test from "node:test";
import type { ViewSubmissionPayload } from "./validate-request-submission.ts";
import { validateRequestSubmission } from "./validate-request-submission.ts";

const validRequestTypeKeys = [
  "vacation_time_off",
  "work_from_home",
  "personal_time",
  "doctor_appointment",
  "schedule_change",
  "expense_purchase",
  "other",
];

interface Overrides {
  requestType?: string;
  resource?: string | null;
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  amount?: string | null;
  currency?: string | null;
  privateMetadata?: string;
  approver?: string | null;
}

function buildPayload(overrides: Overrides = {}): ViewSubmissionPayload {
  const {
    requestType = "vacation_time_off",
    resource = "Family vacation",
    startDate = null,
    startTime = null,
    endDate = null,
    endTime = null,
    amount = null,
    currency = null,
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
          request_type_block: { request_type_select: { selected_option: { value: requestType ?? undefined } } },
          resource_block: { resource_input: { value: resource ?? undefined } },
          start_date_block: { start_date_picker: { selected_date: startDate ?? undefined } },
          start_time_block: { start_time_picker: { selected_time: startTime ?? undefined } },
          end_date_block: { end_date_picker: { selected_date: endDate ?? undefined } },
          end_time_block: { end_time_picker: { selected_time: endTime ?? undefined } },
          expense_amount_block: { expense_amount_input: { value: amount ?? undefined } },
          expense_currency_block: { expense_currency_select: { selected_option: { value: currency ?? undefined } } },
          approver_block: { approver_select: { selected_user: approver ?? undefined } },
        },
      },
    },
  };
}

// --- Universal fields ---

test("Details are required for every request type", () => {
  const result = validateRequestSubmission(buildPayload({ resource: "" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.resource_block);
});

test("M9: a missing Approver is NOT rejected by this pure validator alone — whether it's required depends on live policy state the caller resolves separately", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "other", approver: null }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.selectedApproverSlackId, null);
  }
});

test("oversized Details are rejected", () => {
  const result = validateRequestSubmission(buildPayload({ resource: "x".repeat(201) }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.resource_block);
});

test("an unknown request type is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "totally_made_up" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.request_type_block);
});

test("a legacy/deactivated request type key is rejected the same as any other invalid key", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "production_access" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.request_type_block);
});

test("missing/malformed private_metadata is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ privateMetadata: "not-json" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
});

// --- DATE_RANGE (Vacation / Time Off, Work From Home, Personal Time) ---

for (const type of ["vacation_time_off", "work_from_home", "personal_time"]) {
  test(`${type}: valid start+end date range is accepted`, () => {
    const result = validateRequestSubmission(buildPayload({ requestType: type, startDate: "2026-09-21", endDate: "2026-09-25" }), {
      validRequestTypeKeys,
    });
    assert.equal(result.ok, true);
  });

  test(`${type}: missing dates are rejected`, () => {
    const result = validateRequestSubmission(buildPayload({ requestType: type }), { validRequestTypeKeys });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.start_date_block);
      assert.ok(result.errors.end_date_block);
    }
  });

  test(`${type}: end date before start date is rejected`, () => {
    const result = validateRequestSubmission(
      buildPayload({ requestType: type, startDate: "2026-09-25", endDate: "2026-09-21" }),
      { validRequestTypeKeys },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.end_date_block);
  });

  test(`${type}: crafted times are rejected even though the modal never shows them`, () => {
    const result = validateRequestSubmission(
      buildPayload({ requestType: type, startDate: "2026-09-21", endDate: "2026-09-25", startTime: "09:00" }),
      { validRequestTypeKeys },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.start_time_block);
  });
}

test("vacation_time_off: persists exactly the submitted date range with null times", () => {
  const result = validateRequestSubmission(
    buildPayload({ requestType: "vacation_time_off", startDate: "2026-09-21", endDate: "2026-09-25" }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.timing, { startDate: "2026-09-21", startTime: null, endDate: "2026-09-25", endTime: null });
    assert.deepEqual(result.data.expense, { amount: null, currency: null });
  }
});

// --- SINGLE_DATE_TIME_RANGE (Doctor Appointment, Schedule Change) ---

for (const type of ["doctor_appointment", "schedule_change"]) {
  test(`${type}: valid date + start/end time is accepted`, () => {
    const result = validateRequestSubmission(
      buildPayload({ requestType: type, startDate: "2026-09-18", startTime: "10:00", endTime: "12:00" }),
      { validRequestTypeKeys },
    );
    assert.equal(result.ok, true);
  });

  test(`${type}: missing date is rejected`, () => {
    const result = validateRequestSubmission(buildPayload({ requestType: type, startTime: "10:00", endTime: "12:00" }), {
      validRequestTypeKeys,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.start_date_block);
  });

  test(`${type}: missing start time is rejected`, () => {
    const result = validateRequestSubmission(buildPayload({ requestType: type, startDate: "2026-09-18", endTime: "12:00" }), {
      validRequestTypeKeys,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.start_time_block);
  });

  test(`${type}: missing end time is rejected`, () => {
    const result = validateRequestSubmission(buildPayload({ requestType: type, startDate: "2026-09-18", startTime: "10:00" }), {
      validRequestTypeKeys,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.end_time_block);
  });

  test(`${type}: end time not after start time is rejected`, () => {
    const result = validateRequestSubmission(
      buildPayload({ requestType: type, startDate: "2026-09-18", startTime: "12:00", endTime: "10:00" }),
      { validRequestTypeKeys },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.end_time_block);
  });

  test(`${type}: a crafted different end date is rejected — never made to select the same date twice, never silently accepted either`, () => {
    const result = validateRequestSubmission(
      buildPayload({ requestType: type, startDate: "2026-09-18", startTime: "10:00", endTime: "12:00", endDate: "2026-09-19" }),
      { validRequestTypeKeys },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.end_date_block);
  });
}

test("doctor_appointment: persists end_date equal to the single selected date — never a different fabricated date", () => {
  const result = validateRequestSubmission(
    buildPayload({ requestType: "doctor_appointment", startDate: "2026-09-18", startTime: "10:00", endTime: "12:00" }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.timing, { startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "12:00" });
  }
});

// --- NONE (Expense / Purchase) ---

test("expense_purchase: valid amount + currency is accepted", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", amount: "499.99", currency: "EUR" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, true);
});

test("expense_purchase: missing amount is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", currency: "EUR" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("expense_purchase: missing currency is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", amount: "499.99" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_currency_block);
});

test("expense_purchase: zero amount is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", amount: "0", currency: "EUR" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("expense_purchase: negative amount is rejected", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", amount: "-5", currency: "EUR" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("expense_purchase: more than 2 decimal places is rejected, not rounded", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", amount: "499.999", currency: "EUR" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("expense_purchase: a crafted timing field is rejected even though the modal never shows it", () => {
  const result = validateRequestSubmission(
    buildPayload({ requestType: "expense_purchase", amount: "499.99", currency: "EUR", startDate: "2026-09-21" }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.start_date_block);
});

test("expense_purchase: persists exactly the submitted amount/currency with all timing fields null", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "expense_purchase", amount: "499.99", currency: "EUR" }), {
    validRequestTypeKeys,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.expense, { amount: 499.99, currency: "EUR" });
    assert.deepEqual(result.data.timing, { startDate: null, startTime: null, endDate: null, endTime: null });
  }
});

// --- OPTIONAL_RANGE (Other Request) ---

test("other: no timing at all is valid", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "other" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
});

test("other: a full valid timing range is accepted", () => {
  const result = validateRequestSubmission(
    buildPayload({ requestType: "other", startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-25", endTime: "17:00" }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, true);
});

test("other: an invalid timing combination (end before start) is rejected", () => {
  const result = validateRequestSubmission(
    buildPayload({ requestType: "other", startDate: "2026-09-25", endDate: "2026-09-21" }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_date_block);
});

test("other: a crafted amount/currency is rejected — expense doesn't apply to this type", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "other", amount: "10", currency: "USD" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

// --- Multiple simultaneous errors ---

test("multiple invalid fields all report their own errors", () => {
  const result = validateRequestSubmission(
    buildPayload({ requestType: "vacation_time_off", resource: "", startDate: null, endDate: null }),
    { validRequestTypeKeys },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.resource_block);
    assert.ok(result.errors.start_date_block);
    assert.ok(result.errors.end_date_block);
  }
});

// --- Approver selection (M4) ---

test("a valid selected approver is accepted", () => {
  // "other" has fully optional timing — isolates this test to approver
  // validation alone, independent of any request type's timing rules.
  const result = validateRequestSubmission(buildPayload({ requestType: "other", approver: "U0MIKE456" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.selectedApproverSlackId, "U0MIKE456");
  }
});

test("a malformed approver value is rejected with a field error", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "other", approver: "not-a-slack-id" }), { validRequestTypeKeys });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.approver_block);
});

test("no separate 'reason' field is collected — Details is the only free-text field", () => {
  const result = validateRequestSubmission(buildPayload({ requestType: "other" }), { validRequestTypeKeys });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(!("reason" in result.data));
  }
});

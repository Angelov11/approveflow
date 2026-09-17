import assert from "node:assert/strict";
import test from "node:test";
import { buildRequestModal, REQUEST_MODAL_CALLBACK_ID, type BuildRequestModalParams } from "./build-request-modal.ts";

interface PlainInputBlock {
  block_id: string;
  optional?: boolean;
  label: { text: string };
  hint?: { text: string };
  element: {
    type: string;
    action_id: string;
    max_length?: number;
    initial_value?: string;
    initial_date?: string;
    initial_time?: string;
    initial_user?: string;
    initial_option?: { value: string };
    options?: { text: { text: string }; value: string }[];
  };
}

interface PlainSectionLabelBlock {
  type: "context";
  elements: { text: string }[];
}

interface PlainModalView {
  callback_id: string;
  private_metadata: string;
  title: { text: string };
  blocks: (PlainInputBlock | PlainSectionLabelBlock | { type: "divider" })[];
}

const requestTypes = [
  { key: "vacation_time_off", name: "Vacation / Time Off" },
  { key: "doctor_appointment", name: "Doctor Appointment" },
  { key: "expense_purchase", name: "Expense / Purchase" },
  { key: "other", name: "Other Request" },
];

function build(params: Omit<BuildRequestModalParams, "requestTypes" | "idempotencyKey">= {}): PlainModalView {
  return buildRequestModal({
    requestTypes,
    idempotencyKey: "11111111-1111-1111-1111-111111111111",
    ...params,
  }) as unknown as PlainModalView;
}

function inputBlockIds(view: PlainModalView): string[] {
  return view.blocks.filter((b): b is PlainInputBlock => "label" in b).map((b) => b.block_id);
}

// --- Modal initial state (no type selected yet) ---

test("initial state (no type selected) shows only Request Type, Details, and Approver — no WHEN or EXPENSE fields", () => {
  const view = build();
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "approver_block"]);
});

test("callback id and private_metadata carry the idempotency key", () => {
  const view = build();
  assert.equal(view.callback_id, REQUEST_MODAL_CALLBACK_ID);
  assert.deepEqual(JSON.parse(view.private_metadata), { idempotencyKey: "11111111-1111-1111-1111-111111111111" });
});

test("request type options reflect exactly what the caller passed in", () => {
  const view = build();
  const typeBlock = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "request_type_block");
  assert.deepEqual(
    typeBlock?.element.options?.map((o) => ({ label: o.text.text, value: o.value })),
    requestTypes.map((t) => ({ label: t.name, value: t.key })),
  );
});

test("Request Type dispatches an action on change (dynamic modal mechanism)", () => {
  const view = build();
  const typeBlock = view.blocks.find((b): b is PlainInputBlock & { dispatch_action?: boolean } => "block_id" in b && b.block_id === "request_type_block");
  assert.equal((typeBlock as unknown as { dispatch_action?: boolean })?.dispatch_action, true);
});

test("the approver field no longer exposes the internal policy-routing hint to ordinary employees", () => {
  const view = build();
  const approverBlock = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "approver_block");
  assert.equal(approverBlock?.hint, undefined);
});

// --- Dynamic field sets per selected type ---

test("Vacation / Time Off shows Start date + End date only — no times, no amount/currency", () => {
  const view = build({ selectedTypeKey: "vacation_time_off" });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "start_date_block", "end_date_block", "approver_block"]);
});

test("Work From Home shows Start date + End date only", () => {
  const view = build({ selectedTypeKey: "work_from_home" });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "start_date_block", "end_date_block", "approver_block"]);
});

test("Personal Time shows Start date + End date only", () => {
  const view = build({ selectedTypeKey: "personal_time" });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "start_date_block", "end_date_block", "approver_block"]);
});

test("Vacation's date fields are required (not optional)", () => {
  const view = build({ selectedTypeKey: "vacation_time_off" });
  const startDate = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "start_date_block");
  const endDate = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "end_date_block");
  assert.notEqual(startDate?.optional, true);
  assert.notEqual(endDate?.optional, true);
});

test("Doctor Appointment shows exactly one Date field plus Start time and End time — no End date selector", () => {
  const view = build({ selectedTypeKey: "doctor_appointment" });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "start_date_block", "start_time_block", "end_time_block", "approver_block"]);
  const dateBlock = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "start_date_block");
  assert.equal(dateBlock?.label.text, "Date");
});

test("Schedule Change uses the same one-date-plus-times shape as Doctor Appointment", () => {
  const view = build({ selectedTypeKey: "schedule_change" });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "start_date_block", "start_time_block", "end_time_block", "approver_block"]);
});

test("Expense / Purchase shows Amount + Currency only — no timing fields at all", () => {
  const view = build({ selectedTypeKey: "expense_purchase" });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "expense_amount_block", "expense_currency_block", "approver_block"]);
});

test("Expense currency options are the supported MVP currency list", () => {
  const view = build({ selectedTypeKey: "expense_purchase" });
  const currencyBlock = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "expense_currency_block");
  assert.deepEqual(
    currencyBlock?.element.options?.map((o) => o.value),
    ["USD", "EUR", "GBP", "MKD", "CAD", "AUD"],
  );
});

test("Other Request shows the full optional 4-field timing shape — the flexible escape hatch", () => {
  const view = build({ selectedTypeKey: "other" });
  assert.deepEqual(inputBlockIds(view), [
    "request_type_block",
    "resource_block",
    "start_date_block",
    "start_time_block",
    "end_date_block",
    "end_time_block",
    "approver_block",
  ]);
});

test("Other Request's timing fields are all optional", () => {
  const view = build({ selectedTypeKey: "other" });
  for (const blockId of ["start_date_block", "start_time_block", "end_date_block", "end_time_block"]) {
    const block = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === blockId);
    assert.equal(block?.optional, true);
  }
});

test("WHEN section label appears only when the type has timing fields", () => {
  const withTiming = build({ selectedTypeKey: "vacation_time_off" });
  const withoutTiming = build({ selectedTypeKey: "expense_purchase" });
  const initial = build();
  assert.ok(withTiming.blocks.some((b) => "elements" in b && b.elements.some((e) => e.text.includes("When"))));
  assert.ok(!withoutTiming.blocks.some((b) => "elements" in b && b.elements.some((e) => e.text.includes("When"))));
  assert.ok(!initial.blocks.some((b) => "elements" in b && b.elements.some((e) => e.text.includes("When"))));
});

test("EXPENSE section label appears only for Expense / Purchase", () => {
  const expense = build({ selectedTypeKey: "expense_purchase" });
  const vacation = build({ selectedTypeKey: "vacation_time_off" });
  assert.ok(expense.blocks.some((b) => "elements" in b && b.elements.some((e) => e.text.includes("Expense"))));
  assert.ok(!vacation.blocks.some((b) => "elements" in b && b.elements.some((e) => e.text.includes("Expense"))));
});

// --- Details placeholder adapts per type (cheap, no dynamic complexity) ---

test("Details placeholder adapts to the selected type", () => {
  const vacation = build({ selectedTypeKey: "vacation_time_off" });
  const details = vacation.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "resource_block");
  assert.ok(details?.element.max_length === 200);
});

// --- Input preservation (initial_value/initial_date/initial_time/initial_user) ---

test("preserved Details and Approver are carried over as initial values", () => {
  const view = build({
    selectedTypeKey: "vacation_time_off",
    preserved: { resource: "Family vacation", approverSlackId: "U0MANAGER" },
  });
  const details = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "resource_block");
  const approver = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "approver_block");
  assert.equal(details?.element.initial_value, "Family vacation");
  assert.equal(approver?.element.initial_user, "U0MANAGER");
});

test("preserved compatible dates are carried over as initial_date", () => {
  const view = build({
    selectedTypeKey: "vacation_time_off",
    preserved: { timing: { startDate: "2026-09-21", startTime: null, endDate: "2026-09-25", endTime: null } },
  });
  const startDate = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "start_date_block");
  const endDate = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "end_date_block");
  assert.equal(startDate?.element.initial_date, "2026-09-21");
  assert.equal(endDate?.element.initial_date, "2026-09-25");
});

test("hidden/inapplicable fields for the new type are simply not rendered, even if preserved data exists for them", () => {
  const view = build({
    selectedTypeKey: "expense_purchase",
    preserved: { timing: { startDate: "2026-09-21", startTime: null, endDate: "2026-09-25", endTime: null } },
  });
  assert.deepEqual(inputBlockIds(view), ["request_type_block", "resource_block", "expense_amount_block", "expense_currency_block", "approver_block"]);
});

test("a selected type is reflected as the Request Type select's initial_option", () => {
  const view = build({ selectedTypeKey: "doctor_appointment" });
  const typeBlock = view.blocks.find((b): b is PlainInputBlock => "block_id" in b && b.block_id === "request_type_block");
  assert.equal(typeBlock?.element.initial_option?.value, "doctor_appointment");
});

// --- M9: policy-aware Approver field ---

test("with no active policy for the selected type, the Approver picker is shown (DIRECT)", () => {
  const view = build({ selectedTypeKey: "vacation_time_off" });
  assert.ok(inputBlockIds(view).includes("approver_block"));
});

test("with an active policy for the selected type, the Approver picker is REPLACED by a read-only routing summary", () => {
  const view = build({
    selectedTypeKey: "expense_purchase",
    activePolicySummary: { approverSlackIds: ["U0GARY123", "U0FINANCE1"], requiredApprovals: 2 },
  });
  assert.ok(!inputBlockIds(view).includes("approver_block"));
  const text = JSON.stringify(view.blocks);
  assert.ok(text.includes("Automatically routed according to workspace policy"));
  assert.ok(text.includes("<@U0GARY123>"));
  assert.ok(text.includes("<@U0FINANCE1>"));
  assert.ok(text.includes("2 approvals required"));
});

test("policy summary singular phrasing for exactly one required approval", () => {
  const view = build({ selectedTypeKey: "expense_purchase", activePolicySummary: { approverSlackIds: ["U0GARY123"], requiredApprovals: 1 } });
  const text = JSON.stringify(view.blocks);
  assert.ok(text.includes("1 approval required"));
  assert.ok(!text.includes("1 approvals required"));
});

test("switching from a policy-governed type back to one with no policy restores the Approver picker (POLICY -> DIRECT)", () => {
  const withPolicy = build({ selectedTypeKey: "expense_purchase", activePolicySummary: { approverSlackIds: ["U0GARY123"], requiredApprovals: 1 } });
  const withoutPolicy = build({ selectedTypeKey: "vacation_time_off", activePolicySummary: null });
  assert.ok(!inputBlockIds(withPolicy).includes("approver_block"));
  assert.ok(inputBlockIds(withoutPolicy).includes("approver_block"));
});

test("switching from DIRECT to a policy-governed type hides the Approver picker (DIRECT -> POLICY), other type-aware fields unaffected", () => {
  const view = build({
    selectedTypeKey: "expense_purchase",
    activePolicySummary: { approverSlackIds: ["U0GARY123"], requiredApprovals: 1 },
    preserved: { resource: "External monitor", expense: { amount: "499.99", currency: "EUR" } },
  });
  const blockIds = inputBlockIds(view);
  assert.ok(!blockIds.includes("approver_block"));
  assert.ok(blockIds.includes("expense_amount_block"));
  assert.ok(blockIds.includes("expense_currency_block"));
});

test("no type selected yet: Approver picker still shows by default (no policy summary to evaluate)", () => {
  const view = build();
  assert.ok(inputBlockIds(view).includes("approver_block"));
});

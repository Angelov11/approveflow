import assert from "node:assert/strict";
import test from "node:test";
import { buildRequestModal, REQUEST_MODAL_CALLBACK_ID } from "./build-request-modal.ts";

interface PlainInputBlock {
  block_id: string;
  optional?: boolean;
  label: { text: string };
  hint?: { text: string };
  element: { type: string; action_id: string; max_length?: number; multiline?: boolean; options?: { text: { text: string }; value: string }[] };
}

interface PlainModalView {
  callback_id: string;
  private_metadata: string;
  title: { text: string };
  blocks: PlainInputBlock[];
}

const requestTypes = [
  { key: "vacation_time_off", name: "Vacation / Time Off" },
  { key: "doctor_appointment", name: "Doctor Appointment" },
];

function build(): PlainModalView {
  return buildRequestModal({ requestTypes, idempotencyKey: "11111111-1111-1111-1111-111111111111" }) as unknown as PlainModalView;
}

test("field set is exactly Request type, Details, Start date, Start time, End date, End time, Approver — no separate Reason field, no duration dropdown", () => {
  const view = build();
  const labels = view.blocks.map((b) => b.label.text);
  assert.deepEqual(labels, ["Request type", "Details", "Start date", "Start time", "End date", "End time", "Approver"]);
});

test("the duration dropdown is gone entirely — no static_select for timing", () => {
  const view = build();
  assert.equal(view.blocks.find((b) => b.block_id === "duration_block"), undefined);
});

test("the Details field uses workplace-friendly copy, not 'Resource'", () => {
  const view = build();
  const detailsBlock = view.blocks.find((b) => b.block_id === "resource_block");
  assert.equal(detailsBlock?.label.text, "Details");
  assert.equal(detailsBlock?.element.type, "plain_text_input");
});

test("Start date uses a native Slack datepicker and is optional", () => {
  const view = build();
  const block = view.blocks.find((b) => b.block_id === "start_date_block");
  assert.equal(block?.element.type, "datepicker");
  assert.equal(block?.optional, true);
});

test("Start time uses a native Slack timepicker and is optional", () => {
  const view = build();
  const block = view.blocks.find((b) => b.block_id === "start_time_block");
  assert.equal(block?.element.type, "timepicker");
  assert.equal(block?.optional, true);
});

test("End date uses a native Slack datepicker and is optional", () => {
  const view = build();
  const block = view.blocks.find((b) => b.block_id === "end_date_block");
  assert.equal(block?.element.type, "datepicker");
  assert.equal(block?.optional, true);
});

test("End time uses a native Slack timepicker and is optional", () => {
  const view = build();
  const block = view.blocks.find((b) => b.block_id === "end_time_block");
  assert.equal(block?.element.type, "timepicker");
  assert.equal(block?.optional, true);
});

test("request type options reflect exactly what the caller passed in", () => {
  const view = build();
  const typeBlock = view.blocks.find((b) => b.block_id === "request_type_block");
  assert.deepEqual(
    typeBlock?.element.options?.map((o) => ({ label: o.text.text, value: o.value })),
    [
      { label: "Vacation / Time Off", value: "vacation_time_off" },
      { label: "Doctor Appointment", value: "doctor_appointment" },
    ],
  );
});

test("the native Slack user picker remains the approver element, and approver is required (no `optional: true`)", () => {
  const view = build();
  const approverBlock = view.blocks.find((b) => b.block_id === "approver_block");
  assert.equal(approverBlock?.element.type, "users_select");
  assert.notEqual(approverBlock?.optional, true);
});

test("the approver field no longer exposes the internal policy-routing hint to ordinary employees", () => {
  const view = build();
  const approverBlock = view.blocks.find((b) => b.block_id === "approver_block");
  assert.equal(approverBlock?.hint, undefined);
});

test("callback id and private_metadata carry the idempotency key", () => {
  const view = build();
  assert.equal(view.callback_id, REQUEST_MODAL_CALLBACK_ID);
  assert.deepEqual(JSON.parse(view.private_metadata), { idempotencyKey: "11111111-1111-1111-1111-111111111111" });
});

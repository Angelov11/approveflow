import assert from "node:assert/strict";
import test from "node:test";
import { buildRequestModal, REQUEST_MODAL_CALLBACK_ID } from "./build-request-modal.ts";

interface PlainInputBlock {
  block_id: string;
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

test("field set is exactly Request type, Details, When / Duration, Approver — no separate Reason field", () => {
  const view = build();
  const labels = view.blocks.map((b) => b.label.text);
  assert.deepEqual(labels, ["Request type", "Details", "When / Duration", "Approver"]);
});

test("the Details field uses workplace-friendly copy, not 'Resource'", () => {
  const view = build();
  const detailsBlock = view.blocks.find((b) => b.block_id === "resource_block");
  assert.equal(detailsBlock?.label.text, "Details");
  assert.equal(detailsBlock?.element.type, "plain_text_input");
});

test("the When / Duration field offers the full workplace duration option set", () => {
  const view = build();
  const durationBlock = view.blocks.find((b) => b.block_id === "duration_block");
  const optionLabels = durationBlock?.element.options?.map((o) => o.text.text);
  assert.ok(optionLabels?.includes("Half day"));
  assert.ok(optionLabels?.includes("1 week"));
  assert.ok(optionLabels?.includes("Other / Not specified"));
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
  const approverBlock = view.blocks.find((b) => b.block_id === "approver_block") as unknown as { optional?: boolean; element: { type: string } };
  assert.equal(approverBlock.element.type, "users_select");
  assert.notEqual(approverBlock.optional, true);
});

test("callback id and private_metadata carry the idempotency key", () => {
  const view = build();
  assert.equal(view.callback_id, REQUEST_MODAL_CALLBACK_ID);
  assert.deepEqual(JSON.parse(view.private_metadata), { idempotencyKey: "11111111-1111-1111-1111-111111111111" });
});

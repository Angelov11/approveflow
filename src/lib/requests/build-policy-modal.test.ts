import assert from "node:assert/strict";
import test from "node:test";

import { buildPolicyModal } from "./build-policy-modal.ts";

function blocksToText(view: { blocks?: unknown[] }): string {
  return JSON.stringify(view.blocks);
}

test("a fresh Configure (no existing policy) starts with empty approvers and a default threshold of 1, Active", () => {
  const view = buildPolicyModal({ requestTypeId: "rt-1", requestTypeName: "Expense / Purchase" });
  const text = blocksToText(view);
  assert.ok(text.includes("Expense / Purchase"));
  assert.ok(!text.includes("initial_users"));
  assert.ok(text.includes('"value":"1"'));
  assert.ok(text.includes('"value":"ACTIVE"'));
});

test("Edit pre-fills the existing approvers, threshold, and Active status", () => {
  const view = buildPolicyModal({
    requestTypeId: "rt-1",
    requestTypeName: "Expense / Purchase",
    existing: { approverSlackIds: ["U0GARY123", "U0MIKE456"], requiredApprovals: 2, active: true },
  });
  const text = blocksToText(view);
  assert.ok(text.includes("U0GARY123"));
  assert.ok(text.includes("U0MIKE456"));
  assert.ok(text.includes('"value":"2"'));
  assert.ok(text.includes('"value":"ACTIVE"'));
});

test("Edit pre-fills Disabled status for a currently-inactive policy", () => {
  const view = buildPolicyModal({
    requestTypeId: "rt-1",
    requestTypeName: "Expense / Purchase",
    existing: { approverSlackIds: ["U0GARY123"], requiredApprovals: 1, active: false },
  });
  const text = blocksToText(view);
  assert.ok(text.includes('"text":"Disabled"'));
});

test("the request type is shown read-only, never as a selectable/editable input", () => {
  const view = buildPolicyModal({ requestTypeId: "rt-1", requestTypeName: "Expense / Purchase" });
  const typeBlock = (view.blocks as { type: string; text?: { text: string } }[]).find((b) => b.type === "section" && b.text?.text.includes("Request Type"));
  assert.ok(typeBlock);
});

test("private_metadata carries only the opaque request_type_id locator", () => {
  const view = buildPolicyModal({ requestTypeId: "rt-1", requestTypeName: "Expense / Purchase" });
  assert.deepEqual(JSON.parse(view.private_metadata as string), { requestTypeId: "rt-1" });
});

test("includes the live-membership warning copy", () => {
  const view = buildPolicyModal({ requestTypeId: "rt-1", requestTypeName: "Expense / Purchase" });
  assert.ok(blocksToText(view).includes("Changing approvers affects pending requests"));
});

test("the approvers picker is a multi_users_select with a sensible MVP cap", () => {
  const view = buildPolicyModal({ requestTypeId: "rt-1", requestTypeName: "Expense / Purchase" });
  const text = blocksToText(view);
  assert.ok(text.includes("multi_users_select"));
  assert.ok(text.includes('"max_selected_items":10'));
});

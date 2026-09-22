import assert from "node:assert/strict";
import test from "node:test";

import { buildManagePoliciesView } from "./build-policy-views.ts";
import type { PolicySummary } from "./policy-configuration.ts";

function blocksToText(view: { blocks?: unknown[] }): string {
  return JSON.stringify(view.blocks);
}

const noPolicy: PolicySummary = { requestTypeId: "rt-1", requestTypeKey: "vacation_time_off", requestTypeName: "Vacation / Time Off", policy: null };
const withPolicy: PolicySummary = {
  requestTypeId: "rt-2",
  requestTypeKey: "expense_purchase",
  requestTypeName: "Expense / Purchase",
  policy: { approverSlackIds: ["U0GARY123", "U0FINANCE1"], requiredApprovals: 2, active: true },
};

const PRO = { canManageApprovalPolicies: true };
const FREE = { canManageApprovalPolicies: false };

test("a request type with no policy shows the DIRECT explanation and a Configure button", () => {
  const view = buildManagePoliciesView([noPolicy], PRO);
  const text = blocksToText(view);
  assert.ok(text.includes("Vacation / Time Off"));
  assert.ok(text.includes("No policy"));
  assert.ok(text.includes("employees choose an approver"));
  assert.ok(text.includes('"text":"Configure"'));
});

test("a request type with an active policy shows approver mentions, required count, and an Edit button", () => {
  const view = buildManagePoliciesView([withPolicy], PRO);
  const text = blocksToText(view);
  assert.ok(text.includes("Expense / Purchase"));
  assert.ok(text.includes("<@U0GARY123>"));
  assert.ok(text.includes("<@U0FINANCE1>"));
  assert.ok(text.includes("2 approvals required"));
  assert.ok(text.includes('"text":"Edit"'));
});

test("singular phrasing for exactly one required approval", () => {
  const view = buildManagePoliciesView([{ ...withPolicy, policy: { ...withPolicy.policy!, requiredApprovals: 1 } }], PRO);
  assert.ok(blocksToText(view).includes("1 approval required"));
  assert.ok(!blocksToText(view).includes("1 approvals required"));
});

test("each row's button value is the request_type_id, an opaque locator", () => {
  const view = buildManagePoliciesView([noPolicy, withPolicy], PRO);
  const text = blocksToText(view);
  assert.ok(text.includes('"value":"rt-1"'));
  assert.ok(text.includes('"value":"rt-2"'));
});

test("renders one row per summary, in order", () => {
  const view = buildManagePoliciesView([noPolicy, withPolicy], PRO);
  const text = blocksToText(view);
  assert.ok(text.indexOf("Vacation / Time Off") < text.indexOf("Expense / Purchase"));
});

// --- M10.4: Free (canManageApprovalPolicies: false) ---

test("Free: a saved policy shows a Disable button, never Edit/Configure", () => {
  const view = buildManagePoliciesView([withPolicy], FREE);
  const text = blocksToText(view);
  assert.ok(text.includes("Expense / Purchase"));
  assert.ok(text.includes("Saved policy"));
  assert.ok(text.includes("Pro required"));
  assert.ok(text.includes("<@U0GARY123>"));
  assert.ok(text.includes('"text":"Disable"'));
  assert.ok(!text.includes('"text":"Edit"'));
  assert.ok(!text.includes('"text":"Configure"'));
  assert.ok(!text.includes("configure_policy"));
});

test("Free: no saved policy for a type shows no button at all — configuring one requires Pro", () => {
  const view = buildManagePoliciesView([noPolicy], FREE);
  const text = blocksToText(view);
  assert.ok(text.includes("Vacation / Time Off"));
  assert.ok(text.includes("Requires Pro"));
  assert.ok(!text.includes("accessory"));
});

test("Free: shows an upsell explanation, Pro does not", () => {
  const freeText = blocksToText(buildManagePoliciesView([noPolicy], FREE));
  const proText = blocksToText(buildManagePoliciesView([noPolicy], PRO));
  assert.ok(freeText.includes("require ApproveGo Pro"));
  assert.ok(!proText.includes("require ApproveGo Pro"));
});

test("Free: the Disable button's value is the request_type_id and carries a native confirm dialog", () => {
  const view = buildManagePoliciesView([withPolicy], FREE);
  const text = blocksToText(view);
  assert.ok(text.includes('"value":"rt-2"'));
  assert.ok(text.includes('"confirm"'));
});

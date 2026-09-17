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

test("a request type with no policy shows the DIRECT explanation and a Configure button", () => {
  const view = buildManagePoliciesView([noPolicy]);
  const text = blocksToText(view);
  assert.ok(text.includes("Vacation / Time Off"));
  assert.ok(text.includes("No policy"));
  assert.ok(text.includes("employees choose an approver"));
  assert.ok(text.includes('"text":"Configure"'));
});

test("a request type with an active policy shows approver mentions, required count, and an Edit button", () => {
  const view = buildManagePoliciesView([withPolicy]);
  const text = blocksToText(view);
  assert.ok(text.includes("Expense / Purchase"));
  assert.ok(text.includes("<@U0GARY123>"));
  assert.ok(text.includes("<@U0FINANCE1>"));
  assert.ok(text.includes("2 approvals required"));
  assert.ok(text.includes('"text":"Edit"'));
});

test("singular phrasing for exactly one required approval", () => {
  const view = buildManagePoliciesView([{ ...withPolicy, policy: { ...withPolicy.policy!, requiredApprovals: 1 } }]);
  assert.ok(blocksToText(view).includes("1 approval required"));
  assert.ok(!blocksToText(view).includes("1 approvals required"));
});

test("each row's button value is the request_type_id, an opaque locator", () => {
  const view = buildManagePoliciesView([noPolicy, withPolicy]);
  const text = blocksToText(view);
  assert.ok(text.includes('"value":"rt-1"'));
  assert.ok(text.includes('"value":"rt-2"'));
});

test("renders one row per summary, in order", () => {
  const view = buildManagePoliciesView([noPolicy, withPolicy]);
  const text = blocksToText(view);
  assert.ok(text.indexOf("Vacation / Time Off") < text.indexOf("Expense / Purchase"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { APPROVE_ACTION_ID, REJECT_ACTION_ID } from "./build-approval-notification.ts";
import { parseApprovalBlockAction, type BlockActionsPayload } from "./parse-block-action.ts";

function buildPayload(overrides: Partial<{ actionId: string; value: string }> = {}): BlockActionsPayload {
  const { actionId = APPROVE_ACTION_ID, value = JSON.stringify({ requestId: "req-1" }) } = overrides;
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U123" },
    channel: { id: "C123" },
    message: { ts: "1234.5678", blocks: [{ type: "section" }] },
    actions: [{ action_id: actionId, value }],
  };
}

test("valid approve action is recognized", () => {
  const result = parseApprovalBlockAction(buildPayload({ actionId: APPROVE_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, APPROVE_ACTION_ID);
    assert.equal(result.data.requestId, "req-1");
    assert.equal(result.data.channelId, "C123");
    assert.equal(result.data.messageTs, "1234.5678");
  }
});

test("valid reject action is recognized", () => {
  const result = parseApprovalBlockAction(buildPayload({ actionId: REJECT_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, REJECT_ACTION_ID);
  }
});

test("unknown action is rejected safely", () => {
  const result = parseApprovalBlockAction(buildPayload({ actionId: "some_other_action" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unknown_action");
  }
});

test("missing identifiers are rejected safely", () => {
  const payload = buildPayload();
  delete payload.team;
  const result = parseApprovalBlockAction(payload);
  assert.equal(result.ok, false);
});

test("malformed action value is rejected safely", () => {
  const result = parseApprovalBlockAction(buildPayload({ value: "not-json" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_request_id");
  }
});

test("action value missing requestId is rejected safely", () => {
  const result = parseApprovalBlockAction(buildPayload({ value: JSON.stringify({ nope: true }) }));
  assert.equal(result.ok, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { APPROVE_ACTION_ID, REJECT_ACTION_ID } from "./build-approval-notification.ts";
import { parseApprovalBlockAction, type BlockActionsPayload } from "./parse-block-action.ts";

function buildMessagePayload(overrides: Partial<{ actionId: string; value: string }> = {}): BlockActionsPayload {
  const { actionId = APPROVE_ACTION_ID, value = JSON.stringify({ requestId: "req-1" }) } = overrides;
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U123" },
    trigger_id: "trigger-1",
    channel: { id: "C123" },
    message: { ts: "1234.5678", blocks: [{ type: "section" }] },
    actions: [{ action_id: actionId, value }],
  };
}

function buildModalPayload(overrides: Partial<{ actionId: string; value: string }> = {}): BlockActionsPayload {
  const { actionId = APPROVE_ACTION_ID, value = JSON.stringify({ requestId: "req-1" }) } = overrides;
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U123" },
    trigger_id: "trigger-1",
    view: { id: "V123", blocks: [{ type: "section" }] },
    actions: [{ action_id: actionId, value }],
  };
}

// --- Message-origin (M3/M4 approver DM) — unchanged guarantees ---

test("valid approve action from a message is recognized", () => {
  const result = parseApprovalBlockAction(buildMessagePayload({ actionId: APPROVE_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, APPROVE_ACTION_ID);
    assert.equal(result.data.requestId, "req-1");
    assert.equal(result.data.triggerId, "trigger-1");
    assert.deepEqual(result.data.source, { type: "message", channelId: "C123", messageTs: "1234.5678", messageBlocks: [{ type: "section" }] });
  }
});

test("missing trigger_id is rejected safely (needed to open the M7 decision modal)", () => {
  const payload = buildMessagePayload();
  delete payload.trigger_id;
  const result = parseApprovalBlockAction(payload);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_identifiers");
  }
});

test("valid reject action from a message is recognized", () => {
  const result = parseApprovalBlockAction(buildMessagePayload({ actionId: REJECT_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, REJECT_ACTION_ID);
  }
});

test("unknown action is rejected safely", () => {
  const result = parseApprovalBlockAction(buildMessagePayload({ actionId: "some_other_action" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unknown_action");
  }
});

test("missing identifiers are rejected safely", () => {
  const payload = buildMessagePayload();
  delete payload.team;
  const result = parseApprovalBlockAction(payload);
  assert.equal(result.ok, false);
});

test("malformed action value is rejected safely", () => {
  const result = parseApprovalBlockAction(buildMessagePayload({ value: "not-json" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_request_id");
  }
});

test("action value missing requestId is rejected safely", () => {
  const result = parseApprovalBlockAction(buildMessagePayload({ value: JSON.stringify({ nope: true }) }));
  assert.equal(result.ok, false);
});

// --- Modal-origin (M5 Request Details view) ---

test("valid approve action from a modal is recognized", () => {
  const result = parseApprovalBlockAction(buildModalPayload({ actionId: APPROVE_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, APPROVE_ACTION_ID);
    assert.deepEqual(result.data.source, { type: "modal", viewId: "V123", viewBlocks: [{ type: "section" }] });
  }
});

test("valid reject action from a modal is recognized", () => {
  const result = parseApprovalBlockAction(buildModalPayload({ actionId: REJECT_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, REJECT_ACTION_ID);
    assert.equal(result.data.source.type, "modal");
  }
});

test("a payload with neither channel/message nor view is rejected safely", () => {
  const payload = buildModalPayload();
  delete payload.view;
  const result = parseApprovalBlockAction(payload);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_identifiers");
  }
});

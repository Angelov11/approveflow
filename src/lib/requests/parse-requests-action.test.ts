import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATE_REQUEST_ACTION_ID,
  OPEN_REQUEST_CENTER_ACTION_ID,
  parseRequestsNavigationAction,
  VIEW_REQUEST_ACTION_ID,
  VIEW_WAITING_REQUESTS_ACTION_ID,
  type RequestsNavigationPayload,
} from "./parse-requests-action.ts";

function buildPayload(overrides: Partial<{ actionId: string; value: string; viewType: string }> = {}): RequestsNavigationPayload {
  const { actionId = VIEW_REQUEST_ACTION_ID, value = JSON.stringify({ requestId: "req-1" }), viewType } = overrides;
  return {
    type: "block_actions",
    team: { id: "T123" },
    user: { id: "U123" },
    trigger_id: "trigger-1",
    ...(viewType ? { view: { type: viewType } } : {}),
    actions: [{ action_id: actionId, value }],
  };
}

test("view_request with a valid value is recognized", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: VIEW_REQUEST_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok && result.data.actionId === VIEW_REQUEST_ACTION_ID) {
    assert.equal(result.data.requestId, "req-1");
    assert.equal(result.data.triggerId, "trigger-1");
  }
});

test("view_waiting_requests needs no value", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: VIEW_WAITING_REQUESTS_ACTION_ID, value: "" }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, VIEW_WAITING_REQUESTS_ACTION_ID);
  }
});

test("view_request without a request id is rejected", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: VIEW_REQUEST_ACTION_ID, value: "not-json" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "missing_request_id");
  }
});

test("an unknown action is rejected safely", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: "something_else" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unknown_action");
  }
});

test("missing trigger_id is rejected safely", () => {
  const payload = buildPayload();
  delete payload.trigger_id;
  const result = parseRequestsNavigationAction(payload);
  assert.equal(result.ok, false);
});

test("missing team/user identifiers are rejected safely", () => {
  const payload = buildPayload();
  delete payload.team;
  const result = parseRequestsNavigationAction(payload);
  assert.equal(result.ok, false);
});

test("open_request_center is recognized (Home-only action)", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: OPEN_REQUEST_CENTER_ACTION_ID, viewType: "home" }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, OPEN_REQUEST_CENTER_ACTION_ID);
    assert.equal(result.data.origin, "home");
  }
});

test("create_request_home is recognized (Home-only action)", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: CREATE_REQUEST_ACTION_ID, viewType: "home" }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.actionId, CREATE_REQUEST_ACTION_ID);
    assert.equal(result.data.origin, "home");
  }
});

test("a click from within an open modal (view.type = modal) is tagged with origin 'modal'", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: VIEW_REQUEST_ACTION_ID, viewType: "modal" }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.origin, "modal");
  }
});

test("a click from the Home tab (view.type = home) is tagged with origin 'home'", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: VIEW_REQUEST_ACTION_ID, viewType: "home" }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.origin, "home");
  }
});

test("a missing view (message-posted origin, N/A here) defaults to origin 'modal'", () => {
  const result = parseRequestsNavigationAction(buildPayload({ actionId: VIEW_REQUEST_ACTION_ID }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.origin, "modal");
  }
});

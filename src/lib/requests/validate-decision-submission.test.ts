import assert from "node:assert/strict";
import test from "node:test";
import { DECISION_COMMENT_ACTION_ID, DECISION_COMMENT_BLOCK_ID, MAX_DECISION_COMMENT_LENGTH } from "./build-decision-modal.ts";
import { validateDecisionSubmission, type DecisionSubmissionPayload } from "./validate-decision-submission.ts";

function buildPayload(commentValue: string | null, overrides: Partial<{ metadata: object; team: object; user: object }> = {}): DecisionSubmissionPayload {
  const { metadata = { requestId: "req-1", source: { type: "modal", viewId: "V123" } }, team = { id: "T123" }, user = { id: "U123" } } = overrides;
  return {
    type: "view_submission",
    team,
    user,
    view: {
      private_metadata: JSON.stringify(metadata),
      state: { values: { [DECISION_COMMENT_BLOCK_ID]: { [DECISION_COMMENT_ACTION_ID]: { value: commentValue } } } },
    },
  };
}

// --- APPROVE ---

test("approve with no comment succeeds, normalizing to null", () => {
  const result = validateDecisionSubmission(buildPayload(null), "APPROVED");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.comment, null);
  }
});

test("approve with a whitespace-only comment normalizes to null", () => {
  const result = validateDecisionSubmission(buildPayload("   \n  "), "APPROVED");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.comment, null);
  }
});

test("approve with a real comment succeeds and is trimmed", () => {
  const result = validateDecisionSubmission(buildPayload("  Looks good  "), "APPROVED");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.comment, "Looks good");
  }
});

test("an oversized approve comment fails without truncating", () => {
  const result = validateDecisionSubmission(buildPayload("x".repeat(MAX_DECISION_COMMENT_LENGTH + 1)), "APPROVED");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors[DECISION_COMMENT_BLOCK_ID].includes(String(MAX_DECISION_COMMENT_LENGTH)));
  }
});

test("an approve comment at exactly the max length succeeds", () => {
  const result = validateDecisionSubmission(buildPayload("x".repeat(MAX_DECISION_COMMENT_LENGTH)), "APPROVED");
  assert.equal(result.ok, true);
});

// --- REJECT ---

test("reject with an empty reason fails with a clear message attached to the reason block", () => {
  const result = validateDecisionSubmission(buildPayload(null), "REJECTED");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errors[DECISION_COMMENT_BLOCK_ID], "Please provide a reason for rejecting this request.");
  }
});

test("reject with a whitespace-only reason fails", () => {
  const result = validateDecisionSubmission(buildPayload("   "), "REJECTED");
  assert.equal(result.ok, false);
});

test("reject with a real reason succeeds and is trimmed", () => {
  const result = validateDecisionSubmission(buildPayload("  Budget exceeded.  "), "REJECTED");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.comment, "Budget exceeded.");
  }
});

test("an oversized reject reason fails without truncating", () => {
  const result = validateDecisionSubmission(buildPayload("x".repeat(MAX_DECISION_COMMENT_LENGTH + 1)), "REJECTED");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors[DECISION_COMMENT_BLOCK_ID].includes(String(MAX_DECISION_COMMENT_LENGTH)));
  }
});

// --- locator / identity trust boundaries ---

test("requestId and source are read from private_metadata as opaque locators", () => {
  const result = validateDecisionSubmission(
    buildPayload("fine", { metadata: { requestId: "req-99", source: { type: "message", channelId: "C1", messageTs: "1.1" } } }),
    "APPROVED",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.requestId, "req-99");
    assert.deepEqual(result.data.source, { type: "message", channelId: "C1", messageTs: "1.1" });
  }
});

test("identity always comes from the signed team/user envelope, never from private_metadata, even if metadata carries workspace-shaped fields", () => {
  const result = validateDecisionSubmission(
    buildPayload("fine", {
      team: { id: "T-REAL" },
      user: { id: "U-REAL" },
      metadata: { requestId: "req-1", source: { type: "modal", viewId: "V1" }, team: { id: "T-FORGED" }, workspaceId: "forged-workspace" },
    }),
    "APPROVED",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.slackTeamId, "T-REAL");
    assert.equal(result.data.slackUserId, "U-REAL");
  }
});

test("missing team/user identifiers are rejected safely", () => {
  const payload = buildPayload("fine");
  delete payload.team;
  const result = validateDecisionSubmission(payload, "APPROVED");
  assert.equal(result.ok, false);
});

test("malformed private_metadata is rejected safely, not thrown", () => {
  const payload = buildPayload("fine");
  payload.view!.private_metadata = "not-json";
  assert.doesNotThrow(() => {
    const result = validateDecisionSubmission(payload, "APPROVED");
    assert.equal(result.ok, false);
  });
});

test("private_metadata missing requestId/source is rejected safely", () => {
  const result = validateDecisionSubmission(buildPayload("fine", { metadata: { nope: true } }), "APPROVED");
  assert.equal(result.ok, false);
});

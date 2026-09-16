import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequesterDecisionNotification,
  isFinalDecisionTransition,
  type DecisionOutcome,
} from "./build-requester-decision-notification.ts";
import type { RequestTiming } from "./request-timing.ts";

function fieldTexts(content: ReturnType<typeof buildRequesterDecisionNotification>): string[] {
  const fieldsBlock = content.blocks[1] as { fields: { text: string }[] };
  return fieldsBlock.fields.map((f) => f.text);
}

const NO_TIMING: RequestTiming = { startDate: null, startTime: null, endDate: null, endTime: null };
const NO_EXPENSE = { amount: null, currency: null };

const baseParams = {
  decision: "APPROVED" as const,
  requestTypeName: "Custom Request",
  resource: "AWS Test Resource",
  timing: NO_TIMING,
  // A pre-M8-correction historical value (120 minutes = "2 hours" under the
  // original scale) — exercises the legacy fallback path in every test that
  // doesn't override it with real timing.
  legacyDurationMinutes: 120,
  expense: NO_EXPENSE,
  routingType: "DIRECT" as const,
  decidingApproverSlackId: "U0APPROVER1",
  comment: null,
};

// --- isFinalDecisionTransition: the sole notification gate ---

test("DIRECT approval finalizes: 'approved' is a final transition", () => {
  assert.equal(isFinalDecisionTransition("approved"), true);
});

test("DIRECT/POLICY rejection finalizes: 'rejected' is a final transition", () => {
  assert.equal(isFinalDecisionTransition("rejected"), true);
});

test("policy intermediate approval ('recorded_pending') is NOT a final transition", () => {
  assert.equal(isFinalDecisionTransition("recorded_pending"), false);
});

test("a duplicate decision ('already_decided') is NOT a final transition", () => {
  assert.equal(isFinalDecisionTransition("already_decided"), false);
});

test("an already-final request ('already_final') is NOT a final transition", () => {
  assert.equal(isFinalDecisionTransition("already_final"), false);
});

test("unauthorized/no_policy/not_found are NOT final transitions", () => {
  const nonFinal: DecisionOutcome[] = ["unauthorized", "no_policy", "not_found"];
  for (const outcome of nonFinal) {
    assert.equal(isFinalDecisionTransition(outcome), false);
  }
});

// --- buildRequesterDecisionNotification: attribution rules ---

test("DIRECT approval attributes the approver", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "APPROVED", routingType: "DIRECT" });
  assert.equal(content.text, "✅ Your request was approved");
  assert.ok(fieldTexts(content).some((t) => t.includes("Approved by") && t.includes("<@U0APPROVER1>")));
});

test("DIRECT rejection attributes the approver", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "REJECTED", routingType: "DIRECT" });
  assert.equal(content.text, "❌ Your request was rejected");
  assert.ok(fieldTexts(content).some((t) => t.includes("Rejected by") && t.includes("<@U0APPROVER1>")));
});

test("POLICY final approval does NOT attribute a single approver", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "APPROVED", routingType: "POLICY" });
  assert.equal(
    fieldTexts(content).some((t) => t.includes("Approved by")),
    false,
  );
});

test("POLICY rejection DOES attribute the rejecting approver (rejection always finalizes immediately)", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "REJECTED", routingType: "POLICY" });
  assert.ok(fieldTexts(content).some((t) => t.includes("Rejected by") && t.includes("<@U0APPROVER1>")));
});

test("message always includes request type, resource, the historical duration fallback, and status", () => {
  const content = buildRequesterDecisionNotification(baseParams);
  const texts = fieldTexts(content);
  assert.ok(texts.some((t) => t.includes("Custom Request")));
  assert.ok(texts.some((t) => t.includes("AWS Test Resource")));
  assert.ok(texts.some((t) => t.includes("2 hours")));
  assert.ok(texts.some((t) => t.includes("APPROVED")));
});

test("a request with real M8 timing shows a 'When' field, not 'When / Duration'", () => {
  const content = buildRequesterDecisionNotification({
    ...baseParams,
    timing: { startDate: "2026-09-19", startTime: null, endDate: null, endTime: null },
    legacyDurationMinutes: null,
  });
  const texts = fieldTexts(content);
  assert.ok(texts.some((t) => t.includes("*When:*") && t.includes("Sep 19, 2026")));
  assert.ok(!texts.some((t) => t.includes("When / Duration")));
});

test("a request with no timing and no legacy duration shows no When field at all", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, timing: NO_TIMING, legacyDurationMinutes: null });
  const texts = fieldTexts(content);
  assert.ok(!texts.some((t) => t.includes("When")));
});

test("an Expense / Purchase request shows an Amount field instead of When", () => {
  const content = buildRequesterDecisionNotification({
    ...baseParams,
    timing: NO_TIMING,
    legacyDurationMinutes: null,
    expense: { amount: 499.99, currency: "EUR" },
  });
  const texts = fieldTexts(content);
  assert.ok(texts.some((t) => t.includes("*Amount:*") && t.includes("EUR 499.99")));
  assert.ok(!texts.some((t) => t.includes("When")));
});

// --- M7: decision comment/reason rendering ---

function blockText(content: ReturnType<typeof buildRequesterDecisionNotification>, index: number): string {
  return JSON.stringify(content.blocks[index]);
}

test("DIRECT approved with a comment includes a Comment section", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "APPROVED", routingType: "DIRECT", comment: "Looks good — temporary access approved." });
  assert.equal(content.blocks.length, 3);
  assert.ok(blockText(content, 2).includes("*Comment:*"));
  assert.ok(blockText(content, 2).includes("Looks good — temporary access approved."));
});

test("DIRECT approved without a comment renders no Comment section at all", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "APPROVED", routingType: "DIRECT", comment: null });
  assert.equal(content.blocks.length, 2);
  assert.ok(!JSON.stringify(content.blocks).includes("Comment"));
});

test("DIRECT rejected with a reason includes a Reason section, not 'Comment'", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "REJECTED", routingType: "DIRECT", comment: "Please use staging instead." });
  assert.ok(blockText(content, 2).includes("*Reason:*"));
  assert.ok(blockText(content, 2).includes("Please use staging instead."));
  assert.ok(!blockText(content, 2).includes("*Comment:*"));
});

test("POLICY final approval's comment is labeled generically — never implying the final clicker alone approved it", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "APPROVED", routingType: "POLICY", comment: "Looks good from security." });
  const text = blockText(content, 2);
  assert.ok(text.includes("Final approval comment"));
  assert.ok(!text.includes("Approved by"));
  assert.ok(text.includes("Looks good from security."));
});

test("POLICY rejection attributes the rejector and shows the reason", () => {
  const content = buildRequesterDecisionNotification({ ...baseParams, decision: "REJECTED", routingType: "POLICY", comment: "Budget owner approval is missing." });
  assert.ok(fieldTexts(content).some((t) => t.includes("Rejected by") && t.includes("<@U0APPROVER1>")));
  assert.ok(blockText(content, 2).includes("*Reason:*"));
  assert.ok(blockText(content, 2).includes("Budget owner approval is missing."));
});

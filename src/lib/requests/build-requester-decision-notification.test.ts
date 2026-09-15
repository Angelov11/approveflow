import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequesterDecisionNotification,
  isFinalDecisionTransition,
  type DecisionOutcome,
} from "./build-requester-decision-notification.ts";

function fieldTexts(content: ReturnType<typeof buildRequesterDecisionNotification>): string[] {
  const fieldsBlock = content.blocks[1] as { fields: { text: string }[] };
  return fieldsBlock.fields.map((f) => f.text);
}

const baseParams = {
  decision: "APPROVED" as const,
  requestTypeName: "Custom Request",
  resource: "AWS Test Resource",
  durationLabel: "2 hours",
  routingType: "DIRECT" as const,
  decidingApproverSlackId: "U0APPROVER1",
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

test("message always includes request type, resource, duration, and status", () => {
  const content = buildRequesterDecisionNotification(baseParams);
  const texts = fieldTexts(content);
  assert.ok(texts.some((t) => t.includes("Custom Request")));
  assert.ok(texts.some((t) => t.includes("AWS Test Resource")));
  assert.ok(texts.some((t) => t.includes("2 hours")));
  assert.ok(texts.some((t) => t.includes("APPROVED")));
});

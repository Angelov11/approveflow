import assert from "node:assert/strict";
import test from "node:test";
import { formatStatusLabel } from "./status-display.ts";

test("every status includes both an emoji and a text label", () => {
  assert.equal(formatStatusLabel("PENDING"), "🟡 Pending");
  assert.equal(formatStatusLabel("APPROVED"), "🟢 Approved");
  assert.equal(formatStatusLabel("REJECTED"), "🔴 Rejected");
  assert.equal(formatStatusLabel("CANCELLED"), "⚪ Cancelled");
  assert.equal(formatStatusLabel("EXPIRED"), "⚪ Expired");
});

test("no label is emoji-only", () => {
  for (const status of ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"] as const) {
    const label = formatStatusLabel(status);
    const textPart = label.replace(/^\S+\s/, "");
    assert.ok(textPart.length > 3, `expected a text label after the emoji for ${status}`);
  }
});

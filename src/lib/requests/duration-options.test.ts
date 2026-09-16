import assert from "node:assert/strict";
import test from "node:test";
import { DURATION_OPTIONS, formatDurationLabel } from "./duration-options.ts";

test("every historical option has a unique minutes value (required for label reverse-lookup)", () => {
  const values = DURATION_OPTIONS.map((o) => o.minutes);
  assert.equal(new Set(values).size, values.length);
});

test("formatDurationLabel reuses the exact original M2-M7 labels for known historical minute values", () => {
  assert.equal(formatDurationLabel(30), "30 minutes");
  assert.equal(formatDurationLabel(240), "4 hours");
  assert.equal(formatDurationLabel(480), "8 hours");
  assert.equal(formatDurationLabel(1440), "1 day");
});

test("formatDurationLabel renders null as 'Not specified'", () => {
  assert.equal(formatDurationLabel(null), "Not specified");
});

test("formatDurationLabel never renders null as 0 minutes, 'undefined', 'null', or 'NaN'", () => {
  const label = formatDurationLabel(null);
  assert.ok(!label.includes("0 minutes"));
  assert.ok(!/undefined|null|NaN/i.test(label));
});

test("formatDurationLabel falls back to a raw minutes label for a value outside the historical set", () => {
  assert.equal(formatDurationLabel(999), "999 minutes");
});

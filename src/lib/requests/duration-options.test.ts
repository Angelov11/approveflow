import assert from "node:assert/strict";
import test from "node:test";
import { DURATION_OPTIONS, formatDurationLabel, NOT_SPECIFIED_DURATION_VALUE, resolveDurationMinutes } from "./duration-options.ts";

test("offers a workplace-appropriate range from minutes up to a week", () => {
  const labels = DURATION_OPTIONS.map((o) => o.label);
  assert.deepEqual(labels, [
    "30 minutes",
    "1 hour",
    "2 hours",
    "Half day",
    "1 day",
    "2 days",
    "3 days",
    "1 week",
    "Other / Not specified",
  ]);
});

test("every option has a unique minutes value (required for label reverse-lookup)", () => {
  const values = DURATION_OPTIONS.map((o) => o.minutes);
  assert.equal(new Set(values).size, values.length);
});

test("resolveDurationMinutes resolves each known option", () => {
  assert.equal(resolveDurationMinutes("30"), 30);
  assert.equal(resolveDurationMinutes("1440"), 1440);
  assert.equal(resolveDurationMinutes("10080"), 10080);
});

test("'Other / Not specified' resolves to null minutes — a real choice, not a missing value", () => {
  assert.equal(resolveDurationMinutes(NOT_SPECIFIED_DURATION_VALUE), null);
});

test("resolveDurationMinutes returns undefined for an unknown value", () => {
  assert.equal(resolveDurationMinutes("999"), undefined);
});

test("formatDurationLabel reuses the exact modal labels for known minute values", () => {
  assert.equal(formatDurationLabel(240), "Half day");
  assert.equal(formatDurationLabel(2880), "2 days");
  assert.equal(formatDurationLabel(10080), "1 week");
});

test("formatDurationLabel renders null as 'Not specified' — matching the modal option's own wording exactly", () => {
  assert.equal(formatDurationLabel(null), "Not specified");
});

test("formatDurationLabel never renders null as 0 minutes, 'undefined', 'null', or 'NaN'", () => {
  const label = formatDurationLabel(null);
  assert.ok(!label.includes("0 minutes"));
  assert.ok(!/undefined|null|NaN/i.test(label));
});

test("formatDurationLabel falls back to a raw minutes label for an unrecognized value (e.g. old historical data)", () => {
  assert.equal(formatDurationLabel(480), "480 minutes");
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatWhenLabel, validateRequestTiming, type RequestTiming } from "./request-timing.ts";

const NONE: RequestTiming = { startDate: null, startTime: null, endDate: null, endTime: null };

// --- Validation: accepted combinations ---

test("all timing fields omitted is valid", () => {
  assert.deepEqual(validateRequestTiming(NONE), { ok: true });
});

test("start date only is valid", () => {
  assert.deepEqual(validateRequestTiming({ ...NONE, startDate: "2026-09-19" }), { ok: true });
});

test("start date + end date (a date range) is valid", () => {
  assert.deepEqual(validateRequestTiming({ ...NONE, startDate: "2026-09-21", endDate: "2026-09-25" }), { ok: true });
});

test("same start/end date without times is valid", () => {
  assert.deepEqual(validateRequestTiming({ ...NONE, startDate: "2026-09-19", endDate: "2026-09-19" }), { ok: true });
});

test("same-day end time strictly after start time is valid", () => {
  const result = validateRequestTiming({ startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "12:00" });
  assert.deepEqual(result, { ok: true });
});

test("start date + start time with no end fields at all is valid (open-ended)", () => {
  assert.deepEqual(validateRequestTiming({ ...NONE, startDate: "2026-09-18", startTime: "10:00" }), { ok: true });
});

test("multi-day range with times on each end is valid", () => {
  const result = validateRequestTiming({ startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-25", endTime: "17:00" });
  assert.deepEqual(result, { ok: true });
});

// --- Validation parity cases (matched line-by-line against the 5 DB CHECK
// constraints before deployment) — one omitted time must never invalidate
// an otherwise sensible date range. ---

test("parity B: multi-day range, start time present, end time omitted, is valid", () => {
  const result = validateRequestTiming({ startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-25", endTime: null });
  assert.deepEqual(result, { ok: true });
});

test("parity C: multi-day range, start time omitted, end time present, is valid", () => {
  const result = validateRequestTiming({ startDate: "2026-09-21", startTime: null, endDate: "2026-09-25", endTime: "17:00" });
  assert.deepEqual(result, { ok: true });
});

test("parity E: same-day range, only an end time present, is valid — omitting the start time must not invalidate it", () => {
  const result = validateRequestTiming({ startDate: "2026-09-21", startTime: null, endDate: "2026-09-21", endTime: "17:00" });
  assert.deepEqual(result, { ok: true });
});

test("parity F: same-day range, only a start time present, is valid — omitting the end time must not invalidate it", () => {
  const result = validateRequestTiming({ startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-21", endTime: null });
  assert.deepEqual(result, { ok: true });
});

// --- Validation: rejected combinations ---

test("start time without a start date is invalid", () => {
  const result = validateRequestTiming({ ...NONE, startTime: "10:00" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.start_time_block);
});

test("end date without a start date is invalid", () => {
  const result = validateRequestTiming({ ...NONE, endDate: "2026-09-19" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_date_block);
});

test("end time without an end date is invalid", () => {
  const result = validateRequestTiming({ ...NONE, startDate: "2026-09-18", endTime: "12:00" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_time_block);
});

test("end date before the start date is invalid", () => {
  const result = validateRequestTiming({ ...NONE, startDate: "2026-09-25", endDate: "2026-09-21" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_date_block);
});

test("same-day end time equal to start time is invalid (must be strictly after)", () => {
  const result = validateRequestTiming({ startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "10:00" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_time_block);
});

test("same-day end time before start time is invalid", () => {
  const result = validateRequestTiming({ startDate: "2026-09-18", startTime: "12:00", endDate: "2026-09-18", endTime: "10:00" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_time_block);
});

test("a malformed start date is rejected", () => {
  const result = validateRequestTiming({ ...NONE, startDate: "Sep 19" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.start_date_block);
});

test("a malformed end date is rejected", () => {
  const result = validateRequestTiming({ ...NONE, startDate: "2026-09-18", endDate: "09/19/2026" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_date_block);
});

test("a malformed start time is rejected", () => {
  const result = validateRequestTiming({ ...NONE, startDate: "2026-09-18", startTime: "10am" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.start_time_block);
});

test("a malformed end time is rejected", () => {
  const result = validateRequestTiming({ startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "noon" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.end_time_block);
});

test("never invents a missing end date from a present start date", () => {
  // Purely a documentation-style assertion: start-date-only is VALID and
  // stays that way — validateRequestTiming never rejects or silently fills
  // in an end date on its own.
  const result = validateRequestTiming({ ...NONE, startDate: "2026-09-19" });
  assert.equal(result.ok, true);
});

// --- Formatting ---

test("formats a single date (start date only)", () => {
  const when = formatWhenLabel({ ...NONE, startDate: "2026-09-19" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 19, 2026" });
});

test("formats a date range with no times", () => {
  const when = formatWhenLabel({ ...NONE, startDate: "2026-09-21", endDate: "2026-09-25" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 21, 2026 – Sep 25, 2026" });
});

test("a same start/end date with no times formats as a single date, not a self-range", () => {
  const when = formatWhenLabel({ ...NONE, startDate: "2026-09-19", endDate: "2026-09-19" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 19, 2026" });
});

test("formats same-day times", () => {
  const when = formatWhenLabel({ startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "12:00" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 18, 2026, 10:00 – 12:00" });
});

test("formats multi-day times", () => {
  const when = formatWhenLabel({ startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-25", endTime: "17:00" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 21, 2026, 09:00 – Sep 25, 2026, 17:00" });
});

// --- Formatting: partial times must render naturally, never dropped or malformed ---

test("multi-day, start time only (end time omitted): the time stays attached to the start date", () => {
  const when = formatWhenLabel({ startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-25", endTime: null }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 21, 2026, 09:00 – Sep 25, 2026" });
});

test("multi-day, end time only (start time omitted): the time stays attached to the end date", () => {
  const when = formatWhenLabel({ startDate: "2026-09-21", startTime: null, endDate: "2026-09-25", endTime: "17:00" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 21, 2026 – Sep 25, 2026, 17:00" });
});

test("same day, start time only (end time omitted): shows just the start time, no dangling dash", () => {
  const when = formatWhenLabel({ startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-21", endTime: null }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 21, 2026, 09:00" });
});

test("same day, end time only (start time omitted): still shown, never silently dropped", () => {
  const when = formatWhenLabel({ startDate: "2026-09-21", startTime: null, endDate: "2026-09-21", endTime: "17:00" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 21, 2026, until 17:00" });
});

test("tolerates a time value with seconds (as read back from the database's `time` column)", () => {
  const when = formatWhenLabel({ startDate: "2026-09-18", startTime: "10:00:00", endDate: "2026-09-18", endTime: "12:00:00" }, null);
  assert.deepEqual(when, { label: "When", value: "Sep 18, 2026, 10:00 – 12:00" });
});

test("omits the field entirely when nothing is supplied and there is no legacy duration", () => {
  assert.equal(formatWhenLabel(NONE, null), null);
});

test("falls back to the historical duration label, with its own distinct 'When / Duration' label, when no new timing fields are set", () => {
  const when = formatWhenLabel(NONE, 240);
  assert.deepEqual(when, { label: "When / Duration", value: "4 hours" });
});

test("new timing fields take priority over a legacy duration value if somehow both were present", () => {
  const when = formatWhenLabel({ ...NONE, startDate: "2026-09-19" }, 240);
  assert.deepEqual(when, { label: "When", value: "Sep 19, 2026" });
});

test("never renders a placeholder like 'Not specified', 'NULL', 'undefined', or '0 minutes' when there is truly nothing to show", () => {
  assert.equal(formatWhenLabel(NONE, null), null);
});

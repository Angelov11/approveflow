import assert from "node:assert/strict";
import test from "node:test";
import {
  getRequestTypeFieldConfig,
  REQUEST_TYPE_FIELD_CONFIG,
  remapExpenseForModeChange,
  remapTimingForModeChange,
} from "./request-type-config.ts";

const ACTIVE_DEFAULT_KEYS = [
  "vacation_time_off",
  "doctor_appointment",
  "work_from_home",
  "personal_time",
  "schedule_change",
  "expense_purchase",
  "other",
];

// --- CONFIG ---

test("every active default request type has exactly one field configuration entry", () => {
  for (const key of ACTIVE_DEFAULT_KEYS) {
    assert.ok(REQUEST_TYPE_FIELD_CONFIG[key], `missing config for ${key}`);
  }
  assert.equal(Object.keys(REQUEST_TYPE_FIELD_CONFIG).length, ACTIVE_DEFAULT_KEYS.length);
});

test("Vacation / Time Off, Work From Home, Personal Time use DATE_RANGE and are not expense-bearing", () => {
  for (const key of ["vacation_time_off", "work_from_home", "personal_time"]) {
    assert.deepEqual(getRequestTypeFieldConfig(key), { timingMode: "DATE_RANGE", expense: false });
  }
});

test("Doctor Appointment and Schedule Change use SINGLE_DATE_TIME_RANGE and are not expense-bearing", () => {
  for (const key of ["doctor_appointment", "schedule_change"]) {
    assert.deepEqual(getRequestTypeFieldConfig(key), { timingMode: "SINGLE_DATE_TIME_RANGE", expense: false });
  }
});

test("Expense / Purchase uses NONE timing and is expense-bearing", () => {
  assert.deepEqual(getRequestTypeFieldConfig("expense_purchase"), { timingMode: "NONE", expense: true });
});

test("Other Request uses OPTIONAL_RANGE and is not expense-bearing", () => {
  assert.deepEqual(getRequestTypeFieldConfig("other"), { timingMode: "OPTIONAL_RANGE", expense: false });
});

test("an unrecognized/legacy key never throws — falls back to the flexible OPTIONAL_RANGE shape", () => {
  assert.deepEqual(getRequestTypeFieldConfig("production_access"), { timingMode: "OPTIONAL_RANGE", expense: false });
  assert.doesNotThrow(() => getRequestTypeFieldConfig("totally_unknown"));
});

// --- Input preservation across a type change ---

const fullTiming = { startDate: "2026-09-21", startTime: "09:00", endDate: "2026-09-25", endTime: "17:00" };
const NONE = { startDate: null, startTime: null, endDate: null, endTime: null };

test("remapTimingForModeChange: switching to NONE (Expense) drops all timing — never carried forward", () => {
  assert.deepEqual(remapTimingForModeChange(fullTiming, "NONE"), NONE);
});

test("remapTimingForModeChange: DATE_RANGE keeps both dates, drops times", () => {
  assert.deepEqual(remapTimingForModeChange(fullTiming, "DATE_RANGE"), {
    startDate: "2026-09-21",
    startTime: null,
    endDate: "2026-09-25",
    endTime: null,
  });
});

test("remapTimingForModeChange: SINGLE_DATE_TIME_RANGE keeps the start date as the single date and both times, drops the end date — never fabricates a second date", () => {
  assert.deepEqual(remapTimingForModeChange(fullTiming, "SINGLE_DATE_TIME_RANGE"), {
    startDate: "2026-09-21",
    startTime: "09:00",
    endDate: null,
    endTime: "17:00",
  });
});

test("remapTimingForModeChange: SINGLE_DATE_TIME_RANGE falls back to the end date if only that was set", () => {
  const onlyEndDate = { startDate: null, startTime: null, endDate: "2026-09-25", endTime: null };
  assert.deepEqual(remapTimingForModeChange(onlyEndDate, "SINGLE_DATE_TIME_RANGE"), {
    startDate: "2026-09-25",
    startTime: null,
    endDate: null,
    endTime: null,
  });
});

test("remapTimingForModeChange: OPTIONAL_RANGE (Other) preserves everything unchanged", () => {
  assert.deepEqual(remapTimingForModeChange(fullTiming, "OPTIONAL_RANGE"), fullTiming);
});

test("remapTimingForModeChange: Doctor -> Schedule Change (both SINGLE_DATE_TIME_RANGE) preserves date/start/end time exactly", () => {
  const doctorTiming = { startDate: "2026-09-18", startTime: "10:00", endDate: "2026-09-18", endTime: "12:00" };
  assert.deepEqual(remapTimingForModeChange(doctorTiming, "SINGLE_DATE_TIME_RANGE"), {
    startDate: "2026-09-18",
    startTime: "10:00",
    endDate: null,
    endTime: "12:00",
  });
});

test("remapExpenseForModeChange: switching to a non-expense type drops amount/currency", () => {
  assert.deepEqual(remapExpenseForModeChange({ amount: "499.99", currency: "EUR" }, false), { amount: null, currency: null });
});

test("remapExpenseForModeChange: switching to Expense / Purchase preserves whatever was already entered", () => {
  assert.deepEqual(remapExpenseForModeChange({ amount: "499.99", currency: "EUR" }, true), { amount: "499.99", currency: "EUR" });
});

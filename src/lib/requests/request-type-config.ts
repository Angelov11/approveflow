import type { RequestTiming } from "./request-timing.ts";

/**
 * Centralized, per-request-type field specification — the single source of
 * truth for which fields the Create Request modal shows, how a submission
 * is validated, and how a value is carried over when the requester changes
 * their selected type mid-modal. Every consumer (build-request-modal.ts,
 * validate-request-submission.ts, the interactions route's dynamic-modal
 * handler) reads this instead of scattering `if (type === ...)` checks.
 *
 * - DATE_RANGE: day-level only (Vacation / WFH / Personal) — start+end
 *   date, no times. We care about days, not hours.
 * - SINGLE_DATE_TIME_RANGE: one calendar date plus a start/end time on that
 *   same date (Doctor Appointment / Schedule Change) — modeled as ONE date
 *   field in the modal (never asking the employee to pick the same date
 *   twice), persisted using the existing timing columns with
 *   requested_end_date forced equal to requested_start_date server-side.
 * - NONE: no timing fields at all (Expense / Purchase) — an Amount/Currency
 *   pair instead.
 * - OPTIONAL_RANGE: the full, independently-optional four-field shape
 *   (Other Request) — the flexible escape hatch.
 */
export type TimingMode = "DATE_RANGE" | "SINGLE_DATE_TIME_RANGE" | "NONE" | "OPTIONAL_RANGE";

export interface RequestTypeFieldConfig {
  timingMode: TimingMode;
  expense: boolean;
}

export const REQUEST_TYPE_FIELD_CONFIG: Readonly<Record<string, RequestTypeFieldConfig>> = {
  vacation_time_off: { timingMode: "DATE_RANGE", expense: false },
  work_from_home: { timingMode: "DATE_RANGE", expense: false },
  personal_time: { timingMode: "DATE_RANGE", expense: false },
  doctor_appointment: { timingMode: "SINGLE_DATE_TIME_RANGE", expense: false },
  schedule_change: { timingMode: "SINGLE_DATE_TIME_RANGE", expense: false },
  expense_purchase: { timingMode: "NONE", expense: true },
  other: { timingMode: "OPTIONAL_RANGE", expense: false },
} as const;

/** The flexible "Other"-shaped default — used only for a key with no explicit entry (a historical/legacy type key, which never reaches this new-submission-only config path anyway, since legacy keys are never `active` and are rejected upstream). Never throws. */
const DEFAULT_FIELD_CONFIG: RequestTypeFieldConfig = { timingMode: "OPTIONAL_RANGE", expense: false };

export function getRequestTypeFieldConfig(requestTypeKey: string): RequestTypeFieldConfig {
  return REQUEST_TYPE_FIELD_CONFIG[requestTypeKey] ?? DEFAULT_FIELD_CONFIG;
}

/**
 * Best-effort carryover when the requester changes Request Type mid-modal
 * — never invents a value the new mode doesn't naturally have room for
 * (e.g. switching a date range into a single-date mode never fabricates a
 * second date). Only ever drops or relocates values that were already
 * explicitly entered.
 */
export function remapTimingForModeChange(current: RequestTiming, newMode: TimingMode): RequestTiming {
  switch (newMode) {
    case "NONE":
      return { startDate: null, startTime: null, endDate: null, endTime: null };
    case "DATE_RANGE":
      return { startDate: current.startDate, startTime: null, endDate: current.endDate, endTime: null };
    case "SINGLE_DATE_TIME_RANGE":
      // Only one date fits this mode — prefer the start date, falling back
      // to the end date if that's the only one that was set. The (now
      // inapplicable) second date is dropped, never merged/guessed into a
      // time value.
      return { startDate: current.startDate ?? current.endDate, startTime: current.startTime, endDate: null, endTime: current.endTime };
    case "OPTIONAL_RANGE":
      return current;
  }
}

export interface RequestExpenseInput {
  amount: string | null;
  currency: string | null;
}

/** Expense fields simply disappear when switching to a non-expense type — nothing to carry into a date-based or timeless request. */
export function remapExpenseForModeChange(current: RequestExpenseInput, expenseApplicable: boolean): RequestExpenseInput {
  return expenseApplicable ? current : { amount: null, currency: null };
}

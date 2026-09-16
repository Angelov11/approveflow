import { formatDurationLabel } from "./duration-options.ts";

/**
 * Replaces the fixed "Duration" dropdown for every new request (see
 * build-request-modal.ts). Native Slack `datepicker`/`timepicker` elements
 * return plain "YYYY-MM-DD" / "HH:mm" strings with no timezone information
 * at all — these are stored and rendered as exactly the local values the
 * requester entered ("September 21", "10:00"), never converted, since this
 * app has no reliable per-employee/workspace timezone model to convert
 * against. All four fields are independently optional.
 */
export interface RequestTiming {
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
}

export const START_DATE_BLOCK_ID = "start_date_block";
export const START_DATE_ACTION_ID = "start_date_picker";
export const START_TIME_BLOCK_ID = "start_time_block";
export const START_TIME_ACTION_ID = "start_time_picker";
export const END_DATE_BLOCK_ID = "end_date_block";
export const END_DATE_ACTION_ID = "end_date_picker";
export const END_TIME_BLOCK_ID = "end_time_block";
export const END_TIME_ACTION_ID = "end_time_picker";

export type TimingValidationResult = { ok: true } | { ok: false; errors: Record<string, string> };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Every rule is checked independently of what the Slack UI would normally
 * prevent — a crafted submission is validated exactly like a well-formed
 * one, never trusted merely for coming from a native picker. Never invents
 * a missing value (a supplied start date does not imply a same-day end
 * date) — only ever reports why the supplied combination doesn't make
 * sense.
 */
export function validateRequestTiming(timing: RequestTiming): TimingValidationResult {
  const { startDate, startTime, endDate, endTime } = timing;
  const errors: Record<string, string> = {};

  if (startDate !== null && !DATE_PATTERN.test(startDate)) {
    errors[START_DATE_BLOCK_ID] = "Please select a valid start date.";
  }
  if (endDate !== null && !DATE_PATTERN.test(endDate)) {
    errors[END_DATE_BLOCK_ID] = "Please select a valid end date.";
  }
  if (startTime !== null && !TIME_PATTERN.test(startTime)) {
    errors[START_TIME_BLOCK_ID] = "Please select a valid start time.";
  }
  if (endTime !== null && !TIME_PATTERN.test(endTime)) {
    errors[END_TIME_BLOCK_ID] = "Please select a valid end time.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  if (startTime !== null && startDate === null) {
    errors[START_TIME_BLOCK_ID] = "A start time needs a start date.";
  }
  if (endDate !== null && startDate === null) {
    errors[END_DATE_BLOCK_ID] = "An end date needs a start date.";
  }
  if (endTime !== null && endDate === null) {
    errors[END_TIME_BLOCK_ID] = "An end time needs an end date.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  if (startDate !== null && endDate !== null && endDate < startDate) {
    errors[END_DATE_BLOCK_ID] = "End date must be on or after the start date.";
    return { ok: false, errors };
  }

  const sameDay = startDate !== null && endDate !== null && startDate === endDate;
  if (sameDay && startTime !== null && endTime !== null && endTime <= startTime) {
    errors[END_TIME_BLOCK_ID] = "End time must be after the start time.";
    return { ok: false, errors };
  }

  return { ok: true };
}

const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Manual string parsing, never a Date object — avoids any possibility of a runtime-timezone day shift entirely, not just avoiding conversion in principle. */
function formatDatePart(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTH_ABBREVIATIONS[month - 1]} ${day}, ${year}`;
}

/** Slack's timepicker returns "HH:mm"; a value read back from the database's `time` column may come back as "HH:mm:ss" — tolerate either without ever converting the clock value itself. */
function formatTimePart(time: string): string {
  return time.slice(0, 5);
}

/** Assumes already-validated input (see validateRequestTiming) — never called with a shape validation would have rejected. */
function formatSuppliedTiming(timing: RequestTiming): string | null {
  const { startDate, startTime, endDate, endTime } = timing;
  if (!startDate) {
    return null;
  }

  const sameDay = !endDate || endDate === startDate;
  if (sameDay) {
    const datePart = formatDatePart(startDate);
    if (startTime && endTime) {
      return `${datePart}, ${formatTimePart(startTime)} – ${formatTimePart(endTime)}`;
    }
    if (startTime) {
      return `${datePart}, ${formatTimePart(startTime)}`;
    }
    // A same-day request can legitimately have only an end time (e.g.
    // "leave by 17:00" with no specific start) — must still be shown, never
    // silently dropped just because there's no start time to pair it with.
    if (endTime) {
      return `${datePart}, until ${formatTimePart(endTime)}`;
    }
    return datePart;
  }

  const startPart = startTime ? `${formatDatePart(startDate)}, ${formatTimePart(startTime)}` : formatDatePart(startDate);
  const endPart = endTime ? `${formatDatePart(endDate)}, ${formatTimePart(endTime)}` : formatDatePart(endDate);
  return `${startPart} – ${endPart}`;
}

export interface WhenLabel {
  /** "When" for actual date/time data, "When / Duration" only for the pre-this-correction historical fallback — never the same label for both, so a reader can never mistake one for the other. */
  label: string;
  value: string;
}

/**
 * The single formatter shared by every Slack surface that shows request
 * timing (Request Details, the approver DM, the requester notification,
 * App Home/Request Center row summaries) — reused, never reimplemented per
 * surface. Prefers the new date/time fields; falls back to the historical
 * `requested_duration_minutes` label only when none of the new fields are
 * set (true for every request created before this correction, and for any
 * new request where the requester left every "When" field blank). Returns
 * `null` when there is genuinely nothing to show — callers omit the field
 * entirely rather than rendering "Not specified"/"NULL"/"0 minutes".
 */
export function formatWhenLabel(timing: RequestTiming, legacyDurationMinutes: number | null): WhenLabel | null {
  const supplied = formatSuppliedTiming(timing);
  if (supplied) {
    return { label: "When", value: supplied };
  }
  if (legacyDurationMinutes !== null) {
    return { label: "When / Duration", value: formatDurationLabel(legacyDurationMinutes) };
  }
  return null;
}

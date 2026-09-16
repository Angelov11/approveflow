/**
 * Fixed "When / Duration" choices offered in the request modal. Shared
 * between the modal builder (so the select options are always in sync) and
 * submission validation (so only these exact values are ever accepted, not
 * just "any positive integer").
 *
 * M8: replaced the original AWS-access-shaped set (30 minutes .. 8 hours ..
 * 1 day) with a workplace-request-shaped set that stretches up to a week —
 * "Vacation / Time Off" or "Personal Time" are routinely multi-day, which
 * the original scale had no way to express. This is still a fixed choice
 * list, not a date range or calendar picker — M8 explicitly does not build
 * date-range calculations, business-day math, or calendar sync; it only
 * changes which fixed labels are offered, exactly like before.
 */

export const NOT_SPECIFIED_DURATION_VALUE = "not_applicable";

export interface DurationOption {
  /** Slack option `value` (string, per Block Kit) and the value stored server-side pre-parse. */
  value: string;
  label: string;
  minutes: number | null;
}

export const DURATION_OPTIONS: readonly DurationOption[] = [
  { value: "30", label: "30 minutes", minutes: 30 },
  { value: "60", label: "1 hour", minutes: 60 },
  { value: "120", label: "2 hours", minutes: 120 },
  { value: "240", label: "Half day", minutes: 240 },
  { value: "1440", label: "1 day", minutes: 1440 },
  { value: "2880", label: "2 days", minutes: 2880 },
  { value: "4320", label: "3 days", minutes: 4320 },
  { value: "10080", label: "1 week", minutes: 10080 },
  { value: NOT_SPECIFIED_DURATION_VALUE, label: "Other / Not specified", minutes: null },
];

/** Returns the duration in minutes (or null for "Other / Not specified"), or `undefined` if the value isn't one of DURATION_OPTIONS. */
export function resolveDurationMinutes(value: string): number | null | undefined {
  const option = DURATION_OPTIONS.find((candidate) => candidate.value === value);
  return option ? option.minutes : undefined;
}

/**
 * Human label for a stored `requested_duration_minutes` value. `null` means
 * "Other / Not specified" was selected (a real, intentional choice — not a
 * missing/legacy value) and renders as "Not specified", matching the modal
 * option's own wording exactly so nothing shown back to a user ever
 * contradicts what they picked. Never "0 minutes", "undefined", "null", or
 * "NaN" — the null check always short-circuits first.
 */
export function formatDurationLabel(minutes: number | null): string {
  if (minutes === null) {
    return "Not specified";
  }
  const match = DURATION_OPTIONS.find((option) => option.minutes === minutes);
  return match ? match.label : `${minutes} minutes`;
}

/**
 * Fixed duration choices offered in the /request modal. Shared between the
 * modal builder (so the select options are always in sync) and submission
 * validation (so only these exact values are ever accepted, not just "any
 * positive integer").
 */

export const NOT_APPLICABLE_DURATION_VALUE = "not_applicable";

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
  { value: "240", label: "4 hours", minutes: 240 },
  { value: "480", label: "8 hours", minutes: 480 },
  { value: "1440", label: "1 day", minutes: 1440 },
  { value: NOT_APPLICABLE_DURATION_VALUE, label: "Not applicable", minutes: null },
];

/** Returns the duration in minutes (or null for "Not applicable"), or `undefined` if the value isn't one of DURATION_OPTIONS. */
export function resolveDurationMinutes(value: string): number | null | undefined {
  const option = DURATION_OPTIONS.find((candidate) => candidate.value === value);
  return option ? option.minutes : undefined;
}

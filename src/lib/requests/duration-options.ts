/**
 * Historical-only reference data. "Duration" was a fixed Slack modal
 * static_select from M2 through the first pass of M8 — see
 * request-timing.ts for the actual date/time fields that replace it for
 * every new request going forward. This array's only remaining purpose is
 * reversing a HISTORICAL `requested_duration_minutes` value back to the
 * exact label a requester actually saw at creation time, so it must always
 * reflect the ORIGINAL M2–M7 scale — verified against real production data:
 * every one of the 16 pre-correction requests uses one of these six values.
 * It must never be changed to match some other option list that existed
 * only briefly and was never actually offered to a real user — doing that
 * once already silently mislabeled a real historical request (240 minutes
 * was "4 hours" when selected; a later list briefly relabeled 240 as "Half
 * day", which would have misrepresented that request's own history).
 */
export interface DurationOption {
  value: string;
  label: string;
  minutes: number;
}

export const DURATION_OPTIONS: readonly DurationOption[] = [
  { value: "30", label: "30 minutes", minutes: 30 },
  { value: "60", label: "1 hour", minutes: 60 },
  { value: "120", label: "2 hours", minutes: 120 },
  { value: "240", label: "4 hours", minutes: 240 },
  { value: "480", label: "8 hours", minutes: 480 },
  { value: "1440", label: "1 day", minutes: 1440 },
];

/**
 * Human label for a historical `requested_duration_minutes` value. Only
 * ever consulted as a fallback when a request has no new-style timing
 * fields at all (see `formatWhenLabel` in request-timing.ts) — every new
 * request leaves this column NULL. `null` always renders as "Not
 * specified" — never "0 minutes", "undefined", "null", or "NaN" — and an
 * unrecognized non-null value (there shouldn't be one) falls back to a raw
 * "N minutes" label rather than silently disappearing.
 */
export function formatDurationLabel(minutes: number | null): string {
  if (minutes === null) {
    return "Not specified";
  }
  const match = DURATION_OPTIONS.find((option) => option.minutes === minutes);
  return match ? match.label : `${minutes} minutes`;
}

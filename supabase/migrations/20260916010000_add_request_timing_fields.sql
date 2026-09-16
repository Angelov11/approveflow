-- M8 correction: a fixed "Duration" dropdown (30 minutes .. 1 week) cannot
-- express WHEN a workplace request actually happens — "Vacation / Time
-- Off, 1 week" doesn't say which week; "Doctor Appointment, 2 hours"
-- doesn't say when the appointment is. This migration adds four nullable
-- date/time columns capturing exactly what the requester enters via
-- Slack's native `datepicker`/`timepicker` Block Kit elements.
--
-- DATE + TIME, deliberately not timestamptz: these are human, workplace-
-- local values ("September 21", "10:00") as the requester typed/picked
-- them, not an absolute instant. This app has no reliable per-employee or
-- per-workspace timezone model — using timestamptz would force silently
-- assuming a timezone (almost certainly UTC, the server's), which could
-- misrepresent the requester's actual intended local time. Storing the
-- literal date/time avoids inventing a conversion this app cannot do
-- correctly.
--
-- `requested_duration_minutes` (M2) is untouched and permanently retained
-- for historical rendering — see duration-options.ts. Every one of the 16
-- pre-correction requests keeps rendering exactly as before; every new
-- request leaves these four columns as the only source of timing
-- information, with `requested_duration_minutes` staying NULL (already
-- nullable since M2 — no schema change needed there).
--
-- All four CHECK constraints below are immediately valid (not NOT VALID):
-- these are brand-new columns, so every existing row has NULL in all four,
-- trivially satisfying every one of these conditions — there is no
-- historical data to grandfather. They mirror
-- src/lib/requests/request-timing.ts's validateRequestTiming() exactly, as
-- a defense-in-depth backstop, same posture as every other business-rule
-- CHECK constraint in this schema (e.g. the M7 comment-length constraints).

alter table public.requests
  add column requested_start_date date,
  add column requested_start_time time,
  add column requested_end_date date,
  add column requested_end_time time;

comment on column public.requests.requested_start_date is
  'Local calendar date as entered via Slack''s datepicker — never converted, never assumed to be in any particular timezone.';
comment on column public.requests.requested_start_time is
  'Local clock time as entered via Slack''s timepicker — never converted, never assumed to be in any particular timezone.';
comment on column public.requests.requested_end_date is
  'Optional. NULL does not mean "same as start date" — a single-day request is start-date-only, by the requester''s own input, never inferred.';
comment on column public.requests.requested_end_time is
  'Optional. Requires requested_end_date to be set (see CHECK constraint below).';

alter table public.requests
  add constraint requests_start_time_requires_start_date
  check (requested_start_time is null or requested_start_date is not null);

alter table public.requests
  add constraint requests_end_date_requires_start_date
  check (requested_end_date is null or requested_start_date is not null);

alter table public.requests
  add constraint requests_end_time_requires_end_date
  check (requested_end_time is null or requested_end_date is not null);

alter table public.requests
  add constraint requests_end_date_not_before_start_date
  check (requested_end_date is null or requested_start_date is null or requested_end_date >= requested_start_date);

-- Only meaningful when start and end fall on the exact same calendar date
-- and both times are present — a multi-day range needs no same-day time
-- ordering check at all (the date columns already establish the order).
alter table public.requests
  add constraint requests_same_day_end_time_after_start_time
  check (
    requested_start_date is distinct from requested_end_date
    or requested_start_time is null
    or requested_end_time is null
    or requested_end_time > requested_start_time
  );

-- M7: decision comments/reasons. approvals.comment already exists (M3) and
-- decide_on_request() has already accepted/stored a p_comment since the M4
-- routing update — it was simply never populated, because no caller ever
-- passed one. This migration adds the two DB-level invariants M7 needs; the
-- next migration teaches decide_on_request() to actually enforce/normalize
-- them before insert.
--
-- Production inspection before writing this migration (read-only, via the
-- service-role client): 12 approvals total, 8 APPROVED, 4 REJECTED — all 4
-- REJECTED rows have comment = NULL, and zero rows of any decision have a
-- non-null comment. So:
--
--  1. The max-length constraint is safe to VALIDATE immediately — every
--     existing value is NULL.
--  2. The "REJECTED requires a non-blank comment" constraint would FAIL a
--     standard (validated) CHECK against all 4 existing REJECTED rows. We
--     do not fabricate comments for historical decisions (there is no way
--     to know what a past rejector actually meant), and we do not delete or
--     alter historical rows. Instead this uses Postgres's `NOT VALID`
--     constraint mode: it is enforced for every future INSERT/UPDATE from
--     the moment this migration runs, but existing rows are grandfathered
--     in without an initial validation scan (which would otherwise fail on
--     exactly those 4 rows). This is the standard, safe Postgres pattern
--     for adding a constraint to a table with known-noncompliant history.
--     We deliberately do NOT run `VALIDATE CONSTRAINT` afterward — doing so
--     would fail against the same 4 rows for the same reason.

alter table public.approvals
  add constraint approvals_comment_max_length
  check (comment is null or length(comment) <= 1000);

alter table public.approvals
  add constraint approvals_rejected_requires_comment
  check (decision <> 'REJECTED' or (comment is not null and length(trim(comment)) > 0))
  not valid;

comment on constraint approvals_rejected_requires_comment on public.approvals is
  'NOT VALID by design: 4 pre-M7 REJECTED rows have no comment and are intentionally grandfathered, never backfilled. Enforced for all rows inserted/updated from this migration forward.';

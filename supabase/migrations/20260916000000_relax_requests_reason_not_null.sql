-- M8: MVP simplification merges the modal's separate "Reason" field into
-- "Details" (the `resource` column, kept as-is — see request-types.ts and
-- build-request-modal.ts for why the column itself was never renamed). New
-- requests no longer collect a distinct reason at all, and the application
-- deliberately does NOT duplicate the Details text into `reason` (that
-- would be misleading — a future reader would see two identical-looking
-- but semantically different columns and reasonably assume a bug).
--
-- The only change needed is dropping NOT NULL. The existing CHECK
-- constraint (`char_length(reason) between 1 and 2000`, from the M2
-- migration) needs no change at all: Postgres treats a CHECK expression
-- that evaluates to NULL as satisfied, not failed — `char_length(NULL)` is
-- NULL, so `NULL between 1 and 2000` is NULL, which passes. This is
-- standard, documented Postgres CHECK-constraint behavior, not a workaround.
--
-- Zero risk to history: every existing row already has a non-null,
-- constraint-satisfying `reason` (this migration doesn't touch existing
-- data at all — it only widens what's allowed for rows going forward), and
-- every consumer of `reason` (Request Details, the approver DM, the
-- requester notification) already renders it conditionally — present for
-- historical requests, simply absent for new ones, exactly like M7's
-- optional decision comments.

alter table public.requests
  alter column reason drop not null;

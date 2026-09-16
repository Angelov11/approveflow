-- M8 correction (request-type-aware fields): Expense / Purchase requests
-- need an amount and a currency, not a date/time range — this migration
-- adds two nullable columns for that, leaving every other request type and
-- all 16 pre-existing historical requests completely untouched (their
-- values in these two new columns are simply NULL).
--
-- numeric(10,2), not float/real: money must never use a binary floating-
-- point type (rounding error is unacceptable for an amount someone is
-- asking approval to spend). 10,2 allows up to 99,999,999.99 — comfortably
-- above any ordinary workplace purchase, with exactly 2 decimal places.
-- Application-layer validation (src/lib/requests/expense.ts) is what
-- actually REJECTS a value with more than 2 decimal places outright — the
-- column's own numeric(10,2) typmod would otherwise silently round it
-- instead of erroring, which is not the behavior we want.
--
-- Currency: a small, fixed ISO 4217-style allow-list enforced directly in
-- the CHECK constraint below (USD, EUR, GBP, MKD, CAD, AUD) — no exchange-
-- rate infrastructure, no currency API, no localization engine. Adding a
-- 7th currency later means a small follow-up migration, which is an
-- acceptable and deliberately simple tradeoff for an MVP.
--
-- These two CHECK constraints are simple, row-level, and NOT type-specific
-- — "amount > 0 if present" and "currency is one of these six codes if
-- present" say nothing about which request TYPE the row belongs to, so
-- they're both immediately valid (every existing row has NULL in both
-- columns, trivially satisfying "NULL or ..."). What is deliberately NOT
-- enforced here is "an expense_purchase-type row MUST have both fields set"
-- — that rule depends on joining to request_types.key, which would require
-- either denormalizing the type key onto requests or a trigger, either of
-- which is real, unwarranted complexity for M8. That rule stays where every
-- other type-specific rule in this app already lives: authoritatively in
-- application code (see request-type-config.ts and
-- validate-request-submission.ts), consistent with the existing posture
-- that the database enforces structural/business invariants but not a
-- denormalized join across two tables.

alter table public.requests
  add column requested_amount numeric(10, 2),
  add column requested_currency text;

comment on column public.requests.requested_amount is
  'Expense / Purchase requests only. NULL for every other request type and for all historical (pre-this-migration) rows.';
comment on column public.requests.requested_currency is
  'ISO 4217-style code from a small fixed MVP allow-list (see the CHECK constraint) — no FX conversion, no currency API.';

alter table public.requests
  add constraint requests_amount_positive
  check (requested_amount is null or requested_amount > 0);

alter table public.requests
  add constraint requests_currency_valid
  check (requested_currency is null or requested_currency in ('USD', 'EUR', 'GBP', 'MKD', 'CAD', 'AUD'));

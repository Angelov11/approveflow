-- M4 hardening: DIRECT requests always require exactly 1 approval by
-- product design (src/app/api/slack/interactions/route.ts always inserts
-- `required_approval_count: 1` for DIRECT routing), but until now nothing
-- in the database enforced it — only the general `required_approval_count
-- >= 1` check applied. A future application bug inserting a DIRECT row
-- with a different threshold wouldn't be a security hole (decide_on_request
-- authorizes only the single persisted direct_approver_id regardless), but
-- it would leave the request permanently stuck PENDING: there is exactly
-- one authorized approver for a DIRECT request, and they can only decide
-- once, so any threshold other than 1 could never be reached.
--
-- Verified before writing this migration: all 3 existing DIRECT rows in
-- production already have required_approval_count = 1 (queried directly —
-- zero rows matched routing_type = 'DIRECT' and required_approval_count
-- <> 1), so this is a pure hardening addition with no data to reconcile.
--
-- This is a NEW, separate constraint — requests_routing_consistency (added
-- alongside routing_type/approval_policy_id/direct_approver_id in the
-- earlier M4 migration) is untouched. POLICY rows are unaffected: the
-- condition is vacuously true whenever routing_type <> 'DIRECT', so a
-- POLICY row's required_approval_count keeps behaving exactly as before
-- (including the documented historical case of a null approval_policy_id).

alter table public.requests add constraint requests_direct_requires_single_approval check (
  routing_type <> 'DIRECT' or required_approval_count = 1
);

comment on constraint requests_direct_requires_single_approval on public.requests is
  'DIRECT-routed requests must always require exactly 1 approval — there is only ever one authorized approver, so any other threshold would leave the request permanently undecidable.';

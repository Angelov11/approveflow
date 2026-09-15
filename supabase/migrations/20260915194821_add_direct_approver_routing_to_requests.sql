-- M4: zero-configuration direct approver routing.
--
-- Until now, a request's approver(s) were resolved by dynamically asking
-- "is there currently an active policy for this request type?" — both at
-- notification time and, in decide_on_request(), at decision time. That's
-- fine as long as policies never change after a request exists, but it
-- creates real instability once they can: a request created while no
-- policy existed could suddenly need one later; a request created under
-- Policy A could end up "governed" by unrelated Policy B if Policy A was
-- disabled and replaced; editing a policy's required_approvals could
-- retroactively change the threshold for requests already in flight.
--
-- Fix: routing is decided ONCE, at request creation, and frozen on the row:
--   - routing_type: 'POLICY' or 'DIRECT', set at insert time by the
--     interactions route depending on whether an active policy existed for
--     the request's type at that moment (src/app/api/slack/interactions).
--   - approval_policy_id: WHICH policy row governs this request, snapshotted
--     by id (not re-derived from workspace_id+request_type_id+active later).
--     Null for DIRECT requests, and also null for pre-M4 historical POLICY
--     rows where no matching active policy could be identified during
--     backfill (see below) — a real historical-data gap, not a routing bug.
--   - direct_approver_id: the single Slack user the requester picked via
--     the modal's native `users_select`, when routing_type = 'DIRECT'.
--     Always null for POLICY requests — Case A in the interactions route
--     deliberately discards the requester's selection rather than
--     persisting it as though it were authoritative.
--   - required_approval_count: the approval threshold, ALSO snapshotted at
--     creation (1 for DIRECT, always; the policy's required_approvals at
--     that moment for POLICY) — decide_on_request() reads this column, not
--     approval_policies.required_approvals, so editing a policy later can't
--     retroactively change the threshold for requests already in flight.
--
-- Deliberately NOT snapshotted: WHO may approve under a policy. Given a
-- POLICY request's approval_policy_id, decide_on_request() still reads
-- approval_policy_members live. This is intentional, not an oversight —
-- if an admin removes someone as an approver, that removal should take
-- effect immediately, including for already-pending requests (e.g. the
-- person left the team); grandfathering in a stale member snapshot would
-- be the less safe choice here. Policy IDENTITY and THRESHOLD are frozen
-- for stability; MEMBERSHIP stays live for safety.

alter table public.requests
  add column routing_type text not null default 'POLICY' check (routing_type in ('POLICY', 'DIRECT')),
  add column approval_policy_id uuid references public.approval_policies(id) on delete set null,
  add column direct_approver_id uuid references public.users(id) on delete restrict,
  add column required_approval_count integer not null default 1 check (required_approval_count >= 1);

-- Every request created before this migration was, by construction, routed
-- under the M2/M3 dynamic-policy model — reclassify each as POLICY and
-- attach whichever policy is currently active for its type, which is the
-- best-effort historically-accurate reconstruction (no policy has ever
-- been disabled/replaced in this app before now, so "currently active"
-- and "active at the time" necessarily coincide for pre-existing rows).
update public.requests r
set
  approval_policy_id = ap.id,
  required_approval_count = ap.required_approvals
from public.approval_policies ap
where ap.workspace_id = r.workspace_id
  and ap.request_type_id = r.request_type_id
  and ap.active
  and r.routing_type = 'POLICY';

-- Force future inserts to specify these explicitly rather than silently
-- falling back to POLICY/1 — the application always knows its routing
-- decision and should never rely on a column default to express it.
alter table public.requests alter column routing_type drop default;
alter table public.requests alter column required_approval_count drop default;

-- Prevents contradictory rows: a DIRECT request must name its approver and
-- must not carry a policy reference; a POLICY request must not carry a
-- direct approver (approval_policy_id may legitimately be null — see the
-- historical-backfill note above).
alter table public.requests add constraint requests_routing_consistency check (
  (routing_type = 'DIRECT' and direct_approver_id is not null and approval_policy_id is null)
  or
  (routing_type = 'POLICY' and direct_approver_id is null)
);

comment on column public.requests.routing_type is
  'Frozen at request creation: POLICY or DIRECT. Never re-derived from "is there an active policy right now" after creation.';
comment on column public.requests.approval_policy_id is
  'Snapshot of which policy row governed this request, for POLICY routing. Null for DIRECT requests and for historical rows with no identifiable policy at backfill time.';
comment on column public.requests.direct_approver_id is
  'The requester-selected Slack user, for DIRECT routing only. Never set for POLICY requests even if the requester picked someone in the modal — see the interactions route.';
comment on column public.requests.required_approval_count is
  'Approval threshold snapshotted at creation time (always 1 for DIRECT). decide_on_request() reads this, not approval_policies.required_approvals, so later policy edits cannot retroactively change an in-flight request''s threshold.';

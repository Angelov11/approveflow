-- Atomic approval decision. Mirrors the decision algorithm unit-tested in
-- src/lib/requests/compute-decision-outcome.ts — keep the two in sync if
-- either changes. The actual authorization + atomicity guarantee for
-- production traffic lives HERE, not in the TypeScript mirror: a plpgsql
-- function body executes as a single transaction, and the initial
-- `select ... for update` row-locks the request for the duration of that
-- transaction, so two concurrent decisions on the same request serialize
-- instead of racing on the approval count (the exact bug a naive
-- "read count, calculate, then update" sequence from application code
-- would have).
--
-- Race condition this prevents: with required_approvals = 2, Gary and Mike
-- both clicking Approve at nearly the same instant. Without the row lock,
-- both transactions could independently count only their own
-- not-yet-committed insert, each conclude "count = 1", and neither would
-- ever transition the request to APPROVED. The lock forces the second
-- caller to wait for the first to commit, then re-read a consistent count
-- that includes it.
create or replace function public.decide_on_request(
  p_request_id uuid,
  p_approver_id uuid,
  p_decision text,
  p_comment text default null
)
returns table (
  outcome text,
  request_status text,
  approvals_count integer,
  required_approvals integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.requests%rowtype;
  v_policy public.approval_policies%rowtype;
  v_is_member boolean;
  v_already_decided boolean;
  v_approvals_count integer;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if not found then
    return query select 'not_found'::text, null::text, null::integer, null::integer;
    return;
  end if;

  -- Fail closed on anything that isn't still open. Covers both legitimate
  -- re-clicks after finalization and any attempt to decide on a request
  -- that was never PENDING to begin with.
  if v_request.status <> 'PENDING' then
    return query select 'already_final'::text, v_request.status, null::integer, null::integer;
    return;
  end if;

  select * into v_policy
  from public.approval_policies
  where workspace_id = v_request.workspace_id
    and request_type_id = v_request.request_type_id
    and active
  limit 1;

  if not found then
    return query select 'no_policy'::text, v_request.status, null::integer, null::integer;
    return;
  end if;

  -- Authorization: the approver (already resolved server-side from the
  -- trusted, signature-verified Slack payload — never from client-supplied
  -- values) must be a configured member of this exact policy. Membership is
  -- transitively workspace-scoped (see the schema migration comment), so
  -- this alone also rules out cross-workspace forgery.
  select exists(
    select 1 from public.approval_policy_members
    where policy_id = v_policy.id and user_id = p_approver_id
  ) into v_is_member;

  if not v_is_member then
    return query select 'unauthorized'::text, v_request.status, null::integer, v_policy.required_approvals;
    return;
  end if;

  select exists(
    select 1 from public.approvals
    where request_id = p_request_id and approver_id = p_approver_id
  ) into v_already_decided;

  if v_already_decided then
    return query select 'already_decided'::text, v_request.status, null::integer, v_policy.required_approvals;
    return;
  end if;

  insert into public.approvals (request_id, approver_id, decision, comment)
  values (p_request_id, p_approver_id, p_decision, p_comment);

  if p_decision = 'REJECTED' then
    update public.requests set status = 'REJECTED' where id = p_request_id;
    return query select 'rejected'::text, 'REJECTED'::text, null::integer, v_policy.required_approvals;
    return;
  end if;

  select count(*) into v_approvals_count
  from public.approvals
  where request_id = p_request_id and decision = 'APPROVED';

  if v_approvals_count >= v_policy.required_approvals then
    update public.requests set status = 'APPROVED' where id = p_request_id;
    return query select 'approved'::text, 'APPROVED'::text, v_approvals_count, v_policy.required_approvals;
  else
    return query select 'recorded_pending'::text, 'PENDING'::text, v_approvals_count, v_policy.required_approvals;
  end if;
end;
$$;

comment on function public.decide_on_request is
  'Atomically authorizes and records an approve/reject decision, transitioning the request to APPROVED/REJECTED when appropriate. See migration comment for the concurrency argument.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default — do not
-- assume that's already been locked down. Revoke explicitly, then grant
-- only to the role this app actually uses (service_role, via
-- src/lib/requests/approval-actions.ts). anon/authenticated never call this
-- directly; there is no client-side Supabase usage in this app at all.
revoke all on function public.decide_on_request(uuid, uuid, text, text) from public;
revoke all on function public.decide_on_request(uuid, uuid, text, text) from anon;
revoke all on function public.decide_on_request(uuid, uuid, text, text) from authenticated;
grant execute on function public.decide_on_request(uuid, uuid, text, text) to service_role;

-- M4: teaches decide_on_request() to authorize BOTH policy-routed and
-- direct-routed requests, branching on the request's own frozen
-- routing_type rather than re-deriving "is there an active policy" (see
-- the previous migration's header comment for why that would be unstable).
--
-- This is a `create or replace` in a NEW migration — the M3 migration that
-- originally created this function is untouched; Postgres functions are
-- versioned by replacing the definition, not by editing history.
--
-- Mirrors src/lib/requests/compute-decision-outcome.ts (updated alongside
-- this migration) — keep the two in sync. Same locking/atomicity guarantee
-- as M3: the initial `for update` still serializes concurrent decisions on
-- the same request, now covering both routing models identically.
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
  v_is_authorized boolean;
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

  if v_request.status <> 'PENDING' then
    return query select 'already_final'::text, v_request.status, null::integer, null::integer;
    return;
  end if;

  -- Authorization model is determined by THIS request's own frozen
  -- routing_type — never by whether a policy happens to be active right
  -- now, which could differ from what applied at creation time.
  if v_request.routing_type = 'POLICY' then
    if v_request.approval_policy_id is null then
      -- Historical row with no identifiable policy (see backfill note in
      -- the schema migration), or a policy that's since been deleted
      -- (approval_policy_id is ON DELETE SET NULL). Nobody can decide.
      return query select 'no_policy'::text, v_request.status, null::integer, v_request.required_approval_count;
      return;
    end if;

    select exists(
      select 1 from public.approval_policy_members
      where policy_id = v_request.approval_policy_id and user_id = p_approver_id
    ) into v_is_authorized;
  elsif v_request.routing_type = 'DIRECT' then
    v_is_authorized := (v_request.direct_approver_id = p_approver_id);
  else
    v_is_authorized := false;
  end if;

  if not v_is_authorized then
    return query select 'unauthorized'::text, v_request.status, null::integer, v_request.required_approval_count;
    return;
  end if;

  select exists(
    select 1 from public.approvals
    where request_id = p_request_id and approver_id = p_approver_id
  ) into v_already_decided;

  if v_already_decided then
    return query select 'already_decided'::text, v_request.status, null::integer, v_request.required_approval_count;
    return;
  end if;

  insert into public.approvals (request_id, approver_id, decision, comment)
  values (p_request_id, p_approver_id, p_decision, p_comment);

  if p_decision = 'REJECTED' then
    update public.requests set status = 'REJECTED' where id = p_request_id;
    return query select 'rejected'::text, 'REJECTED'::text, null::integer, v_request.required_approval_count;
    return;
  end if;

  select count(*) into v_approvals_count
  from public.approvals
  where request_id = p_request_id and decision = 'APPROVED';

  if v_approvals_count >= v_request.required_approval_count then
    update public.requests set status = 'APPROVED' where id = p_request_id;
    return query select 'approved'::text, 'APPROVED'::text, v_approvals_count, v_request.required_approval_count;
  else
    return query select 'recorded_pending'::text, 'PENDING'::text, v_approvals_count, v_request.required_approval_count;
  end if;
end;
$$;

comment on function public.decide_on_request is
  'Atomically authorizes and records an approve/reject decision for either POLICY or DIRECT routed requests, transitioning status when appropriate. See this migration and the schema migration for the routing-stability design.';

-- Re-assert explicitly: CREATE OR REPLACE preserves existing grants, but
-- don't rely on that silently — state the intended privileges again so
-- this migration is self-contained and correct even if run in isolation.
revoke all on function public.decide_on_request(uuid, uuid, text, text) from public;
revoke all on function public.decide_on_request(uuid, uuid, text, text) from anon;
revoke all on function public.decide_on_request(uuid, uuid, text, text) from authenticated;
grant execute on function public.decide_on_request(uuid, uuid, text, text) to service_role;

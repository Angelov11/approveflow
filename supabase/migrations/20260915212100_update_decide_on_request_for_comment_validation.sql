-- M7: decide_on_request() now normalizes and validates the decision
-- comment/reason before inserting the approval row. Everything else
-- (row locking, DIRECT/POLICY authorization, duplicate-decision and
-- already-final handling, immediate-rejection and threshold-approval
-- semantics) is copied verbatim from the M4 migration — only the comment
-- handling is new, inserted between the `p_decision` sanity check and the
-- request row lock.
--
-- Comment/reason rules (mirrored in application-layer validation for UX —
-- see src/lib/requests/validate-decision-submission.ts — but this function
-- remains the authoritative enforcement, exactly like every other
-- authorization/business rule here):
--   - Normalized via trim(); an empty/whitespace-only value becomes NULL.
--   - APPROVED: a NULL comment is fine (comment is optional).
--   - REJECTED: a NULL comment after normalization is rejected outright
--     (raise exception) — a REJECTED decision must always carry a reason.
--     This mirrors the `approvals_rejected_requires_comment` CHECK added in
--     the previous migration; the RPC check exists so a bad call fails
--     loudly with a clear message before ever reaching the insert, rather
--     than surfacing as an opaque constraint-violation error.
--   - A comment longer than 1000 characters (after normalization) is
--     rejected outright (raise exception) rather than silently truncated —
--     matches the `approvals_comment_max_length` CHECK, and the same 1000
--     limit is enforced in the Slack modal's own max_length and in
--     application-layer validation before this RPC is ever called in
--     normal operation.
--
-- Both raise-exception paths here are defensive backstops for a
-- should-never-happen case (the application validates first) — the same
-- posture as the existing `p_decision not in (...)` check just below.
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
  v_comment text;
begin
  if p_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  v_comment := nullif(trim(both from p_comment), '');

  if v_comment is not null and length(v_comment) > 1000 then
    raise exception 'comment exceeds maximum length of 1000 characters';
  end if;

  if p_decision = 'REJECTED' and v_comment is null then
    raise exception 'REJECTED decision requires a non-blank comment';
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
  values (p_request_id, p_approver_id, p_decision, v_comment);

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
  'Atomically authorizes and records an approve/reject decision (with an optional/required comment) for either POLICY or DIRECT routed requests, transitioning status when appropriate. See the M4 and M7 migrations for the routing-stability and comment-validation design.';

-- Re-assert explicitly: CREATE OR REPLACE preserves existing grants, but
-- don't rely on that silently — state the intended privileges again so
-- this migration is self-contained and correct even if run in isolation.
revoke all on function public.decide_on_request(uuid, uuid, text, text) from public;
revoke all on function public.decide_on_request(uuid, uuid, text, text) from anon;
revoke all on function public.decide_on_request(uuid, uuid, text, text) from authenticated;
grant execute on function public.decide_on_request(uuid, uuid, text, text) to service_role;

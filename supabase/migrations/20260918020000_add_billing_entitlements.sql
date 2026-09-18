-- M10.1 — billing schema foundation for Paddle subscriptions, plus a
-- DB-level Pro-entitlement defense-in-depth on configure_approval_policy.
--
-- This migration adds ONLY the schema and RPC-level guard needed to make
-- "a workspace must be on Pro to have an ACTIVE approval policy" true at
-- the database layer, on top of the existing Node-level
-- isWorkspaceAdmin() authorization check. It does NOT implement webhook
-- processing, checkout, a Paddle API client, or any Paddle catalog — those
-- remain fully unimplemented pending separate, later authorization. Both
-- new tables start empty: nothing in this migration backfills or mutates
-- any existing workspace_subscriptions-shaped data (there is none yet),
-- and the existing pre-billing "Production Access Approval" policy is not
-- touched by this migration at all. "Effective policy" resolution (an
-- active policy only actually routes requests once its workspace is
-- entitled) is application-level work deferred to a later milestone —
-- interactions/route.ts and decide_on_request() are both untouched here,
-- so current request routing behavior does not change.
--
-- workspace_subscriptions
-- ------------------------
-- One row per workspace's current Paddle subscription relationship — a
-- workspace with no row is simply Free (there is no explicit FREE row).
-- RLS is enabled with no policies for anon/authenticated: every access is
-- server-side via the service role, the same posture as workspace_admins
-- and every other admin-only table in this schema. No raw Paddle payload
-- column and no payment/customer personal data beyond the provider's own
-- opaque customer/subscription ids.
--
-- Nullability reasoning (this table is only ever written by a future
-- webhook handler — M10.1 inserts no rows — but the shape must already
-- accommodate real Paddle event data without requiring a later ALTER):
--   - workspace_id: NOT NULL, UNIQUE, FK -> workspaces ON DELETE CASCADE.
--     A subscription row is only ever created in response to a webhook
--     whose custom_data carries the workspace_id set server-side at
--     checkout time — there is no code path that could legitimately
--     produce a row without knowing which workspace it belongs to. UNIQUE
--     because this app sells at most one Pro subscription per workspace
--     (see the M10 design note on rejecting a second paid checkout in
--     favor of Manage Billing).
--   - provider: NOT NULL, default 'PADDLE' — always known; only one
--     provider exists today, but the column exists so a future provider
--     never requires a backfill of existing rows.
--   - provider_subscription_id: NOT NULL, UNIQUE — this is the Paddle
--     subscription's own natural key (sub_...). A row is only ever
--     created FROM a subscription-shaped webhook event, which always
--     carries this id; a row without one isn't a subscription record yet.
--   - provider_customer_id: NOT NULL — every Paddle subscription object
--     includes customer_id; there is no documented Paddle event shape
--     where a subscription exists without one.
--   - provider_price_id: NULLABLE. isEntitledToPro never reads this
--     column — only plan/status matter for entitlement. It is
--     informational only, and a Paddle subscription's items are
--     technically a list, so forcing this NOT NULL risks a legitimate
--     future webhook write failing if that shape ever changes.
--   - plan, status: NOT NULL — the exact two columns the entitlement
--     resolver depends on; a row that can't yet state its own plan/status
--     shouldn't be inserted until both are known.
--   - current_period_start, current_period_end: NULLABLE — Paddle can
--     legitimately omit a subscription's current billing period in some
--     states (e.g. paused), and no entitlement or routing logic in this
--     app reads either column.
--   - scheduled_change_action, scheduled_change_effective_at: NULLABLE —
--     null for the large majority of subscriptions, which have no
--     scheduled change. Entitlement logic must NEVER read
--     scheduled_change_effective_at: Paddle keeps `status` itself
--     accurate through a scheduled cancellation (stays 'active' until the
--     actual period boundary), so entitlement never needs to inspect it.
--   - last_event_occurred_at: NOT NULL — every insert/update to this row
--     is driven by processing a real webhook event, which always carries
--     occurred_at; kept for future out-of-order delivery protection
--     (Paddle explicitly does not guarantee in-order webhook delivery).
--   - created_at, updated_at: NOT NULL, default now().
--
-- billing_webhook_events
-- -----------------------
-- Idempotency/audit ledger keyed by the provider's own (provider,
-- event_id) — NOT a payload store: no raw webhook body column, no
-- payment or customer personal data. RLS enabled, no policies —
-- service-role only, same posture as workspace_subscriptions.
--   - provider, provider_event_id: NOT NULL, composite PK — Paddle's
--     event_id (evt_...) is the documented dedupe key.
--   - event_type, occurred_at: NOT NULL — always present on a real event;
--     occurred_at is used for out-of-order detection.
--   - processed_at: NULLABLE — a future webhook handler may need to claim
--     a row (to dedupe concurrent retries) before processing finishes;
--     nullable leaves room to distinguish seen-but-not-yet-processed from
--     fully-processed without requiring that handler to exist yet.

create table public.workspace_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  provider text not null default 'PADDLE',
  provider_customer_id text not null,
  provider_subscription_id text not null unique,
  provider_price_id text,
  plan text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  scheduled_change_action text,
  scheduled_change_effective_at timestamptz,
  last_event_occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_subscriptions_plan_check check (plan in ('PRO')),
  constraint workspace_subscriptions_status_check check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled'))
);

alter table public.workspace_subscriptions enable row level security;

comment on table public.workspace_subscriptions is
  'One row per workspace''s current Paddle subscription relationship. No row = Free. Server-side (service role) access only. Written by a future webhook handler, not by M10.1 — see this migration for nullability reasoning.';

create table public.billing_webhook_events (
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  processed_at timestamptz,
  primary key (provider, provider_event_id)
);

alter table public.billing_webhook_events enable row level security;

comment on table public.billing_webhook_events is
  'Idempotency/audit ledger for provider webhook events, keyed by the provider''s own event id. No raw payload, no payment/customer personal data. Server-side (service role) access only. Written by a future webhook handler, not by M10.1.';

-- ---------------------------------------------------------------------
-- configure_approval_policy(...) — add DB-level Pro-entitlement defense
-- ---------------------------------------------------------------------
--
-- Same signature and the same #variable_conflict use_column fix carried
-- forward from 20260918010000 (this function's RETURNS TABLE (policy_id
-- uuid, outcome text) still shadows a same-named OUT parameter for
-- policy_id — see that migration for the full explanation of why the
-- pragma is required). Node's isWorkspaceAdmin() check is unchanged and
-- still runs first, before this function is ever called; the check added
-- below is defense-in-depth, not a replacement for it.
--
-- New behavior, only when p_active = true: require a
-- workspace_subscriptions row for p_workspace_id with plan = 'PRO' and
-- status in ('active', 'trialing', 'past_due') — the same three statuses
-- isEntitledToPro treats as entitled (see src/lib/billing/entitlements.ts).
-- Otherwise returns ('pro_required') using this RPC's existing
-- null-id-plus-outcome-string convention, matching every validation
-- failure below it. The lookup uses a table alias (`ws`) rather than a
-- bare column reference: no column in workspace_subscriptions happens to
-- collide with this function's `policy_id`/`outcome` RETURNS TABLE
-- columns today, but qualifying it explicitly means this check can never
-- silently reintroduce the exact ambiguity class fixed in 20260918010000
-- if either table ever gains a colliding column name later.
--
-- When p_active = false, this check is skipped entirely — disabling
-- always succeeds regardless of billing status, so a workspace that
-- downgrades or lapses can always turn its own policy off. Existing
-- pending POLICY-routed requests are unaffected either way: this function
-- only ever governs configuring a policy, never decide_on_request(),
-- which gains no entitlement check and must remain able to complete
-- already-pending requests after any future downgrade.
create or replace function public.configure_approval_policy(
  p_workspace_id uuid,
  p_request_type_id uuid,
  p_name text,
  p_required_approvals integer,
  p_active boolean,
  p_approver_user_ids uuid[]
)
returns table (policy_id uuid, outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_request_type_workspace_id uuid;
  v_request_type_active boolean;
  v_approver_count integer;
  v_distinct_count integer;
  v_policy_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    return query select null::uuid, 'invalid_name'::text;
    return;
  end if;
  if p_required_approvals is null or p_required_approvals < 1 then
    return query select null::uuid, 'invalid_threshold'::text;
    return;
  end if;

  if p_active and not exists (
    select 1 from public.workspace_subscriptions ws
    where ws.workspace_id = p_workspace_id
      and ws.plan = 'PRO'
      and ws.status in ('active', 'trialing', 'past_due')
  ) then
    return query select null::uuid, 'pro_required'::text;
    return;
  end if;

  -- Lock the request_type row first: serializes concurrent
  -- configure_approval_policy calls for the SAME type (e.g. a
  -- double-submitted modal) so the partial unique index on
  -- (workspace_id, request_type_id) WHERE active can never be raced.
  select workspace_id, active into v_request_type_workspace_id, v_request_type_active
  from public.request_types
  where id = p_request_type_id
  for update;

  if not found or v_request_type_workspace_id is distinct from p_workspace_id then
    return query select null::uuid, 'invalid_request_type'::text;
    return;
  end if;
  if not v_request_type_active then
    return query select null::uuid, 'inactive_request_type'::text;
    return;
  end if;

  v_approver_count := coalesce(array_length(p_approver_user_ids, 1), 0);
  select count(distinct x) into v_distinct_count from unnest(p_approver_user_ids) as x;
  if v_distinct_count <> v_approver_count then
    return query select null::uuid, 'duplicate_approvers'::text;
    return;
  end if;

  if p_active and v_approver_count = 0 then
    return query select null::uuid, 'no_approvers'::text;
    return;
  end if;
  if p_active and p_required_approvals > v_approver_count then
    return query select null::uuid, 'threshold_exceeds_approvers'::text;
    return;
  end if;

  if v_approver_count > 0 and exists (
    select 1 from unnest(p_approver_user_ids) as x
    left join public.users u on u.id = x and u.workspace_id = p_workspace_id
    where u.id is null
  ) then
    return query select null::uuid, 'invalid_approver'::text;
    return;
  end if;

  -- Deliberately NOT filtered to `and active`: M9 adds the ability to
  -- disable and later re-enable/edit the same logical policy through one
  -- modal. Matching on (workspace_id, request_type_id) alone, regardless
  -- of current active state, means there is always at most one policy row
  -- per type going forward — re-enabling a disabled policy updates that
  -- same row rather than accumulating a second one. `order by created_at
  -- desc limit 1` is a defensive tie-breaker (no duplicate rows for the
  -- same type exist in current data, since the pre-M9 script only ever
  -- matched on `active = true`, but this makes the function correct even
  -- if that were ever not true).
  select id into v_policy_id
  from public.approval_policies
  where workspace_id = p_workspace_id and request_type_id = p_request_type_id
  order by created_at desc
  limit 1
  for update;

  if v_policy_id is not null then
    update public.approval_policies
    set name = p_name, required_approvals = p_required_approvals, active = p_active
    where id = v_policy_id;
  else
    insert into public.approval_policies (workspace_id, request_type_id, name, required_approvals, active)
    values (p_workspace_id, p_request_type_id, p_name, p_required_approvals, p_active)
    returning id into v_policy_id;
  end if;

  delete from public.approval_policy_members where policy_id = v_policy_id;
  if v_approver_count > 0 then
    insert into public.approval_policy_members (policy_id, user_id)
    select v_policy_id, x from unnest(p_approver_user_ids) as x;
  end if;

  return query select v_policy_id, 'ok'::text;
end;
$$;

comment on function public.configure_approval_policy is
  'Atomically creates/updates a workspace''s policy for one request type and replaces its approver membership. Never deletes a policy row — disabling is always active=false and always allowed regardless of billing status. Activating (p_active=true) additionally requires an entitled workspace_subscriptions row (DB-level Pro defense-in-depth; Node independently authorizes the acting admin via isWorkspaceAdmin() before calling this). See 20260918010000 for the #variable_conflict fix and this migration (20260918020000) for the pro_required check.';

revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from public;
revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from anon;
revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from authenticated;
grant execute on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) to service_role;

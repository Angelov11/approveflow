-- POST-M11-B2 — billing ownership.
--
-- Adds a nullable owner column to workspace_subscriptions and extends two
-- existing RPCs to establish/enforce it:
--   - process_paddle_subscription_event: captures the owner from a
--     validated, server-authorized Paddle custom_data field, never from
--     anything else.
--   - remove_workspace_admin: blocks removing an admin who currently owns
--     a live/manageable subscription.
-- No workspace-level owner field, no ownership-history table — ownership
-- belongs to the one-row-per-workspace subscription row, matching how
-- every other billing fact is already modeled (see M10.1).

alter table public.workspace_subscriptions
  add column billing_owner_user_id uuid references public.users(id) on delete set null;

create index workspace_subscriptions_billing_owner_user_id_idx
  on public.workspace_subscriptions (billing_owner_user_id);

comment on column public.workspace_subscriptions.billing_owner_user_id is
  'The Slack admin (internal users.id) whose server-authorized checkout produced THIS subscription. Established only by a verified webhook event carrying validated initiating_user_id custom_data that resolves to a user belonging to this exact workspace — never by starting/abandoning a checkout, never inferred from Paddle customer/email identity. Null for pre-existing rows and for any event whose ownership metadata is missing or fails validation. A null owner means Manage Billing remains open to any workspace admin (pre-B2 behavior) — never a fail-closed default that would lock out an already-real subscription. See process_paddle_subscription_event for the same-subscription-preserves vs new-subscription-never-inherits distinction.';

-- ---------------------------------------------------------------------
-- process_paddle_subscription_event(...) — add p_initiating_user_id
-- ---------------------------------------------------------------------
--
-- The parameter list is changing (one new trailing param), so the old
-- 15-argument overload must be dropped explicitly first — `create or
-- replace` cannot change a function's argument list; without the drop,
-- Postgres would leave BOTH the old and new signatures callable side by
-- side, which is exactly the kind of ambiguity this migration exists to
-- avoid, not introduce.
drop function if exists public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz
);

-- CRITICAL OWNERSHIP RULE (the one correction required in review):
-- billing_owner_user_id must NEVER simply coalesce(new, existing) for
-- every event — that is only safe when the event's provider_subscription_id
-- matches the row's EXISTING provider_subscription_id (a later event
-- about the SAME subscription: an update, a cancellation, a retry). The
-- moment a NEW provider_subscription_id replaces the workspace's previous
-- one (a re-upgrade after cancellation), the old subscription's owner
-- must never carry forward merely because the workspace_id row is reused
-- — that would let a historical owner (e.g. a since-departed admin)
-- silently retain management control over someone else's brand new,
-- unrelated subscription. So:
--   SAME subscription + valid initiator   -> owner = that user (fills/reaffirms)
--   SAME subscription + missing/invalid   -> owner = UNCHANGED (preserved)
--   NEW  subscription + valid initiator   -> owner = that user
--   NEW  subscription + missing/invalid   -> owner = NULL (fail closed; never inherited)
create or replace function public.process_paddle_subscription_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_workspace_id uuid,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_price_id text,
  p_quantity integer,
  p_expected_price_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_scheduled_change_action text,
  p_scheduled_change_effective_at timestamptz,
  p_initiating_user_id uuid
)
returns table (outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_processed_at timestamptz;
  v_workspace_row_id uuid;
  v_conflict_id uuid;
  v_conflict_workspace_id uuid;
  v_existing_id uuid;
  v_last_event_occurred_at timestamptz;
  v_existing_provider_subscription_id text;
  v_valid_initiating_user_id uuid;
  v_is_new_subscription boolean;
begin
  -- Programmer/transient-failure validation — see header comment. These
  -- are never legitimate Paddle data variations; every value here is
  -- already type-constrained by the Node normalization layer.
  if p_provider is null or p_provider <> 'PADDLE' then
    raise exception 'process_paddle_subscription_event: unsupported provider %', p_provider;
  end if;
  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'process_paddle_subscription_event: p_provider_event_id is required';
  end if;
  if p_event_type is null or p_event_type not in ('subscription.created', 'subscription.updated', 'subscription.canceled') then
    raise exception 'process_paddle_subscription_event: unsupported event_type %', p_event_type;
  end if;
  if p_occurred_at is null then
    raise exception 'process_paddle_subscription_event: p_occurred_at is required';
  end if;
  if p_provider_subscription_id is null or length(trim(p_provider_subscription_id)) = 0 then
    raise exception 'process_paddle_subscription_event: p_provider_subscription_id is required';
  end if;
  if p_provider_customer_id is null or length(trim(p_provider_customer_id)) = 0 then
    raise exception 'process_paddle_subscription_event: p_provider_customer_id is required';
  end if;
  if p_status is null or p_status not in ('active', 'trialing', 'past_due', 'paused', 'canceled') then
    raise exception 'process_paddle_subscription_event: unsupported status %', p_status;
  end if;
  if p_expected_price_id is null or length(trim(p_expected_price_id)) = 0 then
    raise exception 'process_paddle_subscription_event: p_expected_price_id is required';
  end if;
  if p_scheduled_change_action is not null and p_scheduled_change_action not in ('cancel', 'pause', 'resume') then
    raise exception 'process_paddle_subscription_event: unsupported scheduled_change_action %', p_scheduled_change_action;
  end if;

  -- (1) Claim/lock the event row — the idempotency concurrency boundary.
  insert into public.billing_webhook_events (provider, provider_event_id, event_type, occurred_at)
  values (p_provider, p_provider_event_id, p_event_type, p_occurred_at)
  on conflict (provider, provider_event_id) do nothing;

  select billing_webhook_events.processed_at into v_processed_at
  from public.billing_webhook_events
  where billing_webhook_events.provider = p_provider
    and billing_webhook_events.provider_event_id = p_provider_event_id
  for update;

  if v_processed_at is not null then
    return query select 'duplicate_processed'::text;
    return;
  end if;

  -- (2) Workspace identity — never inferred from anything else.
  if p_workspace_id is null then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'ignored_missing_workspace'::text;
    return;
  end if;

  -- (3) Lock the PARENT workspaces row — see original header comment for
  -- why this, not a workspace_subscriptions lock, is the concurrency fix.
  -- This is also the SAME row remove_workspace_admin locks first, which
  -- is exactly what makes the new admin-removal ownership check below
  -- (in that function) race-safe against this function: the two can
  -- never interleave for the same workspace_id.
  select workspaces.id into v_workspace_row_id
  from public.workspaces
  where workspaces.id = p_workspace_id
  for update;

  if not found then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'ignored_workspace_not_found'::text;
    return;
  end if;

  -- (4) Price/quantity.
  if p_provider_price_id is distinct from p_expected_price_id then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'ignored_wrong_price'::text;
    return;
  end if;
  if p_quantity is distinct from 1 then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'ignored_wrong_quantity'::text;
    return;
  end if;

  -- (5) Subscription-id ownership across workspaces — never silently
  -- transfer entitlement between workspaces.
  select workspace_subscriptions.id, workspace_subscriptions.workspace_id
    into v_conflict_id, v_conflict_workspace_id
  from public.workspace_subscriptions
  where workspace_subscriptions.provider = p_provider
    and workspace_subscriptions.provider_subscription_id = p_provider_subscription_id
  for update;

  if v_conflict_id is not null and v_conflict_workspace_id is distinct from p_workspace_id then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'conflict_subscription_belongs_to_other_workspace'::text;
    return;
  end if;

  -- (6) Current state for THIS workspace.
  select workspace_subscriptions.id, workspace_subscriptions.last_event_occurred_at, workspace_subscriptions.provider_subscription_id
    into v_existing_id, v_last_event_occurred_at, v_existing_provider_subscription_id
  from public.workspace_subscriptions
  where workspace_subscriptions.workspace_id = p_workspace_id
  for update;

  -- (6a) POST-M11-B2: validate the initiating-user ownership metadata.
  -- Valid only when it resolves to a real user belonging to THIS exact
  -- workspace — never assigned otherwise, never an exception (malformed
  -- custom_data must not block the other fields this event legitimately
  -- updates; it only means "no trustworthy ownership info this event").
  if p_initiating_user_id is not null and exists (
    select 1 from public.users
    where users.id = p_initiating_user_id
      and users.workspace_id = p_workspace_id
  ) then
    v_valid_initiating_user_id := p_initiating_user_id;
  end if;

  -- (6b) Same subscription (an update/cancellation/retry of what's
  -- already on this row) vs a NEW subscription replacing it (re-upgrade).
  -- Also true, trivially, when there is no existing row at all.
  v_is_new_subscription := v_existing_id is null or v_existing_provider_subscription_id is distinct from p_provider_subscription_id;

  -- (7) Out-of-order protection — unchanged.
  if v_existing_id is not null and p_occurred_at <= v_last_event_occurred_at then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'stale_event_ignored'::text;
    return;
  end if;

  -- (8) Upsert. billing_owner_user_id follows the CRITICAL OWNERSHIP RULE
  -- documented above the function: same subscription preserves an
  -- existing owner when this event's metadata is absent/invalid; a new
  -- subscription NEVER inherits the old row's owner under any
  -- circumstance — it's either the validated initiator, or NULL.
  if v_existing_id is not null then
    update public.workspace_subscriptions
    set provider_customer_id = p_provider_customer_id,
        provider_subscription_id = p_provider_subscription_id,
        provider_price_id = p_provider_price_id,
        plan = 'PRO',
        status = p_status,
        current_period_start = p_current_period_start,
        current_period_end = p_current_period_end,
        scheduled_change_action = p_scheduled_change_action,
        scheduled_change_effective_at = p_scheduled_change_effective_at,
        last_event_occurred_at = p_occurred_at,
        billing_owner_user_id = case
          when v_is_new_subscription then v_valid_initiating_user_id
          else coalesce(v_valid_initiating_user_id, workspace_subscriptions.billing_owner_user_id)
        end,
        updated_at = now()
    where workspace_subscriptions.workspace_id = p_workspace_id;
  else
    insert into public.workspace_subscriptions (
      workspace_id, provider, provider_customer_id, provider_subscription_id,
      provider_price_id, plan, status, current_period_start, current_period_end,
      scheduled_change_action, scheduled_change_effective_at, last_event_occurred_at,
      billing_owner_user_id
    ) values (
      p_workspace_id, p_provider, p_provider_customer_id, p_provider_subscription_id,
      p_provider_price_id, 'PRO', p_status, p_current_period_start, p_current_period_end,
      p_scheduled_change_action, p_scheduled_change_effective_at, p_occurred_at,
      v_valid_initiating_user_id
    );
  end if;

  -- (9) Finalize.
  update public.billing_webhook_events set processed_at = now()
    where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;

  return query select 'applied'::text;
end;
$$;

comment on function public.process_paddle_subscription_event is
  'Atomically applies one signature-verified Paddle subscription event to workspace_subscriptions, idempotent on (provider, provider_event_id) and safe under concurrency via a fixed lock order (event row -> parent workspaces row -> workspace_subscriptions). Also establishes/preserves billing_owner_user_id from a validated p_initiating_user_id: a same-subscription event preserves an existing owner when this event lacks valid ownership metadata, but a NEW provider_subscription_id replacing the workspace''s previous one NEVER inherits the old owner (POST-M11-B2 critical rule) — it gets the validated initiator or NULL, never a carried-forward historical owner. Never called with an unverified payload; the caller (POST /api/paddle/webhooks) verifies the Paddle signature and normalizes the event before invoking this.';

revoke all on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz, uuid
) from public;
revoke all on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz, uuid
) from anon;
revoke all on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz, uuid
) from authenticated;
grant execute on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz, uuid
) to service_role;

-- ---------------------------------------------------------------------
-- remove_workspace_admin(...) — block removing the Billing Owner while
-- they own a live/manageable subscription
-- ---------------------------------------------------------------------
--
-- Signature is unchanged (still (uuid, uuid)), so a plain create or
-- replace is sufficient — no drop needed, no overload risk.
--
-- Reuses the exact status set isBlockedFromNewCheckout already treats as
-- "a currently live, non-terminal billing relationship" (active,
-- trialing, past_due, paused) — canceled is deliberately excluded: an
-- owner of a canceled subscription is no longer responsible for anything
-- active and can be freely removed. This check runs AFTER the existing
-- last_admin check (never weakening it) and reuses the SAME workspaces-
-- row lock already acquired above in this function, which is also the
-- exact row process_paddle_subscription_event locks first — so admin
-- removal and webhook-driven ownership changes for the same workspace
-- can never interleave; this is genuinely race-safe, not just
-- Node-side UX.
create or replace function public.remove_workspace_admin(
  p_workspace_id uuid,
  p_user_id uuid
)
returns table (outcome text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_locked_id uuid;
  v_admin_count integer;
begin
  select id into v_locked_id from public.workspaces where id = p_workspace_id for update;
  if not found then
    return query select 'workspace_not_found'::text;
    return;
  end if;

  if not exists (select 1 from public.workspace_admins where workspace_id = p_workspace_id and user_id = p_user_id) then
    return query select 'not_admin'::text;
    return;
  end if;

  select count(*) into v_admin_count from public.workspace_admins where workspace_id = p_workspace_id;
  if v_admin_count <= 1 then
    return query select 'last_admin'::text;
    return;
  end if;

  if exists (
    select 1 from public.workspace_subscriptions ws
    where ws.workspace_id = p_workspace_id
      and ws.billing_owner_user_id = p_user_id
      and ws.status in ('active', 'trialing', 'past_due', 'paused')
  ) then
    return query select 'billing_owner_blocked'::text;
    return;
  end if;

  delete from public.workspace_admins where workspace_id = p_workspace_id and user_id = p_user_id;
  return query select 'removed'::text;
end;
$$;

comment on function public.remove_workspace_admin is
  'Atomically removes an admin grant unless doing so would leave the workspace with zero admins, or the target user currently owns the workspace''s active/trialing/past_due/paused Paddle subscription (POST-M11-B2). Serializes concurrent admin mutations by locking the parent workspaces row — the same row process_paddle_subscription_event locks first, so admin removal and webhook-driven ownership changes can never interleave. Caller must independently authorize the acting admin before invoking this.';

revoke all on function public.remove_workspace_admin(uuid, uuid) from public;
revoke all on function public.remove_workspace_admin(uuid, uuid) from anon;
revoke all on function public.remove_workspace_admin(uuid, uuid) from authenticated;
grant execute on function public.remove_workspace_admin(uuid, uuid) to service_role;

-- M10.3 — atomic webhook-driven subscription synchronization.
--
-- Adds the ONE new RPC that turns a signature-verified Paddle subscription
-- event into workspace_subscriptions/billing_webhook_events state.
-- Nothing else changes: the entitlement resolver (isEntitledToPro,
-- getWorkspaceEntitlements), configure_approval_policy's Pro gate, and
-- request routing are all untouched — they already read whatever this RPC
-- writes, with zero code changes needed on that side.
--
-- Optional, approved hardening: a CHECK constraint on
-- scheduled_change_action, confirmed safe against current production data
-- (workspace_subscriptions has zero rows today).
alter table public.workspace_subscriptions
  add constraint workspace_subscriptions_scheduled_change_action_check
  check (scheduled_change_action is null or scheduled_change_action in ('cancel', 'pause', 'resume'));

-- ---------------------------------------------------------------------
-- process_paddle_subscription_event(...)
-- ---------------------------------------------------------------------
--
-- Called ONLY after the caller (the /api/paddle/webhooks route) has
-- already verified the Paddle webhook signature via the official SDK's
-- paddle.webhooks.unmarshal() and normalized the event into these plain
-- scalar parameters. This function never sees a raw payload and never
-- talks to Paddle's API — everything it needs arrives as arguments.
--
-- INPUT VALIDATION PHILOSOPHY: two different failure classes are handled
-- two different ways, and this distinction is deliberate:
--   - Structurally-required fields that our OWN Node normalization layer
--     should always guarantee correct before calling this function
--     (non-empty ids, a supported provider, a supported event_type, a
--     supported status, a supported scheduled_change_action, a non-null
--     occurred_at, a non-empty expected price id) RAISE EXCEPTION if
--     violated. Reaching this function with one of these malformed is not
--     a legitimate Paddle data variation — every value here is already
--     type-constrained by Paddle's own SDK (SubscriptionStatus has
--     exactly 5 values; ScheduledChangeAction has exactly 3) — so a
--     violation means OUR code has a bug. Raising rolls back the entire
--     transaction (including the event claim below), so Paddle's retry
--     will hit the same failure and keep retrying — the correct signal
--     until we fix and redeploy, and harmless in the meantime since
--     nothing is ever partially written.
--   - Legitimate business decisions about a well-formed, already-verified
--     event that simply doesn't apply to us (unknown workspace, wrong
--     price, stale, cross-workspace conflict) are NEVER exceptions — they
--     return a plain outcome string, and the caller always maps that to
--     HTTP 200: retrying a permanent decision can't change it.
--
-- provider_price_id/quantity are DELIBERATELY allowed to be NULL — the
-- Node normalization layer passes NULL for both whenever a subscription's
-- items array doesn't contain EXACTLY ONE item (see
-- src/lib/billing/paddle-webhook-normalization.ts: a multi-item or
-- zero-item subscription is never assumed to be "the Pro item plus
-- something else" by blindly reading items[0] — it's normalized to "no
-- identifiable single item" instead, which this function's price check
-- below naturally rejects as ignored_wrong_price without any special
-- casing here).
--
-- CONCURRENCY / LOCK ORDERING (this is the corrected design from review):
-- locking the workspace_subscriptions row for a workspace that doesn't
-- have one yet is impossible — SELECT ... FOR UPDATE cannot lock a row
-- that doesn't exist, so it does NOT serialize two concurrent first-ever
-- events for the same workspace. Fixed by locking the PARENT
-- public.workspaces row first (same technique remove_workspace_admin
-- already uses to serialize concurrent child-table operations under a
-- shared parent). Every call to this function for the same
-- p_workspace_id acquires that same workspaces-row lock before touching
-- workspace_subscriptions at all, so:
--   - it doubles as the "does this workspace exist" check;
--   - two concurrent first-ever INSERTs for the same workspace can never
--     race, because the second call blocks on the workspaces-row lock
--     until the first transaction commits, then re-reads
--     workspace_subscriptions and correctly finds the just-inserted row;
--   - later UPDATEs for the same workspace are serialized the same way.
-- Fixed lock acquisition order, always: (1) billing_webhook_events event
-- row, (2) public.workspaces parent row, (3) workspace_subscriptions by
-- provider_subscription_id, (4) workspace_subscriptions by workspace_id.
-- This function is the ONLY writer of workspace_subscriptions, and it
-- never acquires these in any other order, so a lock-ordering deadlock is
-- not possible: two concurrent calls can only ever contend for locks in
-- this same sequence, which produces a wait queue, never a cycle. Step 4
-- re-locks a row already locked by step 3 within the same transaction
-- when they resolve to the same physical row (workspace_subscriptions has
-- both workspace_id and provider_subscription_id as UNIQUE, so a row
-- found by one lookup that belongs to p_workspace_id must be the same row
-- the other lookup would find) — Postgres row locks are per-transaction,
-- so re-acquiring FOR UPDATE on an already-self-locked row is a no-op.
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
  p_scheduled_change_effective_at timestamptz
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
  -- ON CONFLICT DO NOTHING never errors on a duplicate; the FOR UPDATE
  -- immediately after is what actually serializes two concurrent
  -- deliveries of the SAME event_id (the second call blocks here until
  -- the first transaction commits or rolls back).
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

  -- (2) Workspace identity — Node already validated UUID shape and passes
  -- NULL for anything missing/malformed; never inferred from anything
  -- else (email, customer name, price).
  if p_workspace_id is null then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'ignored_missing_workspace'::text;
    return;
  end if;

  -- (3) Lock the PARENT workspaces row — see header comment for why this,
  -- not a workspace_subscriptions lock, is the actual concurrency fix.
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

  -- (4) Price/quantity — never trust that carrying our workspace_id in
  -- custom_data alone proves this is our configured Pro plan.
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

  -- (5) Subscription-id ownership — never silently transfer entitlement
  -- between workspaces. Locked now, with the workspaces row already held,
  -- per the fixed lock order documented above.
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

  -- (6) Current state for THIS workspace — safe to read/lock now; the
  -- workspaces-row lock from step 3 already serializes every concurrent
  -- caller for this workspace_id, so no other transaction can be
  -- concurrently mutating this row underneath us.
  select workspace_subscriptions.id, workspace_subscriptions.last_event_occurred_at
    into v_existing_id, v_last_event_occurred_at
  from public.workspace_subscriptions
  where workspace_subscriptions.workspace_id = p_workspace_id
  for update;

  -- (7) Out-of-order protection. Equality deliberately keeps the
  -- already-applied state (never overwrite with a same-instant event),
  -- and this is never based on arrival order, only Paddle's occurred_at.
  if v_existing_id is not null and p_occurred_at <= v_last_event_occurred_at then
    update public.billing_webhook_events set processed_at = now()
      where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;
    return query select 'stale_event_ignored'::text;
    return;
  end if;

  -- (8) Upsert. UNIQUE(workspace_id) and UNIQUE(provider_subscription_id)
  -- are both satisfied by construction: step 5 already ruled out the only
  -- way provider_subscription_id could collide with a different
  -- workspace, and this branch is chosen on workspace_id, which is
  -- exactly what UNIQUE(workspace_id) protects. created_at is preserved
  -- on update (never touched by the UPDATE branch).
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
        updated_at = now()
    where workspace_subscriptions.workspace_id = p_workspace_id;
  else
    insert into public.workspace_subscriptions (
      workspace_id, provider, provider_customer_id, provider_subscription_id,
      provider_price_id, plan, status, current_period_start, current_period_end,
      scheduled_change_action, scheduled_change_effective_at, last_event_occurred_at
    ) values (
      p_workspace_id, p_provider, p_provider_customer_id, p_provider_subscription_id,
      p_provider_price_id, 'PRO', p_status, p_current_period_start, p_current_period_end,
      p_scheduled_change_action, p_scheduled_change_effective_at, p_occurred_at
    );
  end if;

  -- (9) Finalize. This UPDATE and the upsert above are part of the SAME
  -- transaction as the step-1 claim: if anything above raised, none of
  -- this — including the claim — would have committed, so a genuine
  -- failure leaves nothing "claimed but stuck." Paddle's retry sees a
  -- completely fresh state and tries again.
  update public.billing_webhook_events set processed_at = now()
    where billing_webhook_events.provider = p_provider and billing_webhook_events.provider_event_id = p_provider_event_id;

  return query select 'applied'::text;
end;
$$;

comment on function public.process_paddle_subscription_event is
  'Atomically applies one signature-verified Paddle subscription event to workspace_subscriptions, idempotent on (provider, provider_event_id) and safe under concurrency via a fixed lock order (event row -> parent workspaces row -> workspace_subscriptions). Never called with an unverified payload; the caller (POST /api/paddle/webhooks) verifies the Paddle signature and normalizes the event before invoking this. See this migration for the full algorithm and lock-ordering rationale.';

revoke all on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz
) from public;
revoke all on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz
) from anon;
revoke all on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz
) from authenticated;
grant execute on function public.process_paddle_subscription_event(
  text, text, text, timestamptz, uuid, text, text, text, integer, text, text, timestamptz, timestamptz, text, timestamptz
) to service_role;

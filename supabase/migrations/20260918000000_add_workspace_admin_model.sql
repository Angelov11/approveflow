-- M9: workspace administration model.
--
-- Before this migration there was no notion of "who controls this
-- ApproveFlow workspace" at all — every Slack user who ever ran a command
-- was treated identically. This adds the minimal model the M9 audit
-- concluded was sufficient: explicit ADMIN grants only, no MEMBER rows, no
-- role column on `users`, no organizations/teams/departments, no billing
-- concept whatsoever (FREE/PRO/BILLING_ADMIN are deliberately out of scope
-- — see the audit report for the reasoning).
--
-- workspace_admins row exists  -> that user is an ApproveFlow ADMIN for
--                                  that workspace.
-- no workspace_admins row      -> that user is a normal ApproveFlow user.
--
-- RLS: enabled, no anon/authenticated policies — same deny-by-default
-- posture as every other table in this app. All access goes through the
-- service-role client or the two functions below.

create table public.workspace_admins (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  -- Null means "granted by the initial-install bootstrap" (see
  -- install_or_reinstall_workspace below), not "unknown" — every row that
  -- resulted from an admin using the "Add Administrator" UX has a non-null
  -- granted_by identifying who granted it.
  granted_by uuid references public.users(id) on delete set null,
  primary key (workspace_id, user_id)
);

comment on table public.workspace_admins is
  'Explicit ApproveFlow administration grants, one row per (workspace, admin). Absence of a row means "normal user" — there is no separate MEMBER table by design (see the M9 audit).';
comment on column public.workspace_admins.granted_by is
  'The admin who granted this row via the "Add Administrator" UX, or null if this row was created by the initial-install bootstrap (see install_or_reinstall_workspace).';

alter table public.workspace_admins enable row level security;

-- No extra index: the composite primary key (workspace_id, user_id) already
-- supports "all admins for this workspace" (a leading-column prefix scan)
-- efficiently at any realistic scale for this MVP.

-- ---------------------------------------------------------------------
-- install_or_reinstall_workspace(...)
-- ---------------------------------------------------------------------
--
-- Replaces the OAuth callback's previous inline `.upsert()` with one
-- atomic operation that both persists the Slack installation AND, for a
-- genuinely brand-new workspace only, bootstraps the human OAuth installer
-- as the first ApproveFlow admin — in the SAME transaction, so there is no
-- window where the workspace row exists but the bootstrap admin insert
-- could be lost to a process crash between two separate round trips.
--
-- New-vs-existing detection deliberately does NOT rely on reading `xmax`
-- (an MVCC implementation detail) as an application-level signal. Instead
-- it uses a fully standard, documented, portable technique: an
-- `INSERT ... ON CONFLICT (slack_team_id) DO NOTHING RETURNING id` is
-- itself a single atomic statement — Postgres guarantees that of any two
-- concurrent attempts to insert the same `slack_team_id`, at most one can
-- return a row; the other necessarily sees the conflict and returns
-- nothing. "Did this INSERT hand back a row" is the entire signal, with no
-- internal system column exposed as a contract.
--
-- NOT YET verified by executing it against a real Postgres instance —
-- local Supabase/Docker testing was not completable in this environment.
-- This function has been through careful static SQL/security review only.
-- It must be exercised (including the concurrent-first-install race this
-- comment describes) during the controlled Supabase migration/preflight
-- stage before this migration is applied to production.
--
-- If the insert returns a row (workspace_id is not null): this
-- `slack_team_id` was genuinely new. `p_installer_slack_user_id` — which
-- the caller must populate from `oauth.v2.access`'s `authed_user.id`,
-- NEVER `bot_user_id`, a query parameter, or any client-supplied value —
-- is upserted into `users` and granted admin with `granted_by = null`,
-- atomically, before this function returns.
--
-- If the insert returns nothing: this is a reinstall of an existing
-- workspace (regardless of whether it was previously INSTALLED,
-- UNINSTALLED, or TOKEN_REVOKED — `installation_status` is never used as a
-- proxy for "first installation" here). Only the Slack installation/token
-- fields are updated. `workspace_admins` is never read, written, or
-- otherwise referenced in this branch — existing admins are preserved by
-- simply never touching the table, which is the safest possible
-- preservation guarantee.
create or replace function public.install_or_reinstall_workspace(
  p_slack_team_id text,
  p_slack_enterprise_id text,
  p_slack_app_id text,
  p_name text,
  p_bot_user_id text,
  p_bot_access_token_ciphertext text,
  p_bot_access_token_iv text,
  p_bot_access_token_auth_tag text,
  p_installer_slack_user_id text
)
returns table (workspace_id uuid, is_new_workspace boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_id uuid;
  v_installer_user_id uuid;
begin
  if p_slack_team_id is null or length(trim(p_slack_team_id)) = 0 then
    raise exception 'p_slack_team_id is required';
  end if;
  if p_bot_access_token_ciphertext is null or p_bot_access_token_iv is null or p_bot_access_token_auth_tag is null then
    raise exception 'encrypted bot token components are required';
  end if;

  insert into public.workspaces (
    slack_team_id, slack_enterprise_id, slack_app_id, name, bot_user_id,
    bot_access_token_ciphertext, bot_access_token_iv, bot_access_token_auth_tag,
    installation_status, uninstalled_at, installed_at
  ) values (
    p_slack_team_id, p_slack_enterprise_id, p_slack_app_id, p_name, p_bot_user_id,
    p_bot_access_token_ciphertext, p_bot_access_token_iv, p_bot_access_token_auth_tag,
    'INSTALLED', null, now()
  )
  on conflict (slack_team_id) do nothing
  returning id into v_workspace_id;

  if v_workspace_id is not null then
    if p_installer_slack_user_id is not null and length(trim(p_installer_slack_user_id)) > 0 then
      insert into public.users (workspace_id, slack_user_id)
      values (v_workspace_id, p_installer_slack_user_id)
      on conflict (workspace_id, slack_user_id) do update set slack_user_id = excluded.slack_user_id
      returning id into v_installer_user_id;

      insert into public.workspace_admins (workspace_id, user_id, granted_by)
      values (v_workspace_id, v_installer_user_id, null)
      on conflict (workspace_id, user_id) do nothing;
    end if;

    return query select v_workspace_id, true;
    return;
  end if;

  update public.workspaces
  set
    slack_enterprise_id = p_slack_enterprise_id,
    slack_app_id = p_slack_app_id,
    name = p_name,
    bot_user_id = p_bot_user_id,
    bot_access_token_ciphertext = p_bot_access_token_ciphertext,
    bot_access_token_iv = p_bot_access_token_iv,
    bot_access_token_auth_tag = p_bot_access_token_auth_tag,
    installation_status = 'INSTALLED',
    uninstalled_at = null,
    installed_at = now()
  where slack_team_id = p_slack_team_id
  returning id into v_workspace_id;

  return query select v_workspace_id, false;
end;
$$;

comment on function public.install_or_reinstall_workspace is
  'Atomically persists a Slack OAuth installation and, only for a genuinely brand-new workspace, bootstraps the human installer (authed_user.id) as the first admin. A reinstall of an existing workspace never touches workspace_admins. See the M9 migration header for the new-vs-existing detection mechanism.';

revoke all on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) from anon;
revoke all on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) from authenticated;
grant execute on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- remove_workspace_admin(...)
-- ---------------------------------------------------------------------
--
-- Guarantees a workspace can never transition from 1 admin to 0 admins,
-- including under the concrete race the M9 audit called out: Admin A
-- removes Admin B while Admin B concurrently removes Admin A, both having
-- independently observed "2 admins" before either commits.
--
-- Serializes on the PARENT workspace row (`select ... from workspaces
-- where id = p_workspace_id for update`), not on the workspace_admins row
-- set directly — locking a row set returned by a WHERE clause has subtler
-- edge cases around concurrent inserts landing outside what was already
-- locked (phantom-row concerns); locking one single, stable, always-
-- already-existing parent row sidesteps that entirely and gives every
-- concurrent admin mutation for this workspace one common serialization
-- point, the same technique this app already trusts for
-- decide_on_request()'s row-level locking.
--
-- Authorization for "is the acting user even an admin" is deliberately
-- NOT re-checked inside this function — the calling application code
-- (isWorkspaceAdmin(workspaceId, actingSlackUserId)) is responsible for
-- authorizing the acting admin BEFORE invoking this RPC, matching the
-- calling convention used for policy configuration below. This function's
-- only job is the one invariant only the database can safely guarantee
-- under concurrency: never let the admin count reach zero.
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

  delete from public.workspace_admins where workspace_id = p_workspace_id and user_id = p_user_id;
  return query select 'removed'::text;
end;
$$;

comment on function public.remove_workspace_admin is
  'Atomically removes an admin grant unless doing so would leave the workspace with zero admins. Serializes concurrent admin mutations by locking the parent workspaces row. Caller must independently authorize the acting admin before invoking this.';

revoke all on function public.remove_workspace_admin(uuid, uuid) from public;
revoke all on function public.remove_workspace_admin(uuid, uuid) from anon;
revoke all on function public.remove_workspace_admin(uuid, uuid) from authenticated;
grant execute on function public.remove_workspace_admin(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- configure_approval_policy(...)
-- ---------------------------------------------------------------------
--
-- Exposes the EXISTING M3/M4 policy engine (approval_policies +
-- approval_policy_members) through one atomic write, replacing the
-- multi-step, non-atomic sequence scripts/configure-approval-policy.ts has
-- always used by hand (look up existing active policy -> update-or-insert
-- -> delete all members -> insert new members) — a crash between the
-- policy write and the membership replace could previously leave a policy
-- pointing at a stale or empty member list. This function performs the
-- exact same logical steps, in the same order, inside one transaction.
--
-- Deliberately narrow: it does not re-implement decide_on_request's
-- routing/authorization semantics, and it does not authorize the acting
-- admin itself — application code calls isWorkspaceAdmin(...) BEFORE
-- invoking this, the same calling convention as remove_workspace_admin.
-- What it DOES enforce, because only the database can safely guarantee it
-- under concurrency and without trusting client-supplied identifiers:
--   - the request type actually belongs to the given workspace, and is
--     currently active (never trust a client-supplied request_type_id in
--     isolation);
--   - every supplied approver user_id actually belongs to this workspace;
--   - no duplicate approvers;
--   - an ACTIVE policy needs at least one approver;
--   - required_approvals is between 1 and the approver count (only
--     enforced against the approver count while the policy is being left
--     active — a disabled policy's stored threshold is inert either way).
--
-- Reuses the exact same "find the current active policy for this type,
-- update it in place, else insert" semantics as the existing script — this
-- is also how an admin "disables" a policy (p_active = false updates the
-- same row) and how they re-enable/edit it later (found again by the
-- (workspace_id, request_type_id) lookup, active or not is irrelevant to
-- finding it — see below). Never deletes a policy row; disabling is always
-- `active = false`, matching request_types.active's established
-- deactivate-only convention.
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
  'Atomically creates/updates a workspace''s policy for one request type and replaces its approver membership. Never deletes a policy row — disabling is always active=false. Caller must independently authorize the acting admin before invoking this.';

revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from public;
revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from anon;
revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from authenticated;
grant execute on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) to service_role;

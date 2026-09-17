-- M9 corrective migration — found during controlled RPC verification against
-- the linked production database (never edit an already-applied migration
-- file; see 20260918000000_add_workspace_admin_model.sql for the original).
--
-- Bug: `install_or_reinstall_workspace` declares `RETURNS TABLE (workspace_id
-- uuid, is_new_workspace boolean)`. Postgres implicitly declares each
-- RETURNS TABLE column as a PL/pgSQL variable in scope for the whole
-- function body. Two `INSERT ... ON CONFLICT (workspace_id, ...)` clauses in
-- the original body (the installer `users` upsert, and the initial
-- `workspace_admins` grant) reference the bare identifier `workspace_id` in
-- their conflict-target column list — a context Postgres cannot resolve
-- between "the workspace_id OUT parameter" and "the table's workspace_id
-- column," raising `42702: column reference "workspace_id" is ambiguous`.
-- `ON CONFLICT` target lists cannot be table-qualified (`on conflict
-- (users.workspace_id, ...)` is not valid syntax), so qualifying the
-- reference was not an option.
--
-- The same class of bug exists once more in `configure_approval_policy`
-- (`RETURNS TABLE (policy_id uuid, outcome text)`): `DELETE FROM
-- approval_policy_members WHERE policy_id = v_policy_id` bare-references
-- `policy_id`, colliding with the `policy_id` OUT parameter.
--
-- `remove_workspace_admin` (`RETURNS TABLE (outcome text)`) was re-audited
-- line by line and has no such collision anywhere in its body — none of its
-- bare column references are named `outcome` — so it is intentionally left
-- untouched by this migration.
--
-- Fix: add `#variable_conflict use_column` as the first line of each
-- affected function's body. This PL/pgSQL directive tells Postgres to
-- always prefer the table column over a same-named OUT/local variable when
-- a bare reference is ambiguous — the correct choice here, since neither
-- function ever actually reads the implicit RETURNS TABLE output variables
-- directly (both always populate their result via a separate, distinctly
-- named local variable — `v_workspace_id`/`v_policy_id` — passed to the
-- final `RETURN QUERY SELECT`). No other part of either function's logic,
-- signature, or return shape changes. `CREATE OR REPLACE FUNCTION` with an
-- identical signature preserves the existing grants (service_role only,
-- revoked from public/anon/authenticated) — re-asserted explicitly below
-- anyway, matching this project's established convention of never relying
-- on that silently (see decide_on_request's own migrations).
--
-- Verified safe against current production data: neither function has ever
-- successfully run to completion yet (the bug was caught on the very first
-- test call, which rolled back cleanly with zero rows written), so there is
-- no existing data whose shape depends on the previous behavior.

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
#variable_conflict use_column
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
  'Atomically persists a Slack OAuth installation and, only for a genuinely brand-new workspace, bootstraps the human installer (authed_user.id) as the first admin. A reinstall of an existing workspace never touches workspace_admins. See the M9 migration header for the new-vs-existing detection mechanism, and this migration for the #variable_conflict fix.';

revoke all on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) from anon;
revoke all on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) from authenticated;
grant execute on function public.install_or_reinstall_workspace(text, text, text, text, text, text, text, text, text) to service_role;

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
  'Atomically creates/updates a workspace''s policy for one request type and replaces its approver membership. Never deletes a policy row — disabling is always active=false. Caller must independently authorize the acting admin before invoking this. See this migration for the #variable_conflict fix.';

revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from public;
revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from anon;
revoke all on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) from authenticated;
grant execute on function public.configure_approval_policy(uuid, uuid, text, integer, boolean, uuid[]) to service_role;

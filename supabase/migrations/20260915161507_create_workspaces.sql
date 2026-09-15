-- Foundation for Slack workspace tenancy.
-- Slack OAuth token storage is intentionally deferred to M1, pending a
-- deliberate decision on how access tokens should be stored/encrypted.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null unique,
  name text,
  domain text,
  installed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is
  'Slack workspaces that have installed ApproveFlow. No access tokens stored here (see M1).';

-- Keep updated_at current on every row modification.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row
  execute function public.set_updated_at();

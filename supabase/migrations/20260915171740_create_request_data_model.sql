-- M2: users, request_types, requests.
--
-- Multi-tenancy: every table is scoped by workspace_id (FK to
-- workspaces.id). There are no cross-workspace shared rows — request_types
-- defaults are seeded per-workspace by application code the first time a
-- workspace needs them (src/lib/requests/request-types.ts), not by this
-- migration, since we don't know future workspace IDs at migration time.
--
-- RLS: enabled with no anon/authenticated policies, same "deny by default"
-- posture as the workspaces hardening migration. All M2 reads/writes go
-- through the service-role client from server-side routes
-- (src/app/api/slack/commands/request, src/app/api/slack/interactions).
-- If a future milestone needs direct client access (e.g. a dashboard using
-- the anon/authenticated key), add explicit, scoped policies then — do not
-- default-open these tables.

create table public.users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slack_user_id text not null,
  display_name text,
  -- Nullable: we don't have a Slack scope to read email addresses, and we
  -- won't request one just to populate this field.
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slack_user_id)
);

comment on table public.users is
  'Slack users known to ApproveFlow, scoped per workspace. Populated lazily on first interaction (e.g. running /request), not via any Slack directory sync.';

create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

create table public.request_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  requires_duration boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, key)
);

comment on table public.request_types is
  'Per-workspace request type catalog. Defaults are upserted idempotently by application code the first time a workspace needs them — never shared across workspaces.';

create trigger request_types_set_updated_at
  before update on public.request_types
  for each row
  execute function public.set_updated_at();

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- RESTRICT, not CASCADE: a user or request type that has been used by a
  -- request is part of that request's audit trail and shouldn't be
  -- deletable out from under it.
  requester_id uuid not null references public.users(id) on delete restrict,
  request_type_id uuid not null references public.request_types(id) on delete restrict,
  resource text not null check (char_length(resource) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 2000),
  requested_duration_minutes integer check (requested_duration_minutes is null or requested_duration_minutes > 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  -- Dedupes retried Slack modal submissions (see src/app/api/slack/interactions).
  -- One idempotency key per opened modal instance; a unique-violation on
  -- insert means this exact submission was already persisted.
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.requests is
  'Access/approval requests submitted via the Slack /request modal. M2 only creates PENDING requests — approval routing is a later milestone.';

create trigger requests_set_updated_at
  before update on public.requests
  for each row
  execute function public.set_updated_at();

-- Supports "requests in this workspace, optionally filtered by status" —
-- the obvious multi-tenant listing query.
create index requests_workspace_status_idx on public.requests (workspace_id, status);
-- Supports "my requests".
create index requests_requester_idx on public.requests (requester_id);

alter table public.users enable row level security;
alter table public.request_types enable row level security;
alter table public.requests enable row level security;

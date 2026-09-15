-- M3: approval policies and recorded decisions.
--
-- Tenancy: policies and their members are workspace-scoped transitively via
-- request_type_id -> request_types.workspace_id (and user_id ->
-- users.workspace_id). approval_policy_members deliberately has no
-- workspace_id column of its own — there's no concrete query/integrity gap
-- that column would fix, only redundancy, since both FKs already anchor it
-- to a single workspace by construction (a request_type row belongs to
-- exactly one workspace, and this app never creates a policy or membership
-- row referencing a request_type/user from a different workspace).
--
-- RLS: enabled with no anon/authenticated policies, same posture as every
-- prior milestone. All reads/writes go through the service-role client or
-- the decide_on_request() function (see the next migration).

create table public.approval_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_type_id uuid not null references public.request_types(id) on delete cascade,
  name text not null,
  required_approvals integer not null default 1 check (required_approvals >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.approval_policies is
  'Workspace-scoped approval policy per request type. M3 supports exactly one active policy per (workspace_id, request_type_id) — see the partial unique index below.';

-- "One active policy per request type per workspace" enforced deliberately,
-- not just by convention: a second INSERT/UPDATE that would leave two
-- active policies for the same (workspace_id, request_type_id) fails here.
create unique index approval_policies_one_active_per_type
  on public.approval_policies (workspace_id, request_type_id)
  where active;

create trigger approval_policies_set_updated_at
  before update on public.approval_policies
  for each row
  execute function public.set_updated_at();

create table public.approval_policy_members (
  policy_id uuid not null references public.approval_policies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (policy_id, user_id)
);

comment on table public.approval_policy_members is
  'Users who may approve/reject requests under a given policy. Configured via scripts/configure-approval-policy.ts in M3 — no admin UI yet.';

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  -- Cascades with the request: an approval record has no meaning without
  -- the request it decided on.
  request_id uuid not null references public.requests(id) on delete cascade,
  -- Restrict, not cascade: preserves the audit trail — a user who has made
  -- a decision shouldn't be deletable out from under it (same reasoning as
  -- requests.requester_id in the M2 migration).
  approver_id uuid not null references public.users(id) on delete restrict,
  decision text not null check (decision in ('APPROVED', 'REJECTED')),
  comment text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One final decision per approver per request. Combined with the
  -- application logic in decide_on_request() (which checks for an existing
  -- row before inserting), this makes decisions effectively immutable: M3
  -- has no UPDATE path for this table at all, deliberately — there's no
  -- "change your mind" flow yet, so there's no update trigger either.
  unique (request_id, approver_id)
);

comment on table public.approvals is
  'Immutable approve/reject decisions. No update trigger by design — decisions are never edited in M3, only ever inserted once per (request_id, approver_id).';

alter table public.approval_policies enable row level security;
alter table public.approval_policy_members enable row level security;
alter table public.approvals enable row level security;

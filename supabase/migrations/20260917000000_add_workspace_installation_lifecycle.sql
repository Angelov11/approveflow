-- M8.1: Slack workspace installation lifecycle.
--
-- Before this migration, `workspaces` had no notion of "installed" at all —
-- a row either existed (implicitly installed) or didn't. Slack is now
-- configured to deliver `app_uninstalled` and `tokens_revoked` (see
-- src/app/api/slack/events/route.ts), and both need somewhere to record
-- that this workspace's Slack installation is no longer usable — without
-- ever deleting the workspace row or anything that references it.
--
-- installation_status: text + CHECK, not a native Postgres ENUM — matches
-- this project's own established convention everywhere else (requests.status,
-- approvals.decision, requests.routing_type are all `text ... check (col in
-- (...))`), and avoids ALTER TYPE ... ADD VALUE friction if a fourth state
-- is ever needed. Three states, not two: INSTALLED and UNINSTALLED cover the
-- lifecycle the task asked for; TOKEN_REVOKED is added separately because
-- `tokens_revoked` and `app_uninstalled` are NOT the same Slack event and
-- must not be conflated (see the events route's handling) — even though
-- every "is this installation usable" guard treats TOKEN_REVOKED and
-- UNINSTALLED identically (see getUsableInstallation in
-- src/lib/requests/workspace-lookup.ts), keeping them distinct preserves
-- the more specific fact for support/debugging.
--
-- DEFAULT 'INSTALLED' backfills the current production row correctly with
-- no separate UPDATE needed — it IS installed today (it has a valid,
-- working bot token). Safe against current production data: 1 workspace,
-- fully installed.
alter table public.workspaces
  add column installation_status text not null default 'INSTALLED'
    check (installation_status in ('INSTALLED', 'TOKEN_REVOKED', 'UNINSTALLED'));

comment on column public.workspaces.installation_status is
  'Slack installation lifecycle state — INSTALLED, TOKEN_REVOKED (tokens_revoked received, distinct from a full uninstall), or UNINSTALLED (app_uninstalled received). Never implies anything about billing. See src/lib/requests/compute-installation-transition.ts for the transition rules.';

-- Nullable: null for every currently-installed row (including the existing
-- production workspace, which has never been uninstalled). Set only when
-- transitioning INTO 'UNINSTALLED', and left untouched by a redelivered
-- app_uninstalled while already UNINSTALLED (idempotent — see the events
-- route and compute-installation-transition.ts).
alter table public.workspaces
  add column uninstalled_at timestamptz null;

comment on column public.workspaces.uninstalled_at is
  'When this workspace transitioned to UNINSTALLED. Null while INSTALLED or TOKEN_REVOKED. Never reset by a redelivered app_uninstalled event once already set.';

-- Relaxed, not dropped: an uninstalled/token-revoked workspace has no
-- usable bot token, and the target lifecycle semantics explicitly call for
-- clearing it rather than leaving a token Slack has already invalidated
-- lying around encrypted-but-stale. Safe against current production data —
-- relaxing NOT NULL never violates an existing (fully populated) row, same
-- precedent as the M8 `relax_requests_reason_not_null` migration. All three
-- token columns are always written/cleared together as one unit (see
-- oauth/callback/route.ts and events/route.ts) — never independently null.
alter table public.workspaces
  alter column bot_access_token_ciphertext drop not null,
  alter column bot_access_token_iv drop not null,
  alter column bot_access_token_auth_tag drop not null;

-- Deliberately NOT added in this migration:
--   - first_installed_at: created_at already records when the workspace row
--     was first created, and installed_at already represents "most recent
--     successful OAuth install/reinstall" — a third timestamp would be
--     redundant for this MVP's lifecycle needs.
--   - An index on installation_status: at today's scale (a small number of
--     workspaces), a full-table scan is irrelevant; trivial to add later
--     (`create index workspaces_installation_status_idx on workspaces
--     (installation_status)`) if workspace count ever makes it worth it.
--   - A trigger or a lifecycle RPC: all writers of installation_status are
--     already-trusted, signature-verified, service-role server code (OAuth
--     callback, Events API handler) — unlike decide_on_request(), there is
--     no RLS-bypass/anon-client attack surface here that would justify a
--     SECURITY DEFINER function.

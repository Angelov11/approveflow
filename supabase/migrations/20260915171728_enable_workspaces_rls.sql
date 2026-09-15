-- Hardening fix, not part of the original M0/M1 migrations: `workspaces`
-- was never given row level security, which means Supabase's default
-- `anon`/`authenticated` grants on the `public` schema made every row
-- (including encrypted-token columns) readable via the public anon key.
-- Verified directly against the linked project before writing this
-- migration (SELECT via the anon key succeeded).
--
-- All application access to `workspaces` goes through the service-role
-- client (src/lib/supabase/admin.ts), which bypasses RLS entirely. So we
-- enable RLS here and intentionally add no anon/authenticated policies —
-- this is a deliberate "deny by default" posture, not an oversight. See
-- the M2 migration for the same decision applied to the new tables.

alter table public.workspaces enable row level security;

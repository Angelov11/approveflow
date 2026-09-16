-- M8: MVP simplification retires the original AWS/access-shaped default
-- request types (production_access, deployment_approval, software_access,
-- purchase_approval, custom) in favor of everyday workplace request types
-- (vacation_time_off, doctor_appointment, work_from_home, personal_time,
-- schedule_change, expense_purchase, other — see request-types.ts).
--
-- This is a pure DATA fixup, not a schema change: `request_types.active`
-- already exists (M2) and `listActiveRequestTypes()` already filters on it
-- (`.eq("active", true)`) when building the request modal and validating a
-- submission's selected key. Deactivating a row makes it immediately
-- unselectable for NEW requests without deleting anything — historical
-- requests keep their `request_type_id` foreign key exactly as-is (ON
-- DELETE RESTRICT was never triggered here, nothing was deleted), and
-- Request Details/notifications still resolve and render the type's `name`
-- normally regardless of `active`.
--
-- Read-only production inspection before writing this migration: exactly
-- these 5 keys exist today, all workspace-scoped to the single installed
-- workspace, all currently `active = true`. 16 historical requests
-- reference them (8 `custom`, 8 `production_access`; `deployment_approval`/
-- `software_access`/`purchase_approval` have zero requests), and one active
-- approval policy ("Production Access Approval") references
-- `production_access`. None of that is touched here — the policy row, its
-- members, and every historical request/approval remain fully intact and
-- functional; only future request CREATION is affected.
--
-- Global WHERE key IN (...), not scoped to a specific workspace_id: safe
-- and correct because these 5 keys are never seeded for any workspace again
-- (they're gone from DEFAULT_REQUEST_TYPES as of this milestone) — any row
-- with one of these keys, in any workspace, is by definition a pre-M8
-- install that should see the same clean MVP list as everyone else.

update public.request_types
set active = false
where key in (
  'production_access',
  'deployment_approval',
  'software_access',
  'purchase_approval',
  'custom'
);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * M11.1 regression: `workspace_admins` has two foreign keys into
 * `users(id)` — `user_id` and `granted_by` — so a bare `users(...)` embed
 * in listWorkspaceAdmins() is ambiguous to PostgREST and throws at runtime
 * ("Could not embed because more than one relationship was found for
 * 'workspace_admins' and 'users'"), confirmed against production. There is
 * no existing DB-mocking test convention in this codebase to exercise the
 * query itself, so this asserts the source text uses the explicit,
 * disambiguated relationship instead of the ambiguous shorthand — cheap,
 * and exactly what would catch someone reverting the fix.
 */
const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "workspace-admins.ts"), "utf8");

test("listWorkspaceAdmins uses the explicit users!workspace_admins_user_id_fkey embed", () => {
  assert.ok(
    source.includes("users!workspace_admins_user_id_fkey(slack_user_id)"),
    "expected the disambiguated users!workspace_admins_user_id_fkey(...) embed",
  );
});

test("workspace-admins.ts never reintroduces the ambiguous bare users(...) embed", () => {
  assert.ok(
    !/[^!]users\(slack_user_id\)/.test(source),
    "found a bare users(slack_user_id) embed — ambiguous given workspace_admins' two FKs to users, throws at runtime",
  );
});

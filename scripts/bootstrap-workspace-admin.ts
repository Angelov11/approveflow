/**
 * One-time admin CLI for M9: grants ApproveFlow administration to a
 * specific human Slack user in a specific workspace. This exists ONLY for
 * workspaces that were installed before M9 — every workspace installed
 * from M9 onward gets its first admin bootstrapped automatically at OAuth
 * time (see install_or_reinstall_workspace() and oauth/callback/route.ts),
 * from oauth.v2.access's authed_user.id, which a pre-M9 install never
 * captured. There is no way to recover that original installer's identity
 * after the fact — this script exists precisely because guessing would be
 * wrong (see the M9 audit for why every automatic alternative was
 * rejected). This is NOT an HTTP endpoint — it's a one-off script you run
 * locally against your own Supabase project, using the service role key
 * from .env.local, exactly like scripts/configure-approval-policy.ts.
 *
 * Idempotent/re-runnable: granting the same --team/--admin pair twice is a
 * safe no-op (ON CONFLICT DO NOTHING at the DB level).
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/bootstrap-workspace-admin.ts \
 *     --team T0123456 \
 *     --admin U0111111
 *
 * The Slack user ID (--admin) is not looked up automatically — this app
 * has no Slack scope to search the workspace directory. In Slack, open the
 * person's profile -> "..." -> "Copy member ID".
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    team: { type: "string" },
    admin: { type: "string" },
  },
});

const slackTeamId = values.team;
const adminSlackUserId = values.admin;

if (!slackTeamId || !adminSlackUserId) {
  fail("Usage: --team <slack_team_id> --admin <slack_user_id>");
}

// Basic sanity checks — Slack team IDs start with T, user IDs start with U.
// This can never fully validate a real Slack identifier, but it catches
// the obvious mistake of pasting the wrong kind of ID or a stray argument.
if (!/^T[A-Z0-9]+$/i.test(slackTeamId)) {
  fail(`--team must look like a Slack team ID (e.g. T0123456), got: ${slackTeamId}`);
}
if (!/^U[A-Z0-9]+$/i.test(adminSlackUserId)) {
  fail(`--admin must look like a Slack user ID (e.g. U0111111), got: ${adminSlackUserId}`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. via --env-file=.env.local).");
}

// A standalone client, not src/lib/supabase/admin.ts: that module imports
// "server-only", which throws when loaded outside Next.js's bundler — same
// reasoning as scripts/configure-approval-policy.ts.
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, bot_user_id")
    .eq("slack_team_id", slackTeamId)
    .maybeSingle();
  if (workspaceError) fail(`Looking up workspace: ${workspaceError.message}`);
  if (!workspace) fail(`No installed workspace with slack_team_id ${slackTeamId}.`);

  // Never grant the workspace's own bot account admin — it is not a
  // person, and app.uninstall/tokens_revoked handling can rotate/clear its
  // token, which must never be conflated with removing an administrator.
  if (workspace.bot_user_id && workspace.bot_user_id === adminSlackUserId) {
    fail(`Refusing to grant admin to ${adminSlackUserId} — that is this workspace's own bot user, not a person.`);
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .upsert({ workspace_id: workspace.id, slack_user_id: adminSlackUserId }, { onConflict: "workspace_id,slack_user_id" })
    .select("id")
    .single();
  if (userError || !user) fail(`Upserting admin user: ${userError?.message ?? "no row returned"}`);

  const { error: grantError } = await supabase
    .from("workspace_admins")
    .upsert(
      { workspace_id: workspace.id, user_id: user.id, granted_by: null },
      { onConflict: "workspace_id,user_id", ignoreDuplicates: true },
    );
  if (grantError) fail(`Granting admin: ${grantError.message}`);

  // Safe confirmation only — never the workspace row's token columns.
  console.log(`Granted ApproveGo admin to ${adminSlackUserId} in workspace ${slackTeamId} (workspace id ${workspace.id}). Safe to re-run.`);
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown error"));

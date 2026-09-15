/**
 * Dev/admin tool for M3: assigns approvers to a request type in a
 * workspace. This is NOT an HTTP endpoint — it's a one-off script you run
 * locally against your own Supabase project, using the service role key
 * from .env.local. There is no admin UI yet.
 *
 * Idempotent/re-runnable: re-running with the same --team/--request-type
 * updates the existing active policy in place and replaces its member list
 * with exactly the --approver values given (not additive).
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local \
 *     scripts/configure-approval-policy.ts \
 *     --team T0123456 \
 *     --request-type production_access \
 *     --name "Production Access Approvers" \
 *     --required 2 \
 *     --approver U0111111 --approver U0222222
 *
 * Slack user IDs (the --approver values) are not looked up automatically —
 * this app has no Slack scope to search the workspace directory. In Slack,
 * open the person's profile -> "..." -> "Copy member ID".
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
    "request-type": { type: "string" },
    name: { type: "string" },
    required: { type: "string" },
    approver: { type: "string", multiple: true },
  },
});

const slackTeamId = values.team;
const requestTypeKey = values["request-type"];
const policyName = values.name;
const requiredApprovals = values.required ? Number(values.required) : undefined;
const approverSlackIds = values.approver ?? [];

if (!slackTeamId || !requestTypeKey || !policyName || !requiredApprovals || approverSlackIds.length === 0) {
  fail(
    "Usage: --team <slack_team_id> --request-type <key> --name <policy name> --required <N> --approver <slack_user_id> [--approver <slack_user_id> ...]",
  );
}
if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1) {
  fail("--required must be an integer >= 1");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. via --env-file=.env.local).");
}

// A standalone client, not src/lib/supabase/admin.ts: that module imports
// "server-only", which throws when loaded outside Next.js's bundler (see
// src/lib/crypto/token-cipher.ts's header comment for the same issue with
// unit tests). This script runs under plain Node, so it builds its own
// client instead of weakening that guard for the app's real routes.
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slack_team_id", slackTeamId)
    .maybeSingle();
  if (workspaceError) fail(`Looking up workspace: ${workspaceError.message}`);
  if (!workspace) fail(`No installed workspace with slack_team_id ${slackTeamId}.`);

  const { data: requestType, error: requestTypeError } = await supabase
    .from("request_types")
    .select("id, name")
    .eq("workspace_id", workspace.id)
    .eq("key", requestTypeKey)
    .maybeSingle();
  if (requestTypeError) fail(`Looking up request type: ${requestTypeError.message}`);
  if (!requestType) {
    fail(
      `No request type '${requestTypeKey}' for this workspace yet. Run /request once in Slack first — it seeds the default request types.`,
    );
  }

  const userIds: string[] = [];
  for (const slackUserId of approverSlackIds) {
    const { data: user, error: userError } = await supabase
      .from("users")
      .upsert({ workspace_id: workspace.id, slack_user_id: slackUserId }, { onConflict: "workspace_id,slack_user_id" })
      .select("id")
      .single();
    if (userError || !user) fail(`Upserting approver ${slackUserId}: ${userError?.message ?? "no row returned"}`);
    userIds.push(user.id);
  }

  const { data: existingPolicy, error: existingPolicyError } = await supabase
    .from("approval_policies")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("request_type_id", requestType.id)
    .eq("active", true)
    .maybeSingle();
  if (existingPolicyError) fail(`Looking up existing policy: ${existingPolicyError.message}`);

  let policyId: string;
  if (existingPolicy) {
    const { error: updateError } = await supabase
      .from("approval_policies")
      .update({ name: policyName, required_approvals: requiredApprovals })
      .eq("id", existingPolicy.id);
    if (updateError) fail(`Updating existing policy: ${updateError.message}`);
    policyId = existingPolicy.id;
  } else {
    const { data: newPolicy, error: insertError } = await supabase
      .from("approval_policies")
      .insert({
        workspace_id: workspace.id,
        request_type_id: requestType.id,
        name: policyName,
        required_approvals: requiredApprovals,
        active: true,
      })
      .select("id")
      .single();
    if (insertError || !newPolicy) fail(`Creating policy: ${insertError?.message ?? "no row returned"}`);
    policyId = newPolicy.id;
  }

  const { error: deleteMembersError } = await supabase.from("approval_policy_members").delete().eq("policy_id", policyId);
  if (deleteMembersError) fail(`Replacing policy members: ${deleteMembersError.message}`);

  const { error: insertMembersError } = await supabase
    .from("approval_policy_members")
    .insert(userIds.map((userId) => ({ policy_id: policyId, user_id: userId })));
  if (insertMembersError) fail(`Adding policy members: ${insertMembersError.message}`);

  console.log(
    `Configured policy '${policyName}' (${policyId}) for request type '${requestTypeKey}' (${requestType.name}): required_approvals=${requiredApprovals}, members=${approverSlackIds.length}.`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown error"));

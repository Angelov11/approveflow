import "server-only";

import { isBotAdminCandidate } from "@/lib/requests/is-bot-admin-candidate";
import { upsertSlackUser } from "@/lib/requests/workspace-lookup";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RemoveWorkspaceAdminOutcome } from "@/types/admin";

/**
 * M9: the single, centralized authorization check for every administrative
 * action. Resolves the acting Slack user against server-side
 * `workspace_admins` state — never trusts Slack UI visibility, a modal's
 * `private_metadata`, or the action payload's selected-user value alone.
 * Fails closed: an unknown workspace/user, or any ambiguity, resolves to
 * `false`, never `true`.
 *
 * Two sequential, simple lookups rather than one embedded-join query —
 * this app has no existing precedent for filtering on a PostgREST embedded
 * resource's column, and correctness here matters far more than shaving
 * one small round trip on a path that is never trigger_id-latency-critical
 * the way request creation is.
 */
export async function isWorkspaceAdmin(workspaceId: string, slackUserId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  if (userError) {
    throw new Error(`Failed to resolve user for admin check: ${userError.message}`);
  }
  if (!user) {
    // Never seen this Slack user in this workspace — definitely not an admin.
    return false;
  }

  const { data: admin, error: adminError } = await supabase
    .from("workspace_admins")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminError) {
    throw new Error(`Failed to check admin membership: ${adminError.message}`);
  }
  return Boolean(admin);
}

export interface WorkspaceAdminSummary {
  userId: string;
  slackUserId: string;
}

/** For rendering "Current administrators" — see build-admin-views.ts. */
export async function listWorkspaceAdmins(workspaceId: string): Promise<WorkspaceAdminSummary[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("workspace_admins")
    .select("user_id, users(slack_user_id)")
    .eq("workspace_id", workspaceId)
    .order("granted_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list workspace admins: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => {
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      return user?.slack_user_id ? { userId: row.user_id, slackUserId: user.slack_user_id } : null;
    })
    .filter((row): row is WorkspaceAdminSummary => row !== null);
}

export type GrantWorkspaceAdminOutcome = "granted" | "already_admin" | "bot_rejected";

/**
 * Idempotent (ON CONFLICT DO NOTHING at the DB level — a duplicate grant is
 * a harmless no-op) and rejects granting admin to the workspace's own bot
 * user, since the bot is never a person and must never hold administrative
 * privileges. `targetSlackUserId` is upserted into `users` first (an admin
 * may add someone who has never interacted with ApproveFlow before).
 */
export async function grantWorkspaceAdmin(params: {
  workspaceId: string;
  targetSlackUserId: string;
  workspaceBotUserId: string | null;
  grantedByUserId: string;
}): Promise<GrantWorkspaceAdminOutcome> {
  const { workspaceId, targetSlackUserId, workspaceBotUserId, grantedByUserId } = params;

  if (isBotAdminCandidate(targetSlackUserId, workspaceBotUserId)) {
    return "bot_rejected";
  }

  const target = await upsertSlackUser(workspaceId, targetSlackUserId);

  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("workspace_admins")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", target.id)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to check existing admin grant: ${existingError.message}`);
  }
  if (existing) {
    return "already_admin";
  }

  const { error: insertError } = await supabase
    .from("workspace_admins")
    .upsert({ workspace_id: workspaceId, user_id: target.id, granted_by: grantedByUserId }, { onConflict: "workspace_id,user_id", ignoreDuplicates: true });
  if (insertError) {
    throw new Error(`Failed to grant workspace admin: ${insertError.message}`);
  }
  return "granted";
}

/** Thin wrapper around the atomic `remove_workspace_admin` RPC — see its migration header for the last-admin-protection design. Caller must have already authorized the acting admin via isWorkspaceAdmin(). */
export async function removeWorkspaceAdmin(workspaceId: string, targetUserId: string): Promise<RemoveWorkspaceAdminOutcome> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("remove_workspace_admin", {
    p_workspace_id: workspaceId,
    p_user_id: targetUserId,
  });

  if (error) {
    throw new Error(`remove_workspace_admin failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.outcome) {
    throw new Error("remove_workspace_admin returned no result");
  }
  return row.outcome as RemoveWorkspaceAdminOutcome;
}
